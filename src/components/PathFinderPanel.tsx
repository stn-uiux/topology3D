import React, { useState, useCallback, useEffect, useRef } from 'react';
import DeviceSelectModal from './DeviceSelectModal';
import { findKShortestPaths, findGroupToGroupPaths, findMixedPaths, PathResult } from '../utils/pathFinder';
import { getRawData } from '../data';

interface DeviceInfo {
  deviceId: number;
  deviceName: string;
  deviceIpAddr: string;
  deviceGroupId: number;
}

export interface PathHighlightInfo {
  deviceIds: Set<string>;
  linkPairs: Set<string>; // "deviceId1-deviceId2" 형태 (양방향 모두 저장)
  directedLinks: Set<string>; // 실제 경로가 흐르는 방향 "srcId-dstId" 저장
  isLinkIsolation?: boolean;
  srcNodeId?: string;
  dstNodeId?: string;
  resultCount?: number;
}

interface GroupInfo {
  groupId: number;
  groupName: string;
}

type SearchHistoryItem = {
  srcDevice: DeviceInfo | null;
  dstDevice: DeviceInfo | null;
  srcGroup: GroupInfo | null;
  dstGroup: GroupInfo | null;
  timestamp: number;
};

interface PathFinderPanelProps {
  onPathSelect: (highlight: PathHighlightInfo | null, expandGroupIds: number[]) => void;
  resetTrigger?: number;
  externalSrcGroup?: GroupInfo | null;
  externalDstGroup?: GroupInfo | null;
  externalSrcDevice?: DeviceInfo | null;
  externalDstDevice?: DeviceInfo | null;
  externalSearchTrigger?: number;
  onClear?: () => void;
}

const PathFinderPanel: React.FC<PathFinderPanelProps> = ({ onPathSelect, resetTrigger, externalSrcGroup, externalDstGroup, externalSrcDevice, externalDstDevice, externalSearchTrigger, onClear }) => {
  const [srcDevice, setSrcDevice] = useState<DeviceInfo | null>(null);
  const [dstDevice, setDstDevice] = useState<DeviceInfo | null>(null);
  const [srcGroup, setSrcGroup] = useState<GroupInfo | null>(null);
  const [dstGroup, setDstGroup] = useState<GroupInfo | null>(null);
  const [maxPaths, setMaxPaths] = useState(5);
  const [criterion, setCriterion] = useState<'hop' | 'bandwidth'>('hop');
  const [results, setResults] = useState<PathResult[]>([]);
  const [selectedPathIdx, setSelectedPathIdx] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historySearchTrigger, setHistorySearchTrigger] = useState(0);

  // 모달 상태
  const [modalTarget, setModalTarget] = useState<'src' | 'dst' | null>(null);

  const [isExpanded, setIsExpanded] = useState(false);

  // Drag logic
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('.no-drag')) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);


  const handleSearch = useCallback(() => {
    let newHistoryItem: SearchHistoryItem | null = null;
    if (srcDevice && dstDevice) {
      if (srcDevice.deviceId === dstDevice.deviceId) return;
      newHistoryItem = { srcDevice, dstDevice, srcGroup: null, dstGroup: null, timestamp: Date.now() };
    } else if (srcGroup && dstGroup) {
      if (srcGroup.groupId === dstGroup.groupId) return;
      newHistoryItem = { srcDevice: null, dstDevice: null, srcGroup, dstGroup, timestamp: Date.now() };
    } else if (srcGroup && dstDevice) {
      newHistoryItem = { srcDevice: null, dstDevice, srcGroup, dstGroup: null, timestamp: Date.now() };
    } else if (srcDevice && dstGroup) {
      newHistoryItem = { srcDevice, dstDevice: null, srcGroup: null, dstGroup, timestamp: Date.now() };
    } else {
      return;
    }

    if (newHistoryItem) {
      setSearchHistory(prev => {
        if (prev.length > 0) {
          const last = prev[0];
          if (last.srcDevice?.deviceId === newHistoryItem!.srcDevice?.deviceId &&
              last.dstDevice?.deviceId === newHistoryItem!.dstDevice?.deviceId &&
              last.srcGroup?.groupId === newHistoryItem!.srcGroup?.groupId &&
              last.dstGroup?.groupId === newHistoryItem!.dstGroup?.groupId) {
            return prev;
          }
        }
        return [newHistoryItem!, ...prev].slice(0, 10);
      });
    }

    setIsSearching(true);
    setSelectedPathIdx(null);
    onPathSelect(null, []);

    if (srcDevice && dstDevice) {
      setTimeout(() => {
        const paths = findKShortestPaths(srcDevice.deviceId, dstDevice.deviceId, maxPaths, criterion);
        setResults(paths);
        setHasSearched(true);
        setIsSearching(false);
        if (paths.length > 0) {
          setIsExpanded(true);
          setSelectedPathIdx(0);
          
          const path = paths[0];
          const deviceIds = new Set<string>(path.path.map(id => String(id)));
          const linkPairs = new Set<string>();
          const directedLinks = new Set<string>();

          for (let i = 0; i < path.path.length - 1; i++) {
            const src = path.path[i];
            const tgt = path.path[i + 1];
            linkPairs.add(`${src}-${tgt}`);
            linkPairs.add(`${tgt}-${src}`);
            directedLinks.add(`${src}-${tgt}`);
          }

          const srcNodeId = String(path.path[0]);
          const dstNodeId = String(path.path[path.path.length - 1]);

          onPathSelect({ deviceIds, linkPairs, directedLinks, srcNodeId, dstNodeId, resultCount: paths.length }, []);
        }
      }, 50);
    } else if (srcGroup && dstGroup) {
      setTimeout(() => {
        const paths = findGroupToGroupPaths(srcGroup.groupId, dstGroup.groupId, maxPaths);
        setResults(paths);
        setHasSearched(true);
        setIsSearching(false);
        if (paths.length > 0) {
          setIsExpanded(true);
          setSelectedPathIdx(0);

          const path = paths[0];
          const deviceIds = new Set<string>(path.path.map(id => String(id)));
          const linkPairs = new Set<string>();
          const directedLinks = new Set<string>();
          for (let i = 0; i < path.path.length - 1; i++) {
            const src = path.path[i];
            const tgt = path.path[i + 1];
            linkPairs.add(`${src}-${tgt}`);
            linkPairs.add(`${tgt}-${src}`);
            directedLinks.add(`${src}-${tgt}`);
          }

          const raw = getRawData();
          const groupIds: number[] = [];
          if (raw) {
            for (const deviceId of path.path) {
              const node = raw.nodes.find((n: any) => n.deviceId === deviceId);
              if (node && !groupIds.includes(node.deviceGroupId)) {
                groupIds.push(node.deviceGroupId);
              }
            }
          }

          const srcNodeId = String(path.path[0]);
          const dstNodeId = String(path.path[path.path.length - 1]);

          onPathSelect({ deviceIds, linkPairs, directedLinks, srcNodeId, dstNodeId, resultCount: typeof paths !== 'undefined' ? paths.length : results.length }, groupIds);
        }
      }, 50);
    } else if ((srcGroup && dstDevice) || (srcDevice && dstGroup)) {
      setTimeout(() => {
        const paths = findMixedPaths(
          srcGroup ? 'group' : 'device',
          srcGroup ? srcGroup.groupId : srcDevice!.deviceId,
          dstGroup ? 'group' : 'device',
          dstGroup ? dstGroup.groupId : dstDevice!.deviceId,
          maxPaths
        );
        setResults(paths);
        setHasSearched(true);
        setIsSearching(false);
        if (paths.length > 0) {
          setIsExpanded(true);
          setSelectedPathIdx(0);

          const path = paths[0];
          const deviceIds = new Set<string>(path.path.map(id => String(id)));
          const linkPairs = new Set<string>();
          const directedLinks = new Set<string>();

          for (let i = 0; i < path.path.length - 1; i++) {
            const src = path.path[i];
            const tgt = path.path[i + 1];
            linkPairs.add(`${src}-${tgt}`);
            linkPairs.add(`${tgt}-${src}`);
            directedLinks.add(`${src}-${tgt}`);
          }

          const raw = getRawData();
          const groupIds: number[] = [];
          if (raw) {
            for (const deviceId of path.path) {
              const node = raw.nodes.find((n: any) => n.deviceId === deviceId);
              if (node && !groupIds.includes(node.deviceGroupId)) {
                groupIds.push(node.deviceGroupId);
              }
            }
          }

          const srcNodeId = String(path.path[0]);
          const dstNodeId = String(path.path[path.path.length - 1]);

          onPathSelect({ deviceIds, linkPairs, directedLinks, srcNodeId, dstNodeId, resultCount: typeof paths !== 'undefined' ? paths.length : results.length }, groupIds);
        }
      }, 50);
    }
  }, [srcDevice, dstDevice, srcGroup, dstGroup, maxPaths, criterion, onPathSelect]);

  const handleHistoryClick = useCallback((item: SearchHistoryItem) => {
    setSrcDevice(item.srcDevice);
    setDstDevice(item.dstDevice);
    setSrcGroup(item.srcGroup);
    setDstGroup(item.dstGroup);
    setShowHistory(false);
    setHistorySearchTrigger(prev => prev + 1);
  }, []);

  const lastHistorySearchTrigger = useRef(0);
  useEffect(() => {
    if (historySearchTrigger > 0 && historySearchTrigger !== lastHistorySearchTrigger.current) {
      lastHistorySearchTrigger.current = historySearchTrigger;
      handleSearch();
    }
  }, [historySearchTrigger, handleSearch]);

  const handlePathClick = useCallback((idx: number) => {
    if (selectedPathIdx === idx) {
      // Do nothing instead of deselecting, as requested by user
      return;
    }

    setSelectedPathIdx(idx);

    setTimeout(() => {
      const path = results[idx];
      if (!path) return;

      const deviceIds = new Set<string>(path.path.map(id => String(id)));
      const linkPairs = new Set<string>();
      const directedLinks = new Set<string>();

      for (let i = 0; i < path.path.length - 1; i++) {
        const src = path.path[i];
        const tgt = path.path[i + 1];
        linkPairs.add(`${src}-${tgt}`);
        linkPairs.add(`${tgt}-${src}`);
        directedLinks.add(`${src}-${tgt}`);
      }

      // 경로의 장비들이 속한 그룹 ID 수집
      const raw = getRawData();
      const groupIds: number[] = [];
      if (raw) {
        for (const res of results) {
          for (const deviceId of res.path) {
            const node = raw.nodes.find((n: any) => n.deviceId === deviceId);
            if (node && !groupIds.includes(node.deviceGroupId)) {
              groupIds.push(node.deviceGroupId);
            }
          }
        }
      }

      const srcNodeId = String(path.path[0]);
      const dstNodeId = String(path.path[path.path.length - 1]);

      onPathSelect({ deviceIds, linkPairs, directedLinks, srcNodeId, dstNodeId, resultCount: results.length }, groupIds);
    }, 50);
  }, [selectedPathIdx, results, onPathSelect]);

  const handleDeviceSelect = useCallback((device: DeviceInfo) => {
    if (modalTarget === 'src') {
      setSrcDevice(device);
    } else if (modalTarget === 'dst') {
      setDstDevice(device);
    }
    setModalTarget(null);
  }, [modalTarget]);

  const handleClear = useCallback((isProgrammatic = false) => {
    setSrcDevice(null);
    setDstDevice(null);
    setSrcGroup(null);
    setDstGroup(null);
    setResults([]);
    setSelectedPathIdx(null);
    setHasSearched(false);
    setIsExpanded(false);
    if (isProgrammatic !== true) {
      onPathSelect(null, []);
    }
    onClear?.();
  }, [onPathSelect, onClear]);


  const lastResetTriggerRef = useRef(resetTrigger);

  useEffect(() => {
    if (resetTrigger && resetTrigger !== lastResetTriggerRef.current) {
      lastResetTriggerRef.current = resetTrigger;
      handleClear(true);
    }
  }, [resetTrigger, handleClear]);

  const lastExtSearchTriggerRef = useRef(externalSearchTrigger);

  useEffect(() => {
    if (externalSearchTrigger) {
      if (externalSrcGroup) {
        setSrcGroup(externalSrcGroup);
        setSrcDevice(null);
      } else if (externalSrcDevice) {
        setSrcDevice(externalSrcDevice);
        setSrcGroup(null);
      }

      if (externalDstGroup) {
        setDstGroup(externalDstGroup);
        setDstDevice(null);
      } else if (externalDstDevice) {
        setDstDevice(externalDstDevice);
        setDstGroup(null);
      }
    }
      const hasSrc = externalSrcGroup || externalSrcDevice || srcGroup || srcDevice;
      const hasDst = externalDstGroup || externalDstDevice || dstGroup || dstDevice;
      
      // 출발지와 도착지가 모두 설정된 상태라면 즉시 탐색 시작
      if (hasSrc && hasDst && externalSearchTrigger !== lastExtSearchTriggerRef.current) {
        setHistorySearchTrigger(prev => prev + 1);
      }
      lastExtSearchTriggerRef.current = externalSearchTrigger;
  }, [externalSearchTrigger, externalSrcGroup, externalDstGroup, externalSrcDevice, externalDstDevice]);

  // (자동 탐색 제거: 탐색 버튼 클릭 시에만 수동으로 탐색하도록 변경)
  const lastAutoSearchTriggerRef = useRef(0);

  // 경로 번호별 색상 (상위부터)
  const getPathColor = (idx: number) => {
    const colors = ['#22d3ee', '#34d399', '#a78bfa', '#fbbf24', '#f87171'];
    return colors[idx % colors.length];
  };

  // 탐색 조건이나 결과가 모두 없으면 패널 자체를 숨김 (닫기)
  if (!srcDevice && !dstDevice && !srcGroup && !dstGroup && results.length === 0) {
    return null;
  }

  return (
    <>
      {/* Main Panel - Bottom overlay */}
      <div 
        className="absolute bottom-4 left-1/2 z-10 pointer-events-auto" 
        style={{ transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)` }}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="bg-[#161920]/90 backdrop-blur-md border border-[#2d3748] rounded-lg shadow-2xl w-max min-w-[880px] max-w-[95vw]">

          {/* Search bar row */}
          <div className="flex items-center gap-2 px-3 py-2">
            <div 
              className="shrink-0 flex items-center text-gray-500 hover:text-gray-300 transition-colors mr-1 cursor-move" 
              title="드래그하여 이동"
              onMouseDown={handleMouseDown}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
              </svg>
            </div>
            {/* Source device */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider shrink-0">출발</span>
              <button
                onClick={() => setModalTarget('src')}
                className={`bg-[#0d0f14] border rounded px-2.5 py-1 text-[12px] w-[140px] flex items-center transition-all cursor-pointer shrink-0 ${
                  (srcDevice || srcGroup)
                    ? 'border-cyan-700/50 text-gray-200' 
                    : 'border-[#2d3748] text-gray-600 hover:border-[#4a5568]'
                }`}
                title={srcDevice ? srcDevice.deviceName : (srcGroup ? srcGroup.groupName : '')}
              >
                <span className="truncate w-full text-left">
                  {srcDevice ? srcDevice.deviceName.replace(/\s*IP-MPLS/gi, '') : (srcGroup ? `[그룹] ${srcGroup.groupName}` : '장비 선택')}
                </span>
              </button>
            </div>

            {/* Arrow */}
            <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>

            {/* Destination device */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider shrink-0">도착</span>
              <button
                onClick={() => setModalTarget('dst')}
                className={`bg-[#0d0f14] border rounded px-2.5 py-1 text-[12px] w-[140px] flex items-center transition-all cursor-pointer shrink-0 ${
                  (dstDevice || dstGroup)
                    ? 'border-cyan-700/50 text-gray-200' 
                    : 'border-[#2d3748] text-gray-600 hover:border-[#4a5568]'
                }`}
                title={dstDevice ? dstDevice.deviceName : (dstGroup ? dstGroup.groupName : '')}
              >
                <span className="truncate w-full text-left">
                  {dstDevice ? dstDevice.deviceName.replace(/\s*IP-MPLS/gi, '') : (dstGroup ? `[그룹] ${dstGroup.groupName}` : '장비 선택')}
                </span>
              </button>
            </div>

            {/* Separator */}
            <div className="w-[1px] h-5 bg-[#2d3748] mx-1"></div>

            {/* Max paths */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-gray-500 font-semibold shrink-0 whitespace-nowrap">최대 경로 수</span>
              <select
                value={maxPaths}
                onChange={e => setMaxPaths(Number(e.target.value))}
                className="bg-[#0d0f14] border border-[#2d3748] rounded px-1.5 py-1 text-[12px] text-gray-300 focus:outline-none focus:border-cyan-600 cursor-pointer appearance-none pr-5"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 4px center',
                }}
              >
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={7}>7</option>
                <option value={10}>10</option>
              </select>
            </div>

            {/* Separator */}
            <div className="w-[1px] h-5 bg-[#2d3748] mx-1"></div>

            {/* Criterion */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-gray-500 font-semibold shrink-0 whitespace-nowrap">탐색 기준</span>
              <select
                value={criterion}
                onChange={e => setCriterion(e.target.value as 'hop' | 'bandwidth')}
                className="bg-[#0d0f14] border border-[#2d3748] rounded px-1.5 py-1 text-[12px] text-gray-300 focus:outline-none focus:border-cyan-600 cursor-pointer appearance-none pr-5"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 4px center',
                }}
              >
                <option value="hop">홉 카운트 (최소)</option>
                <option value="bandwidth">대역폭 (최대 여유)</option>
              </select>
            </div>

            {/* Separator */}
            <div className="w-[1px] h-5 bg-[#2d3748] mx-1"></div>

            {/* Search button */}
            <button
              onClick={handleSearch}
              disabled={(!srcDevice && !srcGroup) || (!dstDevice && !dstGroup) || (srcDevice && dstDevice && srcDevice.deviceId === dstDevice.deviceId) || (srcGroup && dstGroup && srcGroup.groupId === dstGroup.groupId) || isSearching}
              className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-600/50 hover:border-cyan-500 text-cyan-400 hover:text-cyan-300 text-[12px] font-bold rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              {isSearching ? '탐색 중...' : '탐색'}
            </button>

            {/* History button */}
            <div className="relative flex items-center">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`p-1 transition-colors shrink-0 ${showHistory ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
                title="탐색 기록"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>

              {/* History Dropdown */}
              {showHistory && (
                <div className="absolute bottom-full right-0 mb-2 w-[420px] bg-[#1a1d26] border border-[#2d3748] rounded shadow-2xl z-[9999]">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2d3748] bg-[#0d0f14] rounded-t">
                    <span className="text-[11px] font-bold text-gray-400">최근 탐색 기록</span>
                    <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-300">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {/* Each item is ~29px tall. 5 items = ~145px */}
                  <div className="max-h-[145px] overflow-y-auto custom-scrollbar rounded-b">
                    {searchHistory.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[11px] text-gray-500">기록이 없습니다.</div>
                    ) : (
                      searchHistory.map((item, i) => (
                        <div 
                          key={i} 
                          className="px-3 py-2 border-b border-[#2d3748]/50 hover:bg-cyan-600/10 cursor-default text-[11px] text-gray-300 flex items-center justify-between transition-colors last:border-b-0"
                          onClick={() => handleHistoryClick(item)}
                        >
                          <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              <span className="text-cyan-500 font-bold shrink-0">출발:</span>
                              <span className="truncate">{item.srcDevice ? item.srcDevice.deviceName : (item.srcGroup ? `[그룹] ${item.srcGroup.groupName}` : '')}</span>
                            </div>
                            <span className="text-gray-500 shrink-0 text-[11px]">→</span>
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              <span className="text-rose-500 font-bold shrink-0">도착:</span>
                              <span className="truncate">{item.dstDevice ? item.dstDevice.deviceName : (item.dstGroup ? `[그룹] ${item.dstGroup.groupName}` : '')}</span>
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-500 shrink-0 ml-3">
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* Clear button */}
            {hasSearched && (
              <button
                onClick={handleClear}
                className="p-1 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                title="초기화"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            )}
          </div>

          {/* Results area - Expandable */}
          {hasSearched && results.length > 0 && (
            <>
              {/* Toggle header */}
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 border-t border-[#2d3748]/60 hover:bg-[#1e2230] transition-colors"
              >
                <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">
                  탐색 결과 ({results.length}건)
                </span>
                <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Results list */}
              {isExpanded && (
                <div className="border-t border-[#2d3748]/40 max-h-[200px] overflow-y-auto">
                  {/* Table header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-gray-600 uppercase tracking-wider border-b border-[#2d3748]/40 sticky top-0 bg-[#161920]">
                    <span className="w-6 text-center">#</span>
                    <span className="flex-1">경로</span>
                    <span className="w-12 text-center">홉 수</span>
                    <span className="w-28 text-right">여유 대역폭</span>
                  </div>

                  {results.map((result, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePathClick(idx)}
                      className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-all border-b border-[#2d3748]/20 ${
                        selectedPathIdx === idx
                          ? 'bg-cyan-500/10 border-l-2'
                          : 'hover:bg-[#1e2230] border-l-2 border-l-transparent'
                      }`}
                      style={{
                        borderLeftColor: selectedPathIdx === idx ? getPathColor(idx) : 'transparent',
                      }}
                    >
                      {/* Number badge */}
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{
                          backgroundColor: `${getPathColor(idx)}20`,
                          color: getPathColor(idx),
                        }}
                      >
                        {idx + 1}
                      </span>

                      {/* Path description */}
                      <span className="flex-1 text-[11px] text-gray-300 truncate leading-tight">
                        {result.pathDescription}
                      </span>

                      {/* Hop count */}
                      <span className="w-12 text-center text-[12px] text-gray-400 font-mono">
                        {result.hopCount}
                      </span>

                      {/* Bandwidth */}
                      <span className="w-28 text-right text-[12px] font-mono" style={{ color: getPathColor(idx) }}>
                        {result.minAvailBandwidth.toLocaleString()} Mbps
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* No results */}
          {hasSearched && results.length === 0 && (
            <div className="border-t border-[#2d3748]/60 px-3 py-3 text-center text-[12px] text-gray-600">
              경로를 찾을 수 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Device select modal */}
      <DeviceSelectModal
        isOpen={modalTarget !== null}
        onClose={() => setModalTarget(null)}
        onSelect={handleDeviceSelect}
        title={modalTarget === 'src' ? '출발 장비 선택' : '도착 장비 선택'}
      />
    </>
  );
};

export default PathFinderPanel;
