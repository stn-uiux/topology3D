import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, X, Activity, Server, Network } from 'lucide-react';
import { GraphNode, GraphData, groupsMetadata, RINGS } from '../data';
import { mockNodeAlarms, mockLinkAlarms, getMaxSeverity, ALARM_CAUSES } from './NetworkGraph';

interface NodeDetailSidebarProps {
  node: GraphNode;
  onClose: () => void;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  graphData: GraphData;
}

const getGroupName = (group: string) => {
  switch (group) {
    case 'center': return '센터';
    case 'cityhall': return '시청';
    case 'complex': return '청사';
    case 'provincial': return '도청';
    case 'annex': return '별관';
    default: return '기타';
  }
};


const SEVERITY_COLORS: Record<string, { color: string }> = {
  critical: { color: '#ef4444' }, // red
  major: { color: '#f97316' },    // orange
  minor: { color: '#eab308' },    // yellow
  warning: { color: '#06b6d4' },  // cyan
  normal: { color: '#cbd5e1' }
};

const SeverityBadge = ({ severity }: { severity?: string }) => {
  if (!severity || severity === 'normal') return null;
  const color = SEVERITY_COLORS[severity]?.color || '#f97316';
  
  let label = severity.toUpperCase();
  if (severity === 'critical') label = 'CRIT';
  if (severity === 'major') label = 'MAJ';
  if (severity === 'minor') label = 'MIN';
  if (severity === 'warning') label = 'WRN';

  return (
    <span 
      className="ml-2 text-[8px] font-bold px-0.5 py-0.5 rounded leading-none" 
      style={{ color, border: `1px solid ${color}`, backgroundColor: `${color}15` }}
    >
      {label}
    </span>
  );
};

export const NodeDetailSidebar: React.FC<NodeDetailSidebarProps> = ({ node, onClose, onNodeClick, onNodeHover, graphData }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  
  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  const getActualSeverity = (n: GraphNode) => {
    let maxSev = mockNodeAlarms[n.id] || 'normal';
    
    if (n.isDeviceNode) {
      const intfs = graphData.nodes.filter(i => i.parentDeviceId === n.id && i.isInterfaceNode);
      intfs.forEach(intf => {
        maxSev = getMaxSeverity(maxSev, mockNodeAlarms[intf.id] || 'normal');
        graphData.links.forEach(l => {
          const sId = l.source?.id || l.source;
          const tId = l.target?.id || l.target;
          if (sId === intf.id || tId === intf.id) {
            const linkKey = [String(sId), String(tId)].sort().join('--');
            maxSev = getMaxSeverity(maxSev, mockLinkAlarms[linkKey] || 'normal');
          }
        });
      });
    }
    
    if (n.isInterfaceNode) {
      graphData.links.forEach(l => {
        const sId = l.source?.id || l.source;
        const tId = l.target?.id || l.target;
        if (sId === n.id || tId === n.id) {
          const linkKey = [String(sId), String(tId)].sort().join('--');
          maxSev = getMaxSeverity(maxSev, mockLinkAlarms[linkKey] || 'normal');
        }
      });
    }
    
    return maxSev;
  };

  
  const subDevices = useMemo(() => {
    if (!node.isGroupNode) return [];
    return graphData.nodes.filter(n => n.deviceGroupId === node.deviceGroupId && n.isDeviceNode);
  }, [node, graphData]);

  const ringNames = useMemo(() => {
    if (!node.isGroupNode || !node.deviceGroupId) return [];
    return RINGS.filter(r => r.groups.includes(node.deviceGroupId!)).map(r => r.name);
  }, [node]);

  const subInterfaces = useMemo(() => {
    if (!node.isDeviceNode) return [];
    return graphData.nodes.filter(n => n.parentDeviceId === node.id && n.isInterfaceNode);
  }, [node, graphData]);

  const externalLinks = useMemo(() => {
    if (!graphData) return [];
    
    return graphData.links.filter(l => {
      const sDevId = (l as any).originalSource;
      const tDevId = (l as any).originalTarget;
      
      if (node.isGroupNode) {
        const sNode = graphData.nodes.find(n => n.id === sDevId);
        const tNode = graphData.nodes.find(n => n.id === tDevId);
        if (!sNode || !tNode) return false;
        
        const sInGroup = sNode.deviceGroupId === node.deviceGroupId;
        const tInGroup = tNode.deviceGroupId === node.deviceGroupId;
        return (sInGroup || tInGroup) && (sInGroup !== tInGroup);
      } else if (node.isDeviceNode) {
        return (sDevId === node.id || tDevId === node.id) && (sDevId !== tDevId);
      } else if (node.isInterfaceNode) {
        const sIntf = typeof l.source === 'object' ? l.source.id : l.source;
        const tIntf = typeof l.target === 'object' ? l.target.id : l.target;
        return sIntf === node.id || tIntf === node.id;
      }
      return false;
    }).map(l => {
      let otherNodeId: string;
      let bandwidth = (l as any).totalBandWidth || 0;
      
      const sDevId = (l as any).originalSource;
      const tDevId = (l as any).originalTarget;
      
      if (node.isGroupNode) {
        const sNode = graphData.nodes.find(n => n.id === sDevId);
        otherNodeId = sNode?.deviceGroupId === node.deviceGroupId ? tDevId : sDevId;
      } else if (node.isDeviceNode) {
        otherNodeId = sDevId === node.id ? tDevId : sDevId;
      } else {
        const sIntf = typeof l.source === 'object' ? l.source.id : l.source;
        const tIntf = typeof l.target === 'object' ? l.target.id : l.target;
        otherNodeId = sIntf === node.id ? tIntf : sIntf;
      }
      
      const otherNode = graphData.nodes.find(n => n.id === otherNodeId);
      return { link: l, otherNode, bandwidth };
    }).filter(item => item.otherNode);
    
  }, [node, graphData]);

  // Common Header
  const title = node.label.split('\n')[1] || node.label.split('\n')[0];
  const nodeSeverity = getActualSeverity(node);
  const groupLabel = node.groupName || groupsMetadata[node.deviceGroupId!] || getGroupName(node.group);

  return (
    <aside className="w-[400px] absolute right-0 top-0 bottom-0 bg-[#161920] border-l border-[#2d3748] flex flex-col animate-in slide-in-from-right duration-300 z-50 shadow-2xl">
      
      {/* Header with Close Button */}
      <div className="p-4 border-b border-[#2d3748] bg-[#1a202c] flex justify-between items-start">
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            {node.isGroupNode ? '그룹 정보' : (node.isDeviceNode ? '장비 정보' : '인터페이스 정보')}
          </h2>
          <div className="flex items-center mt-1">
            <p className="text-lg font-bold text-white">{title}</p>
            <SeverityBadge severity={nodeSeverity} />
          </div>
          {!node.isGroupNode && <p className="text-xs text-blue-400">{groupLabel}</p>}
          
          {nodeSeverity && nodeSeverity !== 'normal' && (
            <div
              className="px-3 py-2 rounded-r-md mt-3 text-left w-full"
              style={{
                background: `${SEVERITY_COLORS[nodeSeverity]?.color || '#f97316'}1A`,
                borderLeft: `3px solid ${SEVERITY_COLORS[nodeSeverity]?.color || '#f97316'}`
              }}
            >
              <div className="text-[10px] font-bold uppercase mb-0.5 tracking-wider" style={{ color: SEVERITY_COLORS[nodeSeverity]?.color || '#f97316' }}>
                {nodeSeverity} (알람)
              </div>
              <div className="text-[11px] font-medium text-slate-300 leading-tight">
                {ALARM_CAUSES[node.id] || '시스템 자원 임계치 초과 또는 통신 포트 상태 이상 감지'}
              </div>
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white bg-[#2d3748]/50 hover:bg-[#2d3748] rounded transition-colors cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-6">
        
        {/* 요약 정보 (IP, 그룹명 등) */}
        <section>
          <h3 className="text-sm font-bold text-gray-300 mb-4 tracking-wide">요약 정보</h3>
          <div className="space-y-2">
            {!node.isGroupNode && node.ipAddr && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">IP 주소</span>
                <span className="text-xs font-mono text-cyan-400">{node.ipAddr}</span>
              </div>
            )}
            {!node.isGroupNode && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">소속 그룹</span>
                <span className="text-xs font-mono text-gray-300">{groupLabel}</span>
              </div>
            )}
            {node.isGroupNode && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">하위 장비 수</span>
                <span className="text-xs font-mono text-gray-300">{subDevices.length}개</span>
              </div>
            )}
            {node.isGroupNode && ringNames.length > 0 && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">소속 링</span>
                <span className="text-xs font-bold text-purple-400">{ringNames.join(', ')}</span>
              </div>
            )}
            {node.isDeviceNode && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">하위 포트(인터페이스) 수</span>
                <span className="text-xs font-mono text-gray-300">{subInterfaces.length}개</span>
              </div>
            )}
          </div>
        </section>

        {/* Group Node: Sub-devices list */}
        {node.isGroupNode && subDevices.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-300 mb-4 tracking-wide">하위 장비 리스트</h3>
            <div className="space-y-2">
              {subDevices.map(dev => {
                const devLinks = graphData.links.filter(link => {
                  if (link.isHierarchyLink) return false;
                  const sDevId = (link as any).originalSource;
                  const tDevId = (link as any).originalTarget;
                  return sDevId === dev.id || tDevId === dev.id;
                }).map(link => ({ link }));

                const isExpanded = expandedIds.has(dev.id);

                return (
                  <div 
                    key={dev.id} 
                    className="bg-[#0a0b0e] border border-[#2d3748] rounded flex flex-col overflow-hidden"
                    onMouseEnter={() => onNodeHover && onNodeHover(dev)}
                    onMouseLeave={() => onNodeHover && onNodeHover(null)}
                  >
                    <div 
                      className={`flex items-center justify-between p-2 transition-colors ${devLinks.length > 0 ? 'cursor-pointer hover:bg-[#1a202c]' : ''} ${isExpanded ? 'bg-[#1a1f2e]' : ''}`}
                      onClick={(e) => devLinks.length > 0 && toggleExpand(dev.id, e)}
                    >
                      <div className="flex items-center flex-1">
                        <Server className="w-3.5 h-3.5 text-blue-400 mr-2 shrink-0" />
                        <div 
                          className="flex flex-col items-start cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNodeClick && onNodeClick(dev);
                          }}
                          title="해당 장비로 이동"
                        >
                          <div className="flex items-center">
                            <p className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">{dev.label.split('\n')[1] || dev.label.split('\n')[0]}</p>
                            <SeverityBadge severity={getActualSeverity(dev)} />
                          </div>
                          {dev.ipAddr && <p className="text-[10px] text-gray-500 font-mono mt-0.5 group-hover:text-blue-300/70 transition-colors">{dev.ipAddr}</p>}
                        </div>
                      </div>
                      {devLinks.length > 0 && (
                        <div className="p-1.5 text-white/70 shrink-0 ml-2">
                          {isExpanded ? <ChevronUp className="w-5 h-5 stroke-[2.5]" /> : <ChevronDown className="w-5 h-5 stroke-[2.5]" />}
                        </div>
                      )}
                    </div>
                    
                    {isExpanded && devLinks.length > 0 && (
                      <div className="px-2 pt-2 pb-2 text-[11px]">
                        {devLinks.map(({ link }, idx) => {
                          const srcDevName = (link as any).srcDeviceName || '';
                          const srcIntfName = (link as any).srcInterfaceName || '';
                          const dstDevName = (link as any).dstDeviceName || '';
                          const dstIntfName = (link as any).dstInterfaceName || '';
                          const total = (link as any).totalBandWidth || 0;
                          const traffic = (link as any).traffic || 0;
                          const avail = Math.max(0, total - traffic);
                          const usage = (link as any).usage || 0;
                          const isSrcSelf = (link as any).originalSource === dev.id;
                          
                          return (
                            <div key={idx} className="pb-2.5 mb-2.5 last:mb-0 last:pb-0 border-b border-[#2d3748]/50 last:border-0">
                              <div className="flex items-center flex-wrap font-bold">
                                <span className={isSrcSelf ? 'text-gray-300' : 'text-cyan-300'}>{srcDevName}</span>
                                <span className="text-gray-400 font-normal ml-1.5">{srcIntfName}</span>
                                <span className="text-green-500 mx-2 text-[10px]">↔</span>
                                <span className={isSrcSelf ? 'text-cyan-300' : 'text-gray-300'}>{dstDevName}</span>
                                <span className="text-gray-400 font-normal ml-1.5">{dstIntfName}</span>
                              </div>
                              <div className="flex items-center justify-between text-gray-400 mt-1">
                                <span>총 대역폭 <span className="text-gray-200 font-mono font-bold">{total.toFixed(1)} Gbps</span></span>
                                <div className="flex items-center space-x-1.5">
                                  <span>사용률</span>
                                  <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, usage))}%`, background: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }} />
                                  </div>
                                  <span className="font-mono font-bold" style={{ color: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }}>{usage.toFixed(1)}%</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2 text-gray-400 mt-0.5">
                                <span>사용대역폭 <span className="text-emerald-400 font-mono font-bold">{traffic.toFixed(1)} Gbps</span></span>
                                <span>/</span>
                                <span>가용대역폭 <span className="text-green-500 font-mono font-bold">{avail.toFixed(1)} Gbps</span></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Device Node: Sub-interfaces list */}
        {node.isDeviceNode && subInterfaces.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-300 mb-4 tracking-wide">하위 포트 (인터페이스) 정보</h3>
            <div className="space-y-2">
              {subInterfaces.map(inf => {
                const infLinkObj = externalLinks.find(({ link }) => {
                  const sIntf = typeof (link as any).source === 'object' ? (link as any).source.id : (link as any).source;
                  const tIntf = typeof (link as any).target === 'object' ? (link as any).target.id : (link as any).target;
                  return sIntf === inf.id || tIntf === inf.id;
                });

                const isExpanded = expandedIds.has(inf.id);

                return (
                  <div 
                    key={inf.id} 
                    className="bg-[#0a0b0e] border border-[#2d3748] rounded flex flex-col overflow-hidden"
                    onMouseEnter={() => onNodeHover && onNodeHover(inf)}
                    onMouseLeave={() => onNodeHover && onNodeHover(null)}
                  >
                    <div 
                      className={`flex items-center justify-between p-2 transition-colors ${infLinkObj ? 'cursor-pointer hover:bg-[#1a202c]' : ''} ${isExpanded ? 'bg-[#1a1f2e]' : ''}`}
                      onClick={(e) => infLinkObj && toggleExpand(inf.id, e)}
                    >
                      <div className="flex items-center flex-1">
                        <Network className="w-3.5 h-3.5 text-green-400 mr-2 shrink-0" />
                        <div 
                          className="flex flex-col items-start cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNodeClick && onNodeClick(inf);
                          }}
                          title="해당 포트로 이동"
                        >
                          <div className="flex items-center">
                            <p className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">{inf.interfaceName || inf.label}</p>
                            <SeverityBadge severity={getActualSeverity(inf)} />
                          </div>
                          {inf.ipAddr && <p className="text-[10px] text-gray-500 font-mono mt-0.5 group-hover:text-blue-300/70 transition-colors">{inf.ipAddr}</p>}
                        </div>
                      </div>
                      {infLinkObj && (
                        <div className="p-1.5 text-white/70 shrink-0 ml-2">
                          {isExpanded ? <ChevronUp className="w-5 h-5 stroke-[2.5]" /> : <ChevronDown className="w-5 h-5 stroke-[2.5]" />}
                        </div>
                      )}
                    </div>

                    {isExpanded && infLinkObj && (() => {
                      const link = infLinkObj.link;
                      const srcDevName = (link as any).srcDeviceName || '';
                      const srcIntfName = (link as any).srcInterfaceName || '';
                      const dstDevName = (link as any).dstDeviceName || '';
                      const dstIntfName = (link as any).dstInterfaceName || '';
                      
                      const total = (link as any).totalBandWidth || 0;
                      const traffic = (link as any).traffic || 0;
                      const avail = Math.max(0, total - traffic);
                      const usage = (link as any).usage || 0;

                      const isSrcSelf = (link as any).originalSource === node.id;

                      return (
                        <div className="px-3 py-2 text-[11px]">
                          <div className="flex items-center font-bold mb-1.5 flex-wrap">
                            <span className={isSrcSelf ? 'text-gray-300' : 'text-cyan-300'}>{srcDevName}</span>
                            <span className="text-gray-400 font-normal ml-1.5">{srcIntfName}</span>
                            <span className="text-green-500 mx-2 text-[10px]">↔</span>
                            <span className={isSrcSelf ? 'text-cyan-300' : 'text-gray-300'}>{dstDevName}</span>
                            <span className="text-gray-400 font-normal ml-1.5">{dstIntfName}</span>
                          </div>
                          
                          <div className="flex items-center justify-between text-gray-400">
                            <span>총 대역폭 <span className="text-gray-200 font-mono font-bold">{total.toFixed(1)} Gbps</span></span>
                            <div className="flex items-center space-x-1.5">
                              <span>사용률</span>
                              <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, usage))}%`, background: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }} />
                              </div>
                              <span className="font-mono font-bold" style={{ color: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }}>{usage.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 text-gray-400 mt-0.5">
                            <span>사용대역폭 <span className="text-emerald-400 font-mono font-bold">{traffic.toFixed(1)} Gbps</span></span>
                            <span>/</span>
                            <span>가용대역폭 <span className="text-green-500 font-mono font-bold">{avail.toFixed(1)} Gbps</span></span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Connected External Systems */}
        {(!node.isGroupNode && node.isInterfaceNode) && externalLinks.length > 0 && (
          <section>
            <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wide">
              NETWORK LINK
            </h3>
            <div className="space-y-0 text-[11px]">
              {externalLinks.map(({ link }, idx) => {
                const srcDevName = (link as any).srcDeviceName || '';
                const srcIntfName = (link as any).srcInterfaceName || '';
                const dstDevName = (link as any).dstDeviceName || '';
                const dstIntfName = (link as any).dstInterfaceName || '';
                
                const total = (link as any).totalBandWidth || 0;
                const traffic = (link as any).traffic || 0;
                const avail = Math.max(0, total - traffic);
                const usage = (link as any).usage || 0;

                return (
                  <div key={idx} className="py-3 first:pt-0 border-b border-[#2d3748] last:border-0 flex flex-col space-y-2.5">
                    
                    {/* 상단: 장비 및 인터페이스명 */}
                    <div className="flex items-center font-bold text-[11px] flex-wrap">
                      {(() => {
                        const isSrcSelf = (link as any).originalSource === node.parentDeviceId;
                        return <>
                      <div className="flex items-center">
                        <span className={isSrcSelf ? 'text-gray-300' : 'text-cyan-300'}>{srcDevName}</span>
                        {(() => {
                          const srcId = (link as any).source?.id || (link as any).source;
                          const tgtId = (link as any).target?.id || (link as any).target;
                          const linkKey = [String(srcId), String(tgtId)].sort().join('--');
                          const sev = (link as any).srcSeverity || (link as any).severity || mockLinkAlarms[linkKey];
                          return <SeverityBadge severity={sev} />;
                        })()}
                      </div>
                      <span className="text-gray-400 font-normal ml-1.5">{srcIntfName}</span>
                      <span className="text-green-500 mx-2 text-[10px]">↔</span>
                      <div className="flex items-center">
                        <span className={isSrcSelf ? 'text-cyan-300' : 'text-gray-300'}>{dstDevName}</span>
                        {(() => {
                          const srcId = (link as any).source?.id || (link as any).source;
                          const tgtId = (link as any).target?.id || (link as any).target;
                          const linkKey = [String(srcId), String(tgtId)].sort().join('--');
                          const sev = (link as any).dstSeverity || (link as any).severity || mockLinkAlarms[linkKey];
                          return <SeverityBadge severity={sev} />;
                        })()}
                      </div>
                      <span className="text-gray-400 font-normal ml-1.5">{dstIntfName}</span>
                      </>;
                      })()}
                    </div>
                    
                    {/* 중단/하단: 대역폭 및 사용률 정보 */}
                    <div className="w-full flex flex-col space-y-1 mt-1">
                      <div className="flex items-center justify-between text-[11px] text-gray-400 w-full">
                        <span>총 대역폭 <span className="text-gray-200 font-mono font-bold">{total.toFixed(1)} Gbps</span></span>
                        <div className="flex items-center space-x-1.5">
                          <span>사용률</span>
                          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, usage))}%`, background: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }} />
                          </div>
                          <span className="font-mono font-bold" style={{ color: usage > 80 ? '#ef4444' : usage > 50 ? '#f59e0b' : '#34d399' }}>{usage.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 text-[11px] text-gray-400 w-full">
                        <span>사용대역폭 <span className="text-emerald-400 font-mono font-bold">{traffic.toFixed(1)} Gbps</span></span>
                        <span>/</span>
                        <span>가용대역폭 <span className="text-green-500 font-mono font-bold">{avail.toFixed(1)} Gbps</span></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
      

    </aside>
  );
};
