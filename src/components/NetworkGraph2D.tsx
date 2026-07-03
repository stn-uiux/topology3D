import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  ReactFlowProvider,
  NodeProps,
  useReactFlow,
  useStore,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GraphData, GraphNode, groupsMetadata } from '../data';
import { getLayoutedElements } from '../utils/layoutUtils';
import { Box, Server, Monitor } from 'lucide-react';
import { mockNodeAlarms, mockLinkAlarms, getMaxSeverity } from './NetworkGraph';

interface NetworkGraph2DProps {
  data: GraphData;
  onNodeClick: (node: GraphNode | null) => void;
  onEdgeClick?: (edge: any) => void;
  onEdgeDoubleClick?: (edge: any) => void;
  highlightNodes: Set<string>;
  highlightLinks?: Set<any>;
  highlightVersion?: number;
  isDimmedState: boolean;
  pathHighlight?: any;
  onNodeContextMenu?: (event: React.MouseEvent, node: any) => void;
  onBackgroundClick?: () => void;
  activeNodeId?: string | null;
  onNodeHover?: (node: any) => void;
  isHovering?: boolean;
  getNodeLabel?: (node: any) => string;
}

const SEVERITY_COLORS: Record<string, { color: string, ringColor: string }> = {
  critical: { color: '#ef4444', ringColor: 'rgba(239, 68, 68, 0.4)' },
  major: { color: '#f97316', ringColor: 'rgba(249, 115, 22, 0.4)' },
  minor: { color: '#eab308', ringColor: 'rgba(234, 179, 8, 0.4)' },
  warning: { color: '#06b6d4', ringColor: 'rgba(6, 182, 212, 0.4)' },
  normal: { color: '#22c55e', ringColor: 'rgba(34, 197, 94, 0.2)' }
};

// --- Custom Nodes ---

const GroupNode = memo(({ data }: any) => {
  const severity = data.rawNode?.severity || 'normal';
  const hasAlarm = severity !== 'normal' && !data.isDimmed;
  const alarmColor = SEVERITY_COLORS[severity]?.color;
  const alarmRingColor = SEVERITY_COLORS[severity]?.ringColor;

  return (
    <div
      className="w-full h-full border-dashed rounded-[12px] relative overflow-hidden"
      onMouseEnter={(e) => {
        if (data.onLocalHover) data.onLocalHover(data.rawNode);
      }}
      onMouseLeave={(e) => {
        if (data.onLocalHover) data.onLocalHover(null);
      }}
      style={{
        borderWidth: data.isActiveNode ? '4px' : '2px',
        borderStyle: data.isDirectlySelected ? 'dashed' : (data.isActiveNode ? 'solid' : 'dashed'),
        borderColor: data.isDirectlySelected ? '#06b6d4' : (data.isActiveNode ? '#4ade80' : (hasAlarm ? alarmColor : (data.isDimmed ? '#1f2937' : '#475569'))),
        backgroundColor: hasAlarm ? alarmRingColor : (data.isDimmed ? '#0b0e14' : 'rgba(15,23,42,0.4)'),
        boxShadow: data.isDirectlySelected
          ? '0 0 20px 5px rgba(6,182,212,0.4), inset 0 0 15px rgba(6,182,212,0.3)'
          : (data.isActiveNode
            ? '0 0 20px 5px rgba(74,222,128,0.4), inset 0 0 15px rgba(74,222,128,0.3)'
            : (hasAlarm ? `0 0 15px ${alarmRingColor}, inset 0 0 20px ${alarmRingColor}` : 'none')),
        opacity: data.isDimmed && !data.isActiveNode ? (hasAlarm ? 0.2 : 0.3) : 1
      }}>
      {/* Label container floating at top-left */}
      <div 
        className="absolute top-0 left-0 p-3 z-10 cursor-pointer"
      >
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-[6px] flex items-center justify-center text-white shadow-md"
            style={{
              backgroundColor: hasAlarm ? alarmColor : (data.isDimmed ? '#374151' : '#0891b2')
            }}>
            <Box className="w-4 h-4" />
          </div>
          <span className={`text-[16px] font-bold tracking-wide ${data.isDimmed && !hasAlarm ? 'text-gray-500' : 'text-[#f8fafc]'}`}>
            {data.label}
          </span>
          {data.isSrc && (
            <span className="bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md">
              SRC
            </span>
          )}
          {data.isDst && (
            <span className="bg-purple-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md">
              DST
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

const DeviceNode = memo(({ data, isConnectable }: any) => {
  const topInterfaces = (data.interfaces || []).filter((i: any) => i.direction === 'target');
  const bottomInterfaces = (data.interfaces || []).filter((i: any) => i.direction === 'source');
  const formattedLabel = data.label || '';
  const ipAddr = data.rawNode?.ipAddr;
  const severity = data.rawNode?.severity || 'normal';
  const hasAlarm = severity !== 'normal' && !data.isDimmed;
  const alarmColor = SEVERITY_COLORS[severity]?.color;
  const alarmRingColor = SEVERITY_COLORS[severity]?.ringColor;

  return (
    <div
      className="relative w-[180px] h-[48px] border rounded-[8px] flex items-center px-1.5 py-1 shadow-md"
      onMouseEnter={(e) => {
        if (data.onLocalHover) {
          data.onLocalHover(data.rawNode);
        }
      }}
      onMouseLeave={(e) => {
        if (data.onLocalHover) data.onLocalHover(null);
      }}
      style={{
        borderWidth: data.isActiveNode ? '3px' : (hasAlarm ? '2px' : '1px'),
        borderStyle: 'solid',
        borderColor: data.isDirectlySelected ? '#4ade80' : (data.isActiveNode ? '#4ade80' : (hasAlarm ? alarmColor : (data.isDimmed ? '#1f2937' : 'rgba(59,130,246,0.4)'))),
        background: hasAlarm
          ? '#1e293b'
          : (data.isDimmed && !data.isActiveNode
            ? '#161920'
            : 'radial-gradient(circle at 85% 100%, rgba(59, 130, 246, 0.4) 0%, transparent 40%), #1e293b'),
        boxShadow: data.isDirectlySelected
          ? '0 0 15px 4px rgba(74,222,128,0.6), inset 0 0 10px rgba(74,222,128,0.3)'
          : (data.isActiveNode
            ? '0 0 15px 4px rgba(74,222,128,0.6), inset 0 0 10px rgba(74,222,128,0.3)'
            : (hasAlarm ? `0 0 25px 8px ${alarmRingColor}, 0 0 10px 2px ${alarmColor}` : (data.isDimmed ? 'none' : '0 4px 6px -1px rgba(59,130,246,0.1)'))),
        opacity: data.isDimmed && !data.isActiveNode ? (hasAlarm ? 0.2 : 0.5) : 1,
      }}>
      
      {/* SRC/DST Badges */}
      {data.isSrc && (
        <div className="absolute -top-3 -right-2 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md z-20">
          SRC
        </div>
      )}
      {data.isDst && (
        <div className="absolute -top-3 -right-2 bg-purple-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md z-20">
          DST
        </div>
      )}

      {/* Alarm Background Pulse */}
      {hasAlarm && (
        <div
          className="absolute inset-0 pointer-events-none rounded-[6px] animate-pulse-alarm-bg"
          style={{
            background: `radial-gradient(circle at 85% 100%, ${alarmColor}CC 0%, transparent 85%)`,
            zIndex: 0
          }}
        />
      )}
      {/* Top Handles (Target) */}
      {topInterfaces.map((iface: any, idx: number) => {
        const leftPercent = ((idx + 1) * 100) / (topInterfaces.length + 1);
        const ifaceSeverity = iface.severity || 'normal';
        const ifaceHasAlarm = ifaceSeverity !== 'normal' && !iface.isDimmed;
        return (
          <React.Fragment key={iface.id}>
            {ifaceHasAlarm && (
              <div
                className="absolute rounded-full pointer-events-none animate-pulse-blur-top"
                style={{
                  left: `${leftPercent}%`,
                  top: '-4.5px',
                  width: '8px',
                  height: '8px',
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: SEVERITY_COLORS[ifaceSeverity]?.color,
                  filter: 'blur(3px)',
                  zIndex: 0,
                }}
              />
            )}
            <Handle
              key={`handle-${iface.id}`}
              type="target"
              id={iface.id}
              position={Position.Top}
              onClickCapture={(e) => {
                e.stopPropagation();
                if (data.onPortClick) data.onPortClick(iface.id);
              }}
              onMouseEnter={(e) => {
                if (data.onLocalHover && iface.rawNode) data.onLocalHover(iface.rawNode);
              }}
              onMouseLeave={(e) => {
                // Restore device hover since we left the port but might still be on device
                if (data.onLocalHover) data.onLocalHover(data.rawNode);
              }}
              className="!border-none !rounded-full z-10 !cursor-crosshair"
              style={{
                left: `${leftPercent}%`,
                top: iface.isDimmed && !ifaceHasAlarm ? '-4px' : '-4.5px',
                backgroundColor: ifaceHasAlarm ? SEVERITY_COLORS[ifaceSeverity]?.color : (iface.isDimmed ? '#4b5563' : '#ffffff'),
                boxShadow: ifaceHasAlarm || iface.isDimmed ? 'none' : '0 0 4px 1.5px #4ade80, 0 0 8px 3px rgba(74,222,128,0.2)',
              }}
            />
          </React.Fragment>
        );
      })}

      {/* Left Icon Block */}
      <div className="relative z-10 w-9 h-9 rounded-[6px] flex-shrink-0 flex items-center justify-center text-white shadow-sm mr-2.5"
        style={{
          backgroundColor: hasAlarm ? alarmColor : (data.isDimmed ? '#374151' : '#2563eb')
        }}>
        <Server className="w-5 h-5" />
      </div>

      {/* Right Text Block */}
      <div className="relative z-10 flex flex-col justify-center overflow-hidden w-full">
        <span className={`text-[12px] font-bold truncate ${data.isDimmed ? 'text-gray-500' : 'text-[#f8fafc]'}`}>
          {formattedLabel}
        </span>
        {ipAddr && (
          <span className={`text-[9px] truncate font-medium ${data.isDimmed ? 'text-gray-600' : 'text-[#93c5fd] opacity-90'}`}>
            {ipAddr}
          </span>
        )}
      </div>

      {/* Bottom Handles (Source) */}
      {bottomInterfaces.map((iface: any, idx: number) => {
        const leftPercent = ((idx + 1) * 100) / (bottomInterfaces.length + 1);
        const ifaceSeverity = iface.severity || 'normal';
        const ifaceHasAlarm = ifaceSeverity !== 'normal' && !iface.isDimmed;
        return (
          <React.Fragment key={iface.id}>
            {ifaceHasAlarm && (
              <div
                className="absolute rounded-full pointer-events-none animate-pulse-blur-bottom"
                style={{
                  left: `${leftPercent}%`,
                  bottom: '-4.5px',
                  width: '8px',
                  height: '8px',
                  transform: 'translate(-50%, 50%)', /* Since it's bottom anchored, positive Y translation centers it */
                  backgroundColor: SEVERITY_COLORS[ifaceSeverity]?.color,
                  filter: 'blur(3px)',
                  zIndex: 0,
                }}
              />
            )}
            <Handle
              key={`handle-${iface.id}`}
              type="source"
              id={iface.id}
              position={Position.Bottom}
              onClickCapture={(e) => {
                e.stopPropagation();
                if (data.onPortClick) data.onPortClick(iface.id);
              }}
              onMouseEnter={(e) => {
                if (data.onLocalHover && iface.rawNode) data.onLocalHover(iface.rawNode);
              }}
              onMouseLeave={(e) => {
                // Restore device hover since we left the port but might still be on device
                if (data.onLocalHover) data.onLocalHover(data.rawNode);
              }}
              className={`!border-none !rounded-full z-10 !cursor-crosshair ${iface.isDimmed && !ifaceHasAlarm ? '!w-[4px] !h-[4px]' : '!w-[5px] !h-[5px]'}`}
              style={{
                left: `${leftPercent}%`,
                bottom: iface.isDimmed && !ifaceHasAlarm ? '-4px' : '-4.5px',
                backgroundColor: ifaceHasAlarm ? SEVERITY_COLORS[ifaceSeverity]?.color : (iface.isDimmed ? '#4b5563' : '#ffffff'),
                boxShadow: ifaceHasAlarm || iface.isDimmed ? 'none' : '0 0 4px 1.5px #4ade80, 0 0 8px 3px rgba(74,222,128,0.2)',
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
});


// --- Tooltip Component ---
const TrafficTooltip = ({ edge, allEdges, allNodes, x, y }: { edge: any, allEdges?: any[], allNodes?: any[], x: number, y: number }) => {
  const link = edge.data?.rawLink;
  if (!link) return null;

  const getVisualNodeId = (nodeId: string) => {
    if (!allNodes) return nodeId;
    const n = allNodes.find(n => n.id === nodeId);
    return n?.parentId || nodeId;
  };

  const visualSource = getVisualNodeId(edge.source);
  const visualTarget = getVisualNodeId(edge.target);

  let edgesToRender = [edge];

  const formatBW = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)} Tbps`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)} Gbps`;
    return `${val.toLocaleString()} Mbps`;
  };

  const getUsageColor = (pct: number) => {
    if (pct >= 90) return '#ef4444';
    if (pct >= 70) return '#f97316';
    if (pct >= 50) return '#eab308';
    return '#10b981';
  };

  return (
    <div style={{
      position: 'fixed',
      left: x + 15,
      top: y + 15,
      zIndex: 9999,
      background: 'rgba(15, 18, 25, 0.95)',
      borderRadius: '10px',
      padding: '14px 16px',
      fontFamily: '"Inter", sans-serif',
      width: 'max-content',
      minWidth: '400px',
      maxHeight: '400px',
      overflowY: 'auto',
      color: '#cbd5e1',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.06)',
      pointerEvents: 'none',
    }}>
      <div style={{ fontSize: '9px', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
        NETWORK LINK
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {edgesToRender.map((e, index) => {
          const l = e.data?.rawLink;
          if (!l) return null;

          const sDevice = l.srcDeviceName || (typeof l.source === 'object' ? l.source.label : String(l.source));
          const sIntf = l.srcInterfaceName || '';
          const dDevice = l.dstDeviceName || (typeof l.target === 'object' ? l.target.label : String(l.target));
          const dIntf = l.dstInterfaceName || '';

          const totalBW = l.totalBandWidth || 0;
          const useBW = l.useBandWidth ?? l.traffic ?? 0;
          const availBW = l.availBandWidth ?? (totalBW - useBW);
          const usage = totalBW > 0 ? (useBW / totalBW) * 100 : 0;
          const usageColor = getUsageColor(usage);

          return (
            <div key={e.id} style={index > 0 ? { paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '8px' } : { marginBottom: '8px' }}>
              {/* Line 1: Ports */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                <span style={{ color: '#60a5fa' }} title={sDevice}>{sDevice}</span>
                <span style={{ color: '#94a3b8', fontSize: '10px' }}>{sIntf}</span>
                <span style={{ color: "#4ade80", fontSize: "12px" }}>→</span>
                <span style={{ color: '#60a5fa' }} title={dDevice}>{dDevice}</span>
                <span style={{ color: '#94a3b8', fontSize: '10px' }}>{dIntf}</span>
              </div>

              {/* Line 2: Bandwidth & Usage */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                <span>총 대역폭: <span style={{ color: "#f8fafc", fontWeight: 600 }}>{formatBW(totalBW)}</span></span>
                <span>/</span>
                <span>사용량: <span style={{ color: usageColor, fontWeight: 600 }}>{formatBW(useBW)}</span></span>
                <span>/</span>
                <span>가용 대역폭: <span style={{ color: "#4ade80", fontWeight: 600 }}>{formatBW(availBW)}</span></span>

                <span style={{ color: "#64748b", marginLeft: "4px" }}>사용률:</span>
                <div style={{ width: '50px', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, usage)}%`,
                    background: `linear-gradient(90deg, ${usageColor}88, ${usageColor})`,
                    borderRadius: '2px'
                  }}></div>
                </div>
                <span style={{ color: usageColor, fontWeight: 700 }}>{usage.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};



// --- Custom Zoom Controls ---
const CustomZoomControls = () => {
  const { zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const zoomPercent = Math.round(zoom * 100);

  return (
    <Panel
      position="bottom-right"
      style={{ right: 16, bottom: 16, margin: 0, width: 200, height: 32, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
      className="z-50 flex items-center justify-between bg-[#293250] border border-[#3b82f6]/40 rounded-[12px] px-4 shadow-2xl"
    >
      <button onClick={() => zoomOut()} className="text-white hover:text-blue-300 transition-colors flex items-center justify-center w-6 h-6">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
      <span className="text-[12px] font-bold text-white tracking-wider text-center">{zoomPercent}%</span>
      <button onClick={() => zoomIn()} className="text-white hover:text-blue-300 transition-colors flex items-center justify-center w-6 h-6">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
    </Panel>
  );
};

const nodeTypes = {
  groupNode: GroupNode,
  deviceNode: DeviceNode,
};

// --- Main Component ---

const NetworkGraph2DContent: React.FC<NetworkGraph2DProps> = ({
  data,
  onNodeClick,
  onEdgeClick,
  onEdgeDoubleClick,
  highlightNodes,
  highlightLinks,
  highlightVersion,
  isDimmedState,
  pathHighlight,
  onNodeContextMenu,
  onBackgroundClick,
  activeNodeId,
  onNodeHover,
  isHovering,
  getNodeLabel
}) => {
  const [localHoverNode, setLocalHoverNode] = useState<any>(null);
  const hoverTooltipRef = React.useRef<HTMLDivElement>(null);
  const mousePosRef = React.useRef({ x: 0, y: 0 });
  
  const onEdgeDoubleClickRef = React.useRef(onEdgeDoubleClick);
  useEffect(() => {
    onEdgeDoubleClickRef.current = onEdgeDoubleClick;
  }, [onEdgeDoubleClick]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      const tooltip = hoverTooltipRef.current;
      if (!tooltip) return;

      let offsetX = 18;
      let offsetY = 18;
      if (e.clientX > window.innerWidth - 300) offsetX = -tooltip.offsetWidth - 18;
      if (e.clientY > window.innerHeight - 300) offsetY = -tooltip.offsetHeight - 18;
      
      tooltip.style.transform = `translate(${e.clientX + offsetX}px, ${e.clientY + offsetY}px)`;
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  React.useLayoutEffect(() => {
    if (localHoverNode && hoverTooltipRef.current) {
      const e = { clientX: mousePosRef.current.x, clientY: mousePosRef.current.y };
      const tooltip = hoverTooltipRef.current;
      let offsetX = 18;
      let offsetY = 18;
      if (e.clientX > window.innerWidth - 300) offsetX = -tooltip.offsetWidth - 18;
      if (e.clientY > window.innerHeight - 300) offsetY = -tooltip.offsetHeight - 18;
      tooltip.style.transform = `translate(${e.clientX + offsetX}px, ${e.clientY + offsetY}px)`;
    }
  }, [localHoverNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [resizeVersion, setResizeVersion] = useState(0);
  const { fitBounds, getNode, getEdges, getNodes, fitView, setCenter } = useReactFlow();

  // Container resize event listener to center the graph (handles CSS transitions)
  useEffect(() => {
    let timeoutId: any;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setResizeVersion(v => v + 1);
      }, 100);
    };

    const observer = new ResizeObserver(handleResize);
    const rfElement = document.querySelector('.react-flow');
    if (rfElement) observer.observe(rfElement);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Edge interaction states
  const [activeNodeIds, setActiveNodeIds] = useState<Set<string> | null>(null);
  const [clickedNodeId, setClickedNodeId] = useState<string | null>(null);
  const [clickedEdgeId, setClickedEdgeId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<any>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number, y: number } | null>(null);

  // Mapped data from the raw graphData
  useEffect(() => {
    const buildGraph = async () => {
      setIsLoading(true);

      const rfNodes: any[] = [];
      const rfEdges: any[] = [];

      // Find all unique group IDs from devices and sort them by ID ascending
      const activeGroupIds = new Set<number>();
      data.nodes.forEach(n => {
        if (n.deviceGroupId !== undefined) {
          activeGroupIds.add(n.deviceGroupId);
        }
      });
      const sortedGroupIds = Array.from(activeGroupIds).sort((a, b) => a - b);

      // Create Group Nodes first
      sortedGroupIds.forEach(gid => {
        const groupName = groupsMetadata[gid] || `Group ${gid}`;

        rfNodes.push({
          id: `group-${gid}`,
          type: 'groupNode',
          position: { x: 0, y: 0 },
          data: {
            label: groupName,
            rawNode: { id: `group-${gid}`, isGroupNode: true, deviceGroupId: gid, label: groupName, severity: 'normal' },
            isDimmed: isDimmedState && !highlightNodes.has(`group-${gid}`),
            onNodeHover,
            onLocalHover: setLocalHoverNode,
          },
          zIndex: 0,
          expandParent: true,
        });
      });

      // Prepare interface data for device nodes
      const interfaceDirections: Record<string, 'source' | 'target'> = {};
      data.links.forEach(l => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
        interfaceDirections[String(srcId)] = 'source';
        interfaceDirections[String(tgtId)] = 'target';
      });

      const deviceInterfaces: Record<string, any[]> = {};
      const interfaceToDevice: Record<string, string> = {};

      data.nodes.forEach(n => {
        if (n.isInterfaceNode && n.parentDeviceId) {
          const parentId = String(n.parentDeviceId);
          if (!deviceInterfaces[parentId]) deviceInterfaces[parentId] = [];

          const infId = String(n.id);
          const dir = interfaceDirections[infId] || 'source';

          let infSeverity = mockNodeAlarms[infId] || 'normal';
          // Also check physical link alarms that touch this interface
          Object.entries(mockLinkAlarms).forEach(([alarmKey, linkSev]) => {
            const [port1, port2] = alarmKey.split('--');
            if (port1 === infId || port2 === infId) {
              infSeverity = getMaxSeverity(infSeverity, linkSev);
            }
          });

          deviceInterfaces[parentId].push({
            id: infId,
            label: n.name || n.label || infId,
            direction: dir,
            isDimmed: false,
            severity: infSeverity,
            hasAlarm: infSeverity !== 'normal',
            rawNode: n
          });
          interfaceToDevice[String(n.id)] = parentId;
        }
      });

      // Create Device Nodes (Skip Interfaces)
      data.nodes.forEach(n => {
        if (n.isInterfaceNode) return; // Skip interfaces since they are handles now

        let parentId;
        let type = 'default';
        let zIndex = 0;

        if (n.isGroupNode) {
          type = 'groupNode';
          zIndex = 0;
        } else if (n.isDeviceNode) {
          type = 'deviceNode';
          parentId = n.deviceGroupId !== undefined ? `group-${n.deviceGroupId}` : undefined;
          zIndex = 1;
        }

        let deviceSeverity = mockNodeAlarms[String(n.id)] || 'normal';
        const interfaces = n.isDeviceNode ? (deviceInterfaces[String(n.id)] || []) : [];
        interfaces.forEach(inf => {
          if (inf.severity && inf.severity !== 'normal') {
            deviceSeverity = getMaxSeverity(deviceSeverity, inf.severity);
          }
        });

        const rawNodeWithSeverity = { ...n, severity: deviceSeverity };

        rfNodes.push({
          id: String(n.id),
          type,
          position: { x: 0, y: 0 },
          data: {
            label: n.name || n.label || String(n.id),
            rawNode: rawNodeWithSeverity,
            isDimmed: false,
            interfaces,
            onNodeHover,
            onLocalHover: setLocalHoverNode,
            onPortClick: (portId: string) => {
              // ?縕??紐????????롪퍒?붻뜎???β돦裕뉛쭚???ルㅎ臾???⑤객臾???貫?껆뵳??됀???
              // 嶺뚮씧?긷칰???⑤챶裕욃슖?嶺뚯쉳????????怨몄쓧 ??ルㅎ臾????臾먮┰ ??븐슙留????? ???낆┣????紐껊퉵??
              setClickedNodeId(null);
              setClickedEdgeId(null);
              setActiveNodeIds(null);
              setHoveredEdge(null);
              setHoverPos(null);

              const currentEdges = getEdges();
              const connectedEdge = currentEdges.find(e => e.sourceHandle === portId || e.targetHandle === portId);
              if (connectedEdge && onEdgeDoubleClickRef.current) {
                onEdgeDoubleClickRef.current(connectedEdge.data?.rawLink || connectedEdge);
              }
            }
          },
          parentId,
          zIndex,
          expandParent: true,
        });
      });

      // React Flow requires parents to be before children in the array
      rfNodes.sort((a, b) => a.zIndex - b.zIndex);

      // Verify parent existence to prevent crash
      const nodeIds = new Set(rfNodes.map(n => n.id));
      rfNodes.forEach(n => {
        if (n.parentId && !nodeIds.has(n.parentId)) {
          n.parentId = undefined;
        }
      });

      // Create Edges
      data.links.forEach(l => {
        const originalSource = typeof l.source === 'object' ? String(l.source.id) : String(l.source);
        const originalTarget = typeof l.target === 'object' ? String(l.target.id) : String(l.target);

        // Map interfaces to their parent devices
        const sourceDevice = interfaceToDevice[originalSource] || originalSource;
        const targetDevice = interfaceToDevice[originalTarget] || originalTarget;

        // Skip hierarchy links
        if ((l as any).isGroupToDevice) return;

        const srcId = String(originalSource);
        const tgtId = String(originalTarget);
        const alarmKey = `${srcId}--${tgtId}`;
        const reverseAlarmKey = `${tgtId}--${srcId}`;
        const linkSev = mockLinkAlarms[alarmKey] || mockLinkAlarms[reverseAlarmKey] || 'normal';

        const rawLinkWithSeverity = { ...l, severity: linkSev };

        rfEdges.push({
          id: String(l.id || `e-${originalSource}-${originalTarget}`),
          source: sourceDevice,
          sourceHandle: interfaceToDevice[originalSource] ? originalSource : undefined,
          target: targetDevice,
          targetHandle: interfaceToDevice[originalTarget] ? originalTarget : undefined,
          type: 'smoothstep',
          pathOptions: { borderRadius: 20 },
          animated: false, // Turned off for performance
          style: { stroke: '#4b5563', strokeWidth: 1.5, opacity: 1 }, // Thinner lines for performance
          data: { rawLink: rawLinkWithSeverity, originalLink: l, isDimmed: false }
        });
      });

      // Layout graph using ELK
      const { nodes: layoutedNodes, edges: layoutedEdges } = await getLayoutedElements(rfNodes, rfEdges);

      // Append Group Label Nodes AFTER layout so they don't affect ELK measurements
      // Removed because label is now integrated into GroupNode

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setIsLoading(false);
      setLayoutVersion(v => v + 1);
    };

    buildGraph();
  }, [data, setNodes, setEdges]);

  // Sync edge styles based on hover and click states
  useEffect(() => {
    setEdges(eds => {
      let changed = false;
      const newEdges = eds.map(e => {
        const isHovered = hoveredEdge?.id === e.id;
        const isEdgeClicked = clickedEdgeId === e.id;
        const isConnectedToClickedNode = clickedNodeId && (e.source === clickedNodeId || e.target === clickedNodeId);

        // Use pathHighlight.linkPairs directly instead of the mutable highlightLinks Set
        let isPathHighlighted = false;
        if (pathHighlight && pathHighlight.linkPairs && e.data?.rawLink) {
          const rLink = e.data.rawLink;
          // rawLink has originalSource/originalTarget which are device IDs
          if (rLink.originalSource && rLink.originalTarget) {
            const key1 = `${rLink.originalSource}-${rLink.originalTarget}`;
            const key2 = `${rLink.originalTarget}-${rLink.originalSource}`;
            isPathHighlighted = pathHighlight.linkPairs.has(key1) || pathHighlight.linkPairs.has(key2);
          }
        }

        let isHighlightLink = false;
        if (!pathHighlight && highlightLinks && e.data?.originalLink) {
          isHighlightLink = highlightLinks.has(e.data.originalLink);
        }

        // ????????⑤객臾?activeNodeId ?브퀡??????????얜?嫄??筌뤾퍓援→뤆?쎛 嶺뚮ㅄ維筌?highlightNodes???????琉우꽑 ???덈펲嶺?嶺뚮씧?긷칰類잙ご???戮?뎽??
        // ?? ?롪퍔?δ빳??????pathHighlight) 嶺뚮ㅄ維獄???롪퍔????롪퍔?δ빳??筌뤾쑴踰??釉띾쐡???됀??嶺뚮씧?긷칰???瑜곷턄??源녿턄?筌? ?꾩렮維?
        if (!pathHighlight && activeNodeId && highlightNodes) {
          if (highlightNodes.has(e.source) && highlightNodes.has(e.target)) {
            isHighlightLink = true;
          }
        }

        const isActive = isHovered || isEdgeClicked || isConnectedToClickedNode || isPathHighlighted || isHighlightLink;

        const rawLink = e.data?.rawLink;
        const severity = rawLink?.severity || 'normal';
        const hasAlarm = severity !== 'normal' && !(isDimmedState && !isActive);
        const alarmColor = SEVERITY_COLORS[severity]?.color || '#ef4444';

        const targetOpacity = isDimmedState && !isActive && !hasAlarm ? 0.4 : (hasAlarm ? 0.8 : 1);
        const targetStrokeWidth = isActive ? (hasAlarm ? 8 : 3) : (hasAlarm ? 5 : 1.5);
        const isHierarchy = e.data?.originalLink?.isHierarchyLink || e.data?.originalLink?.isGroupToDevice;
        const targetAnimated = (isHierarchy && !isActive) ? false : (isActive || hasAlarm);
        
        let targetStroke = isActive ? (hasAlarm ? alarmColor : '#4ade80') : (hasAlarm ? alarmColor : '#4b5563');
        if (isHovered) targetStroke = '#ffff00'; // 嶺뚮씞???勇싲８?③뇡????嫄??
        
        let targetZIndex = isActive ? 100 : (hasAlarm ? 50 : 0);
        if (isHovered) targetZIndex = 9999;

        const targetFilter = isHovered ? 'drop-shadow(0 0 8px rgba(255, 255, 0, 1))' : 'none';

        let isForwardFlow = false;
        let isReverseFlow = false;
        if (pathHighlight?.directedLinks && e.data?.rawLink?.originalSource && e.data?.rawLink?.originalTarget) {
          const s = e.data.rawLink.originalSource;
          const t = e.data.rawLink.originalTarget;
          if (pathHighlight.directedLinks.has(`${s}-${t}`)) {
            isForwardFlow = true;
          } else if (pathHighlight.directedLinks.has(`${t}-${s}`)) {
            isReverseFlow = true;
          }
        }

        const targetMarkerEnd = (isActive && !isReverseFlow) ? { type: MarkerType.ArrowClosed, color: targetStroke } : undefined;
        const targetMarkerStart = (isActive && (isReverseFlow || (!isForwardFlow && !isReverseFlow))) ? { type: MarkerType.ArrowClosed, color: targetStroke, orient: 'auto-start-reverse' } : undefined;
        const targetClassName = [
          isReverseFlow ? 'reverse-animation' : '',
          hasAlarm ? 'animate-pulse-alarm-bg' : '',
          (isDimmedState && !isActive) ? 'deactivated-edge' : ''
        ].filter(Boolean).join(' ');
        const targetPointerEvents = (isDimmedState && !isActive) ? 'none' : 'auto';

        if (e.animated !== targetAnimated ||
          e.style?.opacity !== targetOpacity ||
          e.style?.strokeWidth !== targetStrokeWidth ||
          e.style?.stroke !== targetStroke ||
          e.style?.pointerEvents !== targetPointerEvents ||
          e.style?.filter !== targetFilter ||
          e.className !== targetClassName ||
          e.zIndex !== targetZIndex) {

          changed = true;
          return {
            ...e,
            className: targetClassName,
            animated: targetAnimated,
            style: {
              ...e.style,
              stroke: targetStroke,
              strokeWidth: targetStrokeWidth,
              strokeDasharray: isActive ? undefined : 'none',
              vectorEffect: isActive ? 'non-scaling-stroke' : 'none',
              opacity: targetOpacity,
              pointerEvents: targetPointerEvents,
              filter: targetFilter
            },
            markerEnd: targetMarkerEnd,
            markerStart: targetMarkerStart,
            zIndex: targetZIndex
          };
        }
        return e;
      });
      return changed ? newEdges : eds;
    });
  }, [hoveredEdge, clickedEdgeId, clickedNodeId, pathHighlight, highlightLinks, highlightNodes, activeNodeId, isDimmedState, layoutVersion, setEdges, highlightVersion]);

  // Sync node styles based on active nodes
  useEffect(() => {
    const activeInterfaceIds = new Set<string>();

    // Derive active interfaces from pathHighlight by matching edges against linkPairs
    if (pathHighlight && pathHighlight.linkPairs) {
      edges.forEach(e => {
        const rLink = e.data?.rawLink;
        if (rLink && rLink.originalSource && rLink.originalTarget) {
          const key1 = `${rLink.originalSource}-${rLink.originalTarget}`;
          const key2 = `${rLink.originalTarget}-${rLink.originalSource}`;
          if (pathHighlight.linkPairs.has(key1) || pathHighlight.linkPairs.has(key2)) {
            if (e.sourceHandle) activeInterfaceIds.add(e.sourceHandle);
            if (e.targetHandle) activeInterfaceIds.add(e.targetHandle);
          }
        }
      });
    }

    if (clickedEdgeId) {
      const edge = edges.find(e => e.id === clickedEdgeId);
      if (edge) {
        if (edge.sourceHandle) activeInterfaceIds.add(edge.sourceHandle);
        if (edge.targetHandle) activeInterfaceIds.add(edge.targetHandle);
      }
    }

    if (clickedNodeId) {
      edges.forEach(e => {
        if (e.source === clickedNodeId || e.target === clickedNodeId) {
          if (e.sourceHandle) activeInterfaceIds.add(e.sourceHandle);
          if (e.targetHandle) activeInterfaceIds.add(e.targetHandle);
        }
      });
    }

    if (activeNodeId && highlightNodes) {
      edges.forEach(e => {
        let isHighlightLink = false;
        if (highlightLinks && e.data?.originalLink) {
          isHighlightLink = highlightLinks.has(e.data?.originalLink);
        }
        if (highlightNodes.has(e.source) && highlightNodes.has(e.target)) {
          isHighlightLink = true;
        }
        if (isHighlightLink) {
          if (e.sourceHandle) activeInterfaceIds.add(String(e.sourceHandle));
          if (e.targetHandle) activeInterfaceIds.add(String(e.targetHandle));
        }
      });
    }

    const hasAnyActiveInterfaces = activeInterfaceIds.size > 0;

    // Build a set of path device IDs for node dimming
    const pathDeviceIds = pathHighlight?.deviceIds || null;

    setNodes(nds => {
      let changed = false;
      const newNodes = nds.map(n => {
        let isDimmed = false;

        if (pathDeviceIds && pathDeviceIds.size > 0) {
          // Path highlight mode: dim nodes not in the path
          if (n.type === 'groupNode') {
            // Always dim group nodes to focus entirely on the highlighted devices/links
            isDimmed = true;
          } else {
            isDimmed = !(pathDeviceIds.has(n.id) || pathDeviceIds.has(String(n.id)));
          }
        } else if (activeNodeIds) {
          if (n.type === 'groupNode') {
            const hasActiveChild = nds.some(child => child.parentId === n.id && activeNodeIds.has(child.id));
            isDimmed = !hasActiveChild;
          } else {
            isDimmed = !activeNodeIds.has(n.id);
          }
        } else if (isDimmedState) {
          const rawId = n.data?.rawNode?.id;
          isDimmed = !(
            highlightNodes.has(n.id) ||
            highlightNodes.has(String(n.id)) ||
            (rawId !== undefined && (highlightNodes.has(rawId) || highlightNodes.has(String(rawId))))
          );
        }

        let needsUpdate = n.data.isDimmed !== isDimmed;

        const newInterfaces = n.data.interfaces?.map((iface: any) => {
          let ifaceDimmed = isDimmed;
          if (hasAnyActiveInterfaces && !isDimmed) {
            ifaceDimmed = !activeInterfaceIds.has(String(iface.id));
          } else if (hasAnyActiveInterfaces && isDimmed) {
            ifaceDimmed = true;
          }

          if (iface.isDimmed !== ifaceDimmed) needsUpdate = true;
          return { ...iface, isDimmed: ifaceDimmed };
        });

        let isActiveNode = false;
        let isDirectlySelected = false;
        if (activeNodeId) {
          if (n.id === activeNodeId) {
            isDirectlySelected = true;
            // In path highlight mode, do not show active borders for group nodes
            if (!(pathDeviceIds && pathDeviceIds.size > 0 && n.type === 'groupNode')) {
              isActiveNode = true;
            }
          }
        }

        let isSrc = false;
        let isDst = false;
        if (pathHighlight?.srcNodeId && pathHighlight?.dstNodeId) {
          if (n.id === pathHighlight.srcNodeId || String(n.data.rawNode?.deviceId) === pathHighlight.srcNodeId || String(n.data.rawNode?.deviceGroupId) === pathHighlight.srcNodeId || n.id === `group-${pathHighlight.srcNodeId}`) isSrc = true;
          if (n.id === pathHighlight.dstNodeId || String(n.data.rawNode?.deviceId) === pathHighlight.dstNodeId || String(n.data.rawNode?.deviceGroupId) === pathHighlight.dstNodeId || n.id === `group-${pathHighlight.dstNodeId}`) isDst = true;
        }

        if (needsUpdate || n.data?.isActiveNode !== isActiveNode || n.data?.isDirectlySelected !== isDirectlySelected || n.data?.isSrc !== isSrc || n.data?.isDst !== isDst) {
          changed = true;
          return { ...n, data: { ...n.data, isDimmed, isActiveNode, isDirectlySelected, isSrc, isDst, interfaces: newInterfaces || [] } };
        }
        return n;
      });
      return changed ? newNodes : nds;
    });
  }, [activeNodeIds, isDimmedState, highlightNodes, highlightLinks, layoutVersion, setNodes, pathHighlight, clickedEdgeId, clickedNodeId, edges, activeNodeId, highlightVersion]);

  // Auto-zoom to path if pathHighlight is provided, or highlightNodes if present
  useEffect(() => {
    let zoomTargetIds = new Set<string>();

    if (pathHighlight && pathHighlight.deviceIds && pathHighlight.deviceIds.size > 0) {
      pathHighlight.deviceIds.forEach((id: string) => {
        const strId = String(id);
        if (!strId.startsWith('inf-')) {
          // React Flow node IDs are raw device IDs (e.g. "3314"), not "device-3314"
          zoomTargetIds.add(strId);
        }
      });
    } else if (highlightNodes && highlightNodes.size > 0 && !isHovering) {
      highlightNodes.forEach(id => {
        const strId = String(id);
        if (!strId.startsWith('inf-')) {
          zoomTargetIds.add(strId);
        }
      });
    } else if (!activeNodeId) {
      const nodes = getNodes();
      nodes.forEach(n => {
        if (n.type === 'groupNode' || n.type === 'deviceNode') zoomTargetIds.add(n.id);
      });
    }

    let timeoutId: any;
    let isCancelled = false;

    if (zoomTargetIds.size > 0) {
      setActiveNodeIds(null);
      setClickedNodeId(null);
      setClickedEdgeId(null);

      let retryCount = 0;
      const tryZoom = () => {
        if (isCancelled) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let valid = false;
        let foundCount = 0;

        zoomTargetIds.forEach((id: string) => {
          const n = getNode(String(id));
          if (n && n.position !== undefined) {
            let nx = n.position.x;
            let ny = n.position.y;
            if (n.parentId) {
              const parent = getNode(String(n.parentId));
              if (parent && parent.position) {
                nx += parent.position.x;
                ny += parent.position.y;
              }
            }
            const styleW = n.style?.width ? Number(n.style.width) : 0;
            const styleH = n.style?.height ? Number(n.style.height) : 0;
            let nw = n.measured?.width || n.width || styleW || 0;
            let nh = n.measured?.height || n.height || styleH || 0;

            if (!nw && n.type === 'deviceNode') nw = 180;
            if (!nh && n.type === 'deviceNode') nh = 60;
            if (!nw && n.type === 'groupNode') nw = 200;
            if (!nh && n.type === 'groupNode') nh = 100;

            // Only consider it valid if it has actual dimensions, or if it's explicitly placed
            if (nw > 0 && nh > 0) {
              minX = Math.min(minX, nx);
              minY = Math.min(minY, ny);
              maxX = Math.max(maxX, nx + nw);
              maxY = Math.max(maxY, ny + nh);
              foundCount++;
            }
          }
        });

        let expectedCount = 0;
        zoomTargetIds.forEach((id: string) => {
          if (getNode(String(id))) expectedCount++;
        });


        if (expectedCount > 0 && foundCount === expectedCount) {
          valid = true;
        } else if (retryCount >= 15 && foundCount > 0) {
          console.warn(`Zooming with missing dimensions! Expected: ${expectedCount}, Found with dims: ${foundCount}`);
          valid = true;
        }

        if (valid) {
          let h = maxY - minY;
          let w = maxX - minX;

          // Ensure a minimum bounding box size so single nodes aren't zoomed in too extremely
          if (w < 400) {
            const dw = 400 - w;
            minX -= dw / 2;
            maxX += dw / 2;
            w = 400;
          }
          if (h < 300) {
            const dh = 300 - h;
            minY -= dh / 2;
            maxY += dh / 2;
            h = 300;
          }

          const isPathFinderActive = pathHighlight && !pathHighlight.isLinkIsolation;
          if (isPathFinderActive) {
            const VH = typeof window !== 'undefined' ? window.innerHeight : 900;
            const VW = typeof window !== 'undefined' ? window.innerWidth : 1600;
            // 패널 기본 높이(약 170px) + 검색 결과 개수당 28px (최대 5개)
            const resultCount = pathHighlight.resultCount || 1;
            const panelH = 170 + (Math.min(5, resultCount) * 28);
            const heightRatio = panelH / Math.max(100, VH - panelH);
            const widthRatio = panelH / Math.max(100, VW);
            
            const extraY = Math.max(h * heightRatio, w * widthRatio);
            maxY += extraY;
          } else {
            // 경로탐색 중이 아닐 때만 기본 여백 적용 (상단 50, 하단 100~200)
            minY -= 50;
            maxY += 100;
            if (!pathHighlight && (!highlightNodes || highlightNodes.size === 0)) {
              maxY += 100;
            }
          }
          fitBounds(
            { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            { duration: 500, padding: 0.1 }
          );
        } else if (retryCount < 20) {
          retryCount++;
          timeoutId = setTimeout(tryZoom, 150);
        }
      };

      timeoutId = setTimeout(tryZoom, 50);
    } else if (!activeNodeId) {
      // 선택된 노드가 없을 때 전체 줌 (ResizeObserver가 트랜지션 완료를 감지하므로 짧은 딜레이 사용)
      timeoutId = setTimeout(() => {
        if (!isCancelled) fitView({ duration: 500, padding: 0.1 });
      }, 50);
    }

    return () => {
      isCancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [pathHighlight, highlightNodes, highlightVersion, layoutVersion, setNodes, setEdges, fitBounds, fitView, getNode, getNodes, activeNodeId, resizeVersion]);

  // Click handler
  const handleNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    onNodeClick(node.data.rawNode);
    if (node.type === 'groupNode') return; // Don't highlight/zoom on groups

    setClickedNodeId(node.id);
    setClickedEdgeId(null);

    const connectedNodeIds = new Set<string>([node.id]);
    getEdges().forEach(e => {
      if (e.source === node.id) connectedNodeIds.add(e.target);
      if (e.target === node.id) connectedNodeIds.add(e.source);
    });
    setActiveNodeIds(connectedNodeIds);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let valid = false;

    connectedNodeIds.forEach(id => {
      const n = getNode(String(id));
      if (n) {
        let nx = n.position.x;
        let ny = n.position.y;
        if (n.parentId) {
          const parent = getNode(n.parentId);
          if (parent) {
            nx += parent.position.x;
            ny += parent.position.y;
          }
        }
        const nw = n.measured?.width || n.width || 0;
        const nh = n.measured?.height || n.height || 0;
        if (nx < minX) minX = nx;
        if (ny < minY) minY = ny;
        if (nx + nw > maxX) maxX = nx + nw;
        if (ny + nh > maxY) maxY = ny + nh;
        valid = true;
      }
    });

    if (valid) {
      minY -= 50;
      maxY += 100;
      fitBounds(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        { duration: 400, padding: 0.2 }
      );
    }
  }, [onNodeClick, getEdges, getNode, fitBounds]);

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    if (edge.style?.pointerEvents === 'none') return;
    event.stopPropagation();
    setClickedEdgeId(edge.id);
    setClickedNodeId(null);
    if (onEdgeClick) {
      onEdgeClick(edge.data?.rawLink || edge);
    }
  }, [onEdgeClick]);

  const onPaneClick = useCallback(() => {
    // Disabled per user request
  }, []);

  // Global search focus for 2D
  useEffect(() => {
    (window as any).focusEdgeById2D = (edgeId: string) => {
      setClickedEdgeId(edgeId);
      setClickedNodeId(null);
    };

    (window as any).focusNodeById2D = (nodeId: string) => {
      const n = getNode(nodeId);
      if (n) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasChildren = false;

        if (n.type === 'groupNode') {
          const nodes = getNodes();
          nodes.forEach(child => {
            if (child.parentId === n.id) {
              const cx = child.position.x + (n.position.x || 0);
              const cy = child.position.y + (n.position.y || 0);
              const cw = child.measured?.width || child.width || 180;
              const ch = child.measured?.height || child.height || 60;
              if (cx < minX) minX = cx;
              if (cy < minY) minY = cy;
              if (cx + cw > maxX) maxX = cx + cw;
              if (cy + ch > maxY) maxY = cy + ch;
              hasChildren = true;
            }
          });
        }

        if (!hasChildren) {
          const connectedNodeIds = new Set<string>([n.id]);
          getEdges().forEach(e => {
            if (e.source === n.id) connectedNodeIds.add(e.target);
            if (e.target === n.id) connectedNodeIds.add(e.source);
          });
          
          connectedNodeIds.forEach(id => {
            const connectedNode = getNode(String(id));
            if (connectedNode) {
              let nx = connectedNode.position.x;
              let ny = connectedNode.position.y;
              if (connectedNode.parentId) {
                const parent = getNode(connectedNode.parentId);
                if (parent) {
                  nx += parent.position.x;
                  ny += parent.position.y;
                }
              }
              const nw = connectedNode.measured?.width || connectedNode.width || 0;
              const nh = connectedNode.measured?.height || connectedNode.height || 0;
              if (nx < minX) minX = nx;
              if (ny < minY) minY = ny;
              if (nx + nw > maxX) maxX = nx + nw;
              if (ny + nh > maxY) maxY = ny + nh;
            }
          });
        }

        if (hasChildren) {
          let w = maxX - minX;
          let h = maxY - minY;

          if (w < 400) {
            const dw = 400 - w;
            minX -= dw / 2;
            maxX += dw / 2;
            w = 400;
          }
          if (h < 300) {
            const dh = 300 - h;
            minY -= dh / 2;
            maxY += dh / 2;
            h = 300;
          }
          maxY += Math.max(h * 0.8, w * 0.4);
        } else {
          minY -= 50;
          maxY += 100;
        }

        fitBounds(
          { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
          { duration: 400, padding: 0.2 }
        );

        setClickedNodeId(null);
        setClickedEdgeId(null);
        // Do NOT update local activeNodeIds here! NetworkGraph.tsx handles the state globally.
      }
    };
    return () => {
      delete (window as any).focusNodeById2D;
    };
  }, [getNode, fitBounds, getEdges]);

  // Edge hover handlers
  const onEdgeMouseEnter = useCallback((event: React.MouseEvent, edge: any) => {
    // 2,3뎁스 실선에 대해 호버를 무시합니다.
    if (edge?.data?.originalLink?.isHierarchyLink || edge?.data?.originalLink?.isGroupToDevice || edge?.data?.originalLink?.isDeviceToInterface) return;
    if (edge.style?.pointerEvents === 'none') return;
    setHoveredEdge(edge);
    setHoverPos({ x: event.clientX, y: event.clientY });
  }, []);

  const onEdgeMouseMove = useCallback((event: React.MouseEvent) => {
    if (hoveredEdge) {
      setHoverPos({ x: event.clientX, y: event.clientY });
    }
  }, [hoveredEdge]);

  const onEdgeMouseLeave = useCallback((event: React.MouseEvent, edge: any) => {
    setHoveredEdge(null);
    setHoverPos(null);
  }, []);

  const memoizedNodeTypes = useMemo(() => nodeTypes, []);

  return (
    <div className="w-full h-full bg-transparent relative overflow-hidden" style={{ marginTop: "-10px", height: "calc(100% + 10px)" }}>
      {/* Background radial gradient to give space depth in 2D */}
      <div className="absolute inset-0 pointer-events-none z-0" style={{
        background: 'radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.7) 0%, rgba(2, 6, 23, 0.95) 60%, rgba(0, 0, 0, 1) 100%)'
      }} />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#020617]/80 z-50">
          <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
          <p className="text-gray-400 text-sm ml-3">레이아웃 렌더링 중...</p>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={(e, edge) => props.onEdgeDoubleClick?.(edge.data?.rawLink || edge)}
        onPaneClick={onPaneClick}
        nodeTypes={memoizedNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag={[0, 2]}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (onNodeContextMenu && node.data?.rawNode) {
            onNodeContextMenu(event, node.data.rawNode);
          }
        }}
        onPaneContextMenu={(e) => e.preventDefault()}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.05}
        maxZoom={2}
        className="bg-transparent z-10"
        proOptions={{ hideAttribution: true }}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseMove={onEdgeMouseMove}
        onEdgeMouseLeave={onEdgeMouseLeave}
      >
        <Background color="rgba(255, 255, 255, 0.03)" gap={25} size={1} />
        <CustomZoomControls />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'groupNode') return 'rgba(30, 58, 138, 0.4)';
            if (node.type === 'deviceNode') return '#cbd5e1';
            return 'transparent';
          }}
          nodeStrokeColor={(node) => {
            if (node.type === 'groupNode') return 'rgba(59, 130, 246, 0.6)';
            return 'transparent';
          }}
          nodeStrokeWidth={4}
          maskColor="rgba(10, 11, 14, 0.85)"
          className="!bg-[#13161f] border-t border-l border-r border-[#3b82f6]/40 !rounded-t-[12px] !shadow-2xl !overflow-hidden !box-border"
          style={{ right: 16, bottom: 48, margin: 0, width: 200, boxSizing: 'border-box', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}
          pannable
          zoomable
        />
      </ReactFlow>

      {hoveredEdge && hoverPos && (
        <TrafficTooltip edge={hoveredEdge} allEdges={edges} allNodes={nodes} x={hoverPos.x} y={hoverPos.y} />
      )}

      {/* 커스텀 호버 툴팁 */}
      {localHoverNode && getNodeLabel && (
        <div
          ref={hoverTooltipRef}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            transform: `translate(${mousePosRef.current.x + 18}px, ${mousePosRef.current.y + 18}px)`,
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          dangerouslySetInnerHTML={{
            __html: getNodeLabel(localHoverNode)
          }}
        />
      )}
    </div>
  );
};

export const NetworkGraph2D: React.FC<NetworkGraph2DProps> = (props) => (
  <ReactFlowProvider>
    <NetworkGraph2DContent {...props} />
  </ReactFlowProvider>
);







