import ELK from 'elkjs/lib/elk.bundled.js';
import { Node as ReactFlowNode, Edge as ReactFlowEdge } from '@xyflow/react';

const elk = new ELK();

// Layout options for AWS-like architecture diagrams
const defaultOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.padding': '[top=50,left=30,bottom=30,right=30]',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
};

export const getLayoutedElements = async (
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  direction: 'DOWN' | 'RIGHT' = 'DOWN'
) => {
  // Convert flat React Flow nodes to nested ELK nodes
  const elkNodesMap: Record<string, any> = {};
  const rootChildren: any[] = [];

  // Initialize ELK nodes
  nodes.forEach((node) => {
    elkNodesMap[node.id] = {
      id: node.id,
      width: node.width || (node.type === 'deviceNode' ? 180 : 200), // Provide default widths if measured dimensions aren't available
      height: node.height || (node.type === 'deviceNode' ? 48 : 100),
      layoutOptions: { ...defaultOptions, 'elk.direction': direction },
      children: [],
    };
  });

  // Build hierarchy
  nodes.forEach((node) => {
    if (node.parentId && elkNodesMap[node.parentId]) {
      elkNodesMap[node.parentId].children.push(elkNodesMap[node.id]);
      
      // If it's a device node containing interfaces, adjust padding
      if (node.type === 'deviceNode') {
        elkNodesMap[node.id].layoutOptions['elk.padding'] = '[top=60,left=20,bottom=20,right=20]';
      }
    } else {
      rootChildren.push(elkNodesMap[node.id]);
    }
  });

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const graph = {
    id: 'root',
    layoutOptions: { 
      'elk.algorithm': 'box',
      // 우리는 수동으로 좌표를 덮어씌울 것이므로, 내부 그룹 크기 계산용으로만 활용합니다.
    },
    children: rootChildren,
    edges: elkEdges,
  };

  try {
    const layoutedGraph = await elk.layout(graph);

    // [NEW] 수동 그리드 재배치: ELK의 박스 패킹 알고리즘이 면적 최적화를 위해 순서를 섞는 것을 방지
    // 그룹 크기(width, height) 계산이 끝난 상태에서, 직접 ID 순서대로 격자(Grid) 좌표를 부여합니다.
    if (layoutedGraph.children) {
      const getGroupId = (id: string) => {
        const match = id.match(/\d+/);
        return match ? parseInt(match[0], 10) : 99999;
      };

      layoutedGraph.children.sort((a: any, b: any) => getGroupId(a.id) - getGroupId(b.id));

      const COLUMNS = 4; // 화면 비율에 맞게 4열로 구성
      const SPACING = 250; // 그룹 간 여백
      let currentX = 0;
      let currentY = 0;
      let rowMaxHeight = 0;
      let gridIndex = 0;

      // [NEW] 내부 장비들도 일렬로 늘어지지 않게 4단(4열) 그리드로 강제 재배치 및 그룹 크기 재계산
      layoutedGraph.children.forEach((child: any) => {
        if (child.children && child.children.length > 0) {
          // 전진배치(13번 그룹)는 가로로 꽉 차야 하므로 18열 정도로 넓게 펴고, 나머지는 4단(열) 배치
          const isForwardGroup = getGroupId(child.id) === 13;
          const DEVICE_COLS = isForwardGroup ? 18 : 4; 
          
          const PADDING_TOP = 70;
          const PADDING_LEFT = 30;
          const PADDING_BOTTOM = 50;
          const PADDING_RIGHT = 30;
          const DEVICE_SPACING_X = 40;
          const DEVICE_SPACING_Y = 40;

          // 장비 ID 오름차순 정렬
          child.children.sort((a: any, b: any) => getGroupId(a.id) - getGroupId(b.id));

          let dx = PADDING_LEFT;
          let dy = PADDING_TOP;
          let dMaxHeight = 0;

          child.children.forEach((dev: any, i: number) => {
            dev.x = dx;
            dev.y = dy;
            
            const w = dev.width || (dev.type === 'deviceNode' ? 180 : 200);
            const h = dev.height || (dev.type === 'deviceNode' ? 48 : 100);
            
            dx += w + DEVICE_SPACING_X;
            dMaxHeight = Math.max(dMaxHeight, h);

            if ((i + 1) % DEVICE_COLS === 0) {
              dx = PADDING_LEFT;
              dy += dMaxHeight + DEVICE_SPACING_Y;
              dMaxHeight = 0;
            }
          });

          // 내부 요소 배치에 맞춰 부모(그룹) 박스 크기 강제 재계산
          const totalRows = Math.ceil(child.children.length / DEVICE_COLS);
          const actualCols = Math.min(child.children.length, DEVICE_COLS);
          const maxDeviceWidth = 180; // default device width
          const maxDeviceHeight = 48; // default device height
          
          child.width = PADDING_LEFT + actualCols * (maxDeviceWidth + DEVICE_SPACING_X) - DEVICE_SPACING_X + PADDING_RIGHT;
          child.height = PADDING_TOP + totalRows * (maxDeviceHeight + DEVICE_SPACING_Y) - DEVICE_SPACING_Y + PADDING_BOTTOM;
        }
      });

      // 1. '전진배치' (group-13) 그룹을 찾아 먼저 최상단에 배치
      const forwardIndex = layoutedGraph.children.findIndex((c: any) => getGroupId(c.id) === 13);
      let forwardGroup: any = null;
      if (forwardIndex !== -1) {
        forwardGroup = layoutedGraph.children.splice(forwardIndex, 1)[0];
        forwardGroup.x = 0;
        forwardGroup.y = 0;
        // 전진배치 그룹의 높이만큼 다음 Y 좌표를 내림 (가로로 매우 길게 표시됨)
        currentY = (forwardGroup.height || 0) + SPACING;
      }

      // 2. 나머지 그룹들을 그 아래부터 4열 격자로 배치
      layoutedGraph.children.forEach((child: any) => {
        child.x = currentX;
        child.y = currentY;
        
        currentX += (child.width || 0) + SPACING;
        rowMaxHeight = Math.max(rowMaxHeight, (child.height || 0));

        gridIndex++;
        // 줄바꿈 처리
        if (gridIndex % COLUMNS === 0) {
          currentX = 0;
          currentY += rowMaxHeight + SPACING;
          rowMaxHeight = 0;
        }
      });

      // 3. 빼두었던 전진배치 그룹을 다시 배열 맨 앞에 합쳐줌
      if (forwardGroup) {
        layoutedGraph.children.unshift(forwardGroup);
      }
    }

    // Recursively extract positions and update React Flow nodes
    const flattenElkNodes = (elkNode: any, result: Record<string, any> = {}) => {
      if (elkNode.id !== 'root') {
        result[elkNode.id] = {
          x: elkNode.x,
          y: elkNode.y,
          width: elkNode.width,
          height: elkNode.height,
        };
      }
      if (elkNode.children) {
        elkNode.children.forEach((child: any) => flattenElkNodes(child, result));
      }
      return result;
    };

    const layoutedPositions = flattenElkNodes(layoutedGraph);

    const layoutedNodes = nodes.map((node) => {
      const pos = layoutedPositions[node.id];
      if (pos) {
        return {
          ...node,
          position: { x: pos.x, y: pos.y },
          style: { ...node.style, width: pos.width, height: pos.height },
        };
      }
      return node;
    });

    return { nodes: layoutedNodes, edges };
  } catch (error) {
    console.error('ELK layout failed:', error);
    return { nodes, edges }; // Fallback to original
  }
};
