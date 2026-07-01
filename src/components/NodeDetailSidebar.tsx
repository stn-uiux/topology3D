import React, { useMemo } from 'react';
import { ChevronRight, X, Activity, Server, Network } from 'lucide-react';
import { GraphNode, GraphData, groupsMetadata, RINGS } from '../data';
import { mockNodeAlarms, mockLinkAlarms, getMaxSeverity, ALARM_CAUSES } from './NetworkGraph';

interface NodeDetailSidebarProps {
  node: GraphNode;
  onClose: () => void;
  onNodeClick?: (node: GraphNode) => void;
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

export const NodeDetailSidebar: React.FC<NodeDetailSidebarProps> = ({ node, onClose, onNodeClick, graphData }) => {

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

  const ringName = useMemo(() => {
    if (!node.isGroupNode || !node.deviceGroupId) return null;
    const ring = RINGS.find(r => r.groups.includes(node.deviceGroupId!));
    return ring ? ring.name : null;
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
          <p className="text-xs text-blue-400">{groupLabel}</p>
          
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
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white bg-[#2d3748]/50 hover:bg-[#2d3748] rounded transition-colors">
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
            {node.isGroupNode && ringName && (
              <div className="flex justify-between border-b border-gray-800 pb-1.5">
                <span className="text-xs text-gray-500">소속 링</span>
                <span className="text-xs font-bold text-purple-400">{ringName}</span>
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
              {subDevices.map(dev => (
                <div key={dev.id} className="p-2 bg-[#0a0b0e] border border-[#2d3748] rounded flex items-center justify-between">
                  <div className="flex items-center">
                    <Server className="w-3.5 h-3.5 text-blue-400 mr-2" />
                    <div>
                      <div className="flex items-center">
                        <p className="text-xs font-bold text-white">{dev.label.split('\n')[1] || dev.label.split('\n')[0]}</p>
                        <SeverityBadge severity={getActualSeverity(dev)} />
                      </div>
                      {dev.ipAddr && <p className="text-[10px] text-gray-500 font-mono">{dev.ipAddr}</p>}
                    </div>
                  </div>
                  {onNodeClick && (
                    <button 
                      onClick={() => onNodeClick(dev)}
                      className="p-1.5 text-white/70 hover:text-white bg-transparent rounded transition-colors cursor-pointer"
                      title="해당 장비로 이동"
                    >
                      <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                    </button>
                  )}
                </div>
              ))}
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

                return (
                  <div key={inf.id} className="bg-[#0a0b0e] border border-[#2d3748] rounded flex flex-col overflow-hidden">
                    <div className="p-2 flex items-center justify-between">
                      <div className="flex items-center">
                        <Network className="w-3.5 h-3.5 text-green-400 mr-2" />
                        <div>
                          <div className="flex items-center">
                            <p className="text-xs font-bold text-white">{inf.interfaceName || inf.label}</p>
                            <SeverityBadge severity={getActualSeverity(inf)} />
                          </div>
                          {inf.ipAddr && <p className="text-[10px] text-gray-500 font-mono">{inf.ipAddr}</p>}
                        </div>
                      </div>
                      {onNodeClick && (
                        <button 
                          onClick={() => onNodeClick(inf)}
                          className="p-1.5 text-white/70 hover:text-white bg-transparent rounded transition-colors cursor-pointer shrink-0"
                          title="해당 포트로 이동"
                        >
                          <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                        </button>
                      )}
                    </div>

                    {infLinkObj && (() => {
                      const link = infLinkObj.link;
                      const srcDevName = (link as any).srcDeviceName || '';
                      const srcIntfName = (link as any).srcInterfaceName || '';
                      const dstDevName = (link as any).dstDeviceName || '';
                      const dstIntfName = (link as any).dstInterfaceName || '';
                      
                      const total = (link as any).totalBandWidth || 0;
                      const traffic = (link as any).traffic || 0;
                      const avail = Math.max(0, total - traffic);
                      const usage = (link as any).usage || 0;

                      return (
                        <div className="px-3 py-2.5 border-t border-[#2d3748] bg-[#11141b] flex flex-col space-y-2">
                          <div className="flex items-center text-blue-400 font-bold text-[10px] flex-wrap">
                            <div className="flex items-center">
                              <span>{srcDevName}</span>
                              {(() => {
                                const srcId = (link as any).source?.id || (link as any).source;
                                const tgtId = (link as any).target?.id || (link as any).target;
                                const linkKey = [String(srcId), String(tgtId)].sort().join('--');
                                const sev = (link as any).srcSeverity || (link as any).severity || mockLinkAlarms[linkKey];
                                return <SeverityBadge severity={sev} />;
                              })()}
                            </div>
                            <span className="text-gray-400 font-normal ml-1.5">{srcIntfName}</span>
                            <span className="text-green-500 mx-1.5 text-[9px]">↔</span>
                            <div className="flex items-center">
                              <span>{dstDevName}</span>
                              {(() => {
                                const srcId = (link as any).source?.id || (link as any).source;
                                const tgtId = (link as any).target?.id || (link as any).target;
                                const linkKey = [String(srcId), String(tgtId)].sort().join('--');
                                const sev = (link as any).dstSeverity || (link as any).severity || mockLinkAlarms[linkKey];
                                return <SeverityBadge severity={sev} />;
                              })()}
                            </div>
                            <span className="text-gray-400 font-normal ml-1.5">{dstIntfName}</span>
                          </div>
                          
                          <div className="w-full flex flex-col space-y-1 mt-0.5">
                            <div className="flex items-center justify-between text-[10px] text-gray-400 w-full">
                              <span>총 대역폭 <span className="text-gray-200 font-mono font-bold">{total.toFixed(1)} Gbps</span></span>
                              <div className="flex items-center space-x-1.5 shrink-0 text-gray-500 justify-end">
                                <span>사용률</span>
                                <div className="w-10 h-1 bg-gray-800 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-emerald-400 rounded-full" 
                                    style={{ width: `${Math.min(100, Math.max(0, usage))}%` }} 
                                  />
                                </div>
                                <span className="text-emerald-400 font-mono font-bold min-w-[32px] text-right">{usage.toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2 text-[10px] text-gray-400 w-full">
                              <span>사용대역폭 <span className="text-emerald-400 font-mono font-bold">{traffic.toFixed(1)} Gbps</span></span>
                              <span className="text-gray-600">/</span>
                              <span>가용대역폭 <span className="text-emerald-400 font-mono font-bold">{avail.toFixed(1)} Gbps</span></span>
                            </div>
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
        {(node.isGroupNode || node.isInterfaceNode) && externalLinks.length > 0 && (
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
                    <div className="flex items-center text-blue-400 font-bold text-[11px] flex-wrap">
                      <div className="flex items-center">
                        <span>{srcDevName}</span>
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
                        <span>{dstDevName}</span>
                        {(() => {
                          const srcId = (link as any).source?.id || (link as any).source;
                          const tgtId = (link as any).target?.id || (link as any).target;
                          const linkKey = [String(srcId), String(tgtId)].sort().join('--');
                          const sev = (link as any).dstSeverity || (link as any).severity || mockLinkAlarms[linkKey];
                          return <SeverityBadge severity={sev} />;
                        })()}
                      </div>
                      <span className="text-gray-400 font-normal ml-1.5">{dstIntfName}</span>
                    </div>
                    
                    {/* 중단/하단: 대역폭 및 사용률 정보 */}
                    <div className="w-full flex flex-col space-y-1 mt-1">
                      {/* 총 대역폭 & 사용률 (우측정렬) */}
                      <div className="flex items-center justify-between text-[11px] text-gray-400 w-full">
                        <span>총 대역폭 <span className="text-gray-200 font-mono font-bold">{total.toFixed(1)} Gbps</span></span>
                        
                        <div className="flex items-center space-x-1.5 shrink-0 text-gray-500 justify-end">
                          <span>사용률</span>
                          <div className="w-12 h-1 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-emerald-400 rounded-full" 
                              style={{ width: `${Math.min(100, Math.max(0, usage))}%` }} 
                            />
                          </div>
                          <span className="text-emerald-400 font-mono font-bold min-w-[36px] text-right">{usage.toFixed(1)}%</span>
                        </div>
                      </div>
                      
                      {/* 사용대역폭 / 가용대역폭 */}
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
      
      {/* Footer Action */}
      <div className="p-4 border-t border-[#2d3748] bg-[#1a202c]">
        <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-semibold transition-colors shadow-lg shadow-blue-500/20">
          경로 추적
        </button>
      </div>
    </aside>
  );
};
