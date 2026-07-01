export interface GraphNode extends Record<string, any> {
  id: string;
  label: string;
  group: 'center' | 'cityhall' | 'complex' | 'annex' | 'provincial' | 'other';
  val: number;
  deviceGroupId?: number;
  isGroupNode?: boolean;
  isDeviceNode?: boolean;
  isInterfaceNode?: boolean;
  parentDeviceId?: string;
  deviceSize?: 'S' | 'M' | 'L';
}

export interface GraphLink extends Record<string, any> {
  source: string | any;
  target: string | any;
  usage?: number;
  traffic?: number;
  totalBandWidth?: number;
  isDeviceToDevice?: boolean;
  originalSource?: string;
  originalTarget?: string;
  srcInterfaceName?: string;
  dstInterfaceName?: string;
  srcDeviceName?: string;
  dstDeviceName?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── response.json 타입 ───────────────────────────────────────────────────────
interface RawNode {
  deviceId: number;
  deviceName: string;
  deviceIpAddr: string;
  deviceGroupId: number;
  deviceSize?: 'S' | 'M' | 'L';
}

interface RawLink {
  srcDeviceId: number;
  srcInterfaceId: number;
  srcInterfaceName: string;
  srcInterfaceIpAddr: string;
  dstDeviceId: number;
  dstInterfaceId: number;
  dstInterfaceName: string;
  dstInterfaceIpAddr: string;
  totalBandWidth: number;
  useBandWidth: number;
  availBandWidth: number;
}

interface RawGroup {
  groupId: number;
  groupName: string;
}

interface ResponseJson {
  nodes: RawNode[];
  links: RawLink[];
  groups: RawGroup[];
  rings?: { name: string; groups: number[] }[];
}

// ─── 그룹 이름 → group 타입 추론 ─────────────────────────────────────────────
function inferGroup(name: string): GraphNode['group'] {
  if (name.includes('센터')) return 'center';
  if (name.includes('시청')) return 'cityhall';
  if (name.includes('도청')) return 'provincial';
  if (name.includes('청사')) return 'complex';
  if (name.includes('별관')) return 'annex';
  return 'other';
}

// ─── response.json → GraphData 변환 ──────────────────────────────────────────
export function buildGraphData(response: ResponseJson): GraphData {
  // 전역 메타데이터 초기화 및 갱신 (새 JSON을 로드할 때 이전 링 정보 등 제거)
  for (const key in groupsMetadata) {
    delete groupsMetadata[key];
  }
  for (const g of response.groups) {
    groupsMetadata[g.groupId] = g.groupName;
  }
  
  RINGS.length = 0;
  if (response.rings) {
    RINGS.push(...response.rings);
  }

  // groupId → groupName 매핑
  const groupNameMap: Record<number, string> = {};
  for (const g of response.groups) {
    groupNameMap[g.groupId] = g.groupName;
  }

  // deviceId → RawNode 매핑
  const rawNodeMap: Record<number, RawNode> = {};
  for (const n of response.nodes) {
    rawNodeMap[n.deviceId] = n;
  }

  // ── BFS로 depth 계산 (center 그룹 기준) ──────────────────────────────────
  const adjacency: Record<number, Set<number>> = {};
  for (const n of response.nodes) adjacency[n.deviceId] = new Set();
  for (const l of response.links) {
    adjacency[l.srcDeviceId]?.add(l.dstDeviceId);
    adjacency[l.dstDeviceId]?.add(l.srcDeviceId);
  }

  const depths: Record<number, number> = {};
  const queue: number[] = [];
  for (const n of response.nodes) {
    const gName = groupNameMap[n.deviceGroupId] || '';
    if (gName.includes('센터')) {
      depths[n.deviceId] = 0;
      queue.push(n.deviceId);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adjacency[cur] || []) {
      if (depths[nb] === undefined) {
        depths[nb] = depths[cur] + 1;
        queue.push(nb);
      }
    }
  }

  // ── Device 노드 생성 ──────────────────────────────────────────────────────
  const deviceNodes: GraphNode[] = response.nodes.map(n => {
    const d = depths[n.deviceId] ?? 5;
    const groupName = groupNameMap[n.deviceGroupId] || '';
    return {
      id: String(n.deviceId),
      label: n.deviceName.replace(/\s*IP-MPLS/gi, ''),
      group: inferGroup(n.deviceName),
      val: Math.max(15, 60 - d * 12),
      deviceGroupId: n.deviceGroupId,
      groupName,          // ← 그룹명을 노드에 직접 포함
      isDeviceNode: true,
      ipAddr: n.deviceIpAddr,
      deviceSize: n.deviceSize,
    };
  });

  // ── 인터페이스 노드 + 링크 생성 ──────────────────────────────────────────
  // 인터페이스 ID: `{deviceId}-if-{interfaceId}`로 고유하게 구성
  const interfaceNodes: GraphNode[] = [];
  const interfaceSet = new Set<string>(); // 중복 방지
  const links: GraphLink[] = [];

  for (const l of response.links) {
    const srcDevNode = rawNodeMap[l.srcDeviceId];
    const dstDevNode = rawNodeMap[l.dstDeviceId];
    if (!srcDevNode || !dstDevNode) continue;

    const srcIntfId = `${l.srcDeviceId}-if-${l.srcInterfaceId}`;
    const dstIntfId = `${l.dstDeviceId}-if-${l.dstInterfaceId}`;

    if (!interfaceSet.has(srcIntfId)) {
      interfaceSet.add(srcIntfId);
      interfaceNodes.push({
        id: srcIntfId,
        label: l.srcInterfaceName,
        group: inferGroup(srcDevNode.deviceName),
        val: 4,
        deviceGroupId: srcDevNode.deviceGroupId,
        isInterfaceNode: true,
        parentDeviceId: String(l.srcDeviceId),
        ipAddr: l.srcInterfaceIpAddr,
        interfaceName: l.srcInterfaceName,
        deviceName: srcDevNode.deviceName.replace(/\s*IP-MPLS/gi, ''),
      });
    }

    if (!interfaceSet.has(dstIntfId)) {
      interfaceSet.add(dstIntfId);
      interfaceNodes.push({
        id: dstIntfId,
        label: l.dstInterfaceName,
        group: inferGroup(dstDevNode.deviceName),
        val: 4,
        deviceGroupId: dstDevNode.deviceGroupId,
        isInterfaceNode: true,
        parentDeviceId: String(l.dstDeviceId),
        ipAddr: l.dstInterfaceIpAddr,
        interfaceName: l.dstInterfaceName,
        deviceName: dstDevNode.deviceName.replace(/\s*IP-MPLS/gi, ''),
      });
    }

    const usage = l.totalBandWidth > 0 ? (l.useBandWidth / l.totalBandWidth) * 100 : 0;

    links.push({
      source: srcIntfId,
      target: dstIntfId,
      usage,
      traffic: l.useBandWidth,
      totalBandWidth: l.totalBandWidth,
      isDeviceToDevice: true,
      originalSource: String(l.srcDeviceId),
      originalTarget: String(l.dstDeviceId),
      srcInterfaceName: l.srcInterfaceName,
      dstInterfaceName: l.dstInterfaceName,
      srcDeviceName: srcDevNode.deviceName.replace(/\s*IP-MPLS/gi, ''),
      dstDeviceName: dstDevNode.deviceName.replace(/\s*IP-MPLS/gi, ''),
    });
  }

  return {
    nodes: [...deviceNodes, ...interfaceNodes],
    links,
  };
}

// ─── groupsMetadata 내보내기 (NetworkGraph에서 사용) ─────────────────────────
export const groupsMetadata: Record<number, string> = {};
export const RINGS: { name: string; groups: number[] }[] = [];

// ─── 비동기 데이터 로드 ───────────────────────────────────────────────────────
let _cachedData: GraphData | null = null;
let _cachedRawData: ResponseJson | null = null;

export function getRawData(): ResponseJson | null {
  return _cachedRawData;
}

export async function loadGraphData(): Promise<GraphData> {
  if (_cachedData) return _cachedData;

  const res = await fetch('/response.json');
  if (!res.ok) throw new Error(`Failed to load response.json: ${res.status}`);
  const json: ResponseJson = await res.json();

  // groupsMetadata 채우기
  for (const g of json.groups) {
    groupsMetadata[g.groupId] = g.groupName;
  }
  
  if (json.rings) {
    RINGS.length = 0;
    RINGS.push(...json.rings);
  }

  _cachedRawData = json;
  _cachedData = buildGraphData(json);
  return _cachedData;
}

// ─── 동기 호환용 (초기 빈 데이터, App에서 useEffect로 교체) ──────────────────
export const mockGraphData: GraphData = { nodes: [], links: [] };
