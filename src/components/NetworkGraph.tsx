// trigger reload
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import * as d3 from 'd3';
import { GraphData, GraphNode, GraphLink, groupsMetadata, RINGS } from '../data';
import PathFinderPanel, { PathHighlightInfo } from './PathFinderPanel';
import { NetworkGraph2D } from './NetworkGraph2D';

// ==========================================
// 💡 물리 엔진 통합 설정 (여기서 한 번만 수정하세요!)
// ==========================================

// 1. 노드 간 밀어내는 힘 (척력)
export const getNodeChargeStrength = (node: any) => {
  if (node.isDeviceNode) return -30; // 장비 노드 척력
  if (node.isGroupNode) return -50;  // 그룹 노드 척력
  if (node.isInterfaceNode) return -1; // 인터페이스 척력 대폭 감소 (장비에 찰싹 붙도록)
  return -20; // 기본 노드 척력
};

// 2. 노드 간 연결선 길이 (인장력)
export const getLinkDistance = (link: any) => {
  if (link.isRingLink) return 135; // 보이지 않는 링 중심 노드와의 간격 (기존 90에서 1.5배 늘림)
  if (link.isRingTopologyLink) return 428; // 타 그룹과의 간격 (링 둘레, 기존 285에서 1.5배 늘림)
  if (link.isGroupToDevice) return 50; // 내 그룹과 소속 장비 간격 (기존 100에서 50으로 절반 축소)
  if (link.isDeviceToInterface) return Math.max(22, Math.sqrt(link.interfaceCount || 1) * 10); // 장비와 포트(인터페이스) 간격 (현재 8에서 2배인 16으로 늘림)
  if (link.isHierarchyLink) return 20; // 기타 계층 보조선

  const srcNode = typeof link.source === 'object' ? link.source : null;
  const tgtNode = typeof link.target === 'object' ? link.target : null;

  const isSourceInterface = srcNode?.isInterfaceNode;
  const isTargetInterface = tgtNode?.isInterfaceNode;

  // 1. 인터페이스가 포함된 점선 (인터페이스 <-> 타 인터페이스 등)
  if (isSourceInterface || isTargetInterface) {
    return 40; // 👈 포트와 포트 사이의 간격을 20에서 40으로 늘림
  }

  // 2. 장비가 포함된 점선 (장비 <-> 타 그룹 등)
  const isSourceGroup = srcNode ? srcNode.isGroupNode : String(link.source).startsWith('group-');
  const isTargetGroup = tgtNode ? tgtNode.isGroupNode : String(link.target).startsWith('group-');
  if (!(isSourceGroup && isTargetGroup)) {
    return 50; // 👈 장비 <-> 타 그룹 점선 길이 (일반 그룹-장비 간격과 동일하게 50으로 맞춤)
  }

  return 20; // 기본 선 길이
};

// 2.5 노드 간 연결선 당기는 힘 (강도)
export const getLinkStrength = (link: any) => {
  if (link.isDeviceToInterface) return 2.0; // 인터페이스를 장비에 매우 강하게 결속
  if (link.isHierarchyLink) return 0.5;
  if (link.isRingTopologyLink) return 0.05;
  return 0.2;
};

// 3. 커스텀 척력: 라인이 노드를 관통하지 못하도록 노드를 밀어내는 물리 힘 (곡선 지양)
export const createLinkCollideForce = (links: any[]) => {
  let nodes: any[] = [];

  function force(alpha: number) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.x === undefined || node.y === undefined || node.z === undefined) continue;

      for (let j = 0; j < links.length; j++) {
        const link = links[j];
        const source = typeof link.source === 'object' ? link.source : nodes.find(n => n.id === link.source);
        const target = typeof link.target === 'object' ? link.target : nodes.find(n => n.id === link.target);

        if (!source || !target || source.x === undefined || target.x === undefined) continue;
        if (node.id === source.id || node.id === target.id) continue;

        const abx = target.x - source.x;
        const aby = target.y - source.y;
        const abz = target.z - source.z;

        const apx = node.x - source.x;
        const apy = node.y - source.y;
        const apz = node.z - source.z;

        const ab2 = abx * abx + aby * aby + abz * abz;
        if (ab2 === 0) continue;

        let t = (apx * abx + apy * aby + apz * abz) / ab2;
        if (t < 0 || t > 1) continue; // 선분의 연장선상이 아닌 실제 선분 사이에 있을 때만 충돌 판정

        const cx = source.x + t * abx;
        const cy = source.y + t * aby;
        const cz = source.z + t * abz;

        const pcx = node.x - cx;
        const pcy = node.y - cy;
        const pcz = node.z - cz;

        const dist2 = pcx * pcx + pcy * pcy + pcz * pcz;
        const R = node.isGroupNode ? 45 : (node.isDeviceNode ? 25 : 15); // 노드 크기에 맞춘 회피 반경

        if (dist2 < R * R && dist2 > 0) {
          const dist = Math.sqrt(dist2);
          const forceMag = (R - dist) / dist * alpha * 3.0; // 반작용도 고려하여 강도를 약간 더 높임

          // 1. 노드를 선분 밖으로 밀어내기 (작용)
          node.vx += pcx * forceMag;
          node.vy += pcy * forceMag;
          node.vz += pcz * forceMag;

          // 2. 선분(의 양 끝점)을 노드 반대 방향으로 밀어내기 (반작용)
          // 무거운 그룹 노드를 선이 관통하려 할 때, 가벼운 장비 노드(끝점)가 반사적으로 튕겨나가게 하여
          // 특정 노드 예외 처리 없이도 모든 상황에서 자연스럽게 선이 노드를 피해 돌아가도록 만듦.
          const oppX = -pcx * forceMag;
          const oppY = -pcy * forceMag;
          const oppZ = -pcz * forceMag;

          // t값(선분 상의 충돌 위치 비율)에 따라 가까운 쪽에 더 큰 힘을 분배
          source.vx += oppX * (1 - t);
          source.vy += oppY * (1 - t);
          source.vz += oppZ * (1 - t);

          target.vx += oppX * t;
          target.vy += oppY * t;
          target.vz += oppZ * t;
        }
      }
    }
  }

  force.initialize = function (_nodes: any[]) {
    nodes = _nodes;
  };

  return force;
};

// 그라데이션 텍스처 생성 유틸리티 및 캐싱
const linkMaterialCache = new Map<string, THREE.Material>();
const gradientTextureCache: Record<string, THREE.CanvasTexture> = {};
const getGradientTexture = (lightColor: string, darkColor: string) => {
  const key = `${lightColor}-${darkColor}`;
  if (!gradientTextureCache[key]) {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createLinearGradient(0, 0, 0, 256);
      // y=0 (상단): 어두운 네이비
      gradient.addColorStop(0, darkColor);
      // y=256 (하단): 밝은 빛 (0%부터 100%까지 뚝 끊기지 않고 부드럽게 자연스럽게 이어지도록 중간 지점 제거)
      gradient.addColorStop(1, lightColor);
      context.fillStyle = gradient;
      context.fillRect(0, 0, 2, 256);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    gradientTextureCache[key] = texture;
  }
  return gradientTextureCache[key];
};

// 점선 오버레이용 텍스처 생성 유틸리티 및 캐싱
const dashedTextureCache: Record<string, THREE.CanvasTexture> = {};
const getDashedTexture = () => {
  const key = 'dashed';
  if (!dashedTextureCache[key]) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 64, 256);
      context.fillStyle = 'white';
      context.fillRect(0, 0, 64, 128); // 50% 채우기, 50% 투명
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    dashedTextureCache[key] = texture;
  }
  return dashedTextureCache[key];
};

// 격자무늬(창문) 텍스처 생성 유틸리티 및 캐싱
const gridTextureCache: Record<string, THREE.CanvasTexture> = {};
const getGridTexture = (lineColor: string, bgColor: string = 'transparent') => {
  const key = `${lineColor}-${bgColor}`;
  if (!gridTextureCache[key]) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      if (bgColor !== 'transparent') {
        context.fillStyle = bgColor;
        context.fillRect(0, 0, 64, 64);
      }
      context.strokeStyle = lineColor;
      context.lineWidth = 4;
      context.strokeRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    gridTextureCache[key] = texture;
  }
  return gridTextureCache[key];
};

interface NetworkGraphProps {
  data: GraphData;
  onNodeClick: (node: GraphNode | null) => void;
  iconConcept?: 'planet' | 'block';
  onConceptChange?: (concept: 'planet' | 'block') => void;
  is2DMode?: boolean;
}



// Split 20 Mock Alarms: 10 Device Alarms + 10 Port Interface Alarms
export const mockNodeAlarms: Record<string, string> = {
  // Node Alarms (10 nodes) - 2 Critical, 3 Major, 2 Minor, 3 Warning
  '3232': 'critical',  // Gongju Backup Device
  '3242': 'critical',  // Gwangju Backup Device 3
  '3233': 'major',     // Gwangju Backup Device
  '3243': 'major',     // Gwangju Backup Device 2
  '3240': 'major',     // Gongju Backup Device 2
  '3234': 'minor',     // Daegu Backup Device
  '3245': 'minor',     // Daegu Backup Device 2
  '3235': 'warning',   // Daejeon Backup Device
  '3247': 'warning',   // Gwangju Main Device 3
  '3241': 'warning',   // Gongju Backup Device 1

  // 최하위 물리 포트 인터페이스 장애 신설 (10개 추가로 총 20개 노드 장애 완성)
  '3232-if-43': 'critical',  // Gongju Port (치환완료)
  '3403-if-914': 'critical', // Seoul complex Port
  '3237-if-7': 'critical',   // Gwangju Port (치환완료)
  '3334-if-903': 'major',    // Daegu Port
  '3240-if-100': 'major',    // Gongju Port 2 (치환완료)
  '3355-if-911': 'minor',    // Complex Port
  '3233-if-4': 'minor',      // Gwangju Port 2 (치환완료)
  '3401-if-918': 'warning',  // Complex Port 2
  '3238-if-13': 'warning',   // Gwangju Port 3 (치환완료)
  '3332-if-902': 'warning',   // Daegu Port 2

  // 세종청사2(주) 테스트 포트 장애
  '3386-if-831': 'critical',
  '3386-if-819': 'major',
  '3386-if-821': 'minor',
  '3386-if-833': 'warning'
};

export const mockLinkAlarms: Record<string, string> = {
  // 회선 장애 테스트용 포트 ID (양쪽 인터페이스 ID 결합)
  '3237-if-7--3238-if-13': 'critical',
  '3242-if-10--3322-if-553': 'major'
};

// Realistic mock NMS Alarm Causes matching exactly our 20 severity alarms
export const ALARM_CAUSES: Record<string, string> = {
  // Devices (Node Alarms)
  '3232': '메인 전원 공급 장치(PSU) 팬 결함 및 급격한 보드 온도 상승 경보 (78°C)',
  '3242': 'OS 커널 패닉 감지 및 이중화 시스템 백업 강제 세그먼테이션 오류 복구 루프',
  '3233': 'CPU 코어 점유율 98.4% 임계치 위험 초과 (미완성 백그라운드 프로세스 폭주)',
  '3243': '시스템 NVRAM 내부 플래시 플러그 메모리 물리 섹터 파손 및 커밋 연기 발생',
  '3240': '커널 메모리 가용량 급감 경보 (시스템 가용 Memory < 4.2%)',
  '3234': '라인 카드 모듈 하드웨어 섀시 온도 위험 한계 초과 경보',
  '3245': '내부 클럭 위상 정합(PTP Clock Sync) 시간 오프셋 수치 비정상 이격 발생',
  '3235': 'syslog 버퍼 에러 로그 레코드 큐 오버플로우 한도 초과',
  '3247': 'SNMPv3 포트 보안 규격 위반 - 반복적인 비인가 쉘 세션 강제 시도 감지',
  '3241': '흡기 팬 냉각 모듈 구동 회전수 감속 결함 경보 (RPM < 1200)',

  // Interfaces (Port Alarms - 10 nodes matching our mock alarms)
  '3232-if-43': '광 수신 레벨 저하 위험치 돌파 (RX Light Power <-29.2dBm) 및 전송 감쇄 오류',
  '3403-if-914': '이더넷 프레임 정렬 에러(Align Error) 폭주 및 물리 포트 수신 버퍼 오버플로우',
  '3237-if-7': '인터페이스 라인 루프백(Loopback) 오설정 감지 및 포트 보안 위반 강제 비활성화',
  '3334-if-903': '포트 수신 패킷 CRC 에러 유실률 폭주 (임계 패킷 드랍률 > 5.5% 돌파)',
  '3240-if-100': '인터페이스 하드웨어 PHY 칩셋 과열 및 링크 클럭 동기화(Sync Loss) 오류',
  '3355-if-911': '홉 전송 패킷 지연 임계 한계 돌파 및 대기 큐 프레임 드랍 발생 (TTL Expired)',
  '3233-if-4': '이더넷 Auto-Negotiation 프로토콜 정합성 위반 및 반이중(Half-Duplex) 모드 오설정',
  '3401-if-918': 'SNMPv3 세션 처리 능력 초과로 인한 인터페이스 원격 모니터링 프레임 유실',
  '3238-if-13': '물리 라인 카드 모듈 회로 온도 이상 상승 경보 (72°C)',
  '3332-if-902': 'BGP 피어링 킵어라이브(KeepAlive) 타임아웃 세션 강제 차단 경보'
};

// Severity scale, color definitions, and utility helpers
const SEVERITY_ORDER = ['normal', 'warning', 'minor', 'major', 'critical'];

const SEVERITY_COLORS: Record<string, { color: string; emissive: string }> = {
  critical: { color: '#ef4444', emissive: '#dc2626' }, // red
  major: { color: '#f97316', emissive: '#ea580c' },    // orange
  minor: { color: '#eab308', emissive: '#ca8a04' },    // yellow
  warning: { color: '#06b6d4', emissive: '#0891b2' },  // cyan
  normal: { color: '#cbd5e1', emissive: '#475569' }
};

export function getMaxSeverity(s1?: string, s2?: string): string {
  const idx1 = SEVERITY_ORDER.indexOf(s1 || 'normal');
  const idx2 = SEVERITY_ORDER.indexOf(s2 || 'normal');
  return SEVERITY_ORDER[Math.max(idx1, idx2)];
}

function hexToRgba(hex: string, alpha: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 마우스 호버 시 겹쳐있는 객체 중 활성화(Active)된 것이 비활성화(Dimmed) 객체보다 우선적으로 인식되도록 하고,
// 비활성화된 객체는 레이캐스트에서 제외하여 완전한 배경 공간처럼 취급합니다.
const customRaycast = function (this: any, raycaster: THREE.Raycaster, intersects: any[]) {
  // 비활성화된 객체는 아예 레이캐스트 충돌 검사에서 제외하여 빈 공간처럼(드래그, 클릭 무시) 처리
  if (this.userData && this.userData.isDimmed) return;

  const oldLength = intersects.length;
  if (this.isSprite) {
    THREE.Sprite.prototype.raycast.call(this, raycaster, intersects);
  } else if (this.isLine) {
    THREE.Line.prototype.raycast.call(this, raycaster, intersects);
  } else {
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
  }

  for (let i = oldLength; i < intersects.length; i++) {
    if (this.userData && this.userData.isActive) {
      intersects[i].distance -= 10000; // 활성화된 객체는 거리를 당겨 최우선으로 인식되도록 함
    }
  }
};

export const NetworkGraph: React.FC<NetworkGraphProps> = ({ data, onNodeClick, externalSelectedNode, iconConcept = 'planet', onConceptChange, is2DMode = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>();
  const lastClickTimeRef = useRef<number>(0);

  // 컴포넌트 마운트 및 Ref 바인딩 즉시 D3 힘 설정을 적용하기 위한 Callback Ref
  const setGraphRef = useCallback((instance: any) => {
    graphRef.current = instance;
    if (instance) {
      // 컴포넌트 마운트 시 초기 카메라 위치를 즉시 설정 (혼자 갑자기 줌 되는 현상 방지)
      // 노드탐색 패널 등 하단 UI에 가려지지 않도록 카메라가 약간 아래를 바라보게(-20) 하여 토폴로지를 위로 올립니다. (이전 -40 대비 40px 가량 하향)
      instance.cameraPosition({ x: 0, y: 0, z: 666 }, { x: 0, y: -20, z: 0 });

      const chargeForce = instance.d3Force('charge');
      if (chargeForce) {
        chargeForce.strength(getNodeChargeStrength);
      }
      const linkForce = instance.d3Force('link');
      if (linkForce) {
        linkForce.distance(getLinkDistance);
        linkForce.strength(getLinkStrength);
      }
      // instance.d3ReheatSimulation();
    }
  }, []);
  const clickTimeoutRef = useRef<any>(null);
  const ignoreNextExternalRef = useRef<string | null>(null);
  const bgClickTimeoutRef = useRef<any>(null);
  const lastBgClickTimeRef = useRef<number>(0);
  const lastLinkClickTimeRef = useRef<number>(0);
  const linkClickTimeoutRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [clickedNode, setClickedNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<GraphLink | null>(null);
  const [clickedLink, setClickedLink] = useState<GraphLink | null>(null);
  const [clickedLinkPos, setClickedLinkPos] = useState<{ x: number; y: number } | null>(null);
  const [clickedLinkRatio, setClickedLinkRatio] = useState<number>(0.5);
  const [clickedLinkOffset, setClickedLinkOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(() => new Set());
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const [pathHighlight, setPathHighlight] = useState<PathHighlightInfo | null>(null);
  const [pathFinderResetTrigger, setPathFinderResetTrigger] = useState(0);

  const setIconConcept = onConceptChange || (() => { });

  // 경로 탐색 시 해당 경로에 포함된 장비들의 인터페이스 노드를 자동으로 펼쳐줍니다.
  useEffect(() => {
    if (pathHighlight) {
      setExpandedDevices(prev => {
        const next = new Set(prev);
        pathHighlight.deviceIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [pathHighlight]);

  // 뎁스 이동(활성 그룹/장비 변경) 시 띄워져 있던 팝오버 창과 검색어를 모두 초기화합니다.
  useEffect(() => {
    setClickedLink(null);
    setClickedNode(null);
    setHoverLink(null);
    setHoverNode(null);
    setSearchTerm('');
  }, [activeGroupId, activeDeviceId]);

  const [contextMenu, setContextMenu] = useState<{ node: GraphNode, x: number, y: number } | null>(null);
  const [externalSrcGroup, setExternalSrcGroup] = useState<{ groupId: number, groupName: string } | null>(null);
  const [externalDstGroup, setExternalDstGroup] = useState<{ groupId: number, groupName: string } | null>(null);
  const [externalSrcDevice, setExternalSrcDevice] = useState<{ deviceId: number, deviceName: string, deviceIpAddr: string } | null>(null);
  const [externalDstDevice, setExternalDstDevice] = useState<{ deviceId: number, deviceName: string, deviceIpAddr: string } | null>(null);
  const [externalSearchTrigger, setExternalSearchTrigger] = useState(0);
  const [showAlarmList, setShowAlarmList] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [searchFilter, setSearchFilter] = useState<'all' | 'group' | 'device' | 'interface'>('all');

  const nodeCoordsRef = useRef<Record<string, { x: number; y: number; z: number }>>({});
  const visibleNodesRef = useRef<any[]>([]);
  const nodeOrbitRotationsRef = useRef<Record<string, { x: number; y: number; z: number }[]>>({});
  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const nodeTooltipRef = useRef<HTMLDivElement>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const ignoreHoverUntilRef = useRef<number>(0);

  // Breadcrumb helper memo values to track current navigation depth names



  const activeGroupName = useMemo(() => {
    if (activeGroupId === null) return null;
    const anyDeviceInGroup = data.nodes.find(n => n.deviceGroupId === activeGroupId && n.isDeviceNode);
    return anyDeviceInGroup?.groupName || groupsMetadata[activeGroupId] || `그룹 ${activeGroupId}`;
  }, [activeGroupId, data.nodes]);

  const activeDeviceName = useMemo(() => {
    if (activeDeviceId === null) return null;
    const deviceNode = data.nodes.find(n => n.id === activeDeviceId);
    return deviceNode ? deviceNode.label.replace('\n', ' ') : null;
  }, [activeDeviceId, data.nodes]);

  // Aggregate high-DPI split mock alarms counts (Device vs Port vs Link)
  const alarmCounts = useMemo(() => {
    const deviceCounts = { critical: 0, major: 0, minor: 0, warning: 0 };
    const portCounts = { critical: 0, major: 0, minor: 0, warning: 0 };
    const linkCounts = { critical: 0, major: 0, minor: 0, warning: 0 };

    Object.entries(mockNodeAlarms).forEach(([id, severity]) => {
      const counts = id.includes('-if-') ? portCounts : deviceCounts;
      if (severity === 'critical') counts.critical++;
      else if (severity === 'major') counts.major++;
      else if (severity === 'minor') counts.minor++;
      else if (severity === 'warning') counts.warning++;
    });

    Object.entries(mockLinkAlarms).forEach(([_, severity]) => {
      if (severity === 'critical') linkCounts.critical++;
      else if (severity === 'major') linkCounts.major++;
      else if (severity === 'minor') linkCounts.minor++;
      else if (severity === 'warning') linkCounts.warning++;
    });

    return { device: deviceCounts, port: portCounts, link: linkCounts };
  }, []);

  const sortedAlarms = useMemo(() => {
    const list: Array<{ id: string, type: 'DEV' | 'PORT' | 'LINE', severity: string, name: string, groupName: string, cause: string }> = [];

    const getGroupName = (nodeId: string) => {
      const devId = nodeId.split('-if-')[0];
      const node = data.nodes.find(n => n.id === devId);
      if (!node) return '-';
      if (node.deviceGroupId !== undefined && groupsMetadata[node.deviceGroupId]) {
        return groupsMetadata[node.deviceGroupId];
      }
      return '-';
    };

    Object.entries(mockNodeAlarms).forEach(([id, severity]) => {
      const isPort = id.includes('-if-');
      const node = data.nodes.find(n => n.id === id);
      const name = node ? node.label.replace(/\n/g, ' ') : id;
      const groupName = isPort ? getGroupName(id.split('-if-')[0]) : getGroupName(id);
      const cause = ALARM_CAUSES[id] || (isPort ? '포트 인터페이스 연결 오류' : '알 수 없는 시스템 오류');
      list.push({ id, type: isPort ? 'PORT' : 'DEV', severity, name, groupName, cause });
    });
    Object.entries(mockLinkAlarms).forEach(([linkKey, severity]) => {
      const [port1, port2] = linkKey.split('--');
      const n1 = data.nodes.find(n => n.id === port1);
      const n2 = data.nodes.find(n => n.id === port2);
      const n1Name = n1 ? (n1.interfaceName || n1.id) : port1;
      const n2Name = n2 ? (n2.interfaceName || n2.id) : port2;
      const group1 = getGroupName(port1.split('-if-')[0]);
      const group2 = getGroupName(port2.split('-if-')[0]);
      const cause = ALARM_CAUSES[linkKey] || '회선 연결 불량 및 트래픽 유실 경보';
      list.push({ id: linkKey, type: 'LINE', severity, name: `${n1Name} - ${n2Name}`, groupName: `${group1} - ${group2}`, cause });
    });

    const severityOrder: Record<string, number> = { critical: 1, major: 2, minor: 3, warning: 4 };
    return list.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }, [data.nodes]);





  // 커스텀 호버 툴팁: 라이브러리 내장 툴팁 대신 직접 React로 렌더링하여
  // position:fixed로 뷰포트 기준 배치 → overflow:hidden 클리핑 완전 회피
  // mousemove마다 직접 DOM 위치를 갱신하여 지연 없이 커서를 추적합니다.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      const tooltip = hoverTooltipRef.current;
      if (!tooltip) return;

      // 링크 팝오버가 클릭으로 고정되어 있으면, 마우스 이동으로 인한 위치 갱신을 중지합니다.
      if ((stateRef.current as any).clickedLink) return;

      const mx = e.clientX;
      const my = e.clientY;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const gap = 18;

      tooltip.style.left = `${mx}px`;
      tooltip.style.top = `${my}px`;

      // 크기 측정을 위해 임시로 transform 초기화
      tooltip.style.transform = 'translate(0, 0)';
      const tooltipW = tooltip.offsetWidth;
      const tooltipH = tooltip.offsetHeight;

      // 수평: 오른쪽에 공간이 있으면 오른쪽, 없으면 왼쪽
      const tx = (mx + gap + tooltipW <= vw)
        ? `${gap}px`
        : `calc(-100% - ${gap}px)`;

      // 수직: 아래에 공간이 있으면 아래, 없으면 위
      const ty = (my + gap + tooltipH <= vh)
        ? `${gap}px`
        : `calc(-100% - ${gap}px)`;

      tooltip.style.transform = `translate(${tx}, ${ty})`;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper arrays for highlighting
  const highlightNodes = useMemo(() => new Set<string>(), []);
  const highlightLinks = useMemo(() => new Set<GraphLink>(), []);
  const highlightLinkIds = useRef(new Set<string>());
  const [highlightVersion, setHighlightVersion] = useState(0);
  const initialEngineStopRef = useRef(false);

  // 1뎁스 자동회전 및 호버 상태 추적을 위한 ref
  const stateRef = useRef({
    activeGroupId: null as number | null,
    activeDeviceId: null as string | null,
    hoverNode: null as GraphNode | null,
    hoverLink: null as GraphLink | null,
    selectedNode: null as GraphNode | null,
    isAutoRotating: true as boolean,
    pathHighlight: null as any,
    iconConcept: 'planet' as 'planet' | 'block',
    searchTerm: '' as string,
    clickedLink: null as any,
    clickedNode: null as any,
    clickedLinkRatio: 0.5 as number,
    clickedLinkOffset: { x: 0, y: 0 } as { x: number, y: number },
  });

  useEffect(() => {
    stateRef.current = { activeGroupId, activeDeviceId, hoverNode, hoverLink, selectedNode, isAutoRotating, pathHighlight, iconConcept, searchTerm, clickedLink, clickedNode, clickedLinkRatio, clickedLinkOffset };
  }, [activeGroupId, activeDeviceId, hoverNode, hoverLink, selectedNode, isAutoRotating, pathHighlight, iconConcept, searchTerm, clickedLink, clickedNode, clickedLinkRatio, clickedLinkOffset]);


  // 핵심 패치: three-render-objects 라이브러리의 cameraPosition / zoomToFit 내부에서
  // state.controls.target = newVector3 (참조 교체)를 수행하면 TrackballControls의 내부 참조가 끊어져
  // 카메라 조작이 영구적으로 잠금되는 치명적 버그가 존재합니다.
  // 이를 방지하기 위해 controls 객체의 target 속성에 defineProperty setter를 설치하여,
  // 외부에서 target에 새 값을 대입(=)해도 실제로는 기존 Vector3에 .copy()만 수행하도록 보호합니다.

  useEffect(() => {
    let animationFrameId: number;
    const animate = () => {
      if (graphRef.current) {
        // Controls target 재설정 보호 패치 (실시간 감지 및 적용)
        const controls = graphRef.current.controls();
        if (controls && controls.target && !controls.__targetPatched) {
          const originalTarget = controls.target;
          Object.defineProperty(controls, 'target', {
            get() {
              return originalTarget;
            },
            set(newVal: any) {
              if (newVal && typeof newVal.x === 'number') {
                originalTarget.set(newVal.x, newVal.y, newVal.z);
              }
            },
            configurable: true,
            enumerable: true
          });
          controls.__targetPatched = true;
        }

        const scene = graphRef.current.scene();
        const camera = graphRef.current.camera();
        const renderer = graphRef.current.renderer();

        if (scene) {
          scene.traverse((obj: any) => {
            if (obj.isLine || obj.type === 'Line2' || obj.type === 'LineSegments2' || (obj.material && obj.material.isLineMaterial)) {
              let isHighlight = false;
              let isDimmed = false;

              let linkData = obj.__data;
              if (!linkData && obj.parent && obj.parent.__data) {
                linkData = obj.parent.__data;
              }
              if (linkData) {
                const link = linkData;
                const { selectedNode, activeGroupId, activeDeviceId, hoverNode, pathHighlight } = stateRef.current as any;
                if (highlightLinkIds.current) {
                  isHighlight = ((l) => {
                    if (!l) return false;
                    const ts = typeof l.source === 'object' ? l.source.id : l.source;
                    const tt = typeof l.target === 'object' ? l.target.id : l.target;
                    return highlightLinkIds.current.has(ts + '-' + tt);
                  })(link);
                }
                isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
              }

              obj.renderOrder = isDimmed ? 5 : (isHighlight ? 45 : 25);

              if (obj.material) {
                if (obj.material.isLineMaterial) {
                  const targetColor = isHighlight ? 0x3b82f6 : 0x64748b;
                  obj.material.color.setHex(targetColor);
                  obj.material.opacity = isHighlight ? 0.9 : (isDimmed ? 0.05 : 0.4);
                } else if (obj.type === 'Line') {
                  const link = obj.__data;
                  const hasAlarm = link && link.severity && link.severity !== 'normal' && !isDimmed;
                  if (hasAlarm) {
                    const baseColor = link.severity === 'critical' ? '#ef4444' : link.severity === 'major' ? '#f97316' : link.severity === 'minor' ? '#eab308' : '#3b82f6';
                    const pulse = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(Date.now() * 0.007));
                    obj.material.color.set(baseColor);
                    obj.material.opacity = isDimmed ? (pulse * 0.4) : pulse;
                  } else {
                    const targetColor = isHighlight ? '#e2e8f0' : '#94a3b8';
                    obj.material.color.set(targetColor);
                    obj.material.opacity = isHighlight ? 0.8 : (isDimmed ? 0.0 : 0.35);
                  }
                }
              }

              if (obj.material && obj.material.depthWrite !== false) {
                obj.material.depthWrite = false;
              }
            }
            if (obj.userData) {
              if (typeof obj.userData.animate === 'function') {
                obj.userData.animate(camera, obj);
              }
              if (obj.userData.isOrbit) {
                obj.rotation.y += obj.userData.speed;
                obj.rotation.x += obj.userData.speed * 0.3; // Added tumbling effect

                // 현재 회전값을 ref에 저장하여 노드 리렌더링 시 복원할 수 있도록 함
                if (obj.userData.nodeId !== undefined && obj.userData.orbitIndex !== undefined) {
                  const nId = String(obj.userData.nodeId);
                  const oIdx = obj.userData.orbitIndex;
                  if (!nodeOrbitRotationsRef.current[nId]) {
                    nodeOrbitRotationsRef.current[nId] = [];
                  }
                  nodeOrbitRotationsRef.current[nId][oIdx] = {
                    x: obj.rotation.x,
                    y: obj.rotation.y,
                    z: obj.rotation.z
                  };
                }
              }
            }
          });

          // 실시간 D3 노드 좌표 수집 및 캐싱 (2뎁스/3뎁스 탐색 중에만 캐싱을 실행하여 1뎁스 복귀 시의 레이아웃 왜곡을 원천 방지)
          if (activeGroupId !== null && graphRef.current && typeof graphRef.current.graphData === 'function') {
            const currentNodes = graphRef.current.graphData().nodes;
            if (currentNodes) {
              currentNodes.forEach((n: any) => {
                if (n.id && typeof n.x === 'number') {
                  nodeCoordsRef.current[n.id] = { x: n.x, y: n.y, z: n.z };
                }
              });
            }
          }

          // 1뎁스 자동회전 기능 (왼쪽으로 천천히 회전, 마우스 호버 시 멈춤)
          if (camera && controls && stateRef.current) {
            const { activeGroupId, activeDeviceId, hoverNode, hoverLink, selectedNode, isAutoRotating } = stateRef.current;
            if (isAutoRotating && activeGroupId === null && activeDeviceId === null && !hoverNode && !hoverLink && !selectedNode) {
              const target = controls.target;
              const camPos = camera.position;

              const speed = -0.0025; // 속도를 살짝 올리고(-0.0025), 방향을 명확히 지정

              // 항상 카메라의 UP 벡터(기본 Y축)를 기준으로 회전하여 뒤집히거나 방향이 반전되는 현상 방지
              const axis = camera.up.clone().normalize();
              camPos.sub(target);
              camPos.applyAxisAngle(axis, speed);
              camPos.add(target);

              camera.lookAt(target);
            }
          }

          // 노드 팝오버 3D 위치 추적
          if (stateRef.current && stateRef.current.clickedNode && nodeTooltipRef.current && graphRef.current) {
            const cNode = stateRef.current.clickedNode as any;
            if (cNode.x !== undefined && cNode.y !== undefined && cNode.z !== undefined) {
              const coords = graphRef.current.graph2ScreenCoords(cNode.x, cNode.y, cNode.z);
              if (coords) {
                nodeTooltipRef.current.style.left = `${coords.x}px`;
                nodeTooltipRef.current.style.top = `${coords.y}px`;
                nodeTooltipRef.current.style.transform = `translate(${coords.x > window.innerWidth - 350 ? 'calc(-100% - 15px)' : '15px'}, ${coords.y > window.innerHeight - 350 ? 'calc(-100% - 15px)' : '15px'})`;
              }
            }
          }

          // 링크 팝오버 3D 위치 추적 (source와 target 노드의 중간 지점)
          if (stateRef.current && stateRef.current.clickedLink && hoverTooltipRef.current && graphRef.current) {
            const cLink = stateRef.current.clickedLink as any;
            const sourceNode = typeof cLink.source === 'object' ? cLink.source : null;
            const targetNode = typeof cLink.target === 'object' ? cLink.target : null;

            if (sourceNode && targetNode && sourceNode.x !== undefined && targetNode.x !== undefined) {
              const ratio = stateRef.current.clickedLinkRatio || 0.5;
              const offset = stateRef.current.clickedLinkOffset || { x: 0, y: 0 };
              const midX = sourceNode.x + (targetNode.x - sourceNode.x) * ratio;
              const midY = sourceNode.y + (targetNode.y - sourceNode.y) * ratio;
              const midZ = sourceNode.z + (targetNode.z - sourceNode.z) * ratio;

              const coords = graphRef.current.graph2ScreenCoords(midX, midY, midZ);
              if (coords) {
                const finalX = coords.x + offset.x;
                const finalY = coords.y + offset.y;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const gap = 18;
                const tooltipW = 220; // 팝오버의 고정 너비
                const tooltipH = hoverTooltipRef.current.offsetHeight || 150;

                const tx = (finalX + gap + tooltipW <= vw) ? `${gap}px` : `calc(-100% - ${gap}px)`;
                const ty = (finalY + gap + tooltipH <= vh) ? `${gap}px` : `calc(-100% - ${gap}px)`;

                hoverTooltipRef.current.style.left = `${finalX}px`;
                hoverTooltipRef.current.style.top = `${finalY}px`;
                hoverTooltipRef.current.style.transform = `translate(${tx}, ${ty})`;
              }
            }
          }

          // Force rendering to ensure animation keeps running when graph is static
          if (renderer && camera) {
            renderer.render(scene, camera);
          }
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // 1/2/3뎁스 및 링 노드용 결정론적 3D 구형(Spherical) 및 수직 나선(Helix) 초기 좌표 도출 헬퍼 함수
  const getGroupInitialCoords = useCallback((gid: number) => {
    const uniqueGids = Array.from(new Set(data.nodes.map(n => n.deviceGroupId).filter(Boolean) as number[])).sort((a, b) => a - b);
    const idx = uniqueGids.indexOf(gid);
    if (idx === -1) return { x: 0, y: 0, z: 0 };

    const N = uniqueGids.length || 1;
    const heightRange = 325; // 전체 수직 배치 범위
    const radius = 225; // 나선 반경을 넓혀 옆으로 넓게 퍼지도록 설정

    // 그룹 순서대로 위(idx=0, 양의 Y)에서 아래(idx=N-1, 음의 Y) 방향으로 정렬
    const y = ((N - 1 - idx) / (N - 1 || 1) - 0.5) * heightRange;

    // X, Z 축은 나선형(Helix)으로 꼬아서 입체감과 시인성을 동시에 확보
    const theta = idx * 1.3;
    const x = radius * Math.cos(theta);
    const z = radius * Math.sin(theta);

    return { x, y, z };
  }, [data.nodes]);

  const getDeviceInitialCoords = useCallback((devId: string) => {
    const devNode = data.nodes.find(n => n.id === devId);
    if (!devNode || !devNode.deviceGroupId) return { x: 0, y: 0, z: 0 };
    const gid = devNode.deviceGroupId;
    let parentCoord = nodeCoordsRef.current[`group-${gid}`] || getGroupInitialCoords(gid);

    // 전진배치 장비는 고유 그룹 좌표 대신, 실제로 데이터 링크가 연결된 대상 장비의 그룹 위치를 출발점으로 삼음
    const isForward = (groupsMetadata[gid] || '').includes('전진배치') || (devNode.groupName || '').includes('전진배치');
    if (isForward) {
      // data.links의 source/target은 인터페이스 ID이므로 originalSource/originalTarget(장비 ID)를 사용해 연결을 찾음
      const connectedLink = data.links.find((l: any) => String(l.originalSource) === String(devId) || String(l.originalTarget) === String(devId));
      if (connectedLink) {
        const peerId = String(connectedLink.originalSource) === String(devId) ? connectedLink.originalTarget : connectedLink.originalSource;
        const peerNode = data.nodes.find(n => String(n.id) === String(peerId));
        if (peerNode && peerNode.deviceGroupId) {
          parentCoord = nodeCoordsRef.current[`group-${peerNode.deviceGroupId}`] || getGroupInitialCoords(peerNode.deviceGroupId);
        }
      }
    }

    const devicesInGroup = data.nodes.filter(n => n.deviceGroupId === gid && n.isDeviceNode);
    const sortedDevices = [...devicesInGroup].sort((a, b) => a.id.localeCompare(b.id));
    const devIdx = sortedDevices.findIndex(d => d.id === devId);
    if (devIdx === -1) return parentCoord;

    const M = sortedDevices.length || 1;
    const radius = 120; // 그룹 내 장비 입체 배치 반경 (240 -> 480)

    // Fibonacci Sphere로 자식 장비 노드들을 부모 그룹 중심 3D 구형 배치
    const offset = 2 / M;
    const increment = Math.PI * (3 - Math.sqrt(5));

    const y = ((devIdx * offset) - 1) + (offset / 2);
    const r = Math.sqrt(1 - y * y);
    const phi = devIdx * increment;

    return {
      x: parentCoord.x + Math.cos(phi) * r * radius,
      y: parentCoord.y + y * radius,
      z: parentCoord.z + Math.sin(phi) * r * radius
    };
  }, [data.nodes, getGroupInitialCoords]);

  const getRingInitialCoords = useCallback((ringIndex: number) => {
    const ring = RINGS[ringIndex];
    if (!ring) return { x: 0, y: 0, z: 0 };
    let sumX = 0, sumY = 0, sumZ = 0, count = 0;
    ring.groups.forEach(gid => {
      const coord = nodeCoordsRef.current[`group-${gid}`] || getGroupInitialCoords(gid);
      sumX += coord.x;
      sumY += coord.y;
      sumZ += coord.z;
      count++;
    });
    if (count > 0) {
      return { x: sumX / count, y: sumY / count, z: sumZ / count };
    }
    const theta = (2 * Math.PI * ringIndex) / (RINGS.length || 1);
    const radius = 75;
    return {
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
      z: -30
    };
  }, [getGroupInitialCoords]);

  const visibleData = useMemo(() => {
    // 1. Map data.nodes and inject mock node alarm severities
    const mappedNodes: GraphNode[] = data.nodes.map(n => {
      const copy = JSON.parse(JSON.stringify(n));
      copy.severity = mockNodeAlarms[copy.id] || 'normal';
      return copy;
    });

    // 2. Map data.links and inject link-specific alarms.
    // Cascades link faults down to adjacent interface port nodes.
    const mappedLinks = data.links.map(l => {
      const lCopy = JSON.parse(JSON.stringify(l));
      const sId = lCopy.source;
      const tId = lCopy.target;
      const linkKey = [sId, tId].sort().join('--');

      const linkSeverity = mockLinkAlarms[linkKey] || 'normal';
      lCopy.severity = linkSeverity;

      // If a physical link has an alarm, propagate it to endpoints
      if (linkSeverity !== 'normal') {
        const sNode = mappedNodes.find(n => n.id === sId);
        const tNode = mappedNodes.find(n => n.id === tId);
        if (sNode) sNode.severity = getMaxSeverity(sNode.severity, linkSeverity);
        if (tNode) tNode.severity = getMaxSeverity(tNode.severity, linkSeverity);
      }
      return lCopy;
    });

    // 3. Propagate Interface alarms to Parent Device nodes (de-propagate if parent is expanded!)
    mappedNodes.forEach(n => {
      if (n.isInterfaceNode && n.parentDeviceId && n.severity !== 'normal') {
        const parentDev = mappedNodes.find(p => p.id === n.parentDeviceId && p.isDeviceNode);
        if (parentDev) {
          // If the parent device is expanded, do not bubble up its child interface alarms
          if (!expandedDevices.has(parentDev.id)) {
            parentDev.severity = getMaxSeverity(parentDev.severity, n.severity);
          }
        }
      }
    });

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const groupNodeMap: Record<number, GraphNode> = {};
    const deviceNodeMap: Record<string, GraphNode> = {};

    // 3.5. Identify '전진배치' groups to be permanently expanded without a group node
    const forwardGids = new Set<number>();
    mappedNodes.forEach(n => {
      if (n.deviceGroupId && n.groupName?.includes('전진배치')) {
        forwardGids.add(n.deviceGroupId);
      }
    });
    Object.entries(groupsMetadata).forEach(([gid, name]) => {
      if (name.includes('전진배치')) forwardGids.add(parseInt(gid, 10));
    });

    const isGroupExpanded = (gid: number) => {
      if (forwardGids.size === 0) return true;
      return gid === activeGroupId || expandedGroups.has(gid) || forwardGids.has(gid);
    };

    // 2뎁스: 타 그룹 중 현재 활성 그룹(activeGroupId)과 직접 연결이 없는 장비는 숨기기 위해 계산
    const connectedPeerDevices = new Set<string>();
    if (activeGroupId !== null) {
      const activeGroupInterfaces = new Set(
        mappedNodes.filter(n => n.deviceGroupId === activeGroupId && n.isInterfaceNode).map(n => n.id)
      );
      mappedLinks.forEach(l => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (activeGroupInterfaces.has(sId)) {
          const tNode = mappedNodes.find(n => n.id === tId);
          if (tNode && tNode.parentDeviceId) connectedPeerDevices.add(tNode.parentDeviceId);
        }
        if (activeGroupInterfaces.has(tId)) {
          const sNode = mappedNodes.find(n => n.id === sId);
          if (sNode && sNode.parentDeviceId) connectedPeerDevices.add(sNode.parentDeviceId);
        }
      });
    }

    // 4. Process and filter nodes based on copy templates
    for (const node of mappedNodes) {
      const gid = node.deviceGroupId;

      if (node.isInterfaceNode) {
        const devId = node.parentDeviceId;
        if (gid && !isGroupExpanded(gid)) {
          // Collapsed
        } else if (devId && !expandedDevices.has(devId)) {
          // Collapsed
        } else {
          // 만약 2뎁스에서 부모 장비가 숨겨진 타그룹 장비라면 인터페이스도 숨김
          if (activeGroupId !== null && gid !== activeGroupId && devId && !connectedPeerDevices.has(devId)) {
            continue;
          }
          const copy = JSON.parse(JSON.stringify(node));
          const cached = nodeCoordsRef.current[copy.id];
          if (cached) {
            copy.x = cached.x;
            copy.y = cached.y;
            copy.z = cached.z;
          } else {
            // New interface node! 3D Fibonacci Sphere layout around parent device
            const devCoords = nodeCoordsRef.current[devId!] || getDeviceInitialCoords(devId!);
            const interfacesInDevice = mappedNodes.filter(n => n.parentDeviceId === devId && n.isInterfaceNode);
            const sortedInterfaces = [...interfacesInDevice].sort((a, b) => a.id.localeCompare(b.id));
            const infIdx = sortedInterfaces.findIndex(inf => inf.id === copy.id);
            const K = sortedInterfaces.length || 1;

            const radius = Math.max(22, Math.sqrt(K) * 10);
            const offset = 2 / K;
            const increment = Math.PI * (3 - Math.sqrt(5));

            const y = ((infIdx * offset) - 1) + (offset / 2);
            const r = Math.sqrt(1 - y * y);
            const phi = infIdx * increment;

            copy.x = devCoords.x + Math.cos(phi) * r * radius;
            copy.y = devCoords.y + y * radius;
            copy.z = devCoords.z + Math.sin(phi) * r * radius;
          }
          nodes.push(copy);
        }
      } else if (node.isDeviceNode) {
        if (gid && !isGroupExpanded(gid)) {
          // Collapsed
        } else {
          // 2뎁스에서 활성 그룹이 아닌 타 그룹 장비일 경우, 직접 연결된 장비가 아니면 숨김
          if (activeGroupId !== null && gid !== activeGroupId && !connectedPeerDevices.has(node.id)) {
            continue;
          }
          const copy = JSON.parse(JSON.stringify(node));
          const cached = nodeCoordsRef.current[copy.id];
          if (cached) {
            copy.x = cached.x;
            copy.y = cached.y;
            copy.z = cached.z;
          } else {
            // New device node! 3D Fibonacci Sphere layout around parent group
            const initCoords = getDeviceInitialCoords(copy.id);
            copy.x = initCoords.x;
            copy.y = initCoords.y;
            copy.z = initCoords.z;
          }
          nodes.push(copy);
        }
      }

      if (gid) {
        if (!groupNodeMap[gid]) {
          const anyDeviceInGroup = mappedNodes.find(n => n.deviceGroupId === gid && n.isDeviceNode);
          const groupName = anyDeviceInGroup?.groupName || groupsMetadata[gid] || `그룹 ${gid}`;
          let inferredGroup = 'other';
          if (groupName.includes("센터")) inferredGroup = 'center';
          else if (groupName.includes("시청")) inferredGroup = 'cityhall';
          else if (groupName.includes("도청")) inferredGroup = 'provincial';
          else if (groupName.includes("청사")) inferredGroup = 'complex';
          else if (groupName.includes("별관")) inferredGroup = 'annex';

          const groupId = `group-${gid}`;
          const cached = nodeCoordsRef.current[groupId];
          let groupX = 0, groupY = 0, groupZ = 0;
          if (cached) {
            groupX = cached.x;
            groupY = cached.y;
            groupZ = cached.z;
          } else {
            const initCoords = getGroupInitialCoords(gid);
            groupX = initCoords.x;
            groupY = initCoords.y;
            groupZ = initCoords.z;
          }

          groupNodeMap[gid] = {
            id: groupId,
            label: groupName,
            group: inferredGroup as any,
            val: 25,
            deviceGroupId: gid,
            isGroupNode: true,
            severity: 'normal',
            x: groupX,
            y: groupY,
            z: groupZ
          };
          if (!forwardGids.has(gid)) {
            nodes.push(groupNodeMap[gid]);
          }
        }
      }
    }

    // 5. Propagate Device alarms to Parent Group nodes (de-propagate if group is expanded!)
    Object.keys(groupNodeMap).forEach(gidStr => {
      const gid = parseInt(gidStr, 10);
      const devicesInGroup = mappedNodes.filter(n => n.deviceGroupId === gid && n.isDeviceNode);
      let maxSev = 'normal';

      // If the group node is expanded, do not bubble up its child device alarms
      if (!isGroupExpanded(gid)) {
        devicesInGroup.forEach(d => {
          maxSev = getMaxSeverity(maxSev, d.severity);
        });
      }

      groupNodeMap[gid].severity = maxSev;

      const gNode = nodes.find(n => n.id === `group-${gid}`);
      if (gNode) gNode.severity = maxSev;
    });

    // Process Links
    const linkMap: Record<string, GraphLink> = {};
    for (const link of mappedLinks) {
      if (link.isHierarchyLink) continue; // skip generated back-links

      let sourceId = typeof link.source === 'object' ? (link.source as any).id || link.source : link.source;
      let targetId = typeof link.target === 'object' ? (link.target as any).id || link.target : link.target;

      const srcNode = mappedNodes.find(n => n.id === sourceId);
      const tgtNode = mappedNodes.find(n => n.id === targetId);

      if (!srcNode || !tgtNode) continue;

      const srcGid = srcNode.deviceGroupId;
      const tgtGid = tgtNode.deviceGroupId;
      const srcDevId = srcNode.parentDeviceId;
      const tgtDevId = tgtNode.parentDeviceId;

      // Map source: if group is collapsed → group node; if group expanded but device collapsed → device node
      if (srcGid && !isGroupExpanded(srcGid)) {
        sourceId = `group-${srcGid}`;
      } else if (srcGid && isGroupExpanded(srcGid) && srcNode.isDeviceNode) {
        // Device node itself — keep as-is (it's visible)
      } else if (srcDevId && !expandedDevices.has(srcDevId)) {
        sourceId = srcDevId; // map up to device
      }

      // Map target: same logic
      if (tgtGid && !isGroupExpanded(tgtGid)) {
        targetId = `group-${tgtGid}`;
      } else if (tgtGid && isGroupExpanded(tgtGid) && tgtNode.isDeviceNode) {
        // Device node itself — keep as-is (it's visible)
      } else if (tgtDevId && !expandedDevices.has(tgtDevId)) {
        targetId = tgtDevId; // map up to device
      }

      if (sourceId === targetId) continue;

      // 2뎁스(그룹 상세) 이상일 때 그룹 노드 간의 직접 연결선 숨기기
      if (activeGroupId !== null && String(sourceId).startsWith('group-') && String(targetId).startsWith('group-')) {
        continue;
      }

      // 최종적으로 화면에 렌더링될 노드(nodes)에 양쪽 끝단이 모두 존재하는 링크만 유지 (node not found 에러 방지)
      if (!nodes.find(n => n.id === sourceId) || !nodes.find(n => n.id === targetId)) {
        continue;
      }

      const linkKey = [sourceId, targetId].sort().join('--');
      if (!linkMap[linkKey]) {
        linkMap[linkKey] = {
          source: sourceId,
          target: targetId,
          originalSource: link.originalSource,
          originalTarget: link.originalTarget,
          traffic: link.traffic || 0,
          usage: link.usage || 0,
          severity: link.severity || 'normal', // Inherit mock link severity
          totalBandWidth: link.totalBandWidth || 0,
          srcInterfaceName: link.srcInterfaceName,
          dstInterfaceName: link.dstInterfaceName,
          aggregatedLinks: [link]
        };
      } else {
        // Aggregate traffic/usage
        linkMap[linkKey].traffic = (linkMap[linkKey].traffic || 0) + (link.traffic || 0);
        linkMap[linkKey].totalBandWidth = (linkMap[linkKey].totalBandWidth || 0) + (link.totalBandWidth || 0);
        linkMap[linkKey].usage = linkMap[linkKey].totalBandWidth > 0 ? (linkMap[linkKey].traffic / linkMap[linkKey].totalBandWidth) * 100 : 0;
        linkMap[linkKey].severity = getMaxSeverity(linkMap[linkKey].severity, link.severity);
        linkMap[linkKey].aggregatedLinks.push(link);
      }
    }

    links.push(...Object.values(linkMap));

    // Add hierarchy links: group -> device (when group is expanded)
    for (const node of mappedNodes) {
      // 전진배치 그룹은 그룹 노드 자체가 없으므로 계층 링크(스프링) 생성 생략
      if (node.isDeviceNode && node.deviceGroupId && isGroupExpanded(node.deviceGroupId) && !forwardGids.has(node.deviceGroupId)) {
        // [NEW] 만약 숨겨진 타 그룹 장비이거나, 그룹 노드 자체가 숨김 처리되었다면 링크 추가 방지
        if (!nodes.find(n => n.id === node.id)) continue;
        if (!nodes.find(n => n.id === `group-${node.deviceGroupId}`)) continue;

        links.push({
          source: `group-${node.deviceGroupId}`,
          target: node.id,
          usage: 0,
          traffic: 0,
          isHierarchyLink: true,
          isGroupToDevice: true
        });
      }
    }

    // Add artificial links from devices to their interfaces if devices are expanded
    for (const node of mappedNodes) {
      if (node.isInterfaceNode && node.deviceGroupId && isGroupExpanded(node.deviceGroupId) && node.parentDeviceId && expandedDevices.has(node.parentDeviceId)) {
        if (!nodes.find(n => n.id === node.id)) continue;
        if (!nodes.find(n => n.id === node.parentDeviceId)) continue;

        links.push({
          source: node.parentDeviceId,
          target: node.id,
          usage: 0,
          traffic: 0,
          isHierarchyLink: true,
          isDeviceToInterface: true,
          interfaceCount: mappedNodes.filter(n => n.parentDeviceId === node.parentDeviceId && n.isInterfaceNode).length
        });
      }
    }

    // Ring Nodes Hack - insert invisible nodes to center rings
    RINGS.forEach((ring, i) => {
      const ringId = `ring-${i}`;
      const cached = nodeCoordsRef.current[ringId];
      let rx = 0, ry = 0, rz = 0;
      if (cached) {
        rx = cached.x;
        ry = cached.y;
        rz = cached.z;
      } else {
        const initCoords = getRingInitialCoords(i);
        rx = initCoords.x;
        ry = initCoords.y;
        rz = initCoords.z;
      }

      nodes.push({
        id: ringId,
        label: ring.name,
        isRingNode: true,
        val: 0,
        x: rx,
        y: ry,
        z: rz
      } as any);

      const validGroupNodes: string[] = [];

      ring.groups.forEach(groupId => {
        // find the group node by deviceGroupId
        const gn = nodes.find(n => n.deviceGroupId === groupId && n.isGroupNode);
        if (gn) {
          validGroupNodes.push(gn.id);
        }
      });

      // 기존에는 링에 속한 모든 그룹에 보이지 않는 선을 연결해 정중앙(Centroid)에 위치하게 했으나,
      // 링명을 해당 링(외곽선) 가까이로 이동시키기 위해 링의 첫 번째와 두 번째 그룹에만 연결하도록 수정합니다.
      validGroupNodes.slice(0, 2).forEach(gnId => {
        links.push({
          source: ringId,
          target: gnId,
          isRingLink: true, // invisible link
          usage: 0,
          traffic: 0
        } as any);
      });

    });

    // 6. Focused Alarm Isolation Masking (장애 시선 포커싱)
    if (activeDeviceId !== null) {
      nodes.forEach(n => {
        // Keep alarm ONLY for the active device and its own interface ports
        const isTarget = n.id === activeDeviceId || n.parentDeviceId === activeDeviceId;
        if (!isTarget) {
          n.severity = 'normal';
        }
      });
    } else if (activeGroupId !== null) {
      nodes.forEach(n => {
        // Keep alarm ONLY for the active group node and any devices/ports belonging to this group
        const isTarget = n.id === `group-${activeGroupId}` || n.deviceGroupId === activeGroupId;
        if (!isTarget) {
          n.severity = 'normal';
        }
      });
    }

    return { nodes, links };
  }, [data, expandedGroups, expandedDevices, activeGroupId, activeDeviceId, pathHighlight, getGroupInitialCoords, getDeviceInitialCoords, getRingInitialCoords]);

  useEffect(() => {
    visibleNodesRef.current = visibleData.nodes;
  }, [visibleData.nodes]);

  // 컴포넌트 마운트 시점뿐만 아니라, 뎁스 이동 등으로 controls가 재생성될 수 있으므로
  // animate 루프와 useEffect 양쪽에서 실시간 감지하여 자동 패치되도록 이중 보호 장치를 구축합니다.
  // 추가적으로, 노드 간격 확장을 위해 D3 force (charge, link distance) 속성을 함께 설정합니다.
  useEffect(() => {
    if (!graphRef.current) return;

    // 1. Controls target 보호 패치
    const controls = graphRef.current.controls();
    if (controls && controls.target && !controls.__targetPatched) {
      const originalTarget = controls.target;
      Object.defineProperty(controls, 'target', {
        get() {
          return originalTarget;
        },
        set(newVal: any) {
          if (newVal && typeof newVal.x === 'number') {
            originalTarget.set(newVal.x, newVal.y, newVal.z);
          }
        },
        configurable: true,
        enumerable: true
      });
      controls.__targetPatched = true;
    }

    // 2. D3 힘 시뮬레이션: 모든 뎁스(1/2/3뎁스)에서 완전히 동일한 규칙으로 토폴로지를 자동으로 그리도록 강도/거리 규칙을 일관되게 단일화
    const chargeForce = graphRef.current.d3Force('charge');
    if (chargeForce) {
      chargeForce.strength(getNodeChargeStrength);
    }

    const linkForce = graphRef.current.d3Force('link');
    if (linkForce) {
      linkForce.distance(getLinkDistance);
      linkForce.strength(getLinkStrength);
    }

    // 라인 관통 방지 커스텀 포스 적용
    graphRef.current.d3Force('linkCollide', createLinkCollideForce(visibleData.links));

    // 변경된 D3 힘 속성을 즉시 반영하고 시뮬레이션을 재점화
    // graphRef.current.d3ReheatSimulation();
  }, [visibleData, activeGroupId]);

  const updateHighlight = useCallback(() => {
    highlightNodes.clear();
    highlightLinks.clear();
    highlightLinkIds.current?.clear();

    const targetNodes = is2DMode ? data.nodes : visibleData.nodes;
    const targetLinks = is2DMode ? data.links : visibleData.links;

    // 1. 검색어 하이라이트 로직
    const term = searchTerm.trim().toLowerCase();
    if (term.length > 0) {
      const searchTargetNodes = is2DMode ? data.nodes : visibleData.nodes;

      searchTargetNodes.forEach(n => {
        if (searchFilter === 'device' && !n.isDeviceNode) return;
        if (searchFilter === 'interface' && !n.isInterfaceNode) return;
        if (searchFilter === 'group' && !n.isGroupNode) return;

        // 현재 진입해 있는 뎁스(Depth)에서 기본적으로 활성화되어 있는 노드만 검색 대상으로 한정 (미리 Dimmed 상태인 배경 노드 무시)
        // 2D 모드에서는 뎁스(Depth) 및 노드 숨김 개념이 없으므로 이 필터링 로직을 건너뜁니다.
        if (!is2DMode) {
          if (activeDeviceId !== null) {
            if (n.parentDeviceId !== activeDeviceId && n.id !== activeDeviceId) return;
          } else if (activeGroupId !== null) {
            const isCurrentGroup = n.deviceGroupId === activeGroupId || n.id === `group-${activeGroupId}`;

            let isExpandedGroup = false;
            if (n.deviceGroupId && expandedGroups.has(n.deviceGroupId)) {
              isExpandedGroup = true;
            } else if (n.isGroupNode && typeof n.id === 'string' && n.id.startsWith('group-')) {
              const gid = parseInt(n.id.replace('group-', ''), 10);
              if (expandedGroups.has(gid)) isExpandedGroup = true;
            }

            // 현재 뎁스의 소속 노드도 아니고, 수동으로 펼쳐놓은 그룹의 노드도 아니라면 검색에서 무시
            if (!isCurrentGroup && !isExpandedGroup) return;
          }
        }

        const labelMatch = n.label && n.label.toLowerCase().includes(term);
        const devMatch = n.deviceName && n.deviceName.toLowerCase().includes(term);
        const intfMatch = n.interfaceName && n.interfaceName.toLowerCase().includes(term);

        // 부모 그룹의 이름이 검색어에 포함된다고 해서 하위 장비들까지 모두 매칭된 것으로 간주하지 않도록 수정 (노드 개별 매칭)
        let groupMatch = false;
        if (n.isGroupNode && n.label && n.label.toLowerCase().includes(term)) {
          groupMatch = true;
        }

        if (labelMatch || devMatch || intfMatch || groupMatch) {
          highlightNodes.add(n.id);
          // 장비가 매칭된 경우 해당 소속 그룹도 같이 활성화해서 뎁스를 보여줌
          if (n.deviceGroupId !== undefined) highlightNodes.add(`group-${n.deviceGroupId}`);
        }
      });
      // 검색된 노드들 간의 링크 활성화
      targetLinks.forEach((link: any) => {
        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;
        if (highlightNodes.has(sId) && highlightNodes.has(tId)) {
          highlightLinks.add(link);
          if (link && link.source !== undefined && link.target !== undefined) {
            const tempS = typeof link.source === 'object' ? link.source.id : link.source;
            const tempT = typeof link.target === 'object' ? link.target.id : link.target;
            highlightLinkIds.current.add(tempS + '-' + tempT);
            highlightLinkIds.current.add(tempT + '-' + tempS);
          }
        }
      });

      // 검색 모드일 때는 다른 하이라이트(뎁스, 호버 등)를 무시하고 검색 결과만 보여줌
      if (graphRef.current) {
        graphRef.current.refresh();
      }
      setHighlightVersion(v => v + 1);
      return;
    }

    // 2. 경로 탐색 하이라이트가 활성화된 경우 최우선 적용
    if (pathHighlight) {
      // 경로에 포함된 장비 노드 하이라이트
      targetNodes.forEach(n => {
        if (n.isGroupNode && n.deviceGroupId !== undefined) {
          // 사용자가 명시적으로 그룹 자체를 하이라이트 대상으로 지정한 경우 3D에서도 표출
          if (pathHighlight.deviceIds.has(n.id) || pathHighlight.deviceIds.has(String(n.id))) {
            highlightNodes.add(n.id);
            return;
          }

          // 3D 경로 탐색 및 링크 격리에서는 그룹 노드를 비활성화 (하이라이트에서 제외)
          if (!is2DMode) {
            return;
          }

          // 경로상에 있는 장비가 이 그룹에 속하는지 확인
          const hasPathDevice = data.nodes.some(
            dn => dn.deviceGroupId === n.deviceGroupId && (pathHighlight.deviceIds.has(dn.id) || pathHighlight.deviceIds.has(String(dn.id)))
          );
          if (hasPathDevice) highlightNodes.add(n.id);
        } else if ((n.isDeviceNode || n.isInterfaceNode) && (pathHighlight.deviceIds.has(n.id) || pathHighlight.deviceIds.has(String(n.id)))) {
          highlightNodes.add(n.id);
        }
      });

      // 경로에 포함된 링크 하이라이트 (장비 간 연결)
      targetLinks.forEach(link => {
        const sId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as any).id : link.target;

        const directKey1 = `${sId}-${tId}`;
        const directKey2 = `${tId}-${sId}`;
        const isDirectMatch = pathHighlight.linkPairs.has(directKey1) || pathHighlight.linkPairs.has(directKey2);

        if (isDirectMatch) {
          highlightLinks.add(link as any);
          if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
            const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
            const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
            highlightLinkIds.current.add(tempS + '-' + tempT);
            highlightLinkIds.current.add(tempT + '-' + tempS);
          }
          highlightNodes.add(sId);
          highlightNodes.add(tId);
        } else if (link.originalSource && link.originalTarget) {
          // 장비-장비 링크: originalSource/originalTarget 확인
          const key1 = `${link.originalSource}-${link.originalTarget}`;
          const key2 = `${link.originalTarget}-${link.originalSource}`;
          if (pathHighlight.linkPairs.has(key1) || pathHighlight.linkPairs.has(key2)) {
            highlightLinks.add(link as any);
            if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
              const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
              const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
              highlightLinkIds.current.add(tempS + '-' + tempT);
              highlightLinkIds.current.add(tempT + '-' + tempS);
            }
            highlightNodes.add(sId);
            highlightNodes.add(tId);
          }
        }

        // 그룹-장비 계층 링크: 장비가 하이라이트 되어있으면 계층 링크도 하이라이트
        if ((link as any).isHierarchyLink || (link as any).isGroupToDevice) {
          if (highlightNodes.has(sId) && highlightNodes.has(tId)) {
            highlightLinks.add(link as any);
            if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
              const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
              const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
              highlightLinkIds.current.add(tempS + '-' + tempT);
              highlightLinkIds.current.add(tempT + '-' + tempS);
            }
          }
        }
      });

      if (graphRef.current) {
        graphRef.current.refresh();
      }
      return;
    }

    if (hoverNode !== null && activeDeviceId === null) {
      highlightNodes.add(hoverNode.id);

      if (hoverNode.isRingNode) {
        // 링명에 호버 시 RINGS 배열을 참조하여 해당 링에 속한 모든 그룹을 하이라이트
        const ringIndex = parseInt(hoverNode.id.replace('ring-', ''));
        const ring = RINGS[ringIndex];
        if (ring) {
          ring.groups.forEach(gid => {
            highlightNodes.add(`group-${gid}`);
          });
        }
        targetLinks.forEach((link: any) => {
          const s = typeof link.source === 'object' ? link.source.id : link.source;
          const t = typeof link.target === 'object' ? link.target.id : link.target;
          if (highlightNodes.has(s) && highlightNodes.has(t)) {
            highlightLinks.add(link);
            if (link && link.source !== undefined && link.target !== undefined) {
              const tempS = typeof link.source === 'object' ? link.source.id : link.source;
              const tempT = typeof link.target === 'object' ? link.target.id : link.target;
              highlightLinkIds.current.add(tempS + '-' + tempT);
              highlightLinkIds.current.add(tempT + '-' + tempS);
            }
          }
        });
      } else {
        targetLinks.forEach((link: any) => {
          const s = typeof link.source === 'object' ? link.source.id : link.source;
          const t = typeof link.target === 'object' ? link.target.id : link.target;

          if (s === hoverNode.id || t === hoverNode.id) {
            let isValid = true;
            const otherId = s === hoverNode.id ? t : s;

            // 현재 뎁스(그룹/장비)에 진입한 상태라면, 활성화되지 않은 배경 노드(타 그룹 노드 등)로 뻗어가는 선은 하이라이트 제외
            if (activeGroupId !== null) {
              const otherNode = visibleData.nodes.find((n: any) => n.id === otherId);
              if (otherNode && otherNode.isGroupNode && otherNode.deviceGroupId !== activeGroupId) {
                isValid = false;
              }
            } else if (activeDeviceId !== null) {
              const otherNode = visibleData.nodes.find((n: any) => n.id === otherId);
              if (otherNode && otherNode.isDeviceNode && otherNode.id !== activeDeviceId) {
                isValid = false;
              }
            }

            if (isValid) {
              highlightLinks.add(link);
              if (link && link.source !== undefined && link.target !== undefined) {
                const tempS = typeof link.source === 'object' ? link.source.id : link.source;
                const tempT = typeof link.target === 'object' ? link.target.id : link.target;
                highlightLinkIds.current.add(tempS + '-' + tempT);
                highlightLinkIds.current.add(tempT + '-' + tempS);
              }
              highlightNodes.add(s);
              highlightNodes.add(t);
            }
          }
        });
      }
    } else if (activeDeviceId !== null) {
      // Highlight all interfaces of the active device
      targetNodes.forEach(n => {
        if (n.parentDeviceId === activeDeviceId || n.id === activeDeviceId) {
          highlightNodes.add(n.id);
        }
      });
      // 1차 패스: 실제 데이터 링크 처리 (highlightNodes 완성)
      targetLinks.forEach(link => {
        if ((link as any).isHierarchyLink) return; // 계층 링크는 2차 패스에서 처리
        const sId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as any).id : link.target;

        const srcNode = visibleData.nodes.find(n => n.id === sId);
        const tgtNode = visibleData.nodes.find(n => n.id === tId);

        if (
          srcNode?.parentDeviceId === activeDeviceId || tgtNode?.parentDeviceId === activeDeviceId ||
          sId === activeDeviceId || tId === activeDeviceId
        ) {
          highlightLinks.add(link as any);
          if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
            const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
            const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
            highlightLinkIds.current.add(tempS + '-' + tempT);
            highlightLinkIds.current.add(tempT + '-' + tempS);
          }
          highlightNodes.add(sId);
          highlightNodes.add(tId);
          // 연결된 인터페이스의 부모 장비 노드도 활성화
          if (srcNode?.parentDeviceId) highlightNodes.add(srcNode.parentDeviceId);
          if (tgtNode?.parentDeviceId) highlightNodes.add(tgtNode.parentDeviceId);
        }
      });

      // 2차 패스: 계층 링크 처리 — 장비↔인터페이스 연결선 활성화
      // highlightNodes가 완성된 뒤 실행하므로 피어 장비 연결선까지 포함됨
      targetLinks.forEach(link => {
        if (!(link as any).isHierarchyLink) return;
        const sId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as any).id : link.target;
        // 장비-인터페이스 양쪽 모두 highlight 된 경우만 → 실제 연결된 인터페이스의 선만 활성화
        if (highlightNodes.has(sId) && highlightNodes.has(tId)) {
          highlightLinks.add(link as any);
          if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
            const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
            const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
            highlightLinkIds.current.add(tempS + '-' + tempT);
            highlightLinkIds.current.add(tempT + '-' + tempS);
          }
        }
      });
    } else if (activeGroupId !== null) {
      // Highlight all nodes in the active group, PLUS all expanded peer groups (devices and group nodes)
      visibleData.nodes.forEach(n => {
        if (n.deviceGroupId === activeGroupId || n.id === `group-${activeGroupId}`) {
          highlightNodes.add(n.id);
        } else if (n.deviceGroupId && expandedGroups.has(n.deviceGroupId)) {
          highlightNodes.add(n.id);
        } else if (n.id && typeof n.id === 'string' && n.id.startsWith('group-')) {
          const gid = parseInt(n.id.replace('group-', ''), 10);
          if (expandedGroups.has(gid)) {
            highlightNodes.add(n.id);
          }
        }
      });

      // Highlight internal links, connected links, and hierarchy links for expanded peer groups
      visibleData.links.forEach(link => {
        const sId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const tId = typeof link.target === 'object' ? (link.target as any).id : link.target;

        const srcNode = visibleData.nodes.find(n => n.id === sId);
        const tgtNode = visibleData.nodes.find(n => n.id === tId);

        // Highlight the link if it connects to the active group, OR if it's a hierarchy link inside an expanded peer group
        const isActiveGroupLink = srcNode?.deviceGroupId === activeGroupId || tgtNode?.deviceGroupId === activeGroupId ||
          sId === `group-${activeGroupId}` || tId === `group-${activeGroupId}`;

        const isExpandedHierarchyLink = (link as any).isHierarchyLink && highlightNodes.has(sId) && highlightNodes.has(tId);

        if (isActiveGroupLink || isExpandedHierarchyLink) {
          highlightLinks.add(link as any);
          if (link as any && (link as any).source !== undefined && (link as any).target !== undefined) {
            const tempS = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
            const tempT = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
            highlightLinkIds.current.add(tempS + '-' + tempT);
            highlightLinkIds.current.add(tempT + '-' + tempS);
          }
          highlightNodes.add(sId);
          highlightNodes.add(tId);
        }
      });
    } else if (selectedNode) {
      highlightNodes.add(selectedNode.id);

      if (selectedNode.isRingNode) {
        // 링명 클릭(선택) 시 RINGS 배열을 참조하여 해당 링에 속한 모든 그룹을 하이라이트
        const ringIndex = parseInt(selectedNode.id.replace('ring-', ''));
        const ring = RINGS[ringIndex];
        if (ring) {
          ring.groups.forEach(gid => {
            highlightNodes.add(`group-${gid}`);
          });
        }
        visibleData.links.forEach((link: any) => {
          const s = typeof link.source === 'object' ? link.source.id : link.source;
          const t = typeof link.target === 'object' ? link.target.id : link.target;
          if (highlightNodes.has(s) && highlightNodes.has(t)) {
            highlightLinks.add(link);
            if (link && link.source !== undefined && link.target !== undefined) {
              const tempS = typeof link.source === 'object' ? link.source.id : link.source;
              const tempT = typeof link.target === 'object' ? link.target.id : link.target;
              highlightLinkIds.current.add(tempS + '-' + tempT);
              highlightLinkIds.current.add(tempT + '-' + tempS);
            }
          }
        });
      } else {
        targetLinks.forEach((link: any) => {
          const s = typeof link.source === 'object' ? link.source.id : link.source;
          const t = typeof link.target === 'object' ? link.target.id : link.target;

          if (s === selectedNode.id || t === selectedNode.id) {
            let isValid = true;
            const otherId = s === selectedNode.id ? t : s;

            // 현재 뎁스(그룹/장비)에 진입한 상태라면, 활성화되지 않은 배경 노드(타 그룹 노드 등)로 뻗어가는 선은 하이라이트 제외
            if (activeGroupId !== null) {
              const otherNode = visibleData.nodes.find((n: any) => n.id === otherId);
              if (otherNode && otherNode.isGroupNode && otherNode.deviceGroupId !== activeGroupId) {
                isValid = false;
              }
            } else if (activeDeviceId !== null) {
              const otherNode = visibleData.nodes.find((n: any) => n.id === otherId);
              if (otherNode && otherNode.isDeviceNode && otherNode.id !== activeDeviceId) {
                isValid = false;
              }
            }

            if (isValid) {
              highlightLinks.add(link);
              if (link && link.source !== undefined && link.target !== undefined) {
                const tempS = typeof link.source === 'object' ? link.source.id : link.source;
                const tempT = typeof link.target === 'object' ? link.target.id : link.target;
                highlightLinkIds.current.add(tempS + '-' + tempT);
                highlightLinkIds.current.add(tempT + '-' + tempS);
              }
              highlightNodes.add(s);
              highlightNodes.add(t);
            }
          }
        });
      }
    }

    // 링명에 호버/선택한 노드와 관련된 링만 남기고 비활성화 (투명하게)
    if (hoverNode !== null || selectedNode !== null || activeGroupId !== null || activeDeviceId !== null || pathHighlight !== null) {
      const primaryGids = new Set<number>();

      if (pathHighlight) {
        visibleData.nodes.forEach(n => {
          if (n.deviceGroupId !== undefined && highlightNodes.has(n.id)) {
            primaryGids.add(n.deviceGroupId);
          }
        });
      } else {
        const primaryNode = hoverNode || selectedNode;
        if (primaryNode) {
          if (primaryNode.deviceGroupId !== undefined) {
            primaryGids.add(primaryNode.deviceGroupId);
          } else if (primaryNode.isInterfaceNode && primaryNode.parentDeviceId) {
            const pNode = visibleData.nodes.find(n => n.id === primaryNode.parentDeviceId);
            if (pNode && pNode.deviceGroupId !== undefined) primaryGids.add(pNode.deviceGroupId);
          } else if (primaryNode.isRingNode) {
            const ringIndex = parseInt(primaryNode.id.replace('ring-', ''));
            const ring = RINGS[ringIndex];
            if (ring) ring.groups.forEach(gid => primaryGids.add(gid));
          }
        } else if (activeGroupId !== null) {
          primaryGids.add(activeGroupId);
        } else if (activeDeviceId !== null) {
          const pNode = visibleData.nodes.find(n => n.id === activeDeviceId);
          if (pNode && pNode.deviceGroupId !== undefined) primaryGids.add(pNode.deviceGroupId);
        }
      }

      // 무분별한 연결 그룹 확산을 방지하여, 오직 상호작용한 대상이 실제로 속한 링만 하이라이트
      RINGS.forEach((ring, i) => {
        const ringId = `ring-${i}`;
        if (ring.groups.some(gid => primaryGids.has(gid))) {
          highlightNodes.add(ringId);
        }
      });
    }

    if (graphRef.current) {
      graphRef.current.refresh();
    }
    setHighlightVersion(v => v + 1);
  }, [selectedNode, activeGroupId, activeDeviceId, hoverNode, data.nodes, visibleData.nodes, visibleData.links, highlightNodes, highlightLinks, pathHighlight, searchTerm, searchFilter, is2DMode]);

  useEffect(() => {
    updateHighlight();
  }, [updateHighlight]);


  // 카메라를 활성화된 노드(그룹 또는 장비 전체)에 꽉 차게 맞추는 유틸리티
  // 상태(stateRef)가 비동기적으로 업데이트되기 전에도 올바른 노드를 추적할 수 있도록 명시적 ID 파라미터 추가
  const zoomToFitActiveNodes = useCallback((duration: number = 1200, padding: number = 80, explicitGroupId?: number | null, explicitDeviceId?: string | null, explicitRingId?: string | null) => {
    if (!graphRef.current) {
      // console.log('[zoomToFit] SKIP: no graphRef');
      return;
    }

    // 명시적 ID가 주어지면 그것을 우선 사용, 없으면 stateRef에서 폴백
    const targetGroupId = explicitGroupId !== undefined ? explicitGroupId : stateRef.current.activeGroupId;
    const targetDeviceId = explicitDeviceId !== undefined ? explicitDeviceId : stateRef.current.activeDeviceId;

    const nodes = visibleNodesRef.current;
    // console.log('[zoomToFit] START', {
    //   targetGroupId, targetDeviceId, explicitRingId,
    //   totalVisibleNodes: nodes.length,
    //   nodesWithX: nodes.filter((n: any) => typeof n.x === 'number').length
    // });

    let activeNodes = [];
    const ph = stateRef.current.pathHighlight;

    if (ph) {
      // 경로 탐색 및 링크 격리의 경우 최신 상태인 stateRef를 사용하여 클로저 문제(Stale Closure)를 방지합니다.
      activeNodes = nodes.filter((n: any) => {
        if (!n.isDeviceNode) return false;
        return (ph.deviceIds.has(n.id) || ph.deviceIds.has(String(n.id))) && typeof n.x === 'number';
      });
    } else if (explicitRingId) {
      const ringIndex = parseInt(explicitRingId.replace('ring-', ''), 10);
      const ring = RINGS[ringIndex];
      if (ring) {
        const groupIds = new Set(ring.groups);
        activeNodes = nodes.filter((n: any) => n.isGroupNode && groupIds.has(n.deviceGroupId) && typeof n.x === 'number');
      }
    } else if (targetDeviceId !== null) {
      activeNodes = nodes.filter((n: any) =>
        (n.id === targetDeviceId || n.parentDeviceId === targetDeviceId || highlightNodes.has(n.id))
        && typeof n.x === 'number'
      );
    } else if (targetGroupId !== null) {
      // 2뎁스: 활성 그룹의 노드를 필터링 (연결된 피어 그룹도 포함)
      activeNodes = nodes.filter((n: any) => {
        if (typeof n.x !== 'number') return false;
        if (n.deviceGroupId === targetGroupId || n.id === `group-${targetGroupId}` || highlightNodes.has(n.id)) return true;
        return false;
      });
    } else {
      activeNodes = nodes.filter((n: any) => highlightNodes.has(n.id) && typeof n.x === 'number');
    }

    // console.log('[zoomToFit] activeNodes:', activeNodes.length, activeNodes.map((n: any) => n.id));

    if (activeNodes.length === 0) {
      // console.log('[zoomToFit] SKIP: no activeNodes found');
      return;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    activeNodes.forEach((n: any) => {
      // 노드 종류별로 시각적 크기(라벨, 글로우 포함)를 고려해 바운딩 박스 패딩을 추가
      let nodePadding = 20;
      if (n.isGroupNode) nodePadding = 80;
      else if (n.isDeviceNode) nodePadding = 45;

      minX = Math.min(minX, n.x - nodePadding);
      maxX = Math.max(maxX, n.x + nodePadding);
      minY = Math.min(minY, n.y - nodePadding);
      maxY = Math.max(maxY, n.y + nodePadding);
      minZ = Math.min(minZ, n.z - nodePadding);
      maxZ = Math.max(maxZ, n.z + nodePadding);
    });

    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    let cz = (minZ + maxZ) / 2;

    const camera = graphRef.current.camera();

    // 카메라가 갑자기 회전하여 어지러움을 유발하는 것을 방지하기 위해,
    // 현재 카메라의 위치(시점)를 기준으로 새로운 중심점(cx, cz)을 향하는 각도를 유지합니다.
    let camAngle = 0;
    let usePcaAngle = (explicitRingId !== null || targetGroupId !== null);

    if (usePcaAngle && activeNodes.length >= 2) {
      // Calculate PCA on XZ plane to find the angle of maximum variance
      let sumX = 0, sumZ = 0;
      activeNodes.forEach((n: any) => {
        sumX += n.x;
        sumZ += n.z;
      });
      const meanX = sumX / activeNodes.length;
      const meanZ = sumZ / activeNodes.length;

      let covXX = 0, covXZ = 0, covZZ = 0;
      activeNodes.forEach((n: any) => {
        const dx = n.x - meanX;
        const dz = n.z - meanZ;
        covXX += dx * dx;
        covXZ += dx * dz;
        covZZ += dz * dz;
      });

      const diff = covXX - covZZ;
      const discriminant = Math.sqrt(diff * diff + 4 * covXZ * covXZ);
      const lambda1 = (covXX + covZZ + discriminant) / 2;

      let evX = 0, evZ = 0;
      if (Math.abs(covXZ) < 1e-6) {
        if (covXX > covZZ) { evX = 1; evZ = 0; }
        else { evX = 0; evZ = 1; }
      } else {
        evX = lambda1 - covZZ;
        evZ = covXZ;
      }
      // We want the camera to be perpendicular to the principal component (longest axis)
      // so the ring/group nodes are spread out maximally on the screen.
      camAngle = Math.atan2(evZ, evX) + Math.PI / 2;
    } else if (camera) {
      // 경로 탐색 등 일반 줌에서는 카메라가 회전하지 않고 부드럽게 평행 이동(Panning)만 하도록
      // 현재 카메라가 바라보고 있는 타겟을 기준으로 정확한 현재 방위각을 계산해 그대로 유지합니다.
      const controls = graphRef.current.controls();
      if (controls && controls.target) {
        camAngle = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
      } else {
        camAngle = Math.atan2(camera.position.z, camera.position.x);
      }
    }

    // 화면에서 UI가 차지하는 높이 (위쪽: 헤더+브레드크럼, 아래쪽: 검색패널)
    const isPathHighlight = !!stateRef.current.pathHighlight && !stateRef.current.pathHighlight.isLinkIsolation;
    const topUIHeight = 80;
    // 노드탐색(Path Finder) 패널 등 상시 하단 UI(약 420px)를 감안하여 큰 패딩 추가. 링크 격리는 제외
    const bottomUIHeight = isPathHighlight ? 420 : 100;
    const totalOccludedHeight = topUIHeight + bottomUIHeight;
    const screenHeight = window.innerHeight || 1080;

    // 3D 구(Sphere) 형태의 바운딩 반경 대신, 수평/수직을 분리하여 정확히 화면에 꽉 차게 계산합니다.
    let maxDistX = 0, maxDistY = 0, maxDistZ = 0;
    activeNodes.forEach((n: any) => {
      let nodePadding = 20;
      if (n.isGroupNode) nodePadding = 80;
      else if (n.isDeviceNode) nodePadding = 45;

      maxDistX = Math.max(maxDistX, Math.abs(n.x - cx) + nodePadding);
      maxDistY = Math.max(maxDistY, Math.abs(n.y - cy) + nodePadding);
      maxDistZ = Math.max(maxDistZ, Math.abs(n.z - cz) + nodePadding);
    });

    const aspect = camera && camera.aspect ? camera.aspect : (window.innerWidth / window.innerHeight);
    const fov = camera && camera.fov ? camera.fov : 45;
    const halfFovRad = (fov * Math.PI) / 360;

    // 가시 영역 비율
    const visibleRatio = Math.max(0.4, (screenHeight - totalOccludedHeight) / screenHeight);

    // 카메라의 수평 방향 반경 (X-Z 평면 기준 최대 거리)
    const horizRadius = Math.hypot(maxDistX, maxDistZ);
    // 카메라의 수직 방향 반경 (15도 내려다보는 각도를 반영한 Y-Z 평면 투영 거리)
    const elevation = 15 * Math.PI / 180;
    const vertRadius = maxDistY * Math.cos(elevation) + maxDistZ * Math.sin(elevation);

    // 수평, 수직 각각 화면에 맞추기 위해 필요한 카메라 거리
    const distForHoriz = horizRadius / Math.tan(halfFovRad) / aspect;
    const distForVert = vertRadius / Math.tan(halfFovRad) / visibleRatio;

    // 두 거리 중 큰 값을 선택하여 화면 바깥으로 노드가 잘리지 않도록 보장
    let cameraDistance = Math.max(distForHoriz, distForVert) + padding;
    cameraDistance = Math.max(cameraDistance, 80 + padding);

    // 경로 탐색 또는 장비 선택 시에는 사용자의 요청에 따라 1.2배 추가 확대
    if (isPathHighlight || targetDeviceId !== null) {
      cameraDistance /= 1.2;
    }

    // 입체감을 위해 살짝 위에서 내려다보는 각도(Elevation: 약 15도) 적용
    const camYOffset = cameraDistance * Math.sin(elevation);
    const camXZDist = cameraDistance * Math.cos(elevation);

    let camX = cx + Math.cos(camAngle) * camXZDist;
    let camZ = cz + Math.sin(camAngle) * camXZDist;
    const camY = cy + camYOffset;

    // 180도 뒤집히는 어지러움을 방지하기 위해, 현재 카메라와 가장 가까운 쪽을 선택
    if (camera) {
      const currentCam = camera.position;
      const dx1 = camX - currentCam.x;
      const dz1 = camZ - currentCam.z;
      const dist1 = dx1 * dx1 + dz1 * dz1;

      const altCamX = cx + Math.cos(camAngle + Math.PI) * camXZDist;
      const altCamZ = cz + Math.sin(camAngle + Math.PI) * camXZDist;
      const dx2 = altCamX - currentCam.x;
      const dz2 = altCamZ - currentCam.z;
      const dist2 = dx2 * dx2 + dz2 * dz2;

      if (dist2 < dist1) {
        camX = altCamX;
        camZ = altCamZ;
      }
    }

    // 위/아래 UI 가림 영역 보정 (수직 평행 이동)
    const halfVisibleHeight = cameraDistance * Math.tan(halfFovRad);
    const bottomShiftRatio = (bottomUIHeight - topUIHeight) / 2 / screenHeight;
    const shiftY = halfVisibleHeight * 2 * bottomShiftRatio;

    const finalLookAtY = cy - shiftY;
    const finalCamY = camY - shiftY;

    // console.log('[zoomToFitActiveNodes]', {
    //   activeNodeCount: activeNodes.length,
    //   center: { cx: cx.toFixed(0), cy: cy.toFixed(0), cz: cz.toFixed(0) },
    //   maxRadius3D: maxRadius3D.toFixed(0),
    //   cameraDistance: cameraDistance.toFixed(0),
    //   shiftY: shiftY.toFixed(1)
    // });

    graphRef.current.cameraPosition(
      { x: camX, y: finalCamY, z: camZ },
      { x: cx, y: finalLookAtY, z: cz },
      duration
    );
  }, []);

  // 2D 모드에서 3D 모드로 전환될 때 현재 활성화된 노드가 있다면 화면에 꽉 차게 줌인
  const prevIs2DMode = useRef(is2DMode);
  useEffect(() => {
    if (prevIs2DMode.current === true && is2DMode === false) {
      if (activeGroupId !== null || activeDeviceId !== null || pathHighlight !== null) {
        // 이제 피어 장비들까지 모두 activeNodes 바운딩 박스에 포함되므로,
        // 여백(Padding)을 과도하게 주지 않고 화면에 꽉 차게(snug fit) 설정합니다.
        const targetPadding = 100;

        setTimeout(() => zoomToFitActiveNodes(1200, targetPadding, activeGroupId, activeDeviceId), 300);
        setTimeout(() => zoomToFitActiveNodes(1000, targetPadding, activeGroupId, activeDeviceId), 1200);
        setTimeout(() => zoomToFitActiveNodes(1000, targetPadding, activeGroupId, activeDeviceId), 2500);
      }
    }
    // 3D <-> 2D 전환 시 열려있는 툴팁/팝오버 닫기
    if (prevIs2DMode.current !== is2DMode) {
      setClickedNode(null);
      setClickedLink(null);
      setTooltipPos(null);
      setContextMenu(null);
    }
    prevIs2DMode.current = is2DMode;
  }, [is2DMode, activeGroupId, activeDeviceId, pathHighlight, zoomToFitActiveNodes]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      setContextMenu(null);
      setPathHighlight(null);
      setClickedLink(null);
      setHoverLink(null);
      setTooltipPos(null);
      // console.log('[handleNodeClick]', { id: node.id, isGroupNode: node.isGroupNode, isDeviceNode: node.isDeviceNode, deviceGroupId: node.deviceGroupId });
      let targetForZoomAndSelect: GraphNode | null = node;

      if (node.isGroupNode && node.deviceGroupId !== undefined) {
        const targetGid = node.deviceGroupId;

        // Find all devices in this group
        const groupDevices = data.nodes.filter(n => n.deviceGroupId === targetGid && n.isDeviceNode);
        const deviceIds = new Set(groupDevices.map(n => n.id));

        // Find all peer groups connected to these devices
        const peerGroupIds = new Set<number>();
        for (const link of data.links) {
          if (link.isHierarchyLink) continue;

          let peerId: string | null = null;
          if (deviceIds.has(link.originalSource)) peerId = link.originalTarget;
          else if (deviceIds.has(link.originalTarget)) peerId = link.originalSource;

          if (peerId) {
            const peerNode = data.nodes.find(n => n.id === peerId);
            if (peerNode && peerNode.deviceGroupId) {
              peerGroupIds.add(peerNode.deviceGroupId);
            }
          }
        }

        const nextExpanded = new Set<number>();
        nextExpanded.add(targetGid);
        peerGroupIds.forEach(gid => nextExpanded.add(gid));
        setExpandedGroups(nextExpanded);

        setActiveGroupId(targetGid);
        setActiveDeviceId(null);
      } else if (node.isDeviceNode) {
        // Find all interfaces belonging to this device
        const deviceInterfaces = data.nodes.filter(n => n.isInterfaceNode && n.parentDeviceId === node.id);
        const interfaceIds = new Set(deviceInterfaces.map(n => n.id));

        // Find all peer nodes connected to these interfaces via links
        const peerGroupIds = new Set<number>();
        const peerDeviceIds = new Set<string>();

        for (const link of data.links) {
          if (link.isHierarchyLink) continue;
          const srcId = typeof link.source === 'object' ? (link.source as any).id : link.source;
          const tgtId = typeof link.target === 'object' ? (link.target as any).id : link.target;

          let peerId: string | null = null;
          if (interfaceIds.has(srcId as string)) peerId = tgtId as string;
          else if (interfaceIds.has(tgtId as string)) peerId = srcId as string;

          if (peerId) {
            const peerNode = data.nodes.find(n => n.id === peerId);
            if (peerNode) {
              if (peerNode.deviceGroupId) peerGroupIds.add(peerNode.deviceGroupId);
              if (peerNode.parentDeviceId) peerDeviceIds.add(peerNode.parentDeviceId);
              else if (peerNode.isDeviceNode) peerDeviceIds.add(peerNode.id);
            }
          }
        }

        // Expand peer groups so their device nodes become visible
        const nextExpanded = new Set<number>();
        peerGroupIds.forEach(gid => nextExpanded.add(gid));
        setExpandedGroups(nextExpanded);

        // Expand this device AND all peer devices so their interfaces become visible
        const nextExpandedDevices = new Set<string>();
        nextExpandedDevices.add(node.id);
        peerDeviceIds.forEach(did => nextExpandedDevices.add(did));
        setExpandedDevices(nextExpandedDevices);

        setActiveDeviceId(node.id);
        setActiveGroupId(node.deviceGroupId || null);
      } else {
        if (node.isInterfaceNode) {
          setActiveDeviceId(node.parentDeviceId || null);
          setActiveGroupId(node.deviceGroupId || null);
        } else {
          setActiveDeviceId(null);
          setActiveGroupId(null);
          nodeCoordsRef.current = {}; // Clear coordinate cache to restore initial pristine layout!
        }
      }

      const newNode = targetForZoomAndSelect === selectedNode ? null : targetForZoomAndSelect;
      setSelectedNode(newNode);
      onNodeClick(newNode);

      if ((targetForZoomAndSelect || node.isGroupNode || node.isDeviceNode) && graphRef.current) {
        const zoomTarget = targetForZoomAndSelect || node;
        const nx = zoomTarget.x || 0;
        const ny = zoomTarget.y || 0;
        const nz = zoomTarget.z || 0;

        if (node.isGroupNode) {
          const targetGid = node.deviceGroupId !== undefined ? node.deviceGroupId : null;
          setTimeout(() => zoomToFitActiveNodes(1200, 100, targetGid, null), 150);
        } else if (node.isDeviceNode) {
          const targetDid = node.id;
          setTimeout(() => zoomToFitActiveNodes(1200, 100, null, targetDid), 150);
        } else if (node.isRingNode) {
          const ringId = node.id;
          setTimeout(() => zoomToFitActiveNodes(1200, 20, null, null, ringId), 150);
        } else {
          // 일반/인터페이스 노드 클릭:
          const dist = Math.max(300, Math.hypot(nx, ny, nz) + 200);
          const ratio = dist / Math.max(1, Math.hypot(nx, ny, nz));
          graphRef.current.cameraPosition(
            { x: nx * ratio, y: ny * ratio, z: nz * ratio },
            undefined, // lookAt 전달 금지
            1200
          );
        }
      }
    },
    [selectedNode, onNodeClick, data, zoomToFitActiveNodes]
  );

  // Expose global binding to allow direct HTML tooltips to drill down and focus nodes
  useEffect(() => {
    (window as any).closeClickedLink = (e: any) => {
      if (e) e.stopPropagation();
      ignoreHoverUntilRef.current = Date.now() + 300;
      setClickedLink(null);
      setHoverLink(null);
    };

    (window as any).focusNodeById = (nodeId: string) => {
      setClickedLink(null);

      let targetNode = data.nodes.find(n => n.id === nodeId);

      // Group nodes are dynamically created, so they might not be in data.nodes
      if (!targetNode && nodeId.startsWith('group-')) {
        const gid = parseInt(nodeId.replace('group-', ''), 10);
        targetNode = {
          id: nodeId,
          isGroupNode: true,
          deviceGroupId: gid
        } as any;
      }

      if (!targetNode) return;

      if (is2DMode) {
        if ((window as any).focusNodeById2D) {
          if (targetNode.isInterfaceNode && targetNode.parentDeviceId) {
            (window as any).focusNodeById2D(String(targetNode.parentDeviceId));
          } else {
            (window as any).focusNodeById2D(nodeId);
          }
        }
      }
      // Expand dependencies recursively if collapsed
      if (targetNode.isInterfaceNode) {
        if (targetNode.deviceGroupId) {
          setExpandedGroups(prev => {
            const next = new Set(prev);
            next.add(targetNode.deviceGroupId!);
            return next;
          });
        }
        if (targetNode.parentDeviceId) {
          setExpandedDevices(prev => {
            const next = new Set(prev);
            next.add(targetNode.parentDeviceId!);
            return next;
          });
        }

        const link = data.links.find(l =>
          (l.source.id || l.source) === targetNode.id ||
          (l.target.id || l.target) === targetNode.id
        );

        if (is2DMode) {
          if (link && (window as any).focusEdgeById2D) {
            (window as any).focusEdgeById2D(link.id);
          }
          if ((window as any).focusNodeById2D && targetNode.parentDeviceId) {
            (window as any).focusNodeById2D(String(targetNode.parentDeviceId));
          }
          if (link) {
            handleLinkDoubleClick(link as GraphLink);
            setTimeout(() => setClickedLink(link as GraphLink), 500);
          }
          // Do not return here, so that global state gets updated if needed
        } else {
          if (link) {
            setTimeout(() => {
              handleLinkDoubleClick(link as GraphLink);
              setTimeout(() => setClickedLink(link as GraphLink), 500);
            }, 600); // Wait for depth expansion and physics layout
            // Do not return here, so that handleNodeClick(parentDevice) is called
          }
        }
      }

      // Delay briefly to allow D3 physics layout to insert nodes
      setTimeout(() => {
        if (graphRef.current) {
          const simulatedNode = visibleNodesRef.current.find((n: any) => n.id === nodeId);
          const target = simulatedNode || targetNode;

          // 인터페이스인 경우 상위 장비로 이동(줌 인)
          if (target.isInterfaceNode && target.parentDeviceId) {
            const parentDevice = visibleNodesRef.current.find((n: any) => String(n.id) === String(target.parentDeviceId)) || data.nodes.find(n => String(n.id) === String(target.parentDeviceId));
            if (parentDevice) {
              handleNodeClick(parentDevice);
            } else {
              handleNodeClick(target);
            }
          } else {
            handleNodeClick(target);
          }

          // 카메라 줌 애니메이션(1200ms) 완료 직후, 해당 노드에 하이라이팅 툴팁 카드를 팝업합니다.
          setTimeout(() => {
            const latestNode = visibleNodesRef.current.find((n: any) => n.id === nodeId) || target;
            setClickedNode(latestNode);
            // 인터페이스 등 장비 주변에 있는 노드의 정확한 화면 좌표를 계산하여 툴팁을 띄웁니다.
            if (graphRef.current && typeof (graphRef.current as any).graph2ScreenCoords === 'function' && latestNode.x !== undefined && latestNode.y !== undefined && latestNode.z !== undefined) {
              const coords = (graphRef.current as any).graph2ScreenCoords(latestNode.x, latestNode.y, latestNode.z);
              setTooltipPos({ x: coords.x, y: coords.y });
            } else {
              setTooltipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            }
          }, 1250);
        } else {
          handleNodeClick(targetNode);
        }
      }, 300);
    };
    return () => {
      delete (window as any).closeClickedLink;
      delete (window as any).focusNodeById;
    };
  }, [data.nodes, handleNodeClick, is2DMode]);

  const getNodeVal = useCallback((node: any) => {
    if (node.isGroupNode) return 40;
    if (node.isDeviceNode) return 15;
    if (node.isInterfaceNode) return 4;
    return node.val || 10;
  }, []);


  const customZoomToFitAllNodes = useCallback((duration: number, preserveAngle: boolean = false) => {
    if (!graphRef.current) return;

    let targetX = 0;
    let targetZ = 666; // 현재 상태(Z=686)에서 1.03배 더 확대하기 위해 666으로 거리 조정

    if (preserveAngle) {
      const camera = graphRef.current.camera();
      const controls = graphRef.current.controls();
      if (camera && controls) {
        const dx = camera.position.x - controls.target.x;
        const dz = camera.position.z - controls.target.z;
        const angle = Math.atan2(dz, dx);
        targetX = 625 * Math.cos(angle);
        targetZ = 625 * Math.sin(angle);

        // 마우스 드래그로 틀어진 롤(Roll) 값을 초기화
        camera.up.set(0, 1, 0);
      }
    }

    // 노드탐색 패널 등 하단 UI에 가려지지 않도록 카메라 target Y를 -20으로 설정 (이전 -40 대비 40px 가량 하향)
    graphRef.current.cameraPosition({ x: targetX, y: 0, z: targetZ }, { x: 0, y: -20, z: 0 }, duration);
  }, []);


  const handleResetToRoot = useCallback(() => {
    setSelectedNode(null);
    setClickedNode(null);
    setTooltipPos(null);
    setActiveGroupId(null);
    setActiveDeviceId(null);
    onNodeClick(null);
    setExpandedGroups(new Set());
    setExpandedDevices(new Set());

    // 자동 회전을 잠시 멈추고 카메라를 정면(초기 셋팅값)으로 완전히 복귀시킨 후 회전을 다시 시작합니다.
    setIsAutoRotating(false);
    nodeCoordsRef.current = {}; // Clear coordinate cache to restore initial pristine layout!

    if (graphRef.current) {
      setTimeout(() => {
        customZoomToFitAllNodes(800, false);
        setTimeout(() => {
          setIsAutoRotating(true);
        }, 850); // 트랜지션 완료 직후 회전 재개
      }, 100);
    }
  }, [onNodeClick, customZoomToFitAllNodes]);

  const handleBackToGroup = useCallback(() => {
    if (activeGroupId === null) return;

    const groupNode = visibleData.nodes.find(n => n.id === `group-${activeGroupId}`);
    if (groupNode) {
      setSelectedNode(groupNode);
      onNodeClick(groupNode);
    } else {
      setSelectedNode(null);
      onNodeClick(null);
    }

    setClickedNode(null);
    setTooltipPos(null);
    setActiveDeviceId(null);
    setExpandedDevices(new Set());

    // 3뎁스에서 강제로 열어두었던 타 그룹(peerGroups)들을 닫기 위해,
    // 현재 활성화된 그룹(activeGroupId)과 그에 직접 연결된 타 그룹만 남기고 초기화
    const groupDevices = data.nodes.filter(n => n.deviceGroupId === activeGroupId && n.isDeviceNode);
    const deviceIds = new Set(groupDevices.map(n => n.id));
    const peerGroupIds = new Set<number>();
    for (const link of data.links) {
      if (link.isHierarchyLink) continue;

      let peerId: string | null = null;
      if (deviceIds.has(link.originalSource)) peerId = link.originalTarget;
      else if (deviceIds.has(link.originalTarget)) peerId = link.originalSource;

      if (peerId) {
        const peerNode = data.nodes.find(n => n.id === peerId);
        if (peerNode && peerNode.deviceGroupId) {
          peerGroupIds.add(peerNode.deviceGroupId);
        }
      }
    }

    const nextExpanded = new Set([activeGroupId]);
    peerGroupIds.forEach(gid => nextExpanded.add(gid));
    setExpandedGroups(nextExpanded);

    setTimeout(() => {
      if (graphRef.current) {
        const groupNode = data.nodes.find(n => n.deviceGroupId === activeGroupId && n.isGroupNode);
        if (groupNode) {
          const nx = groupNode.x || 0;
          const ny = groupNode.y || 0;
          const nz = groupNode.z || 0;
          const dist = Math.max(500, Math.hypot(nx, ny, nz) + 400);
          const ratio = dist / Math.max(1, Math.hypot(nx, ny, nz));
          graphRef.current.cameraPosition(
            { x: nx * ratio, y: ny * ratio, z: nz * ratio },
            undefined,
            1200
          );
          // handleBackToGroup에서도 물리 엔진 팽창/수축에 맞춰 카메라가 계속 따라가게 추적
          setTimeout(() => zoomToFitActiveNodes(1200, 20, activeGroupId, null), 150);
        } else {
          zoomToFitActiveNodes(1200, 20, activeGroupId, null);
        }
      }
    }, 100);
  }, [activeGroupId, onNodeClick, data.nodes, visibleData.nodes]);

  const handleBackgroundClick = useCallback(() => {
    setContextMenu(null);
    const now = Date.now();
    const delay = now - lastBgClickTimeRef.current;
    lastBgClickTimeRef.current = now;

    if (delay < 300) {
      // 더블 클릭 감지 -> 한 단계 이전으로 돌아가기
      lastBgClickTimeRef.current = 0; // 트리플 클릭 방지

      if (bgClickTimeoutRef.current) {
        clearTimeout(bgClickTimeoutRef.current);
        bgClickTimeoutRef.current = null;
      }

      setTooltipPos(null);
      setClickedNode(null);

      // stateRef.current에 저장된 값을 바탕으로 현재 뎁스 파악
      const { activeDeviceId, activeGroupId, selectedNode } = stateRef.current;

      if (activeDeviceId !== null) {
        // 3뎁스(장비) -> 2뎁스(그룹)로 돌아갈 때 브레드크럼의 "그룹명" 클릭과 동일한 효과
        handleBackToGroup();
      } else if (activeGroupId !== null) {
        // 2뎁스(그룹) -> 1뎁스(루트)로 돌아갈 때 브레드크럼의 "전체" 클릭과 동일한 효과
        handleResetToRoot();
        if (pathHighlight?.isLinkIsolation) {
          setPathHighlight(null);
        }
      } else if (selectedNode !== null) {
        // 링 화면 -> 1뎁스(루트)로 돌아갈 때 브레드크럼의 "전체" 클릭과 동일한 효과
        handleResetToRoot();
      } else if (pathHighlight?.isLinkIsolation) {
        // 활성화된 뎁스가 없지만 링크 격리 상태일 때
        setPathHighlight(null);
      }
    } else {
      // 싱글 클릭 -> 툴팁이나 클릭된 상태만 해제하고 화면 뎁스는 유지
      bgClickTimeoutRef.current = setTimeout(() => {
        bgClickTimeoutRef.current = null;
        setTooltipPos(null);
        setClickedNode(null);
      }, 300);
    }
  }, [handleBackToGroup, handleResetToRoot]);

  const getNodeColor = useCallback((node: any) => {
    const isHighlight = highlightNodes.has(node.id);
    const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;

    if (isHighlight) {
      if (node.isGroupNode) return iconConcept === 'block' ? '#38bdf8' : '#eab308'; // sky-400 or yellow-500
      if (node.isDeviceNode) return '#3b82f6';
      if (node.isInterfaceNode) return '#10b981'; // green
      return '#fde047';
    }
    if (isDimmed) return 'rgba(100, 116, 139, 0.4)';

    if (node.isGroupNode) return iconConcept === 'block' ? 'rgba(14, 165, 233, 0.9)' : 'rgba(234, 179, 8, 0.9)'; // sky-500 or yellow-500
    if (node.isDeviceNode) return 'rgba(59, 130, 246, 0.9)'; // blue
    if (node.isInterfaceNode) return 'rgba(16, 185, 129, 0.9)'; // emerald
    return 'rgba(148, 163, 184, 0.6)';
  }, [highlightNodes, selectedNode, activeGroupId, activeDeviceId, hoverNode, iconConcept]);

  const getNodeThreeObject = useCallback((node: any) => {
    const isHighlight = highlightNodes.has(node.id);
    const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
    // 현재 클릭/활성화된 노드 판별 — 이 노드를 강하게 빛나게 함
    const isPathHighlightTarget = pathHighlight !== null && (pathHighlight.deviceIds.has(node.id) || pathHighlight.deviceIds.has(String(node.id)));
    const isActiveNode =
      (node.isGroupNode && node.deviceGroupId === activeGroupId) ||
      (node.isDeviceNode && node.id === activeDeviceId) ||
      isPathHighlightTarget;

    // 1뎁스에서는 visibleData에 x, y, z가 캐시되지 않으므로, 
    // ForceGraph 내부 엔진의 최신 좌표를 직접 조회하여 정확한 거리를 계산합니다.
    let resolvedPos = new THREE.Vector3(node.x || 0, node.y || 0, node.z || 0);
    if (node.x === undefined && graphRef.current && typeof graphRef.current.graphData === 'function') {
      const internalNodes = graphRef.current.graphData().nodes;
      if (internalNodes) {
        const actualNode = internalNodes.find((n: any) => n.id === node.id);
        if (actualNode && actualNode.x !== undefined) {
          resolvedPos = new THREE.Vector3(actualNode.x, actualNode.y, actualNode.z);
        }
      }
    }

    // 마우스 호버 등 상태 변경으로 인해 노드 3D 객체가 재생성될 때 깜빡임(flicker)을 방지하기 위해 
    // 생성 시점의 현재 카메라 줌 팩터를 즉시 적용합니다.
    let initialZoomFactor = 1;
    if (graphRef.current) {
      const camera = graphRef.current.camera();
      if (camera) {
        const distance = camera.position.distanceTo(resolvedPos);
        initialZoomFactor = distance / 450;
      }
    }

    // 마우스 호버 시 겹쳐있는 노드 중 활성화(Active)된 노드가 
    // 비활성화(Dimmed) 노드보다 물리적으로 뒤에 있더라도 우선적으로 호버/클릭되도록 Raycast 거리를 조작합니다.
    if (node.isRingNode) {
      const group = new THREE.Group();
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createTextCanvas(node.label, 1.0, 'ring'), // 항상 1.0으로 생성 후 material.opacity로 동적 조절
          depthWrite: false,
          depthTest: false,
          color: isHighlight ? '#ffffff' : '#e2e8f0',
          opacity: isDimmed ? 0.1 : 1.0
        })
      );
      sprite.raycast = customRaycast;
      sprite.renderOrder = 999; // 항상 라인 위에 표출
      sprite.scale.set(20 * initialZoomFactor, 10 * initialZoomFactor, 1); // Hover 영역 대폭 축소 (60x30 -> 20x10)
      group.add(sprite);

      // 화면 확대/축소 시에도 링명 폰트 사이즈가 일정하게 유지되도록 고정
      // 링명도 비활성화 시 드래그 방지 및 빈 공간 처리를 위해 userData 갱신
      group.userData = {
        animate: (camera: THREE.Camera, obj: THREE.Object3D) => {
          const { selectedNode, activeGroupId, activeDeviceId, hoverNode, pathHighlight } = stateRef.current as any;
          const currentIsHighlight = highlightNodes.has(node.id);
          const currentIsDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !currentIsHighlight;

          sprite.userData = { isDimmed: currentIsDimmed, isActive: currentIsHighlight };
          sprite.visible = pathHighlight === null;
          if (sprite.material) {
            sprite.material.opacity = currentIsDimmed ? 0.1 : 1.0;
            const isSelected = selectedNode && selectedNode.id === node.id;
            sprite.material.color.set(isSelected ? '#a3e635' : (currentIsHighlight ? '#ffffff' : '#e2e8f0'));
            sprite.material.blending = isSelected ? 2 : 1; // 2 = THREE.AdditiveBlending, 1 = THREE.NormalBlending
          }

          if (camera) {
            let targetPos = obj.position;
            if (targetPos.x === 0 && targetPos.y === 0 && targetPos.z === 0) {
              targetPos = resolvedPos;
            }
            const distance = camera.position.distanceTo(targetPos);
            const zoomFactor = distance / 450; // 450 is the reference distance
            const scaleMultiplier = (selectedNode && selectedNode.id === node.id) ? 1.35 : 1.0;
            sprite.scale.set(20 * zoomFactor * scaleMultiplier, 10 * zoomFactor * scaleMultiplier, 1); // Hover 영역 대폭 축소 (60x30 -> 20x10)

            // 1. 전체 토폴로지 외곽을 감싸도록(바깥으로 빠지게) 좌우 방향 밀어내기
            // (요청에 따라 전체적으로 텍스트 중심을 5% 정도 내려서 y값을 0.5 -> 0.55로 조정)
            if (targetPos.x < -20) {
              sprite.center.set(1.2, 0.55); // 왼쪽 링은 텍스트를 더 왼쪽 바깥으로
            } else if (targetPos.x > 20) {
              sprite.center.set(-0.2, 0.55); // 오른쪽 링은 텍스트를 더 오른쪽 바깥으로
            } else {
              sprite.center.set(0.5, 0.55); // 중앙 부근
            }

            // 2. 링명이 토폴로지 상단으로 너무 멀어지지 않도록 전체적으로 -40 만큼 하향 조정 (기존 -70에서 30 상향)
            if (targetPos.y < -50) {
              // Y축으로 내려간 만큼 비례해서 위쪽(+Y)으로 오프셋 부여하되, 기본적으로 -40 위치에서 시작
              sprite.position.y = (Math.abs(targetPos.y + 50) * 0.35) - 40;
            } else {
              sprite.position.y = -40;
            }
          }
        }
      };

      return group;
    }

    let coreColor = '#9ca3af';
    let wireframeColor = '#4b5563';
    let hasAlarm = node.severity && node.severity !== 'normal';

    // (비활성화 상태여도 장애컬러를 유지해달라는 요청에 따라 강제 제거 로직 삭제)
    if (hasAlarm) {
      coreColor = SEVERITY_COLORS[node.severity].color;
      wireframeColor = SEVERITY_COLORS[node.severity].emissive;
    } else if (isActiveNode) {
      // 클릭된 노드: 더 밝은 색상 사용
      if (node.isGroupNode) {
        coreColor = iconConcept === 'block' ? '#67e8f9' : '#fde047'; // cyan-300 or yellow-300
        wireframeColor = iconConcept === 'block' ? '#22d3ee' : '#eab308'; // cyan-400 or yellow-500
      } else if (node.isDeviceNode) {
        const isForward = node.deviceGroupId !== undefined && (groupsMetadata[node.deviceGroupId] || '').includes('전진배치');
        if (isForward) {
          coreColor = '#a78bfa'; // 밝은 푸른빛 보라색 (violet-400)
          wireframeColor = '#8b5cf6'; // (violet-500)
        } else {
          coreColor = '#93c5fd'; // 더 밝은 파란색
          wireframeColor = '#3b82f6';
        }
      } else if (node.isInterfaceNode) {
        coreColor = '#34d399'; // 밝은 에메랄드 그린
        wireframeColor = '#10b981';
      }
    } else {
      if (node.isGroupNode) {
        coreColor = iconConcept === 'block' ? '#06b6d4' : '#eab308'; // cyan-500 or yellow-500
        wireframeColor = iconConcept === 'block' ? '#0891b2' : '#ca8a04'; // cyan-600 or yellow-600
      } else if (node.isDeviceNode) {
        const isForward = node.deviceGroupId !== undefined && (groupsMetadata[node.deviceGroupId] || '').includes('전진배치');
        if (isForward) {
          coreColor = '#8b5cf6'; // 푸른빛 보라색 (violet-500)
          wireframeColor = '#6d28d9'; // (violet-700)
        } else {
          coreColor = '#3b82f6'; // 파란색
          wireframeColor = '#2563eb';
        }
      } else if (node.isInterfaceNode) {
        coreColor = '#10b981';
        wireframeColor = '#059669';
      }
    }

    let gradientMap = null;
    if (iconConcept === 'block' && node.isGroupNode && !hasAlarm) {
      const lightColor = isActiveNode ? '#67e8f9' : '#22d3ee'; // 빛 (시안/하늘민트)
      const darkColor = '#000000'; // 상단은 발광하지 않음 (블랙)
      gradientMap = getGradientTexture(lightColor, darkColor);
    }

    const group = new THREE.Group();

    let radiusMultiplier = 2.4;

    let baseVal = node.val || 10;
    if (node.isGroupNode) {
      baseVal = iconConcept === 'planet' ? 36.9 : 16.4; // 행성 테마는 1.5배 크게(반지름 기준), 블록 테마는 유지
    }
    else if (node.isDeviceNode) baseVal = 15;
    else if (node.isInterfaceNode) baseVal = 9; // 인터페이스 노드 기존 4에서 1.5배로 증가 (반지름 1.5배)

    const radius = Math.sqrt(baseVal * 0.4) * radiusMultiplier;
    const opacityMultiplier = isDimmed ? 0.3 : 1;

    // 클릭된 노드: 글로우 스케일 1.3배, emissive 강화
    const emissiveBoost = isActiveNode ? 2.5 : 1.0;
    const glowScaleBoost = isActiveNode ? 1.3 : 1.0;

    let wireframeSphere: any = null;
    const currentConcept = iconConcept || 'planet';

    if (currentConcept === 'block') {
      // ----------------------------------------------------
      // Block Concept
      // ----------------------------------------------------
      if (node.isGroupNode) {
        // 1. 기본 아우터 글래스 (외곽선 있음, 맵 없음)
        const boxMat = new THREE.MeshPhysicalMaterial({
          color: gradientMap ? '#020617' : (hasAlarm ? '#000000' : coreColor),
          map: null,
          emissive: hasAlarm ? '#000000' : (gradientMap ? '#ffffff' : coreColor),
          emissiveMap: gradientMap || null,
          emissiveIntensity: 1.5 * emissiveBoost,
          transparent: true,
          opacity: 1.0 * opacityMultiplier,
          transmission: 0.5,
          roughness: 0.05,
          metalness: 0.2,
          clearcoat: 1.0,
          depthWrite: true
        });

        // (격자 무늬는 별도의 LineSegments로 그리므로 gridMat은 더 이상 사용하지 않음)

        // 3. 내부 코어 (외곽선 없음, 반투명 솔리드)
        const coreMat = new THREE.MeshPhysicalMaterial({
          color: gradientMap ? '#020617' : (hasAlarm ? '#000000' : coreColor),
          emissive: hasAlarm ? '#000000' : (gradientMap ? '#38bdf8' : coreColor),
          emissiveMap: gradientMap || null,
          emissiveIntensity: 0.5 * emissiveBoost,
          transparent: true,
          opacity: 1.0 * opacityMultiplier,
          transmission: 0.1,
          depthWrite: true
        });

        const building = new THREE.Group();
        building.name = 'coreSphere';

        // 바닥 발광 패드 추가 (공통)
        const padMat = new THREE.MeshBasicMaterial({
          color: isActiveNode ? '#67e8f9' : '#22d3ee',
          transparent: true,
          opacity: 0.3 * opacityMultiplier,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const basePad = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3.2, radius * 3.2), padMat);
        basePad.rotation.x = -Math.PI / 2;
        basePad.position.y = 0.05;
        building.add(basePad);

        // 넓게 퍼지는 소프트 발광 패드
        const softPadMat = padMat.clone();
        softPadMat.map = createGlowTexture();
        softPadMat.opacity = 0.6 * opacityMultiplier;
        const softPad = new THREE.Mesh(new THREE.PlaneGeometry(radius * 5.5, radius * 5.5), softPadMat);
        softPad.rotation.x = -Math.PI / 2;
        softPad.position.y = 0.02;
        building.add(softPad);

        const addBlock = (w: number, h: number, d: number, y: number, x = 0, z = 0, options: { grid?: boolean, innerCore?: boolean, noLines?: boolean } = {}) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMat);
          mesh.position.set(x, y, z);
          mesh.name = 'buildingMesh';
          mesh.raycast = customRaycast;

          if (!options.noLines) {
            const edges = new THREE.EdgesGeometry(mesh.geometry);
            // 1. 메인 엣지 라인
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
              color: wireframeColor, transparent: true, opacity: 0.05 * opacityMultiplier, depthWrite: false
            }));
            line.name = 'buildingLine';
            mesh.add(line);
            // 2. 가짜 블러 글로우 라인 1
            const glowLine1 = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
              color: wireframeColor, transparent: true, opacity: 0.15 * opacityMultiplier, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            glowLine1.scale.set(1.03, 1.03, 1.03);
            glowLine1.name = 'buildingLineGlow';
            mesh.add(glowLine1);
            // 3. 가짜 블러 글로우 라인 2
            const glowLine2 = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
              color: wireframeColor, transparent: true, opacity: 0.05 * opacityMultiplier, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            glowLine2.scale.set(1.06, 1.06, 1.06);
            glowLine2.name = 'buildingLineGlow';
            mesh.add(glowLine2);
            // 4. 바디 글로우
            const bodyGlow = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
              color: coreColor, transparent: true, opacity: 0.2 * opacityMultiplier, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            bodyGlow.scale.set(1.04, 1.04, 1.04);
            bodyGlow.name = 'buildingBodyGlow';
            mesh.add(bodyGlow);
          }

          if (options.innerCore) {
            const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, h * 0.95, d * 0.75), coreMat);
            coreMesh.name = 'innerCoreMesh';
            mesh.add(coreMesh);
          }

          if (options.grid) {
            // 박스 표면에 실제 격자 메쉬(LineSegments) 생성
            const step = Math.min(w, h, d) * 0.3; // 격자 간격 (건물 크기에 비례)
            const points = [];
            const hx = w / 2, hy = h / 2, hz = d / 2;

            // Front & Back faces (XY plane, z = hz and -hz)
            for (let x = -hx + step; x < hx - 0.01; x += step) {
              points.push(new THREE.Vector3(x, -hy, hz), new THREE.Vector3(x, hy, hz));
              points.push(new THREE.Vector3(x, -hy, -hz), new THREE.Vector3(x, hy, -hz));
            }
            for (let y = -hy + step; y < hy - 0.01; y += step) {
              points.push(new THREE.Vector3(-hx, y, hz), new THREE.Vector3(hx, y, hz));
              points.push(new THREE.Vector3(-hx, y, -hz), new THREE.Vector3(hx, y, -hz));
            }

            // Left & Right faces (YZ plane, x = hx and -hx)
            for (let z = -hz + step; z < hz - 0.01; z += step) {
              points.push(new THREE.Vector3(hx, -hy, z), new THREE.Vector3(hx, hy, z));
              points.push(new THREE.Vector3(-hx, -hy, z), new THREE.Vector3(-hx, hy, z));
            }
            for (let y = -hy + step; y < hy - 0.01; y += step) {
              points.push(new THREE.Vector3(hx, y, -hz), new THREE.Vector3(hx, y, hz));
              points.push(new THREE.Vector3(-hx, y, -hz), new THREE.Vector3(-hx, y, hz));
            }

            // Top & Bottom faces (XZ plane, y = hy and -hy)
            for (let x = -hx + step; x < hx - 0.01; x += step) {
              points.push(new THREE.Vector3(x, hy, -hz), new THREE.Vector3(x, hy, hz));
              points.push(new THREE.Vector3(x, -hy, -hz), new THREE.Vector3(x, -hy, hz));
            }
            for (let z = -hz + step; z < hz - 0.01; z += step) {
              points.push(new THREE.Vector3(-hx, hy, z), new THREE.Vector3(hx, hy, z));
              points.push(new THREE.Vector3(-hx, -hy, z), new THREE.Vector3(hx, -hy, z));
            }

            const gridGeo = new THREE.BufferGeometry().setFromPoints(points);
            const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
              color: wireframeColor, transparent: true, opacity: 0.05 * opacityMultiplier, depthWrite: false
            }));

            const gridGlow = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
              color: wireframeColor, transparent: true, opacity: 0.15 * opacityMultiplier, blending: THREE.AdditiveBlending, depthWrite: false
            }));
            gridGlow.scale.set(1.02, 1.02, 1.02);

            mesh.add(gridLines);
            mesh.add(gridGlow);
          }

          building.add(mesh);
        };

        const R = radius;
        const labelStr = node.name || node.label || '';

        if (labelStr.includes('시청')) {
          // 시청: 3단 구조 (중앙, 좌, 우) - 격자 없이 코어 중첩
          addBlock(R * 1.4, R * 2.8, R * 1.4, R * 1.4, 0, 0, { innerCore: true }); // 중앙
          addBlock(R * 0.8, R * 1.8, R * 1.0, R * 0.9, -R * 1.1, 0, { innerCore: true }); // 좌
          addBlock(R * 0.8, R * 1.8, R * 1.0, R * 0.9, R * 1.1, 0, { innerCore: true }); // 우
          addBlock(R * 1.0, R * 0.8, R * 1.0, R * 0.4, 0, R * 1.0, { innerCore: true }); // 전면
        } else if (labelStr.includes('도청')) {
          // 도청: 높은 격자 타워, 좌측 별관, 옥상
          addBlock(R * 1.6, R * 3.2, R * 1.6, R * 1.6, 0, 0, { grid: true, innerCore: true }); // 메인
          addBlock(R * 0.8, R * 1.6, R * 1.0, R * 0.8, -R * 1.2, 0, { grid: true, innerCore: true }); // 좌측
          addBlock(R * 1.0, R * 0.8, R * 1.0, R * 0.4, 0, R * 1.0, { innerCore: true }); // 전면 입구
          addBlock(R * 0.6, R * 0.3, R * 0.6, R * 3.2 + R * 0.15, R * 0.3, -R * 0.3, { innerCore: true }); // 옥상 구조물
        } else if (labelStr.includes('센터')) {
          // 센터: 넓은 격자 건물, 옥상 구조물
          addBlock(R * 2.0, R * 2.2, R * 2.0, R * 1.1, 0, 0, { grid: true, innerCore: true }); // 메인
          addBlock(R * 1.2, R * 0.8, R * 1.2, R * 0.4, 0, R * 1.2, { innerCore: true }); // 전면 입구
          addBlock(R * 0.8, R * 0.2, R * 0.8, R * 2.2 + R * 0.1, 0, 0, { innerCore: true }); // 옥상 구조물
        } else if (labelStr.includes('별관')) {
          // 별관: 단일 블록
          addBlock(R * 1.4, R * 1.6, R * 1.4, R * 0.8, 0, 0, { innerCore: true }); // 메인
          addBlock(R * 0.8, R * 0.6, R * 0.8, R * 0.3, 0, R * 0.9, { innerCore: true }); // 입구
        } else {
          // 청사 (기본): 3층으로 겹겹이 쌓인 타워형 (수평 분할)
          addBlock(R * 1.6, R * 1.0, R * 1.6, R * 0.5, 0, 0, { innerCore: true }); // 1층
          addBlock(R * 1.6, R * 1.0, R * 1.6, R * 1.6, 0, 0, { innerCore: true }); // 2층
          addBlock(R * 1.6, R * 1.0, R * 1.6, R * 2.7, 0, 0, { innerCore: true }); // 3층
          addBlock(R * 1.0, R * 0.8, R * 1.0, R * 0.4, 0, R * 1.0, { innerCore: true }); // 전면 입구
        }

        building.renderOrder = isDimmed ? 100 : (isActiveNode ? 200 : 150);
        group.add(building);
        wireframeSphere = building;
      } else if (node.isDeviceNode) {
        let stackCount = 2; // Default for 'M' (중)
        if (node.deviceSize === 'S') stackCount = 1; // 소
        else if (node.deviceSize === 'L') stackCount = 3; // 대

        const boxMat = new THREE.MeshPhysicalMaterial({
          color: hasAlarm ? '#000000' : coreColor,
          emissive: hasAlarm ? '#000000' : coreColor,
          emissiveIntensity: 1.0 * emissiveBoost,
          transparent: true,
          opacity: 0.8 * opacityMultiplier, // opacity 0.8
          transmission: 0.5, // 맑고 투명한 유리 느낌을 위해 투과율 조정
          roughness: 0.2,
          metalness: 0.1,
          clearcoat: 1.0,
          depthWrite: false
        });

        const deviceGroup = new THREE.Group();
        deviceGroup.name = 'coreSphere';

        // 납작한 상자의 크기 정의 (블록 테마에서 장비 아이콘 크기 0.8배 축소)
        const blockScale = 0.8;
        const boxWidth = radius * 1.8 * blockScale;
        const boxDepth = radius * 1.8 * blockScale;
        const boxHeight = radius * 0.525 * blockScale; // 기존 0.35에서 1.5배 두껍게 수정
        const gap = radius * 0.15 * blockScale;

        const totalHeight = stackCount * boxHeight + (stackCount - 1) * gap;
        const startY = -totalHeight / 2 + boxHeight / 2;

        for (let i = 0; i < stackCount; i++) {
          const yOffset = startY + i * (boxHeight + gap);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth), boxMat);
          mesh.position.set(0, yOffset, 0);
          mesh.name = 'buildingMesh'; // 건물과 동일한 투명도 및 펄스 로직을 공유하기 위해 이름 사용
          mesh.raycast = customRaycast;

          const edges = new THREE.EdgesGeometry(mesh.geometry);

          // 1. 메인 엣지 라인
          const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: wireframeColor,
            transparent: true,
            opacity: 0.05 * opacityMultiplier,
            depthWrite: false
          }));
          line.name = 'buildingLine';
          mesh.add(line);

          // 2. 가짜 블러 글로우 라인 1
          const glowLine1 = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: wireframeColor,
            transparent: true,
            opacity: 0.15 * opacityMultiplier,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          }));
          glowLine1.scale.set(1.03, 1.03, 1.03);
          glowLine1.name = 'buildingLineGlow';
          mesh.add(glowLine1);

          // 3. 가짜 블러 글로우 라인 2
          const glowLine2 = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
            color: wireframeColor,
            transparent: true,
            opacity: 0.05 * opacityMultiplier,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          }));
          glowLine2.scale.set(1.06, 1.06, 1.06);
          glowLine2.name = 'buildingLineGlow';
          mesh.add(glowLine2);

          // 4. 몸체 내부/외부 그라데이션 및 블러 효과용 바디 글로우
          const bodyGlow = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
            color: coreColor,
            transparent: true,
            opacity: 0.2 * opacityMultiplier,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          }));
          bodyGlow.scale.set(1.04, 1.04, 1.04);
          bodyGlow.name = 'buildingBodyGlow';
          mesh.add(bodyGlow);

          deviceGroup.add(mesh);
        }

        deviceGroup.renderOrder = isDimmed ? 100 : (isActiveNode ? 200 : 150);
        group.add(deviceGroup);
        wireframeSphere = deviceGroup;
      } else {
        const portMat = new THREE.MeshPhysicalMaterial({
          color: hasAlarm ? '#000000' : coreColor,
          emissive: hasAlarm ? '#000000' : coreColor,
          emissiveIntensity: 1.2 * emissiveBoost,
          transparent: true,
          opacity: 0.8 * opacityMultiplier,
          depthWrite: false
        });
        const port = new THREE.Mesh(new THREE.BoxGeometry(radius, radius, radius), portMat); // 완벽한 정육면체(정사각형)
        const edges = new THREE.EdgesGeometry(port.geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: wireframeColor, transparent: true, opacity: opacityMultiplier }));
        port.add(line);
        port.name = 'coreSphere';
        port.raycast = customRaycast;
        port.renderOrder = isDimmed ? 100 : (isActiveNode ? 200 : 150);
        group.add(port);
        wireframeSphere = port;
      }

      const glowMaterial = new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: coreColor,
        transparent: true,
        blending: THREE.AdditiveBlending,
        opacity: 0.5 * opacityMultiplier,
        depthWrite: false
      });
      const glowSprite = new THREE.Sprite(glowMaterial);
      glowSprite.name = 'glowSprite';
      glowSprite.scale.set(radius * 5 * glowScaleBoost, radius * 5 * glowScaleBoost, 1);
      glowSprite.raycast = () => { };
      group.add(glowSprite);

    } else {
      // ----------------------------------------------------
      // Planet Concept
      // ----------------------------------------------------
      if (node.group === 'center' || baseVal > 25 || node.isGroupNode) {
        const coreMaterial = new THREE.MeshPhongMaterial({
          color: hasAlarm ? '#000000' : coreColor,
          emissive: hasAlarm ? '#000000' : coreColor,
          emissiveIntensity: 1.0 * emissiveBoost,
          transparent: true,
          opacity: 1 * opacityMultiplier,
          shininess: 100,
          depthWrite: false
        });
        let coreRadiusMultiplier = 0.6;
        const coreRadius = radius * coreRadiusMultiplier;
        const coreSphere = new THREE.Mesh(
          new THREE.SphereGeometry(coreRadius, 32, 32),
          coreMaterial
        );
        coreSphere.name = 'coreSphere';
        coreSphere.raycast = customRaycast;
        coreSphere.renderOrder = isDimmed ? 100 : (isActiveNode ? 200 : 150);
        group.add(coreSphere);

        if (node.isGroupNode) {
          const oColor1 = hasAlarm ? SEVERITY_COLORS[node.severity].color : '#fbbf24';
          const oColor2 = hasAlarm ? SEVERITY_COLORS[node.severity].color : '#fde047';
          const oColor3 = hasAlarm ? SEVERITY_COLORS[node.severity].color : '#f97316';
          const orbitSpheres = [
            { r: radius * 0.15, d: radius * 1.1, color: oColor1, speed: 0.0175, startRotX: Math.random() * Math.PI },
            { r: radius * 0.12, d: radius * 1.2, color: oColor2, speed: -0.00625, startRotX: Math.random() * Math.PI },
            { r: radius * 0.08, d: radius * 1.0, color: oColor3, speed: 0.01, startRotX: Math.random() * Math.PI }
          ];

          orbitSpheres.forEach((os, idx) => {
            const orbitSubGroup = new THREE.Group();
            const savedRot = nodeOrbitRotationsRef.current[String(node.id)]?.[idx];
            if (savedRot) {
              orbitSubGroup.rotation.x = savedRot.x;
              orbitSubGroup.rotation.y = savedRot.y;
              orbitSubGroup.rotation.z = savedRot.z;
            } else {
              orbitSubGroup.rotation.x = os.startRotX;
              orbitSubGroup.rotation.z = Math.random() * Math.PI;
            }

            const oMat = new THREE.MeshPhongMaterial({
              color: os.color,
              emissive: os.color,
              emissiveIntensity: 2.5 * opacityMultiplier,
              transparent: true,
              opacity: 1.0 * opacityMultiplier
            });
            const oMesh = new THREE.Mesh(new THREE.SphereGeometry(os.r, 16, 16), oMat);
            oMesh.name = 'orbitMesh';
            oMesh.position.x = os.d;
            oMesh.raycast = customRaycast;
            oMesh.userData = { isDimmed, isActive: isActiveNode };
            const oGlowMat = new THREE.SpriteMaterial({
              map: createGlowTexture(),
              color: os.color,
              transparent: true,
              blending: THREE.AdditiveBlending,
              opacity: 0.9 * opacityMultiplier,
              depthWrite: false
            });
            const oGlowSprite = new THREE.Sprite(oGlowMat);
            oGlowSprite.name = 'orbitGlow';
            oGlowSprite.scale.set(os.r * 5, os.r * 5, 1);
            oGlowSprite.raycast = () => { };
            oMesh.add(oGlowSprite);
            orbitSubGroup.add(oMesh);

            orbitSubGroup.userData = {
              isOrbit: true,
              speed: os.speed,
              nodeId: node.id,
              orbitIndex: idx
            };
            group.add(orbitSubGroup);
          });
        }

        const glowMaterial = new THREE.SpriteMaterial({
          map: createGlowTexture(),
          color: coreColor,
          transparent: true,
          blending: THREE.AdditiveBlending,
          opacity: 1.0 * opacityMultiplier,
          depthWrite: false
        });
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.name = 'glowSprite';
        glowSprite.scale.set(radius * 6 * glowScaleBoost, radius * 6 * glowScaleBoost, 1);
        glowSprite.raycast = () => { };
        group.add(glowSprite);

        const innerGlowSprite = new THREE.Sprite(glowMaterial.clone());
        innerGlowSprite.name = 'innerGlowSprite';
        innerGlowSprite.scale.set(radius * 3 * glowScaleBoost, radius * 3 * glowScaleBoost, 1);
        innerGlowSprite.raycast = () => { };
        group.add(innerGlowSprite);
      } else {
        const coreMaterial = new THREE.MeshPhongMaterial({
          color: hasAlarm ? '#000000' : coreColor,
          emissive: hasAlarm ? '#000000' : coreColor,
          emissiveIntensity: 2.0 * emissiveBoost,
          transparent: true,
          opacity: 1.0 * opacityMultiplier,
          depthWrite: false
        });
        const coreRadius = radius * 0.7;
        const coreSphere = new THREE.Mesh(
          new THREE.SphereGeometry(coreRadius, 16, 16),
          coreMaterial
        );
        coreSphere.name = 'coreSphere';
        coreSphere.raycast = customRaycast;
        coreSphere.renderOrder = isDimmed ? 100 : (isActiveNode ? 200 : 150);
        group.add(coreSphere);

        const glowMaterial = new THREE.SpriteMaterial({
          map: createGlowTexture(),
          color: coreColor,
          transparent: true,
          blending: THREE.AdditiveBlending,
          opacity: 0.8 * opacityMultiplier,
          depthWrite: false
        });
        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.name = 'glowSprite';
        glowSprite.scale.set(radius * 4.5 * glowScaleBoost, radius * 4.5 * glowScaleBoost, 1);
        glowSprite.raycast = () => { };
        group.add(glowSprite);
      }

      const wireframeMaterial = new THREE.MeshBasicMaterial({
        color: wireframeColor,
        map: createWireframeTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: (node.group === 'center' ? 0.3 : 0.4) * opacityMultiplier
      });

      wireframeSphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 32),
        wireframeMaterial
      );
      wireframeSphere.name = 'wireframeSphere';
      wireframeSphere.renderOrder = isDimmed ? 101 : (isActiveNode ? 201 : 151);
      wireframeSphere.raycast = customRaycast;
      group.add(wireframeSphere);
    }

    // Add text label sprite
    let nodeType = 'other';
    if (node.isGroupNode) nodeType = 'group';
    else if (node.isDeviceNode) nodeType = 'device';
    else if (node.isInterfaceNode) nodeType = 'interface';

    // SRC / DST 뱃지 확인 (통합 라벨용)
    let badgeConfig: { text: string; color: string } | undefined;
    const { pathHighlight: currentPathHighlight } = stateRef.current;

    // 1. 경로 탐색 결과에 의한 배지 (우선순위 높음, 단 링크 더블클릭에 의한 격리 상태 제외)
    if (currentPathHighlight && !currentPathHighlight.isLinkIsolation && node.isDeviceNode) {
      const pathDeviceArr = Array.from(currentPathHighlight.deviceIds);
      const isSrc = node.id === pathDeviceArr[0];
      const isDst = node.id === pathDeviceArr[pathDeviceArr.length - 1];
      if (isSrc || isDst) {
        badgeConfig = {
          text: isSrc ? 'SRC' : 'DST',
          color: isSrc ? '#16a34a' : '#a855f7',
        };
      }
    } else {
      // 2. 우클릭 수동 선택에 의한 배지 (선택 중인 상태)
      const isSrcGroup = node.isGroupNode && externalSrcGroup && String(node.deviceGroupId) === String(externalSrcGroup.groupId);
      const isSrcDevice = node.isDeviceNode && externalSrcDevice && String(node.id) === String(externalSrcDevice.deviceId);

      const isDstGroup = node.isGroupNode && externalDstGroup && String(node.deviceGroupId) === String(externalDstGroup.groupId);
      const isDstDevice = node.isDeviceNode && externalDstDevice && String(node.id) === String(externalDstDevice.deviceId);

      if (isSrcGroup || isSrcDevice) {
        badgeConfig = { text: 'SRC', color: '#16a34a' };
      } else if (isDstGroup || isDstDevice) {
        badgeConfig = { text: 'DST', color: '#a855f7' };
      }
    }

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createTextCanvas(node.label, 1, nodeType, badgeConfig), // Always bake at full opacity, control dynamically via material
        depthWrite: false,
        depthTest: false, // Ensure label ignores depth
        color: isHighlight ? '#ffffff' : '#e2e8f0'
      })
    );
    sprite.name = 'labelSprite';
    sprite.renderOrder = 999; // 항상 라인 위에 표출

    const isBackbone = node.group === 'backbone';
    const baseLabelWidth = isBackbone ? 45 : 30;
    const labelHeight = isBackbone ? 22.5 : 15;

    // Adjust width slightly if badge exists to prevent squishing
    const labelWidth = badgeConfig ? baseLabelWidth * 1.45 : baseLabelWidth;

    sprite.scale.set(labelWidth * initialZoomFactor, labelHeight * initialZoomFactor, 1);
    let yOffset = -radius;
    if (iconConcept === 'block') {
      if (node.isGroupNode) yOffset = -radius * 0.2; // 그룹 노드 하단 기준 살짝 띄움
      else if (node.isDeviceNode) yOffset = -radius * 1.2; // 장비 노드 하단 기준 살짝 띄움
      else yOffset = -radius * 1.2;
    }
    sprite.position.y = yOffset - (isBackbone ? 10 : 8) * initialZoomFactor; // 노드 아래로 적절한 간격
    sprite.raycast = () => { }; // Disable raycast for text label

    // 블록 테마에서는 건물이 카메라를 따라 회전하므로, 라벨도 건물에 종속시켜 시각적으로 항상 건물 아래쪽에 위치하게 함
    if (iconConcept === 'block' && wireframeSphere) {
      wireframeSphere.add(sprite);
    } else {
      group.add(sprite);
    }

    // Add an extra glowing pulse effect if this is the selected node
    let pulseSprite: THREE.Sprite | null = null;
    // To animate rotation of the wireframe mesh and apply dynamic alarms pulsing
    group.userData = {
      animate: (camera: THREE.Camera, obj: THREE.Object3D) => {
        const { selectedNode, activeGroupId, activeDeviceId, hoverNode, pathHighlight } = stateRef.current as any;
        const currentIsHighlight = highlightNodes.has(node.id);
        const currentIsDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !currentIsHighlight;
        let currentIsActiveNode = false;
        if (hoverNode) {
          currentIsActiveNode = node.id === hoverNode.id;
        } else if (activeDeviceId !== null) {
          currentIsActiveNode = node.isDeviceNode && node.id === activeDeviceId;
        } else if (activeGroupId !== null) {
          currentIsActiveNode = node.isGroupNode && node.deviceGroupId === activeGroupId;
        } else if (selectedNode) {
          currentIsActiveNode = node.id === selectedNode.id;
        }

        if (currentConcept === 'block' && (node.isGroupNode || node.isDeviceNode)) {
          wireframeSphere.quaternion.copy(camera.quaternion);
          // 3D 뷰어처럼 보이도록 약간의 이소메트릭(등각 투영) 각도 유지
          wireframeSphere.rotateX(0.2);
          wireframeSphere.rotateY(Math.PI / 4);

          if (node.isDeviceNode) {
            // 장비 노드는 혼자 빙글빙글 도는 효과 유지
            const time = Date.now() * 0.001;
            wireframeSphere.rotateY(time * 0.5);
          }
        } else {
          wireframeSphere.rotation.y += 0.006;
          wireframeSphere.rotation.x += 0.003;
        }

        const time = Date.now() * 0.007;
        const pulse = 0.5 + 0.5 * Math.sin(time);

        // 장애 노드는 비활성화 상태여도 너무 어두워지지 않도록(0.4) 처리
        const dimMultiplier = currentIsDimmed ? (hasAlarm ? 0.2 : 0.1) : 1.0;
        const opacityDim = currentIsDimmed ? (hasAlarm ? 0.2 : 0.1) : 1.0;
        const currentOpacityMultiplier = currentIsDimmed ? (hasAlarm ? 0.2 : 0.1) : 1.0;

        // Apply dynamic renderOrder updates
        group.renderOrder = currentIsDimmed ? 10 : (currentIsActiveNode ? 50 : 30);
        wireframeSphere.renderOrder = currentIsDimmed ? 12 : (currentIsActiveNode ? 52 : 32);

        group.traverse((child: any) => {
          if (child.name === 'labelSprite') {
            child.renderOrder = 999; // 항상 라인 위에 표출되도록 고정
            if (child.material) {
              child.material.opacity = currentIsDimmed ? (node.isInterfaceNode ? 0.0 : 0.1) : 1.0;
              child.material.color.set(currentIsHighlight ? '#ffffff' : '#e2e8f0');
              child.material.depthTest = false; // 항상 라인 위로 표시되도록 깊이 테스트 무시
            }
            child.userData = { isDimmed: currentIsDimmed, isActive: currentIsActiveNode };
          } else if (child.name === 'glowSprite' || child.name === 'innerGlowSprite' || child.name === 'orbitGlow') {
            child.renderOrder = currentIsDimmed ? 11 : (currentIsActiveNode ? 51 : 31);
            if (child.material) {
              const baseOpacity = child.name === 'orbitGlow' ? 0.9 : (node.group === 'center' ? 1.0 : 0.8);
              let adjustedOpacity = baseOpacity * currentOpacityMultiplier;
              if (child.name === 'glowSprite' && node.isGroupNode && currentIsActiveNode) {
                adjustedOpacity = 0.4 * currentOpacityMultiplier; // 선택된 그룹 노드의 빛은 더 은은하게 (Softer)
              } else if (child.name === 'innerGlowSprite') {
                // 이너 글로우: 선택된 그룹 노드일 때만 매쉬 근처에서 강하게 빛남
                adjustedOpacity = (node.isGroupNode && currentIsActiveNode) ? 0.9 * currentOpacityMultiplier : 0.0;
              }
              // 기본 투명도 설정 (장애 시 아래 hasAlarm 블록에서 덮어씀)
              child.material.opacity = adjustedOpacity;
              child.material.depthTest = !currentIsActiveNode;
            }
            if (child.name === 'glowSprite') {
              const isLargeCore = node.group === 'center' || baseVal > 25 || node.isGroupNode;
              const baseGlowScale = radius * (isLargeCore ? 6 : 4.5);
              const isGroupNodeActive = currentIsActiveNode && node.isGroupNode;
              // 선택된 그룹 노드의 빛은 훨씬 더 넓게 퍼지도록 Scale 부스트 (Wider)
              const currentGlowScaleBoost = isGroupNodeActive ? 4.5 : (currentIsActiveNode ? 1.3 : 1.0);
              const targetScale = baseGlowScale * currentGlowScaleBoost;
              child.scale.set(targetScale, targetScale, 1);
            } else if (child.name === 'innerGlowSprite') {
              const isLargeCore = node.group === 'center' || baseVal > 25 || node.isGroupNode;
              const baseGlowScale = radius * (isLargeCore ? 2.5 : 2.0); // 매쉬에 딱 붙는 작은 크기
              const isGroupNodeActive = currentIsActiveNode && node.isGroupNode;
              const currentGlowScaleBoost = isGroupNodeActive ? 1.5 : 1.0;
              const targetScale = baseGlowScale * currentGlowScaleBoost;
              child.scale.set(targetScale, targetScale, 1);
            }
          } else if (child.name === 'coreSphere') {
            child.renderOrder = currentIsDimmed ? 12 : (currentIsActiveNode ? 52 : 32);
            child.userData = { isDimmed: currentIsDimmed, isActive: currentIsActiveNode };
            if (child.material) child.material.depthTest = !currentIsActiveNode;
          } else if (child.isMesh || child.isSprite || child.isLine) {
            child.renderOrder = currentIsDimmed ? 13 : (currentIsActiveNode ? 53 : 33);
            child.userData = { isDimmed: currentIsDimmed, isActive: currentIsActiveNode };
            if (child.material) child.material.depthTest = !currentIsActiveNode;
          }
        });
        wireframeSphere.renderOrder = currentIsDimmed ? 14 : (currentIsActiveNode ? 54 : 34);
        wireframeSphere.userData = { isDimmed: currentIsDimmed, isActive: currentIsActiveNode };
        if (wireframeSphere.material) wireframeSphere.material.depthTest = !currentIsActiveNode;

        // Apply physical mesh glowing pulse and opacity
        if (hasAlarm) {
          group.traverse((child: any) => {
            if (child.isMesh && child.material) {
              if (child.material.emissive) {
                child.material.emissiveIntensity = (currentIsActiveNode ? 2.5 : 1.0) * (0.3 + pulse * 0.7) * 2.0 * dimMultiplier;
              }
              if (child.material.opacity !== undefined) {
                if (child === wireframeSphere || child.name === 'buildingMesh') {
                  // 유릿결 느낌을 살리기 위해 다시 투명도 조절
                  child.material.opacity = (node.group === 'center' ? 0.85 : 0.9) * (0.3 + pulse * 0.7) * opacityDim;
                } else if (child.name === 'buildingLine' || child.name === 'buildingLineGlow' || child.name === 'buildingBodyGlow') {
                  // 빌딩 라인과 글로우도 펄스에 맞춰 깜빡임 적용
                  let baseOp = 0.15;
                  if (child.name === 'buildingLineGlow') baseOp = child.scale.x > 1.04 ? 0.2 : 0.5;
                  else if (child.name === 'buildingBodyGlow') baseOp = 0.2;
                  child.material.opacity = baseOp * (0.3 + pulse * 0.7) * opacityDim;
                } else if (child.name === 'coreSphere') {
                  // 검은색 중심부 투명도 70% ~ 100%
                  child.material.opacity = (0.7 + pulse * 0.3) * opacityDim;
                } else if (child.name === 'orbitMesh') {
                  child.material.opacity = 1.0 * opacityDim;
                }
              }
            } else if ((child.isSprite || child.name === 'glowSprite' || child.name === 'orbitGlow') && child.name !== 'labelSprite' && child.name !== 'pathBadge') {
              // 글로우(빛나는 부분) 투명도 30% ~ 100%
              if (child.material && child.material.opacity !== undefined) {
                const baseOpacity = child.name === 'orbitGlow' ? 0.9 : (node.group === 'center' ? 1.0 : 0.8);
                child.material.opacity = baseOpacity * (0.3 + pulse * 0.7) * opacityDim;
              }
            }
          });
        } else {
          group.traverse((child: any) => {
            if (child.isMesh && child.material) {
              if (child.material.emissive) {
                child.material.emissiveIntensity = (currentIsActiveNode ? 2.5 : 1.0) * dimMultiplier;
              }
              if (child.material.opacity !== undefined) {
                if (child === wireframeSphere || child.name === 'buildingMesh') {
                  child.material.opacity = 0.8 * currentOpacityMultiplier;
                } else if (child.name === 'buildingLine' || child.name === 'buildingLineGlow' || child.name === 'buildingBodyGlow') {
                  let baseOp = 0.05;
                  if (child.name === 'buildingLineGlow') baseOp = child.scale.x > 1.04 ? 0.05 : 0.15;
                  else if (child.name === 'buildingBodyGlow') baseOp = 0.1;
                  child.material.opacity = baseOp * currentOpacityMultiplier;
                } else if (child.name === 'coreSphere') {
                  child.material.opacity = 1.0 * currentOpacityMultiplier;
                } else if (child.name === 'orbitMesh') {
                  child.material.opacity = 1.0 * currentOpacityMultiplier;
                }
              }
            }
          });
        }

        if (camera) {
          // Maintain absolute constant size on the screen regardless of camera zoom (constant screen-space size)
          let targetPos = obj.position;
          if (targetPos.x === 0 && targetPos.y === 0 && targetPos.z === 0) {
            targetPos = resolvedPos;
          }
          const distance = camera.position.distanceTo(targetPos);
          const zoomFactor = distance / 450; // 450 is the reference distance for standard font size

          sprite.scale.set(labelWidth * zoomFactor, labelHeight * zoomFactor, 1);

          // Scale the Y offset proportionally so it always stays at a perfect apparent gap below the node
          sprite.position.y = yOffset - (isBackbone ? 10 : 8) * zoomFactor;
        }
      }
    };

    // (이전에 완전 숨김 처리하던 로직 제거 -> isDimmed 효과로 희미하게 표출됨)

    return group;
  }, [highlightNodes, selectedNode, activeGroupId, activeDeviceId, externalSrcGroup, externalSrcDevice, externalDstGroup, externalDstDevice, iconConcept]);

  const getLinkWidth = useCallback((link: any) => {
    if (link.isRingLink) return 0;

    // Make ring topology edges slightly thicker when highlighted, subtle otherwise!
    if (link.isRingTopologyLink) {
      if (((l) => {
        if (!l) return false;
        const ts = typeof l.source === 'object' ? l.source.id : l.source;
        const tt = typeof l.target === 'object' ? l.target.id : l.target;
        return highlightLinkIds.current.has(ts + '-' + tt);
      })(link)) return 0.65;
      return 0.65; // 평상시 항상 얇게 고정하여 노드 장애 연동 두께 효과 제거
    }

    const isSourceGroup = typeof link.source === 'object' ? link.source.isGroupNode : String(link.source).startsWith('group-');
    const isTargetGroup = typeof link.target === 'object' ? link.target.isGroupNode : String(link.target).startsWith('group-');

    if (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode) {
      if (((l) => {
        if (!l) return false;
        const ts = typeof l.source === 'object' ? l.source.id : l.source;
        const tt = typeof l.target === 'object' ? l.target.id : l.target;
        return highlightLinkIds.current.has(ts + '-' + tt);
      })(link)) {
        return (isSourceGroup && isTargetGroup) ? 0.3 : 0.3;
      }
      return 0.2;
    }

    if (isSourceGroup && isTargetGroup) return 0.3;
    if (link.isHierarchyLink) return 0.25; // 계층 보조선 두께
    return 0.15;
  }, [highlightLinks, selectedNode, activeGroupId, activeDeviceId, hoverNode, visibleData.nodes]);

  const getLinkColor = useCallback((link: any) => {
    if (link.isRingLink) return 'rgba(0,0,0,0)';

    const isSourceGroup = typeof link.source === 'object' ? link.source.isGroupNode : String(link.source).startsWith('group-');
    const isTargetGroup = typeof link.target === 'object' ? link.target.isGroupNode : String(link.target).startsWith('group-');
    const isGroupToGroup = isSourceGroup && isTargetGroup;

    // 점선 처리되는 링크들은 기본 라인을 투명하게 처리하고 linkThreeObject에서 직접 그림
    const isDashed = !(link.isHierarchyLink || link.isRingLink || link.isRingTopologyLink || isGroupToGroup);
    if (isDashed) return 'rgba(0,0,0,0)';

    // 1. Ring topology link styling (fixed to neutral color, not affected by node alarms)
    if (link.isRingTopologyLink) {
      const isHighlight = ((l) => {
        if (!l) return false;
        const ts = typeof l.source === 'object' ? l.source.id : l.source;
        const tt = typeof l.target === 'object' ? l.target.id : l.target;
        return highlightLinkIds.current.has(ts + '-' + tt);
      })(link);
      if (isHighlight) return 'rgba(226, 232, 240, 0.8)'; // elegant soft silver highlight
      const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
      return isDimmed ? 'rgba(100, 116, 139, 0.05)' : 'rgba(100, 116, 139, 0.35)'; // neutral gray
    }

    const isHighlight = ((l) => {
      if (!l) return false;
      const ts = typeof l.source === 'object' ? l.source.id : l.source;
      const tt = typeof l.target === 'object' ? l.target.id : l.target;
      return highlightLinkIds.current.has(ts + '-' + tt);
    })(link);
    const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
    const hasAlarm = link.severity && link.severity !== 'normal' && !isDimmed;

    if (hasAlarm) {
      const baseColor = SEVERITY_COLORS[link.severity].color;
      const time = Date.now() * 0.007;
      const pulse = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(time));

      // 비활성화 상태여도 장애 선은 너무 투명해지지 않고(0.4배수 적용) 깜빡임 유지
      if (isDimmed) {
        return hexToRgba(baseColor, String(pulse * 0.4));
      }
      return hexToRgba(baseColor, String(pulse));
    }

    if (link.isHierarchyLink) {
      if (isHighlight) return 'rgba(255, 255, 255, 0.8)';
      if (isDimmed) return 'rgba(255, 255, 255, 0.1)';
      return 'rgba(255, 255, 255, 0.8)'; // 계층 보조선
    }

    if (isGroupToGroup) {
      if (isHighlight) return 'rgba(253, 224, 71, 0.8)'; // bright yellow
      if (isDimmed) return 'rgba(253, 224, 71, 0.1)';
      return 'rgba(253, 224, 71, 0.3)'; // normal yellow
    }

    if (isHighlight) return 'rgba(255, 255, 255, 0.85)'; // elegant silver-gray highlight instead of neon blue
    if (isDimmed) return 'rgba(148, 163, 184, 0.8)';

    return 'rgba(148, 163, 184, 0.5)';
  }, [highlightLinks, selectedNode, activeGroupId, activeDeviceId, hoverNode, visibleData.nodes]);

  const getLinkLabel = useCallback((link: any, isClicked: boolean = false) => {
    if (link.isRingLink || link.isRingTopologyLink) return '';
    // 계층 보조선(부모-자식 연결선)에는 트래픽 툴팁을 표시하지 않음
    if (link.isHierarchyLink || link.isGroupToDevice || link.isDeviceToInterface) return '';
    const sourceName = typeof link.source === 'object' ? link.source.label.replace(/\n/g, ' ') : link.source;
    const targetName = typeof link.target === 'object' ? link.target.label.replace(/\n/g, ' ') : link.target;
    const srcIntf = link.srcInterfaceName || '';
    const dstIntf = link.dstInterfaceName || '';
    const totalBW = link.totalBandWidth || 0;
    const useBW = link.useBandWidth ?? link.traffic ?? 0;
    const availBW = link.availBandWidth ?? (totalBW - useBW);
    const usage = totalBW > 0 ? (useBW / totalBW) * 100 : 0;
    const formatBW = (val: number) => {
      if (val >= 1000000) return `${(val / 1000000).toFixed(1)} Tbps`;
      if (val >= 1000) return `${(val / 1000).toFixed(1)} Gbps`;
      return `${val.toLocaleString()} Mbps`;
    };
    const usageColor = usage >= 90 ? '#ef4444' : usage >= 70 ? '#f97316' : usage >= 50 ? '#eab308' : '#10b981';

    const isHighlight = ((l) => {
      if (!l) return false;
      const ts = typeof l.source === 'object' ? l.source.id : l.source;
      const tt = typeof l.target === 'object' ? l.target.id : l.target;
      return highlightLinkIds.current.has(ts + '-' + tt);
    })(link);
    const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
    const hasAlarm = link.severity && link.severity !== 'normal' && !isDimmed;
    const linkKey = typeof link.source === 'object'
      ? [link.source.id, link.target.id].sort().join('--')
      : [link.source, link.target].sort().join('--');

    const severityLabel: Record<string, string> = {
      critical: 'CRITICAL (단선/장애)',
      major: 'MAJOR (대역폭 포화)',
      minor: 'MINOR (경고/에러)',
      warning: 'WARNING (주의/지연)'
    };

    // Find original interface nodes that caused the alarm on this link
    let drillDownButtonsHtml = '';
    if (hasAlarm) {
      const matchingAlarmKey = Object.keys(mockLinkAlarms).find(alarmKey => {
        const [aPort1, aPort2] = alarmKey.split('--');

        // Find which visible/collapsed ID these alarm ports map to in the current visibleData
        const getMappedId = (portId) => {
          const node = data.nodes.find(n => n.id === portId);
          if (!node) return portId;
          const gid = node.deviceGroupId;
          const devId = node.parentDeviceId;

          if (gid && !expandedGroups.has(gid)) {
            return `group-${gid}`;
          } else if (devId && !expandedDevices.has(devId)) {
            return devId;
          }
          return portId;
        };

        const mapped1 = getMappedId(aPort1);
        const mapped2 = getMappedId(aPort2);

        const sId = typeof link.source === 'object' ? link.source.id : link.source;
        const tId = typeof link.target === 'object' ? link.target.id : link.target;

        return (mapped1 === sId && mapped2 === tId) || (mapped1 === tId && mapped2 === sId);
      });

      if (matchingAlarmKey) {
        const [port1Id, port2Id] = matchingAlarmKey.split('--');
        const port1 = data.nodes.find(n => n.id === port1Id);
        const port2 = data.nodes.find(n => n.id === port2Id);

        if (port1 && port2) {
          const p1Label = port1.label.split('\n')[1] || port1.interfaceName || '포트 1';
          const p2Label = port2.label.split('\n')[1] || port2.interfaceName || '포트 2';
          const p1Dev = data.nodes.find(n => n.id === port1.parentDeviceId)?.label.replace('\n', ' ') || '장비 1';
          const p2Dev = data.nodes.find(n => n.id === port2.parentDeviceId)?.label.replace('\n', ' ') || '장비 2';

          drillDownButtonsHtml = `
            <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <div style="font-size: 9px; color: #a3a3a3; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">장애 물리 포트로 바로 가기:</div>
              <button onclick="window.focusNodeById('${port1Id}')" style="cursor:pointer; background: #0891b2; border: none; color: white; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; text-align: left; box-shadow: 0 4px 10px rgba(8, 145, 178, 0.25); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;">
                <span>[송신] ${p1Dev} ➔ ${p1Label}</span> <span>➔</span>
              </button>
              <button onclick="window.focusNodeById('${port2Id}')" style="cursor:pointer; background: #0891b2; border: none; color: white; border-radius: 4px; padding: 6px 10px; font-size: 10.5px; font-weight: bold; text-align: left; box-shadow: 0 4px 10px rgba(8, 145, 178, 0.25); display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;">
                <span>[수신] ${p2Dev} ➔ ${p2Label}</span> <span>➔</span>
              </button>
            </div>
          `;
        }
      }
    }

    // Determine representative alarm cause description
    let alarmDescription = '하위 장애 전파 검출 및 라인 다운 경보';
    if (hasAlarm) {
      if (mockLinkAlarms[linkKey]) {
        alarmDescription = ALARM_CAUSES[linkKey] || alarmDescription;
      } else {
        // Collapsed aggregate link, look for individual sub-link alarms inside it
        const childAlarmKey = Object.keys(mockLinkAlarms).find(alarmKey => {
          const [aPort1, aPort2] = alarmKey.split('--');
          const getMappedId = (portId) => {
            const node = data.nodes.find(n => n.id === portId);
            if (!node) return portId;
            const gid = node.deviceGroupId;
            const devId = node.parentDeviceId;
            if (gid && !expandedGroups.has(gid)) return `group-${gid}`;
            if (devId && !expandedDevices.has(devId)) return devId;
            return portId;
          };
          const mapped1 = getMappedId(aPort1);
          const mapped2 = getMappedId(aPort2);
          const sId = typeof link.source === 'object' ? link.source.id : link.source;
          const tId = typeof link.target === 'object' ? link.target.id : link.target;
          return (mapped1 === sId && mapped2 === tId) || (mapped1 === tId && mapped2 === sId);
        });
        if (childAlarmKey) {
          alarmDescription = ALARM_CAUSES[childAlarmKey] || alarmDescription;
        }
      }
    }

    const linksToRender = link.aggregatedLinks && link.aggregatedLinks.length > 0 ? link.aggregatedLinks : [link];

    return `
      <div style="position: relative; background: rgba(15, 18, 25, 0.92); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-radius: 10px; padding: 12px 14px; font-family: 'Inter', sans-serif; width: max-content; min-width: 400px; color: #cbd5e1; max-height: 400px; overflow-y: auto; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px ${hasAlarm ? SEVERITY_COLORS[link.severity].color : 'rgba(255, 255, 255, 0.06)'}; pointer-events: ${isClicked ? 'auto' : 'none'};">
        ${isClicked ? `<button onclick="window.closeClickedLink(event)" style="position: absolute; top: 8px; right: 8px; background: transparent; border: none; color: #a3a3a3; cursor: pointer; font-size: 16px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; padding: 0; line-height: 1;">&times;</button>` : ''}
        <div style="font-size: 9px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
          ${hasAlarm ? 'ALARMED LINE' : 'NETWORK LINK'}
        </div>

        ${hasAlarm ? `
          <div style="background: ${hexToRgba(SEVERITY_COLORS[link.severity].color, '0.12')}; border-left: 2px solid ${SEVERITY_COLORS[link.severity].color}; padding: 4px 6px; border-radius: 3px; margin-bottom: 10px; text-align: left;">
            <div style="font-size: 8px; font-weight: bold; color: ${SEVERITY_COLORS[link.severity].color}; text-transform: uppercase;">
              ${severityLabel[link.severity]}
            </div>
            <div style="font-size: 10px; color: #e2e8f0; margin-top: 2px; font-weight: 500; line-height: 1.2;">
              ${alarmDescription}
            </div>
          </div>
        ` : ''}

        <div style="display: flex; flex-direction: column; gap: 0;">
          ${linksToRender.map((l, index) => {
      const sName = l.srcDeviceName || l.source?.label || l.source || sourceName;
      const tName = l.dstDeviceName || l.target?.label || l.target || targetName;
      const sIntf = l.srcInterfaceName || srcIntf;
      const tIntf = l.dstInterfaceName || dstIntf;
      const lTotalBW = l.totalBandWidth || totalBW;
      const lUseBW = l.useBandWidth ?? l.traffic ?? useBW;
      const lAvailBW = l.availBandWidth ?? (lTotalBW - lUseBW);
      const lUsage = lTotalBW > 0 ? (lUseBW / lTotalBW) * 100 : usage;
      const lUsageColor = lUsage >= 90 ? '#ef4444' : lUsage >= 70 ? '#f97316' : lUsage >= 50 ? '#eab308' : '#10b981';

      return `
              <div style="${index > 0 ? 'padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 8px;' : ''}">
                <!-- Line 1: Ports -->
                <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #f8fafc; margin-bottom: 4px;">
                  <span style="color: #60a5fa;" title="${sName}">${sName.split('\n')[1] || sName}</span>
                  <span style="color: #94a3b8; font-size: 10px;">${sIntf}</span>
                  <span style="color: #4ade80; font-size: 12px;">↔</span>
                  <span style="color: #60a5fa;" title="${tName}">${tName.split('\n')[1] || tName}</span>
                  <span style="color: #94a3b8; font-size: 10px;">${tIntf}</span>
                </div>
                
                <!-- Line 2: Bandwidth & Usage -->
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #94a3b8; white-space: nowrap;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span>총 대역폭 <span style="color: #f8fafc; font-weight: 600;">${formatBW(lTotalBW)}</span></span>
                    <span>/</span>
                    <span>사용대역폭 <span style="color: ${lUsageColor}; font-weight: 600;">${formatBW(lUseBW)}</span></span>
                    <span>/</span>
                    <span>가용대역폭 <span style="color: #4ade80; font-weight: 600;">${formatBW(lAvailBW)}</span></span>
                  </div>
                  
                  <div style="display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-shrink: 0;">
                    <span style="color: #64748b;">사용률</span>
                    <div style="width: 50px; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;">
                      <div style="height: 100%; width: ${Math.min(100, lUsage)}%; background: linear-gradient(90deg, ${lUsageColor}88, ${lUsageColor}); border-radius: 2px;"></div>
                    </div>
                    <span style="color: ${lUsageColor}; font-weight: 700; min-width: 36px; text-align: right; display: inline-block;">${lUsage.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            `;
    }).join('')}
        </div>
        
      </div>
    `;
  }, [data.nodes, expandedGroups, expandedDevices]);

  const getLinkThreeObject = useCallback((link: any) => {
    const group = new THREE.Group();

    const isSourceGroup = typeof link.source === 'object' ? link.source.isGroupNode : String(link.source).startsWith('group-');
    const isTargetGroup = typeof link.target === 'object' ? link.target.isGroupNode : String(link.target).startsWith('group-');
    const isGroupToGroup = isSourceGroup && isTargetGroup;

    const isDashed = !(link.isHierarchyLink || link.isRingLink || link.isRingTopologyLink || isGroupToGroup);

    // 두꺼운 오버레이 매테리얼 설정
    let overlayMat;
    if (isDashed) {
      overlayMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#ffffff') },
          uOpacity: { value: 0.0 },
          uDashScale: { value: 6.0 },
          uDistance: { value: 100.0 },
          uOffset: { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uDashScale;
          uniform float uDistance;
          uniform float uOffset;
          varying vec2 vUv;
          void main() {
            float repeat = uDistance / uDashScale;
            float pos = vUv.y * repeat + uOffset;
            if (fract(pos) > 0.5) {
              discard;
            }
            gl_FragColor = vec4(uColor, uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false
      });
    } else {
      overlayMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    }

    if (!(link.isRingLink || link.isRingTopologyLink)) {
      const hitGeom = new THREE.CylinderGeometry(1.5, 1.5, 1, 4); // radius 1.5, length 1
      hitGeom.rotateX(Math.PI / 2); // Z-axis aligned
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hitMesh = new THREE.Mesh(hitGeom, hitMat);
      hitMesh.name = "hitMesh";
      hitMesh.raycast = customRaycast;
      group.add(hitMesh);

      // 기본 크기를 1로 설정하고, 애니메이션 틱마다 scale로 두께를 동적 조절하도록 변경
      const overlayGeom = new THREE.CylinderGeometry(1, 1, 1, 6);
      overlayGeom.rotateX(Math.PI / 2);
      const overlayMesh = new THREE.Mesh(overlayGeom, overlayMat);
      overlayMesh.name = "activeOverlay";
      overlayMesh.renderOrder = 40; // 비활성화 노드(10~15)나 일반 노드(30~35)보다 위에, 활성화 노드(50~55)보다는 아래에 렌더링
      overlayMesh.raycast = () => { }; // 오직 hitMesh만 레이캐스트를 받도록 무시
      group.add(overlayMesh);
    }

    if (isDashed) {
      const material = new THREE.LineDashedMaterial({
        color: 0x94a3b8,
        dashSize: 1,
        gapSize: 1,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 1)
      ]);
      const dashedLine = new THREE.Line(geometry, material);
      dashedLine.name = "dashedLine";
      dashedLine.raycast = () => { }; // 오직 hitMesh만 레이캐스트를 받도록 무시
      dashedLine.computeLineDistances(); // 반드시 첫 렌더링 전에 호출해야 WebGL에서 점선으로 인식합니다!
      group.add(dashedLine);
    }

    // 경로 탐색 시에만 보여주는 트래픽 라벨 (인터페이스 간 링크인 경우에만 렌더링)
    if (isDashed && link.traffic !== undefined) {
      const texture = createTrafficCanvas(link.traffic);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0, // 기본적으로 숨김 (animate에서 제어)
        depthWrite: false,
        depthTest: false // 테두리 없고 항상 라인 위에 보이도록
      });
      const labelSprite = new THREE.Sprite(spriteMaterial);
      labelSprite.name = "trafficLabel";
      labelSprite.renderOrder = 999;
      labelSprite.scale.set(40, 10, 1); // 5배에서 절반으로 감소 (80 -> 40)
      labelSprite.raycast = () => { }; // 보이지 않는 거대한 라벨이 호버를 가로채는 현상 완벽 방지
      group.add(labelSprite);
    }

    group.userData = {
      animate: (camera: THREE.Camera, obj: THREE.Object3D) => {
        const { activeGroupId, activeDeviceId, hoverNode, pathHighlight, hoverLink } = stateRef.current;
        const isHighlight = ((l) => {
          if (!l) return false;
          const ts = typeof l.source === 'object' ? l.source.id : l.source;
          const tt = typeof l.target === 'object' ? l.target.id : l.target;
          return highlightLinkIds.current.has(ts + '-' + tt);
        })(link);
        const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
        const hasAlarm = link.severity && link.severity !== 'normal' && !isDimmed;
        const isHovered = link === hoverLink;

        const hitMesh = obj.getObjectByName("hitMesh") as THREE.Mesh;
        if (hitMesh) {
          hitMesh.userData = { isDimmed, isActive: isHighlight };
        }

        let baseColorHex = '#94a3b8';
        let baseOpacity = 0.5;

        if (hasAlarm) {
          baseColorHex = SEVERITY_COLORS[link.severity].color;
          if (isDimmed) baseOpacity = 0.3;
          else {
            const time = Date.now() * 0.007;
            baseOpacity = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(time));
          }
        } else {
          if (isHovered) {
            baseColorHex = '#4ade80';
            baseOpacity = 1.0;
          } else if (isHighlight) {
            baseColorHex = '#e2e8f0';
            baseOpacity = 0.85;
          } else if (isDimmed) {
            baseColorHex = '#475569';
            baseOpacity = 0.0;
          }
        }

        let showOverlay = false;
        let overlayColor = '#ffffff';
        let overlayOpacity = 1.0;
        let overlayThickness = 0.2; // 기본 두께

        if (hasAlarm) {
          showOverlay = true;
          overlayColor = SEVERITY_COLORS[link.severity].color;
          overlayThickness = isHovered ? 1.0 : (isGroupToGroup ? 0.5 : 0.4); // 장애+호버면 크게 두꺼워짐!
          overlayOpacity = baseOpacity;
        } else if (isHovered) {
          showOverlay = true;
          overlayColor = baseColorHex;
          overlayOpacity = 1.0;
          overlayThickness = 0.8;
        } else if (isHighlight) {
          showOverlay = true;
          overlayColor = isGroupToGroup ? '#fde047' : '#ffffff';
          overlayOpacity = 0.85;
          overlayThickness = isGroupToGroup ? 0.35 : 0.25;
        }

        const dl = obj.getObjectByName("dashedLine") as THREE.Line;
        if (dl && dl.material) {
          dl.userData = { isDimmed, isActive: isHighlight };
          const material = dl.material as THREE.LineDashedMaterial;

          let dashSize = 1;
          let gapSize = 1;
          let dlOpacity = baseOpacity;

          if (isHovered) {
            dashSize = 3; // 호버 시 내부 얇은 점선 간격도 증가
            gapSize = 3;
          }

          // 오버레이(두꺼운 점선)가 나타날 때는 얇은 선을 완전히 숨겨서 감싸는 튜브처럼 보이지 않게 함
          if (showOverlay && isDashed) {
            dlOpacity = 0;
          }

          (dl.material as THREE.LineDashedMaterial).color.set(baseColorHex);
          (dl.material as THREE.LineDashedMaterial).opacity = dlOpacity;
          dl.visible = dlOpacity > 0;
          (dl.material as THREE.LineDashedMaterial).dashSize = dashSize;
          (dl.material as THREE.LineDashedMaterial).gapSize = gapSize;
        }

        const overlayMesh = obj.getObjectByName("activeOverlay") as THREE.Mesh;
        if (overlayMesh && overlayMesh.material) {
          overlayMesh.userData = { isDimmed, isActive: isHighlight };
          const mat = overlayMesh.material as any;

          if (showOverlay) {
            overlayMesh.userData.thickness = overlayThickness;

            if (mat.isShaderMaterial) {
              mat.uniforms.uOpacity.value = overlayOpacity;
              mat.uniforms.uColor.value.set(overlayColor);
              const distance = overlayMesh.scale.z || 100;
              // 점선 간격 키우기: Hover 상태면 간격을 크게 (숫자가 작을수록 텍스처 반복이 적어져 간격이 커짐)
              const dashScale = isHovered ? 12.0 : 6.0;
              mat.uniforms.uDistance.value = distance;
              mat.uniforms.uDashScale.value = dashScale;
              mat.uniforms.uOffset.value = 0.0;
            } else {
              mat.opacity = overlayOpacity;
              mat.color.set(overlayColor);
            }
          } else {
            if (mat.isShaderMaterial) {
              mat.uniforms.uOpacity.value = 0;
            } else {
              mat.opacity = 0;
            }
            overlayMesh.userData.thickness = 0.01;
          }
        }

        // 트래픽 라벨 가시성 및 스케일 업데이트
        const labelSprite = obj.getObjectByName("trafficLabel") as THREE.Sprite;
        if (labelSprite && labelSprite.material) {
          const mat = labelSprite.material as THREE.SpriteMaterial;
          const showLabel = !!pathHighlight && isHighlight;
          if (showLabel) {
            mat.opacity = 0.9;
            if (camera) {
              const distance = camera.position.distanceTo(obj.position);
              const zoomFactor = distance / 450;
              // 노드 이름 크기의 2.5배 비율(40x10)로 스케일 적용
              labelSprite.scale.set(40 * zoomFactor, 10 * zoomFactor, 1);
            }
          } else {
            mat.opacity = 0;
          }
        }
      }
    };

    return group;
  }, [highlightLinks, selectedNode]);

  const onLinkPositionUpdate = useCallback((sprite: THREE.Object3D, { start, end }: any) => {
    const hitMesh = sprite.getObjectByName("hitMesh");
    const overlayMesh = sprite.getObjectByName("activeOverlay");

    if (hitMesh || overlayMesh) {
      const middlePos = {
        x: start.x + (end.x - start.x) / 2,
        y: start.y + (end.y - start.y) / 2,
        z: start.z + (end.z - start.z) / 2
      };

      const dir = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
      const distance = dir.length();
      dir.normalize();

      if (hitMesh) {
        Object.assign(hitMesh.position, middlePos);
        if (distance > 0) {
          hitMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          hitMesh.scale.set(1, 1, distance);
        }
      }

      if (overlayMesh) {
        Object.assign(overlayMesh.position, middlePos);
        if (distance > 0) {
          overlayMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          const thickness = overlayMesh.userData.thickness || 0.3; // userData에서 동적 두께 적용
          overlayMesh.scale.set(thickness, thickness, distance);
        }
      }
    }

    const dashedLine = sprite.getObjectByName("dashedLine") as THREE.Line;
    if (dashedLine) {
      dashedLine.geometry.setFromPoints([
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(end.x, end.y, end.z)
      ]);
      dashedLine.geometry.computeBoundingSphere(); // 필수: bounding sphere를 업데이트하지 않으면 카메라 각도에 따라 Three.js가 선을 컬링(culling)하여 안 보이게 만듭니다!
      dashedLine.computeLineDistances();
    }

    const trafficLabel = sprite.getObjectByName("trafficLabel");
    if (trafficLabel) {
      const middlePos = {
        x: start.x + (end.x - start.x) / 2,
        y: start.y + (end.y - start.y) / 2 + 5, // 라인보다 위로 띄움
        z: start.z + (end.z - start.z) / 2
      };
      Object.assign(trafficLabel.position, middlePos);
    }

    return false;
  }, []);

  const onNodeHover = useCallback((node: GraphNode | null) => {
    if (Date.now() < ignoreHoverUntilRef.current) return;
    if (clickedNode || clickedLink) return; // 팝오버가 고정되어 있을 때는 새로운 호버를 무시합니다.
    let isDimmed = false;
    if (node) {
      const { selectedNode, activeGroupId, activeDeviceId, pathHighlight } = stateRef.current;
      const isHighlight = highlightNodes.has(node.id);
      isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
    }

    if (isDimmed) {
      setHoverNode(null);
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      return;
    }

    setHoverNode(node);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'default';
    }
  }, [highlightNodes]);

  const onLinkHover = useCallback((link: GraphLink | null) => {
    if (Date.now() < ignoreHoverUntilRef.current) return;
    if (clickedNode || clickedLink) return; // 팝오버가 고정되어 있을 때는 새로운 호버를 무시합니다.
    // 2,3뎁스 계층 보조선(그룹-장비, 장비-포트)은 호버 이벤트를 무시하여 포인터 커서나 색상 변화가 없도록 합니다.
    if (link && ((link as any).isGroupToDevice || (link as any).isDeviceToInterface || (link as any).isHierarchyLink)) {
      setHoverLink(null);
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      return;
    }
    let isDimmed = false;
    if (link) {
      const { selectedNode, activeGroupId, activeDeviceId, pathHighlight } = stateRef.current;
      const isHighlight = ((l) => {
        if (!l) return false;
        const ts = typeof l.source === 'object' ? l.source.id : l.source;
        const tt = typeof l.target === 'object' ? l.target.id : l.target;
        return highlightLinkIds.current.has(ts + '-' + tt);
      })(link);
      isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;
    }

    if (isDimmed) {
      setHoverLink(null);
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      return;
    }

    setHoverLink(link);
    if (containerRef.current) {
      containerRef.current.style.cursor = link ? 'pointer' : 'default';
    }
  }, [highlightLinks, clickedNode, clickedLink]);

  const handleLinkDoubleClick = useCallback((link: GraphLink) => {
    if ((link as any).isRingLink || (link as any).isRingTopologyLink) return;
    if ((link as any).isHierarchyLink || (link as any).isDeviceToInterface) return;

    setClickedLink(null);
    setTooltipPos(null);
    setHoverLink(null);
    const sourceNodeId = String(typeof link.source === 'object' ? link.source.id : link.source);
    const targetNodeId = String(typeof link.target === 'object' ? link.target.id : link.target);
    const startNode = visibleData.nodes.find((n: any) => String(n.id) === sourceNodeId) || data.nodes.find((n: any) => String(n.id) === sourceNodeId);
    const endNode = visibleData.nodes.find((n: any) => String(n.id) === targetNodeId) || data.nodes.find((n: any) => String(n.id) === targetNodeId);

    const isSourceGroup = sourceNodeId.startsWith('group-');
    const isTargetGroup = targetNodeId.startsWith('group-');
    const isGroupToGroup = isSourceGroup && isTargetGroup;
    const isGroupToDevice = (isSourceGroup && !isTargetGroup) || (!isSourceGroup && isTargetGroup);

    let hasForwardDeployGroup = false;
    if (isSourceGroup) {
      const gid = sourceNodeId.replace('group-', '');
      if (groupsMetadata[parseInt(gid, 10)] && groupsMetadata[parseInt(gid, 10)].includes('전진배치')) hasForwardDeployGroup = true;
    }
    if (isTargetGroup) {
      const gid = targetNodeId.replace('group-', '');
      if (groupsMetadata[parseInt(gid, 10)] && groupsMetadata[parseInt(gid, 10)].includes('전진배치')) hasForwardDeployGroup = true;
    }

    const deviceIdsToHighlight = new Set<string>();
    const linkPairsToHighlight = new Set<string>();
    const directedLinksToHighlight = new Set<string>();
    const groupsToExpand = new Set<number>();

    const useGroupHighlightLogic = isGroupToGroup || (isGroupToDevice && !hasForwardDeployGroup);

    if (useGroupHighlightLogic) {
      deviceIdsToHighlight.add(sourceNodeId);
      deviceIdsToHighlight.add(targetNodeId);
      linkPairsToHighlight.add(`${sourceNodeId}-${targetNodeId}`);
      linkPairsToHighlight.add(`${targetNodeId}-${sourceNodeId}`);
      directedLinksToHighlight.add(`${sourceNodeId}-${targetNodeId}`);
      // Expand the group so the internal devices/ports become visible
      if (isSourceGroup) groupsToExpand.add(parseInt(sourceNodeId.replace('group-', ''), 10));
      if (isTargetGroup) groupsToExpand.add(parseInt(targetNodeId.replace('group-', ''), 10));

      // Highlight actual physical port-to-port links
      const originalLinks = (link as any).aggregatedLinks && (link as any).aggregatedLinks.length > 0
        ? (link as any).aggregatedLinks
        : [link];

      originalLinks.forEach((l: any) => {
        const s = String(l.originalSource || (typeof l.source === 'object' ? l.source.id : l.source));
        const t = String(l.originalTarget || (typeof l.target === 'object' ? l.target.id : l.target));
        deviceIdsToHighlight.add(s);
        deviceIdsToHighlight.add(t);
        linkPairsToHighlight.add(`${s}-${t}`);
        linkPairsToHighlight.add(`${t}-${s}`);
        directedLinksToHighlight.add(`${s}-${t}`);
      });
    } else {
      const originalLinks = (link as any).aggregatedLinks && (link as any).aggregatedLinks.length > 0
        ? (link as any).aggregatedLinks
        : [link];

      originalLinks.forEach((l: any) => {
        const s = String(l.originalSource || (typeof l.source === 'object' ? l.source.id : l.source));
        const t = String(l.originalTarget || (typeof l.target === 'object' ? l.target.id : l.target));
        deviceIdsToHighlight.add(s);
        deviceIdsToHighlight.add(t);
        linkPairsToHighlight.add(`${s}-${t}`);
        linkPairsToHighlight.add(`${t}-${s}`);
        directedLinksToHighlight.add(`${s}-${t}`);
      });
    }

    const parentDevicesToAdd = new Set<string>();
    deviceIdsToHighlight.forEach(dId => {
      const node = data.nodes.find(n => String(n.id) === dId);
      if (node) {
        if (node.deviceGroupId !== undefined && !dId.startsWith('group-')) {
          groupsToExpand.add(node.deviceGroupId);
        }
        if (node.parentDeviceId !== undefined) {
          parentDevicesToAdd.add(String(node.parentDeviceId));
        }
      }
    });
    parentDevicesToAdd.forEach(pId => deviceIdsToHighlight.add(pId));

    if (groupsToExpand.size > 0 || deviceIdsToHighlight.size > 0) {
      if (groupsToExpand.size > 0) {
        setExpandedGroups(prev => {
          const next = new Set(prev);
          groupsToExpand.forEach(gid => next.add(gid));
          return next;
        });
        setActiveGroupId(Array.from(groupsToExpand)[0] || null);
      }
      setActiveDeviceId(null);

      setPathHighlight({
        deviceIds: deviceIdsToHighlight,
        linkPairs: linkPairsToHighlight,
        directedLinks: directedLinksToHighlight,
        isLinkIsolation: true,
        srcNodeId: sourceNodeId,
        dstNodeId: targetNodeId
      });

      if (!is2DMode) {
        setTimeout(() => {
          if (graphRef.current) {
            zoomToFitActiveNodes(1200, 100);
          }
        }, 300);
      }
    }
  }, [data.nodes, is2DMode, zoomToFitActiveNodes]);

  const onLinkClick = useCallback((link: any, event: any) => {
    if (link.isRingLink || link.isRingTopologyLink) return;
    // 계층 보조선(부모-자식 연결선)에는 팝오버를 표시하지 않으므로 클릭 무시
    if (link.isHierarchyLink || link.isDeviceToInterface) return;

    const now = Date.now();
    const delay = now - lastLinkClickTimeRef.current;

    if (delay < 300) {
      if (linkClickTimeoutRef.current) {
        clearTimeout(linkClickTimeoutRef.current);
        linkClickTimeoutRef.current = null;
      }
      handleLinkDoubleClick(link);
    } else {
      if (linkClickTimeoutRef.current) clearTimeout(linkClickTimeoutRef.current);

      linkClickTimeoutRef.current = setTimeout(() => {
        linkClickTimeoutRef.current = null;
        if (clickedLink === link) {
          setClickedLink(null);
        } else {
          let ratio = 0.5;
          let offset = { x: 0, y: 0 };
          if (graphRef.current && (link as any).source && (link as any).target) {
            const src = (link as any).source;
            const tgt = (link as any).target;
            if (src.x !== undefined && tgt.x !== undefined) {
              const s2d = (graphRef.current as any).graph2ScreenCoords(src.x, src.y, src.z);
              const t2d = (graphRef.current as any).graph2ScreenCoords(tgt.x, tgt.y, tgt.z);
              if (s2d && t2d) {
                const mx = event ? (event.clientX || mousePosRef.current.x) : mousePosRef.current.x;
                const my = event ? (event.clientY || mousePosRef.current.y) : mousePosRef.current.y;
                const dx = t2d.x - s2d.x;
                const dy = t2d.y - s2d.y;
                const lengthSq = dx * dx + dy * dy;
                if (lengthSq > 0) {
                  const t = ((mx - s2d.x) * dx + (my - s2d.y) * dy) / lengthSq;
                  ratio = Math.max(0, Math.min(1, t));

                  // 계산된 3D 비율 좌표와 실제 마우스 2D 좌표 간의 미세한 오프셋을 구하여 보정합니다.
                  const midX = src.x + (tgt.x - src.x) * ratio;
                  const midY = src.y + (tgt.y - src.y) * ratio;
                  const midZ = src.z + (tgt.z - src.z) * ratio;
                  const projectedCoords = (graphRef.current as any).graph2ScreenCoords(midX, midY, midZ);
                  if (projectedCoords) {
                    offset = { x: mx - projectedCoords.x, y: my - projectedCoords.y };
                  }
                }
              }
            }
          }
          setClickedLinkRatio(ratio);
          setClickedLinkOffset(offset);
          setClickedLink(link);
          setClickedLinkPos({ x: event ? (event.clientX || mousePosRef.current.x) : mousePosRef.current.x, y: event ? (event.clientY || mousePosRef.current.y) : mousePosRef.current.y });
        }
      }, 250);
    }
    lastLinkClickTimeRef.current = now;
  }, [clickedLink, visibleData.nodes, data.nodes, zoomToFitActiveNodes]);

  const getNodeLabel = useCallback((node: any) => {
    if (node.isRingNode) return '';
    const hasAlarm = node.severity && node.severity !== 'normal';

    let extraInfo = '';
    if (node.isDeviceNode) {
      // data.ts에서 groupName, ipAddr가 매핑되어 있음
      const groupName = node.groupName || groupsMetadata[node.deviceGroupId] || '';
      const ip = node.ipAddr || '';
      let pathInfo = '';

      const { pathHighlight } = stateRef.current;
      if (pathHighlight && (pathHighlight.deviceIds.has(node.id) || pathHighlight.deviceIds.has(String(node.id)))) {
        const inLinks: { intf: string, bw: string }[] = [];
        const outLinks: { intf: string, bw: string }[] = [];

        visibleData.links.forEach((l: any) => {
          if (!l.originalSource || !l.originalTarget) return;

          const s = String(l.originalSource);
          const t = String(l.originalTarget);
          const nId = String(node.id);

          const bwStr = l.totalBandWidth ? `${l.traffic?.toFixed(1) || 0} / ${l.totalBandWidth} Mbps` : 'N/A';

          if (t === nId && pathHighlight.directedLinks?.has(`${s}-${nId}`)) {
            inLinks.push({ intf: l.dstInterfaceName || 'Unknown Port', bw: bwStr });
          } else if (s === nId && pathHighlight.directedLinks?.has(`${t}-${nId}`)) {
            inLinks.push({ intf: l.srcInterfaceName || 'Unknown Port', bw: bwStr });
          }

          if (s === nId && pathHighlight.directedLinks?.has(`${nId}-${t}`)) {
            outLinks.push({ intf: l.srcInterfaceName || 'Unknown Port', bw: bwStr });
          } else if (t === nId && pathHighlight.directedLinks?.has(`${nId}-${s}`)) {
            outLinks.push({ intf: l.dstInterfaceName || 'Unknown Port', bw: bwStr });
          }
        });

        if (inLinks.length > 0 || outLinks.length > 0) {
          pathInfo += `<div style="margin-top: 6px; font-size: 10px; color: #94a3b8; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px; display: flex; flex-direction: column; gap: 4px;">`;
          inLinks.forEach(({ intf, bw }) => {
            pathInfo += `<div><span style="color: #a78bfa; margin-right: 4px;">[In]</span><span style="color: #cbd5e1;">${intf}</span> <span style="color: #64748b;">(${bw})</span></div>`;
          });
          outLinks.forEach(({ intf, bw }) => {
            pathInfo += `<div><span style="color: #34d399; margin-right: 4px;">[Out]</span><span style="color: #cbd5e1;">${intf}</span> <span style="color: #64748b;">(${bw})</span></div>`;
          });
          pathInfo += `</div>`;
        }
      }

      if (groupName || ip || pathInfo) {
        extraInfo = `
          <div style="margin-top: 4px; font-size: 10px; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            ${groupName ? `<div><span style="color: #64748b; margin-right: 4px;">그룹:</span><span style="color: #cbd5e1;">${groupName}</span></div>` : ''}
            ${ip ? `<div><span style="color: #64748b; margin-right: 4px;">IP:</span><span style="font-family: monospace; color: #93c5fd;">${ip}</span></div>` : ''}
          </div>
          ${pathInfo}
        `;
      }
    } else if (node.isInterfaceNode) {
      const deviceName = node.deviceName || '';
      const ip = node.ipAddr || '';
      if (deviceName || ip) {
        extraInfo = `
          <div style="margin-top: 4px; font-size: 10px; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; display: flex; flex-direction: column; gap: 2px;">
            ${deviceName ? `<div><span style="color: #64748b; margin-right: 4px;">장비:</span><span style="color: #cbd5e1;">${deviceName}</span></div>` : ''}
            ${ip ? `<div><span style="color: #64748b; margin-right: 4px;">IP:</span><span style="font-family: monospace; color: #93c5fd;">${ip}</span></div>` : ''}
          </div>
        `;
      }
    }

    return `
      <div style="background: rgba(22, 25, 32, 0.85); backdrop-filter: blur(8px); border-radius: 8px; padding: 6px 10px; font-family: 'Inter', sans-serif; color: #cbd5e1; font-size: 11px; box-shadow: 0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px ${hasAlarm ? SEVERITY_COLORS[node.severity].color : 'rgba(255, 255, 255, 0.08)'};">
        <div style="display: flex; align-items: center;">
          <span style="font-weight: bold; color: #f8fafc;">${node.label.replace('\n', ' ')}</span>
          ${hasAlarm ? `<span style="color: ${SEVERITY_COLORS[node.severity].color}; font-weight: bold; margin-left: 4px;">[장애]</span>` : ''}
        </div>
        ${extraInfo}
      </div>
    `;
  }, [visibleData.links]);


  // Window resize event listener to center the 3D graph
  useEffect(() => {
    if (is2DMode) return;
    let timeoutId: any;
    const handleResizeFit = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        zoomToFitActiveNodes(800, 20);
      }, 200);
    };
    window.addEventListener('resize', handleResizeFit);
    return () => {
      window.removeEventListener('resize', handleResizeFit);
      clearTimeout(timeoutId);
    };
  }, [is2DMode, zoomToFitActiveNodes]);


  useEffect(() => {
    if (externalSelectedNode !== undefined && externalSelectedNode !== selectedNode) {
      if (externalSelectedNode === null) {
        setSelectedNode(null);
        setClickedNode(null);
        setTooltipPos(null);
      } else {
        if (ignoreNextExternalRef.current === externalSelectedNode.id) {
          // 이 변경은 3D 내부의 원클릭으로 인해 발생한 것이므로 줌인을 트리거하지 않고 무시합니다.
          ignoreNextExternalRef.current = null;
          return;
        }

        const targetNode = visibleNodesRef.current.find((n: any) => n.id === externalSelectedNode.id) || externalSelectedNode;
        if (targetNode) {
          // 포트(인터페이스)인 경우, 3D 상에서 더블클릭한 것과 동일하게 링크 뎁스(격리 뷰)로 바로 이동하도록 처리
          if (targetNode.isInterfaceNode) {
            const link = data.links.find(l =>
              (l.source.id || l.source) === targetNode.id ||
              (l.target.id || l.target) === targetNode.id
            );
            if (link) {
              handleLinkDoubleClick(link as GraphLink);
              setTimeout(() => setClickedLink(link as GraphLink), 500);
              setClickedNode(null);
              setTooltipPos(null);
              return;
            }
          }

          handleNodeClick(targetNode);

          setClickedNode(targetNode);

          if (graphRef.current && typeof (graphRef.current as any).graph2ScreenCoords === 'function' && targetNode.x !== undefined) {
            const coords = (graphRef.current as any).graph2ScreenCoords(targetNode.x, targetNode.y, targetNode.z);
            setTooltipPos({ x: coords.x, y: coords.y });
          } else {
            setTooltipPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          }
        }
      }
    }
  }, [externalSelectedNode, handleNodeClick, handleResetToRoot, selectedNode]);

  return (
    <div ref={containerRef} className="graph-container absolute top-16 left-0 right-0 bottom-0 bg-transparent overflow-hidden" style={{ cursor: 'default' }}>

      {/* Sleek Breadcrumb / Navigation Bar */}
      <div className="absolute top-4 left-6 z-10 pointer-events-auto flex items-center space-x-2 bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md px-3.5 py-1.5 shadow-2xl text-[11px] font-bold text-gray-400">
        <span
          onClick={() => {
            handleResetToRoot();
            // 탐색(pathHighlight)이 이미 진행된 상태에서 '전체' 클릭 시 경로 탐색 리셋
            if (pathHighlight) {
              setPathHighlight(null);
              setPathFinderResetTrigger(prev => prev + 1);
              setExternalSrcGroup(null);
              setExternalDstGroup(null);
              setExternalSrcDevice(null);
              setExternalDstDevice(null);
            }
          }}
          className="hover:text-blue-400 cursor-pointer transition-colors flex items-center select-none"
        >
          <svg className="w-3.5 h-3.5 mr-1 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
          전체
        </span>

        {pathHighlight && (() => {
          const arr = Array.from(pathHighlight.deviceIds);
          if (arr.length >= 2) {
            const startId = pathHighlight.srcNodeId || arr[0];
            const endId = pathHighlight.dstNodeId || arr[arr.length - 1];
            const startNode = visibleData.nodes.find((n: any) => String(n.id) === String(startId)) || data.nodes.find((n: any) => String(n.id) === String(startId));
            const endNode = visibleData.nodes.find((n: any) => String(n.id) === String(endId)) || data.nodes.find((n: any) => String(n.id) === String(endId));

            const getIsolationName = (node: any) => {
              if (!node) return 'Unknown';
              if (node.isGroupNode) return node.label;
              if (node.isDeviceNode) return node.label;
              if (node.isInterfaceNode) {
                const parentDev = data.nodes.find((n: any) => n.id === node.parentDeviceId);
                if (parentDev) return parentDev.label;
                const parentGroup = groupsMetadata[node.deviceGroupId];
                if (parentGroup) return parentGroup;
              }
              return node.label;
            };

            return (
              <>
                <span className="text-gray-600 font-mono text-[11px]">➔</span>
                <span className="text-cyan-400 font-extrabold select-none">
                  {pathHighlight.isLinkIsolation
                    ? `${getIsolationName(startNode).replace('\n', ' ')} ↔ ${getIsolationName(endNode).replace('\n', ' ')}`
                    : `경로탐색: ${startNode?.label.replace('\n', ' ')} - ${endNode?.label.replace('\n', ' ')}`}
                </span>
              </>
            );
          }
          return null;
        })()}

        {(!pathHighlight && selectedNode?.isRingNode) && (
          <>
            <span className="text-gray-600 font-mono text-[11px]">➔</span>
            <span className="text-blue-400 font-extrabold select-none">
              {selectedNode.label}
            </span>
          </>
        )}

        {(!pathHighlight && activeGroupName) && (
          <>
            <span className="text-gray-600 font-mono text-[11px]">➔</span>
            <span
              onClick={handleBackToGroup}
              className={`hover:text-blue-400 cursor-pointer transition-colors select-none ${!activeDeviceName ? 'text-blue-400' : ''}`}
            >
              {activeGroupName}
            </span>
          </>
        )}

        {(!pathHighlight && activeDeviceName) && (
          <>
            <span className="text-gray-600 font-mono text-[11px]">➔</span>
            <span className="text-blue-400 font-extrabold select-none">
              {activeDeviceName}
            </span>
          </>
        )}
      </div>

      {dimensions.width > 0 && dimensions.height > 0 && (
        is2DMode ? (
          <NetworkGraph2D
            onNodeContextMenu={(event, node) => {
              if ((node.isGroupNode && node.deviceGroupId !== undefined) || node.isDeviceNode) {
                setContextMenu({
                  node,
                  x: event.clientX,
                  y: event.clientY
                });
              }
            }}
            data={data}
            onNodeClick={(node) => {
              // 링크 격리 상태에서 다른 장비/그룹을 클릭하면, 먼저 격리를 해제하여 초기 상태처럼 동작하도록 합니다.
              if (pathHighlight?.isLinkIsolation) {
                setPathHighlight(null);
              }
              // Re-use existing click handler
              const mockEvent = { clientX: 0, clientY: 0 } as any;
              if (node) {
                // Simulating double click for depth navigation
                handleNodeClick(node, mockEvent);
                // Second click to simulate double click (if needed, but usually single click might be mapped to navigation in 2D)
                setTimeout(() => handleNodeClick(node, mockEvent), 50);
              }
            }}
            highlightNodes={highlightNodes}
            highlightLinks={highlightLinks}
            highlightVersion={highlightVersion}
            pathHighlight={pathHighlight}
            activeNodeId={selectedNode ? String(selectedNode.id) : (activeDeviceId ? activeDeviceId : (activeGroupId !== null ? `group-${activeGroupId}` : null))}
            isDimmedState={(selectedNode || activeGroupId !== null || activeDeviceId !== null || hoverNode || pathHighlight !== null || searchTerm.trim().length > 0) ? true : false}
            onEdgeClick={(edge) => {
              // 2D에서는 한 번 클릭 시 즉시 해당 뎁스로 이동
              handleLinkDoubleClick(edge);
            }}
            onEdgeDoubleClick={handleLinkDoubleClick}
            onBackgroundClick={handleBackgroundClick}
            onNodeHover={onNodeHover}
            isHovering={!!hoverNode}
            getNodeLabel={getNodeLabel}
          />
        ) : (
          <ForceGraph3D
            ref={setGraphRef}
            showNavInfo={false}
            width={dimensions.width}
            height={dimensions.height}
            graphData={visibleData}
            nodeId="id"
            nodeVal={getNodeVal}
            nodeLabel={() => ''}
            onNodeHover={onNodeHover}
            onLinkHover={onLinkHover}
            onLinkClick={onLinkClick}
            nodeColor={getNodeColor}
            nodeThreeObject={getNodeThreeObject}
            nodeResolution={16}
            linkWidth={getLinkWidth}
            linkResolution={6}
            linkMaterial={(link: any) => {
              const colorStr = getLinkColor(link);
              const isSourceGroup = typeof link.source === 'object' ? link.source.isGroupNode : String(link.source).startsWith('group-');
              const isTargetGroup = typeof link.target === 'object' ? link.target.isGroupNode : String(link.target).startsWith('group-');
              const isGroupToGroup = isSourceGroup && isTargetGroup;
              const depthTest = iconConcept === 'block' ? true : !isGroupToGroup;

              const cacheKey = `${colorStr}_${depthTest}`;
              if (linkMaterialCache.has(cacheKey)) {
                return linkMaterialCache.get(cacheKey);
              }

              let mat;
              if (colorStr === 'rgba(0,0,0,0)') {
                mat = new THREE.MeshBasicMaterial({ visible: false });
              } else {
                const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                let color = new THREE.Color('#94a3b8');
                let opacity = 1;
                if (match) {
                  color = new THREE.Color(`rgb(${match[1]}, ${match[2]}, ${match[3]})`);
                  if (match[4] !== undefined) opacity = parseFloat(match[4]);
                } else if (colorStr.startsWith('#')) {
                  color = new THREE.Color(colorStr);
                }

                mat = new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity,
                  depthWrite: false,
                  depthTest
                });
              }
              linkMaterialCache.set(cacheKey, mat);
              return mat;
            }}
            linkColor={getLinkColor}
            linkLabel={() => ''}
            linkThreeObjectExtend={true}
            linkThreeObject={getLinkThreeObject}
            linkPositionUpdate={onLinkPositionUpdate}
            linkDirectionalParticles={(link: any) => {
              if (pathHighlight && !pathHighlight.isLinkIsolation && ((l) => {
                if (!l) return false;
                const ts = typeof l.source === 'object' ? l.source.id : l.source;
                const tt = typeof l.target === 'object' ? l.target.id : l.target;
                return highlightLinkIds.current.has(ts + '-' + tt);
              })(link)) {
                // 포트와 장비 사이, 그룹과 장비 사이의 계층 구조 선에는 흐르는 애니메이션 제외
                if (link.isHierarchyLink || link.isGroupToDevice) {
                  return 0;
                }
                return 5;
              }
              return 0;
            }}
            linkDirectionalParticleWidth={3}
            linkDirectionalParticleSpeed={(link: any) => {
              if (pathHighlight && ((l) => {
                if (!l) return false;
                const ts = typeof l.source === 'object' ? l.source.id : l.source;
                const tt = typeof l.target === 'object' ? l.target.id : l.target;
                return highlightLinkIds.current.has(ts + '-' + tt);
              })(link)) {
                // 1. 일반 데이터 링크인 경우 (장비 간 또는 인터페이스 간)
                const origSrc = link.originalSource;
                const origTgt = link.originalTarget;
                if (origSrc && origTgt) {
                  if (pathHighlight.directedLinks?.has(`${origTgt}-${origSrc}`)) {
                    return -0.008; // 역방향 흐름
                  }
                  return 0.008; // 정방향 흐름
                }

                // 2. 계층 링크인 경우 (장비 <-> 인터페이스)
                if (link.isHierarchyLink && link.isDeviceToInterface) {
                  const devId = typeof link.source === 'object' ? link.source.id : link.source;
                  const intfId = typeof link.target === 'object' ? link.target.id : link.target;

                  // 이 인터페이스(intfId)에 연결된 활성화된 데이터 링크 찾기
                  const connectedDataLink = visibleData.links.find((l: any) => {
                    if (l.isHierarchyLink) return false;
                    if (!highlightLinks.has(l)) return false;
                    const s = typeof l.source === 'object' ? l.source.id : l.source;
                    const t = typeof l.target === 'object' ? l.target.id : l.target;
                    return s === intfId || t === intfId;
                  });

                  if (connectedDataLink) {
                    const peerId = connectedDataLink.originalSource === devId
                      ? connectedDataLink.originalTarget
                      : connectedDataLink.originalSource;

                    // peer -> devId 방향이면 역방향(인터페이스 -> 장비)으로 흐름
                    if (pathHighlight.directedLinks?.has(`${peerId}-${devId}`)) {
                      return -0.008;
                    }
                    // devId -> peer 방향이면 정방향(장비 -> 인터페이스)으로 흐름
                    if (pathHighlight.directedLinks?.has(`${devId}-${peerId}`)) {
                      return 0.008;
                    }
                  }
                }
              }
              return 0.008;
            }}
            linkDirectionalParticleColor={() => '#ffffff'}
            onNodeClick={(node, event) => {
              const { selectedNode, activeGroupId, activeDeviceId, pathHighlight } = stateRef.current;
              const isHighlight = highlightNodes.has(node.id);
              const isDimmed = (selectedNode || activeGroupId !== null || activeDeviceId !== null || pathHighlight !== null || stateRef.current.searchTerm.trim().length > 0) && !isHighlight;

              if (isDimmed) return;

              const now = Date.now();
              const delay = now - lastClickTimeRef.current;
              // console.log('[onNodeClick RAW]', { nodeId: node.id, delay, isDimmed });

              if (delay < 300) {
                // Double click detected -> Expand depth layout & Zoom in
                if (clickTimeoutRef.current) {
                  clearTimeout(clickTimeoutRef.current);
                  clickTimeoutRef.current = null;
                }
                if (node.isInterfaceNode) {
                  const link = data.links.find(l =>
                    (l.source.id || l.source) === node.id ||
                    (l.target.id || l.target) === node.id
                  );
                  if (link) {
                    handleLinkDoubleClick(link as GraphLink);
                    setTimeout(() => setClickedLink(link as GraphLink), 500);
                    setClickedNode(null);
                    setTooltipPos(null);
                    return;
                  }
                }
                handleNodeClick(node);
                setClickedNode(null);
                setTooltipPos(null);
              } else {
                // Single click -> Trigger high-performance React floating overlay card
                if (clickTimeoutRef.current) {
                  clearTimeout(clickTimeoutRef.current);
                }

                // Capture native event coordinates safely before React's event pooling wipes them
                const clientX = event ? (event as MouseEvent).clientX : 0;
                const clientY = event ? (event as MouseEvent).clientY : 0;

                clickTimeoutRef.current = setTimeout(() => {
                  if (node.isRingNode) {
                    clickTimeoutRef.current = null;
                    return;
                  }
                  setClickedNode(node);
                  setTooltipPos({ x: clientX, y: clientY });
                  // 노드 원클릭은 그냥 장애관련 툴팁만 나오게 하고 연결 노드 하이라이트는 방지하도록 로컬 selectedNode 세팅 제외
                  ignoreNextExternalRef.current = node.id;
                  onNodeClick(node);
                  clickTimeoutRef.current = null;
                }, 250);
              }
              lastClickTimeRef.current = now;
            }}
            onNodeRightClick={(node: any, event: MouseEvent) => {
              if ((node.isGroupNode && node.deviceGroupId !== undefined) || node.isDeviceNode) {
                setContextMenu({
                  node,
                  x: event.clientX,
                  y: event.clientY
                });
              }
            }
            }
            onBackgroundClick={handleBackgroundClick}
            backgroundColor="rgba(0,0,0,0)" // Match CSS background instead
            nodeThreeObjectExtend={false}
            forceEngine="d3"
            d3AlphaDecay={0.03}   // 적절한 수렴 속도로 노드가 충분히 밀려나도록 보장
            d3VelocityDecay={0.6}   // 부드러운 감속으로 용수철 반동은 억제하되 이동 속도 확보
            warmupTicks={300}       // 기존 120틱보다 훨씬 늘린 300틱 사전 연산을 통해 새로고침 시마다 완벽하게 동일한 평형 상태(고정된 배치)로 시작하도록 보장
            cooldownTicks={100}     // 추가적으로 100틱 동안 엔진을 더 안정화
          />
        )
      )}

      {/* 커스텀 호버 툴팁 (position:fixed로 뷰포트 기준 배치 → 잘림 방지) */}
      {(hoverNode || hoverLink || clickedLink) && (
        <div
          ref={hoverTooltipRef}
          style={{
            position: 'fixed',
            left: `${clickedLink ? clickedLinkPos?.x : mousePosRef.current.x}px`,
            top: `${clickedLink ? clickedLinkPos?.y : mousePosRef.current.y}px`,
            transform: clickedLink
              ? `translate(${(clickedLinkPos?.x || 0) > window.innerWidth - 300 ? 'calc(-100% - 18px)' : '18px'}, ${(clickedLinkPos?.y || 0) > window.innerHeight - 300 ? 'calc(-100% - 18px)' : '18px'})`
              : `translate(${mousePosRef.current.x > window.innerWidth - 300 ? 'calc(-100% - 18px)' : '18px'}, ${mousePosRef.current.y > window.innerHeight - 300 ? 'calc(-100% - 18px)' : '18px'})`,
            zIndex: 9999,
            pointerEvents: clickedLink ? 'auto' : 'none',
          }}
          dangerouslySetInnerHTML={{
            __html: hoverNode
              ? getNodeLabel(hoverNode)
              : (clickedLink ? getLinkLabel(clickedLink, true) : (hoverLink ? getLinkLabel(hoverLink) : ''))
          }}
        />
      )}

      {/* React Floating Glassmorphism Tooltip Card */}

      {/* View controls and Alarm Counting overlay */}
      <div className="absolute top-4 right-6 bottom-6 flex flex-col items-end space-y-3 z-10 pointer-events-none">

        {/* Top Row: Search, Theme Toggle & View Controls */}
        <div className="flex flex-row items-center space-x-3 pointer-events-none z-50">

          {/* Node Search Field Widget */}
          <div className="relative pointer-events-auto w-[320px] h-[32px]">
            <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md shadow-2xl flex items-center h-full">
              <div className="relative flex items-center h-full group">
                <select
                  value={searchFilter}
                  onChange={e => {
                    setSearchFilter(e.target.value as any);
                    if (stateRef.current.searchTerm.trim().length > 0) setShowSearchSuggestions(true);
                  }}
                  className="bg-transparent border-none outline-none text-gray-400 group-hover:text-gray-300 text-[11px] font-bold cursor-pointer h-full flex items-center focus:outline-none appearance-none pl-2 pr-6 w-[60px] z-10"
                  style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                >
                  <option value="all" className="bg-[#161920] text-gray-300">전체</option>
                  <option value="group" className="bg-[#161920] text-gray-300">그룹</option>
                  <option value="device" className="bg-[#161920] text-gray-300">장비</option>
                  <option value="interface" className="bg-[#161920] text-gray-300">포트</option>
                </select>
                <svg className="absolute right-1.5 w-3 h-3 text-gray-500 group-hover:text-gray-400 pointer-events-none z-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
              <div className="w-[1px] h-4 bg-[#2d3748]"></div>
              <svg className="w-3.5 h-3.5 text-gray-400 mx-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <input
                type="text"
                placeholder="노드명 검색..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setShowSearchSuggestions(true);
                }}
                onFocus={() => setShowSearchSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 200)}
                className="bg-transparent border-none outline-none text-gray-200 text-[12px] w-full placeholder-gray-500 h-full"
              />
            </div>
            {/* Suggestions Dropdown */}
            {showSearchSuggestions && stateRef.current.searchTerm.trim().length > 0 && (
              <div className="absolute top-full right-0 left-0 mt-1 bg-[#161920]/95 backdrop-blur-md border border-[#2d3748] rounded-md shadow-2xl max-h-[300px] overflow-y-auto custom-scrollbar z-50">
                {(() => {
                  const term = searchTerm.toLowerCase();
                  let groupResults: any[] = [];
                  if (searchFilter === 'all' || searchFilter === 'group') {
                    groupResults = Object.entries(groupsMetadata)
                      .filter(([_, name]) => name.toLowerCase().includes(term))
                      .map(([gid, name]) => ({
                        id: `group-${gid}`,
                        label: name,
                        isGroupNode: true,
                        isDeviceNode: false,
                        ipAddr: ''
                      }));
                  }

                  let nodeResults: any[] = [];
                  if (searchFilter !== 'group') {
                    nodeResults = data.nodes.filter(n => {
                      if (searchFilter === 'device' && !n.isDeviceNode) return false;
                      if (searchFilter === 'interface' && !n.isInterfaceNode) return false;

                      const labelMatch = n.label && n.label.toLowerCase().includes(term);
                      const devMatch = n.deviceName && n.deviceName.toLowerCase().includes(term);
                      const intfMatch = n.interfaceName && n.interfaceName.toLowerCase().includes(term);
                      return labelMatch || devMatch || intfMatch;
                    });
                  }

                  const results = [...groupResults, ...nodeResults].slice(0, 50);
                  if (results.length === 0) return <div className="px-4 py-3 text-[11px] text-gray-500 text-center">검색 결과가 없습니다.</div>;
                  return results.map(node => {
                    let hierarchyStr = '';
                    if (node.isInterfaceNode) {
                      const gName = groupsMetadata[node.deviceGroupId] || node.groupName || '';
                      const dName = node.deviceName || '';
                      if (gName && dName) hierarchyStr = ` (${gName} > ${dName})`;
                      else if (gName) hierarchyStr = ` (${gName})`;
                      else if (dName) hierarchyStr = ` (${dName})`;
                    } else if (node.isDeviceNode) {
                      const gName = groupsMetadata[node.deviceGroupId] || node.groupName || '';
                      if (gName) hierarchyStr = ` (${gName})`;
                    }

                    return (
                      <div
                        key={node.id}
                        className="px-3 py-2 hover:bg-[#2d3748]/50 cursor-pointer border-b border-[#2d3748]/50 last:border-0 flex justify-between items-center transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchTerm('');
                          setShowSearchSuggestions(false);
                          setPathHighlight(null);
                          setPathFinderResetTrigger(prev => prev + 1);
                          if ((window as any).focusNodeById) {
                            (window as any).focusNodeById(node.id);
                          }
                        }}
                      >
                        <div className="flex flex-col overflow-hidden w-full">
                          <span className="text-[12px] font-bold text-gray-200 truncate">{node.label.replace('\n', ' ')}</span>
                          <span className="text-[10px] text-gray-500 truncate mt-0.5">
                            {node.isGroupNode ? '그룹' : node.isDeviceNode ? '장비' : '포트'}
                            <span className="text-[#94a3b8]">{hierarchyStr}</span>
                            {node.ipAddr ? ` | ${node.ipAddr}` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Theme Toggle Widget */}
          {!is2DMode && (
            <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md flex items-center shadow-2xl pointer-events-auto h-[32px]">
              <button
                onClick={() => setIconConcept('planet')}
                className={`px-3 h-full flex items-center justify-center text-[11px] font-bold rounded-l-md transition-colors cursor-pointer ${iconConcept === 'planet' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-[#2d3748]'}`}
              >
                행성 테마
              </button>
              <button
                onClick={() => setIconConcept('block')}
                className={`px-3 h-full flex items-center justify-center text-[11px] font-bold rounded-r-md transition-colors cursor-pointer ${iconConcept === 'block' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:bg-[#2d3748]'}`}
              >
                블록 테마
              </button>
            </div>
          )}

          {/* View controls widget */}
          {!is2DMode && (
            <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md flex items-center shadow-2xl pointer-events-auto h-[32px]">
              <button
                className="px-3.5 h-full hover:bg-[#2d3748] rounded-l-md text-gray-400 text-[11px] font-bold transition-colors flex items-center justify-center cursor-pointer"
                onClick={() => {
                  if (graphRef.current) {
                    customZoomToFitAllNodes(500);
                  }
                }}
                title="View All Nodes"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
                노드 전체보기
              </button>
              <div className="w-[1px] h-4 bg-[#2d3748]"></div>
              <button
                className={`px-3 h-full rounded-r-md transition-colors flex items-center justify-center cursor-pointer ${isAutoRotating ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' : 'text-gray-400 hover:bg-[#2d3748]'}`}
                onClick={() => setIsAutoRotating(!isAutoRotating)}
                title={isAutoRotating ? "Pause Rotation" : "Auto Rotate"}
              >
                {isAutoRotating ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653Z" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Sleek operation dashboard alarm count widget - Split by Device, Port and Link alarms */}
        <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md px-4 py-2 flex flex-col space-y-1.5 shadow-2xl min-w-[320px] pointer-events-auto">
          {/* Header */}
          <div className="flex justify-between items-center text-[11px] font-bold text-gray-500 uppercase tracking-widest border-b border-[#2d3748] pb-1">
            <span>장애 관제 현황</span>
            <span className="text-blue-400 font-mono">TOTAL ALARMS</span>
          </div>

          {/* Statistics grid */}
          <div className="flex justify-around items-center pt-3 pb-2 px-2 gap-4">
            {/* Critical */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] text-red-500 font-bold uppercase tracking-wide flex items-center flex-nowrap mb-1">
                <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse mr-1.5 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>CRIT
              </span>
              <span className="text-[32px] leading-none font-mono font-bold text-[#ef4444] drop-shadow-[0_0_10px_rgba(239,68,68,0.4)]">
                {alarmCounts.device.critical + alarmCounts.port.critical + alarmCounts.link.critical}
              </span>
            </div>

            {/* Major */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] text-orange-500 font-bold uppercase tracking-wide flex items-center flex-nowrap mb-1">
                <span className="w-2 h-2 rounded-full bg-[#f97316] animate-pulse mr-1.5 shadow-[0_0_8px_rgba(249,115,22,0.6)]"></span>MAJ
              </span>
              <span className="text-[32px] leading-none font-mono font-bold text-[#f97316] drop-shadow-[0_0_10px_rgba(249,115,22,0.3)]">
                {alarmCounts.device.major + alarmCounts.port.major + alarmCounts.link.major}
              </span>
            </div>

            {/* Minor */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] text-yellow-500 font-bold uppercase tracking-wide flex items-center flex-nowrap mb-1">
                <span className="w-2 h-2 rounded-full bg-[#eab308] mr-1.5"></span>MIN
              </span>
              <span className="text-[32px] leading-none font-mono font-bold text-[#eab308] drop-shadow-[0_0_10px_rgba(234,179,8,0.2)]">
                {alarmCounts.device.minor + alarmCounts.port.minor + alarmCounts.link.minor}
              </span>
            </div>

            {/* Warning */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] text-cyan-500 font-bold uppercase tracking-wide flex items-center flex-nowrap mb-1">
                <span className="w-2 h-2 rounded-full bg-[#06b6d4] mr-1.5"></span>WRN
              </span>
              <span className="text-[32px] leading-none font-mono font-bold text-[#06b6d4] drop-shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                {alarmCounts.device.warning + alarmCounts.port.warning + alarmCounts.link.warning}
              </span>
            </div>
          </div>

          {/* Footer (Occurred / Ack / Notified & Toggle Button) */}
          <div className="border-t border-[#2d3748] pt-2 mt-1 flex justify-between items-center">
            <div className="flex space-x-4 text-[11px] font-bold text-gray-400">
              <div className="flex items-center">
                <span className="mr-1">발생</span>
                <span className="text-white font-mono">{sortedAlarms.length}</span>
              </div>
              <div className="flex items-center">
                <span className="mr-1 text-green-500/70">인지</span>
                <span className="text-white font-mono">{Math.floor(sortedAlarms.length * 0.75)}</span>
              </div>
              <div className="flex items-center">
                <span className="mr-1 text-blue-500/70">통보</span>
                <span className="text-white font-mono">{Math.floor(sortedAlarms.length * 0.4)}</span>
              </div>
            </div>

            <button
              onClick={() => setShowAlarmList(!showAlarmList)}
              className={`px-2 py-1 rounded transition-colors flex items-center text-[11px] font-bold cursor-pointer ${showAlarmList ? 'bg-cyan-600/20 text-cyan-400' : 'bg-[#2d3748]/50 text-gray-400 hover:text-gray-300 hover:bg-[#2d3748]/80'}`}
            >
              리스트 {showAlarmList ? '접기' : '보기'}
              <svg className={`w-3 h-3 ml-1 transform transition-transform ${showAlarmList ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Alarm List Widget */}
        {showAlarmList && (
          <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-md flex flex-col shadow-2xl min-w-[480px] flex-1 min-h-0">
            <div className="px-4 py-2 border-b border-[#2d3748] flex justify-between items-center text-[11px] font-bold text-gray-500 uppercase tracking-widest shrink-0">
              <span>장애 리스트</span>
              <span className="text-gray-400 font-mono text-[11px]">총 {sortedAlarms.length}건</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {sortedAlarms.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-gray-500">현재 발생한 장애가 없습니다.</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#0d0f14]/95 backdrop-blur-md z-10 shadow">
                    <tr className="text-[11px] text-gray-500 uppercase tracking-widest border-b border-[#2d3748]">
                      <th className="px-2 py-2 font-bold w-12 text-center">등급</th>
                      <th className="px-2 py-2 font-bold">분류</th>
                      <th className="px-2 py-2 font-bold">그룹</th>
                      <th className="px-2 py-2 font-bold">대상 및 장애 내용</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2d3748]/50">
                    {sortedAlarms.map((alarm, idx) => (
                      <tr key={idx} className="hover:bg-[#2d3748]/40 transition-colors group cursor-pointer">
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-2 h-2 rounded-full ${alarm.severity === 'critical' ? 'bg-[#ef4444] animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]' :
                            alarm.severity === 'major' ? 'bg-[#f97316]' :
                              alarm.severity === 'minor' ? 'bg-[#eab308]' : 'bg-[#06b6d4]'
                            }`} title={alarm.severity.toUpperCase()}></span>
                        </td>
                        <td className="px-2 py-2 text-[11px] font-mono text-gray-400">{alarm.type}</td>
                        <td className="px-2 py-2 text-[11px] text-cyan-500/80 font-bold leading-tight">
                          {alarm.groupName.includes(' - ') ? (
                            alarm.groupName.split(' - ').map((g, idx) => (
                              <div key={idx}>{g}</div>
                            ))
                          ) : (
                            alarm.groupName
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-gray-200 group-hover:text-white transition-colors">{alarm.name}</span>
                            <span className="text-[11px] text-gray-500 mt-0.5 leading-snug line-clamp-1" title={alarm.cause}>{alarm.cause}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Path Finder Panel */}
      <PathFinderPanel
        resetTrigger={pathFinderResetTrigger}
        externalSrcGroup={externalSrcGroup}
        externalDstGroup={externalDstGroup}
        externalSrcDevice={externalSrcDevice}
        externalDstDevice={externalDstDevice}
        externalSearchTrigger={externalSearchTrigger}
        onClear={() => {
          setExternalSrcGroup(null);
          setExternalDstGroup(null);
          setExternalSrcDevice(null);
          setExternalDstDevice(null);
        }}
        onPathSelect={(highlight, expandGroupIds) => {
          setPathHighlight(highlight);
          if (highlight) {
            setIsAutoRotating(false);
            // 경로가 포함된 그룹 노드 자동 확장 (시작/끝 그룹 및 경로상에 있는 모든 경유 그룹 포함)
            setExpandedGroups(prev => {
              const next = new Set(prev);
              expandGroupIds.forEach(gid => next.add(gid));

              if (highlight && highlight.deviceIds) {
                highlight.deviceIds.forEach(deviceId => {
                  const node = data.nodes.find(n => n.id === deviceId);
                  if (node && node.deviceGroupId !== undefined) {
                    next.add(node.deviceGroupId);
                  }
                });
              }

              return next;
            });
            // 경로 하이라이트 시 다른 포커스 상태 초기화
            setActiveGroupId(null);
            setActiveDeviceId(null);
            setSelectedNode(null);
            setClickedNode(null);

            // 경로 탐색 시 화면에 꽉 차도록 패딩을 줄여서 줌
            // ForceGraph의 물리 엔진이 노드들을 펼치는 시간을 고려하여 줌을 여러 번 실행합니다.
            setTimeout(() => zoomToFitActiveNodes(1200, 20, null, null), 150);
            setTimeout(() => zoomToFitActiveNodes(1000, 20, null, null), 1200);
            // 모든 노드가 물리엔진에 의해 최종 위치에 도달한 후 다시 한번 정확하게 타겟팅합니다.
            setTimeout(() => zoomToFitActiveNodes(1000, 20, null, null), 2500);
          } else {
            // 경로 하이라이트 해제 시 확장 그룹 및 장비도 초기화
            setExpandedGroups(new Set());
            setExpandedDevices(new Set());
            setTimeout(() => customZoomToFitAllNodes(800), 50);
          }
        }}
      />
      {/* Context Menu for Node Right Click */}
      {contextMenu && (
        <div
          className="fixed z-[9999] bg-[#1a1d26] border border-[#2d3748] rounded-md shadow-2xl overflow-hidden min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="px-3 py-1.5 text-[11px] font-bold text-gray-400 border-b border-[#2d3748] bg-[#0d0f14] truncate">
            {contextMenu.node.isGroupNode ? '그룹:' : '장비:'} {contextMenu.node.label.replace('\n', ' ')}
          </div>
          <button
            className="w-full text-left px-4 py-2 text-[12px] text-gray-200 hover:bg-cyan-600/20 hover:text-cyan-400 transition-colors"
            onClick={() => {
              if (contextMenu.node.isGroupNode) {
                setExternalSrcGroup({ groupId: contextMenu.node.deviceGroupId!, groupName: contextMenu.node.label || '' });
                setExternalSrcDevice(null);
              } else if (contextMenu.node.isDeviceNode) {
                setExternalSrcDevice({ deviceId: Number(contextMenu.node.id), deviceName: contextMenu.node.label, deviceIpAddr: contextMenu.node.ipAddr || '' });
                setExternalSrcGroup(null);
              }
              setExternalSearchTrigger(prev => prev + 1);
              setContextMenu(null);
            }}
          >
            출발지로 설정
          </button>
          <button
            className="w-full text-left px-4 py-2 text-[12px] text-gray-200 hover:bg-cyan-600/20 hover:text-cyan-400 transition-colors"
            onClick={() => {
              if (contextMenu.node.isGroupNode) {
                setExternalDstGroup({ groupId: contextMenu.node.deviceGroupId!, groupName: contextMenu.node.label || '' });
                setExternalDstDevice(null);
              } else if (contextMenu.node.isDeviceNode) {
                setExternalDstDevice({ deviceId: Number(contextMenu.node.id), deviceName: contextMenu.node.label, deviceIpAddr: contextMenu.node.ipAddr || '' });
                setExternalDstGroup(null);
              }
              setExternalSearchTrigger(prev => prev + 1);
              setContextMenu(null);
            }}
          >
            도착지로 설정
          </button>
        </div>
      )}

    </div>
  );
};

export default NetworkGraph;

// Helper to create small text canvas for traffic labels
function createTrafficCanvas(trafficMbps: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Text formatting without padding/background
    ctx.font = 'bold 100px Inter, sans-serif';
    ctx.fillStyle = '#38bdf8'; // light cyan text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = `${trafficMbps.toFixed(1)} Mbps`;
    // Outline stroke for readability over lines
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#0f1115';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Helper function to create wireframe texture for the outer mesh
let cachedWireframeTexture: THREE.CanvasTexture | null = null;
function createWireframeTexture() {
  if (cachedWireframeTexture) return cachedWireframeTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Transparent background, so lines are the only visible things during blending
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2; // Thinner mesh lines

    // Remove glow effect from the wireframe itself so only the core glows
    ctx.shadowBlur = 0;

    // Low number of rows/cols makes the mesh look "사이버펑크" (less dense)
    const rows = 12;
    const cols = 24;

    ctx.beginPath();
    // Horizontal lines
    for (let i = 0; i <= rows; i++) {
      const y = (i / rows) * canvas.height;
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    // Vertical lines
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * canvas.width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    ctx.stroke();

    // Adding tech-like scattered dots/crosses at intersections
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        if (Math.random() > 0.7) {
          const x = (j / cols) * canvas.width;
          const y = (i / rows) * canvas.height;
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
      }
    }
  }

  cachedWireframeTexture = new THREE.CanvasTexture(canvas);
  cachedWireframeTexture.wrapS = THREE.RepeatWrapping;
  cachedWireframeTexture.wrapT = THREE.RepeatWrapping;

  return cachedWireframeTexture;
}


// Helper function to create glow texture
let cachedGlowTexture: THREE.CanvasTexture | null = null;
function createGlowTexture() {
  if (cachedGlowTexture) return cachedGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  cachedGlowTexture = new THREE.CanvasTexture(canvas);
  return cachedGlowTexture;
}

// Helper function to create canvas text texture for labels
function createTextCanvas(text: string, opacity: number, nodeType: string, badgeConfig?: { text: string; color: string }) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 1024; // Double the width for high-DPI clarity
  canvas.height = 256; // Double the height for high-DPI clarity

  if (context) {
    const fontSize = nodeType === 'ring' ? 210 : 100; // Hover 영역 축소를 위해 폰트 렌더링 배율 3배 증가 (70 -> 210)
    context.font = `${nodeType === 'ring' ? 'bold' : 'normal'} ${fontSize}px Inter, sans-serif`;

    // 노드명이 너무 길 경우 적절히 줄바꿈 처리
    let processedText = text;
    if (nodeType !== 'ring' && !processedText.includes('\n') && processedText.length > 8) {
      if (processedText.includes(' ')) {
        processedText = processedText.replace(' ', '\n');
      } else {
        const wrapKeywords = [
          '식품의약품', '국립농산물', '농림축산', '국립환경', '국립재난',
          '광주센터', '대구센터', '대전센터', '공주센터', '질병관리', '해양경찰',
          '강원도청', '경기도청', '경남도청', '경북도청', '전남도청', '전북도청',
          '충남도청', '충북도청', '제주도청', '서울시청', '부산시청', '대구시청',
          '인천시청', '광주시청', '대전시청', '울산시청', '세종시청',
          '서울청사', '과천청사', '대전청사', '세종청사', '서울별관'
        ];
        let keywordMatched = false;
        for (const kw of wrapKeywords) {
          if (processedText.includes(kw)) {
            const idx = processedText.indexOf(kw) + kw.length;
            if (processedText.length - idx >= 2) { // 뒤에 2글자 이상 남았을 때만
              processedText = processedText.substring(0, idx) + '\n' + processedText.substring(idx);
              keywordMatched = true;
              break;
            }
          }
        }

        if (!keywordMatched) {
          if (processedText.includes('-')) {
            const idx = processedText.indexOf('-');
            if (idx > 0 && idx < processedText.length - 1) processedText = processedText.substring(0, idx) + '\n' + processedText.substring(idx);
          } else {
            const half = Math.ceil(processedText.length / 2);
            processedText = processedText.substring(0, half) + '\n' + processedText.substring(half);
          }
        }
      }
    }

    // Calculate text dimensions
    let textWidth = 0;
    const isMultiLine = processedText.includes('\n');
    let textLines: string[] = [];

    if (isMultiLine) {
      textLines = processedText.split('\n');
      const w1 = context.measureText(textLines[0]).width;
      const w2 = context.measureText(textLines[1]).width;
      textWidth = Math.max(w1, w2);
    } else {
      textWidth = context.measureText(processedText).width;
    }

    // Calculate Badge dimensions
    let badgeWidth = 0;
    const badgeMargin = 30; // Space between badge and text
    const badgeFontSize = 60; // Badge text size
    if (badgeConfig) {
      context.font = `bold ${badgeFontSize}px Inter, sans-serif`;
      badgeWidth = context.measureText(badgeConfig.text).width + 60; // Padding inside badge
      // Restore font for main text
      context.font = `${nodeType === 'ring' ? 'bold' : 'normal'} ${fontSize}px Inter, sans-serif`;
    }

    // Draw background and border only for non-ring nodes (groups, devices, interfaces)
    if (nodeType !== 'ring') {
      // Set background container boundaries with padding (adjusted for 2x resolution)
      const paddingX = 48;
      const paddingY = 24;

      const line1TextWidth = isMultiLine ? context.measureText(textLines[0]).width : textWidth;
      const line2TextWidth = isMultiLine ? context.measureText(textLines[1]).width : 0;

      const line1TotalWidth = (badgeConfig ? badgeWidth + badgeMargin : 0) + line1TextWidth;
      const line2TotalWidth = line2TextWidth;

      const totalContentWidth = Math.max(line1TotalWidth, line2TotalWidth);
      const boxWidth = totalContentWidth + paddingX * 2;
      const boxHeight = (isMultiLine ? fontSize * 2 + 24 : fontSize) + paddingY * 2;
      const boxX = 512 - boxWidth / 2;
      const boxY = 128 - boxHeight / 2;
      const borderRadius = 24;

      // Draw dark semi-transparent background box for superior contrast
      context.fillStyle = `rgba(10, 11, 14, ${0.9 * opacity})`;
      context.beginPath();
      if (context.roundRect) {
        context.roundRect(boxX, boxY, boxWidth, boxHeight, borderRadius);
      } else {
        context.rect(boxX, boxY, boxWidth, boxHeight);
      }
      context.fill();

      // Add a delicate, glowing border (adjusted width for 2x resolution)
      context.strokeStyle = `rgba(255, 255, 255, ${0.12 * opacity})`;
      context.lineWidth = 3.0;
      context.stroke();

      // Text configuration
      let fillStyle = `rgba(255,255,255,${opacity})`;
      context.fillStyle = fillStyle;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      const line1Y = isMultiLine ? 128 - fontSize / 2 - 4 : 128;
      const line2Y = isMultiLine ? 128 + fontSize / 2 + 4 : 128;

      let contentStartX = 512 - line1TotalWidth / 2;

      // Draw Badge if exists
      if (badgeConfig) {
        const bW = badgeWidth;
        const bH = badgeFontSize + 32; // height with padding
        const bY = line1Y - bH / 2;
        const bX = contentStartX;
        const r = 16;

        context.fillStyle = badgeConfig.color;
        context.globalAlpha = 0.2 * opacity;
        context.beginPath();
        context.moveTo(bX + r, bY);
        context.lineTo(bX + bW - r, bY);
        context.quadraticCurveTo(bX + bW, bY, bX + bW, bY + r);
        context.lineTo(bX + bW, bY + bH - r);
        context.quadraticCurveTo(bX + bW, bY + bH, bX + bW - r, bY + bH);
        context.lineTo(bX + r, bY + bH);
        context.quadraticCurveTo(bX, bY + bH, bX, bY + bH - r);
        context.lineTo(bX, bY + r);
        context.quadraticCurveTo(bX, bY, bX + r, bY);
        context.fill();

        context.globalAlpha = 1.0 * opacity;
        context.shadowColor = badgeConfig.color;
        context.shadowBlur = 10;
        context.lineWidth = 4;
        context.strokeStyle = badgeConfig.color;
        context.stroke();
        context.shadowBlur = 0;

        context.font = `bold ${badgeFontSize}px Inter, sans-serif`;
        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.fillText(badgeConfig.text, bX + bW / 2, line1Y);

        // Restore font and fill style for main text
        context.font = `${nodeType === 'ring' ? 'bold' : 'normal'} ${fontSize}px Inter, sans-serif`;
        context.fillStyle = fillStyle;
        contentStartX += bW + badgeMargin;
      }

      // Draw Main Text
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      if (isMultiLine) {
        context.fillText(textLines[0], contentStartX, line1Y);
        context.textAlign = 'center';
        context.fillText(textLines[1], 512, line2Y);
      } else {
        context.fillText(processedText, contentStartX, line1Y);
      }
    } else {
      // Ring Node text rendering (no box, no badge support)
      let fillStyle = `rgba(255,255,255,${opacity})`;
      context.fillStyle = fillStyle;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.shadowColor = 'rgba(0, 0, 0, 0.8)';
      context.shadowBlur = 16;
      context.shadowOffsetX = 8;
      context.shadowOffsetY = 8;

      if (isMultiLine) {
        context.fillText(textLines[0], 512, 128 - fontSize / 2 - 4);
        context.fillText(textLines[1], 512, 128 + fontSize / 2 + 4);
      } else {
        context.fillText(processedText, 512, 128);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);

  // High-performance texture filtering configuration for razor-sharp rendering
  texture.minFilter = THREE.LinearMipmapLinearFilter; // Enable high-quality mipmapping
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16; // 16x Anisotropic Filtering (eliminates blur at angles and scaling)

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return texture;
}
