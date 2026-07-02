import React, { useState, useEffect } from 'react';
import { Search, Bell, Menu, ChevronRight, Download, Upload, X, FileJson } from 'lucide-react';
import { loadGraphData, GraphNode, GraphData, groupsMetadata, buildGraphData } from './data';
import { NetworkGraph } from './components/NetworkGraph';
import { StarsBackground } from './components/StarsBackground';
import { NetworkGraph2D } from './components/NetworkGraph2D';
import { NodeDetailSidebar } from './components/NodeDetailSidebar';

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

export default function App() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [iconConcept, setIconConcept] = useState<'planet' | 'block'>('planet');
  const [is2DMode, setIs2DMode] = useState<boolean>(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const PUBLIC_JSON_FILES = [
    'response.json',
    'response_test.json',
    'response_simple.json'
  ];

  const handleLoadPublicJson = async (filename: string) => {
    try {
      const res = await fetch(`/${filename}`);
      if (!res.ok) throw new Error(`Failed to load ${filename}`);
      const json = await res.json();
      if (json && json.nodes && json.links) {
        if (json.nodes.length > 0 && json.nodes[0].deviceId !== undefined) {
          const parsedData = buildGraphData(json);
          setGraphData(parsedData);
        } else {
          setGraphData(json);
        }
        setDataVersion(v => v + 1);
        setSelectedNode(null);
        setShowLoadModal(false);
      } else {
        alert('유효하지 않은 토폴로지 JSON 파일입니다.');
      }
    } catch (err) {
      alert('JSON 파싱/로드 오류: ' + (err as Error).message);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadGraphData()
      .then(data => {
        setGraphData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleDownloadJson = () => {
    if (!graphData) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(graphData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "topology_data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleLoadJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (json && json.nodes && json.links) {
          // 원본 API 응답(response.json) 포맷인지 검사
          if (json.nodes.length > 0 && json.nodes[0].deviceId !== undefined) {
            const parsedData = buildGraphData(json);
            setGraphData(parsedData);
          } else {
            // 이미 변환된 topology_data.json 포맷
            setGraphData(json);
          }
          setDataVersion(v => v + 1);
          setSelectedNode(null);
          setShowLoadModal(false);
        } else {
          alert('유효하지 않은 토폴로지 JSON 파일입니다.');
        }
      } catch (err) {
        alert('JSON 파싱 오류: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const stats = React.useMemo(() => {
    if (!graphData) return null;

    const deviceNodes = graphData.nodes.filter(n => n.isDeviceNode);
    const interfaceNodes = graphData.nodes.filter(n => n.isInterfaceNode);

    const groupIds = Object.keys(groupsMetadata).map(Number);
    const forwardGroupIds = new Set(
      groupIds.filter(id => groupsMetadata[id]?.includes('전진배치'))
    );

    const normalGroupCount = groupIds.length - forwardGroupIds.size;
    const forwardDeviceCount = deviceNodes.filter(n =>
      n.deviceGroupId !== undefined && forwardGroupIds.has(n.deviceGroupId)
    ).length;
    const regularDeviceCount = deviceNodes.length - forwardDeviceCount;
    const interfaceCount = interfaceNodes.length;

    return {
      totalNodes: deviceNodes.length,
      totalLinks: graphData.links.length,
      normalGroupCount,
      regularDeviceCount,
      forwardDeviceCount,
      interfaceCount
    };
  }, [graphData]);

  return (
    <div className="flex h-screen bg-space-gradient text-[#e2e8f0] font-sans overflow-hidden relative">
      {/* 배경 별무리 효과 */}
      <StarsBackground />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative">

        {/* Top Navigation */}
        <header className="h-16 border-b border-[#2d3748] flex items-center justify-between px-6 bg-[#161920] z-10 absolute top-0 left-0 right-0">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-sm font-bold text-white">C</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">IP-MPLS <span className="text-blue-400 font-normal text-sm ml-2">네트워크 대시보드</span></h1>

            {/* Toggle Button */}
            <div className="ml-8 bg-[#0a0b0e] p-1 rounded-md border border-[#2d3748] flex items-center">
              <button
                onClick={() => setIs2DMode(false)}
                className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${!is2DMode ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                3D Topology
              </button>
              <button
                onClick={() => setIs2DMode(true)}
                className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${is2DMode ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                2D Architecture
              </button>
            </div>
          </div>
          <div className="flex items-center text-sm text-gray-400">
            {currentTime.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
            <span className="mx-2 text-[#2d3748]">|</span>
            <span className="font-mono text-gray-300 tracking-wider">
              {currentTime.toLocaleTimeString('ko-KR', { hour12: false })}
            </span>
          </div>

        </header>

        {/* Graph Area */}
        <div className="flex-1 pt-16 relative bg-transparent">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-transparent">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
              <p className="text-gray-400 text-sm">토폴로지 데이터 로딩 중...</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-transparent">
              <p className="text-red-400 text-sm">오류: {error}</p>
            </div>
          )}
          {graphData && <NetworkGraph key={dataVersion} data={graphData} onNodeClick={setSelectedNode} externalSelectedNode={selectedNode} externalHoverNode={hoverNode} iconConcept={iconConcept} onConceptChange={setIconConcept} is2DMode={is2DMode} />}



          {/* Bottom stats */}
          <div className="absolute bottom-6 left-6 z-10 flex flex-col space-y-2 pointer-events-none">

            {/* JSON Export/Import Buttons */}
            <div className="flex space-x-2 pointer-events-auto">
              <button
                onClick={handleDownloadJson}
                className="flex-1 bg-blue-600/80 hover:bg-blue-500 text-white text-[11px] font-bold py-1.5 px-2 rounded border border-blue-500/50 shadow-lg backdrop-blur-md transition-colors flex items-center justify-center cursor-pointer"
              >
                <Download className="w-3 h-3 mr-1" />
                다운로드
              </button>
              <button
                onClick={() => setShowLoadModal(true)}
                className="flex-1 bg-gray-700/80 hover:bg-gray-600 text-white text-[11px] font-bold py-1.5 px-2 rounded border border-gray-600/50 shadow-lg backdrop-blur-md transition-colors flex items-center justify-center cursor-pointer"
              >
                <Upload className="w-3 h-3 mr-1" />
                불러오기
              </button>
            </div>

            <div className="bg-[#161920]/80 backdrop-blur-md p-3.5 border border-[#2d3748] rounded-md shadow-2xl min-w-[190px]">
              <div className="text-[11px] text-gray-400 mb-2 font-bold uppercase tracking-wider border-b border-[#2d3748] pb-1.5 flex justify-between">
                <span>그래프 범례</span>
              </div>

              {/* 전체 통계 */}
              {stats && (
                <div className="mb-2.5 pb-2 flex flex-col space-y-1 text-[11px] font-semibold text-gray-300 border-b border-[#2d3748]/40">
                  <div className="flex justify-between">
                    <span className="text-gray-500">전체 노드</span>
                    <span className="font-mono text-cyan-400">{stats.totalNodes}개</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">전체 링크</span>
                    <span className="font-mono text-cyan-400">{stats.totalLinks}개</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="flex items-center">
                    <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: iconConcept === 'block' ? '#38bdf8' : '#eab308' }}></span>
                    디바이스 그룹
                  </span>
                  <span className="font-mono text-gray-500 text-[10px] ml-2">{stats ? `${stats.normalGroupCount}개` : '-'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="flex items-center">
                    <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: '#3b82f6' }}></span>
                    장비 (디바이스)
                  </span>
                  <span className="font-mono text-gray-500 text-[10px] ml-2">{stats ? `${stats.regularDeviceCount}개` : '-'}</span>
                </div>
                {(!stats || stats.forwardDeviceCount > 0) && (
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span className="flex items-center">
                      <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: '#8b5cf6' }}></span>
                      전진배치 장비
                    </span>
                    <span className="font-mono text-gray-500 text-[10px] ml-2">{stats ? `${stats.forwardDeviceCount}개` : '-'}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="flex items-center">
                    <span className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: '#10b981' }}></span>
                    인터페이스
                  </span>
                  <span className="font-mono text-gray-500 text-[10px] ml-2">{stats ? `${stats.interfaceCount}개` : '-'}</span>
                </div>
              </div>
            </div>
          </div>


        </div>
      </div>

      {/* Right Sidebar (Exploration Detail View) */}
      {selectedNode && !selectedNode.isRingNode && graphData && (
        <NodeDetailSidebar
          node={selectedNode}
          graphData={graphData}
          onClose={() => setSelectedNode(null)}
          onNodeClick={setSelectedNode}
          onNodeHover={setHoverNode}
        />
      )}

      {/* Load Data Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#161920] border border-[#2d3748] rounded-lg shadow-2xl w-[400px] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-[#2d3748] bg-[#1a202c]">
              <h2 className="text-sm font-bold text-white flex items-center">
                <FileJson className="w-4 h-4 mr-2 text-blue-400" />
                데이터 불러오기
              </h2>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-400 hover:text-white transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-5 flex flex-col space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">내장된 테스트 파일</h3>
                <div className="space-y-2">
                  {PUBLIC_JSON_FILES.map(file => (
                    <button
                      key={file}
                      onClick={() => handleLoadPublicJson(file)}
                      className="w-full text-left px-3 py-2.5 bg-[#0a0b0e] border border-[#2d3748] hover:border-blue-500/50 hover:bg-blue-600/10 rounded transition-colors text-sm text-gray-300 flex items-center justify-between group cursor-pointer"
                    >
                      <span className="font-mono">{file}</span>
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-[#2d3748]"></div>
                <span className="flex-shrink-0 mx-4 text-gray-500 text-[11px] font-semibold">또는</span>
                <div className="flex-grow border-t border-[#2d3748]"></div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">내 컴퓨터에서 파일 선택</h3>
                <label className="w-full flex flex-col items-center justify-center px-4 py-5 border border-dashed border-[#2d3748] hover:border-blue-500/50 bg-[#0a0b0e] hover:bg-blue-600/10 rounded-lg cursor-pointer transition-colors group">
                  <Upload className="w-5 h-5 text-gray-500 group-hover:text-blue-400 transition-colors mb-2" />
                  <span className="text-xs font-medium text-gray-400 group-hover:text-gray-300 transition-colors">클릭하여 JSON 파일 업로드</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleLoadJson}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
