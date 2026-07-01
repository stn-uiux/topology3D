/**
 * pathFinder.ts
 * 
 * Yen's K-Shortest Paths 알고리즘 기반 경로 탐색 유틸리티.
 * response.json의 원본 링크 데이터를 사용하여 장비(device) 단위 그래프를 구성하고,
 * 홉 카운트(최소) 또는 여유 대역폭(최대) 기준으로 최적 경로를 탐색합니다.
 */

import { getRawData } from '../data';

export interface PathResult {
  path: number[];          // deviceId 배열 (경로 순서)
  hopCount: number;        // 홉 수
  minAvailBandwidth: number; // 경로 내 최소 여유 대역폭 (Mbps)
  pathDescription: string; // 경로 설명 문자열
}

interface EdgeInfo {
  neighbor: number;
  availBandWidth: number;  // 해당 엣지의 여유 대역폭
  totalBandWidth: number;
}

type AdjacencyMap = Map<number, EdgeInfo[]>;

/**
 * 원본 데이터로부터 장비 단위 인접 그래프를 구성합니다.
 * 동일 장비 쌍 간 여러 링크가 있을 경우 최대 여유 대역폭을 대표값으로 사용합니다.
 */
function buildAdjacencyMap(): { adj: AdjacencyMap; deviceNameMap: Map<number, string> } {
  const raw = getRawData();
  if (!raw) return { adj: new Map(), deviceNameMap: new Map() };

  const adj: AdjacencyMap = new Map();
  const deviceNameMap = new Map<number, string>();

  // 장비 이름 매핑
  for (const node of raw.nodes) {
    deviceNameMap.set(node.deviceId, node.deviceName.replace(/\s*IP-MPLS/gi, ''));
    if (!adj.has(node.deviceId)) {
      adj.set(node.deviceId, []);
    }
  }

  // 동일 장비 쌍의 최대 대역폭을 추적하기 위한 맵
  const bestEdge = new Map<string, EdgeInfo & { from: number }>();

  for (const link of raw.links) {
    const key1 = `${link.srcDeviceId}-${link.dstDeviceId}`;
    const key2 = `${link.dstDeviceId}-${link.srcDeviceId}`;

    // 양방향 모두에 대해 최대 여유 대역폭 엣지를 유지
    const existing1 = bestEdge.get(key1);
    if (!existing1 || link.availBandWidth > existing1.availBandWidth) {
      bestEdge.set(key1, {
        from: link.srcDeviceId,
        neighbor: link.dstDeviceId,
        availBandWidth: link.availBandWidth,
        totalBandWidth: link.totalBandWidth,
      });
    }

    const existing2 = bestEdge.get(key2);
    if (!existing2 || link.availBandWidth > existing2.availBandWidth) {
      bestEdge.set(key2, {
        from: link.dstDeviceId,
        neighbor: link.srcDeviceId,
        availBandWidth: link.availBandWidth,
        totalBandWidth: link.totalBandWidth,
      });
    }
  }

  // 인접 리스트에 최적 엣지 추가
  for (const [, edge] of bestEdge) {
    const neighbors = adj.get(edge.from);
    if (neighbors) {
      neighbors.push({
        neighbor: edge.neighbor,
        availBandWidth: edge.availBandWidth,
        totalBandWidth: edge.totalBandWidth,
      });
    }
  }

  return { adj, deviceNameMap };
}

/**
 * Dijkstra 최단 경로 (홉 카운트 기준 또는 대역폭 기준)
 */
function dijkstra(
  adj: AdjacencyMap,
  source: number,
  target: number,
  criterion: 'hop' | 'bandwidth',
  removedEdges?: Set<string>,
  removedNodes?: Set<number>
): { path: number[]; cost: number; minBw: number } | null {
  // 거리/비용 테이블
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const minBw = new Map<number, number>(); // 경로 내 최소 대역폭 추적
  const visited = new Set<number>();

  dist.set(source, criterion === 'hop' ? 0 : 0);
  minBw.set(source, Infinity);

  // 간단한 우선순위 큐 (작은 규모의 그래프에 적합)
  while (true) {
    let u = -1;
    let bestCost = criterion === 'hop' ? Infinity : -Infinity;

    for (const [node, cost] of dist) {
      if (visited.has(node)) continue;
      if (removedNodes?.has(node)) continue;

      if (criterion === 'hop') {
        if (cost < bestCost) {
          bestCost = cost;
          u = node;
        }
      } else {
        // bandwidth: 최대 최소 대역폭을 가진 경로 선택
        const bw = minBw.get(node) ?? 0;
        if (bw > bestCost) {
          bestCost = bw;
          u = node;
        }
      }
    }

    if (u === -1) break;
    if (u === target) break;

    visited.add(u);

    const neighbors = adj.get(u);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      if (visited.has(edge.neighbor)) continue;
      if (removedNodes?.has(edge.neighbor)) continue;

      const edgeKey = `${u}-${edge.neighbor}`;
      if (removedEdges?.has(edgeKey)) continue;

      if (criterion === 'hop') {
        const newDist = (dist.get(u) ?? Infinity) + 1;
        if (newDist < (dist.get(edge.neighbor) ?? Infinity)) {
          dist.set(edge.neighbor, newDist);
          prev.set(edge.neighbor, u);
          minBw.set(edge.neighbor, Math.min(minBw.get(u) ?? Infinity, edge.availBandWidth));
        }
      } else {
        // bandwidth: 경로 내 최소 대역폭을 최대화
        const pathMinBw = Math.min(minBw.get(u) ?? Infinity, edge.availBandWidth);
        if (pathMinBw > (minBw.get(edge.neighbor) ?? -1)) {
          dist.set(edge.neighbor, pathMinBw); // dist는 사실상 사용하지 않지만 기록
          minBw.set(edge.neighbor, pathMinBw);
          prev.set(edge.neighbor, u);
        }
      }
    }
  }

  if (!prev.has(target) && source !== target) return null;

  // 경로 복원
  const path: number[] = [];
  let cur = target;
  while (cur !== source) {
    path.unshift(cur);
    const p = prev.get(cur);
    if (p === undefined) return null;
    cur = p;
  }
  path.unshift(source);

  return {
    path,
    cost: criterion === 'hop' ? path.length - 1 : (minBw.get(target) ?? 0),
    minBw: minBw.get(target) ?? 0,
  };
}

/**
 * Yen's K-Shortest Paths 알고리즘
 * @param source 출발 장비 deviceId
 * @param target 도착 장비 deviceId
 * @param k 최대 경로 수
 * @param criterion 탐색 기준
 */
export function findKShortestPaths(
  source: number,
  target: number,
  k: number,
  criterion: 'hop' | 'bandwidth'
): PathResult[] {
  const { adj, deviceNameMap } = buildAdjacencyMap();
  if (adj.size === 0) return [];

  const getName = (id: number) => deviceNameMap.get(id) || `장비 ${id}`;

  // 첫 번째 최단 경로
  const first = dijkstra(adj, source, target, criterion);
  if (!first) return [];

  const A: { path: number[]; cost: number; minBw: number }[] = [first];
  const B: { path: number[]; cost: number; minBw: number }[] = [];
  const pathStrings = new Set<string>();
  pathStrings.add(first.path.join(','));

  for (let ki = 1; ki < k; ki++) {
    const prevPath = A[A.length - 1].path;

    for (let i = 0; i < prevPath.length - 1; i++) {
      const spurNode = prevPath[i];
      const rootPath = prevPath.slice(0, i + 1);

      const removedEdges = new Set<string>();
      const removedNodes = new Set<number>();

      // 기존 A 경로들에서 동일한 rootPath를 가진 경로의 다음 엣지를 제거
      for (const aPath of A) {
        if (aPath.path.length > i) {
          const matchRoot = aPath.path.slice(0, i + 1).join(',') === rootPath.join(',');
          if (matchRoot && i + 1 < aPath.path.length) {
            removedEdges.add(`${aPath.path[i]}-${aPath.path[i + 1]}`);
          }
        }
      }

      // rootPath의 중간 노드들 제거 (spur node 제외)
      for (let j = 0; j < i; j++) {
        removedNodes.add(rootPath[j]);
      }

      const spurResult = dijkstra(adj, spurNode, target, criterion, removedEdges, removedNodes);
      if (spurResult) {
        const totalPath = [...rootPath.slice(0, -1), ...spurResult.path];

        // rootPath 구간의 최소 대역폭도 계산
        let rootMinBw = Infinity;
        for (let j = 0; j < rootPath.length - 1; j++) {
          const neighbors = adj.get(rootPath[j]);
          if (neighbors) {
            const edge = neighbors.find(e => e.neighbor === rootPath[j + 1]);
            if (edge) {
              rootMinBw = Math.min(rootMinBw, edge.availBandWidth);
            }
          }
        }

        const totalMinBw = Math.min(
          rootMinBw === Infinity ? spurResult.minBw : rootMinBw,
          spurResult.minBw
        );

        const pathStr = totalPath.join(',');
        if (!pathStrings.has(pathStr)) {
          pathStrings.add(pathStr);
          B.push({
            path: totalPath,
            cost: criterion === 'hop' ? totalPath.length - 1 : totalMinBw,
            minBw: totalMinBw,
          });
        }
      }
    }

    if (B.length === 0) break;

    // B에서 최적 경로를 선택하여 A에 추가
    if (criterion === 'hop') {
      B.sort((a, b) => a.cost - b.cost || b.minBw - a.minBw);
    } else {
      B.sort((a, b) => b.cost - a.cost);
    }

    A.push(B.shift()!);
  }

  return A.map((result, idx) => ({
    path: result.path,
    hopCount: result.path.length - 1,
    minAvailBandwidth: result.minBw,
    pathDescription: result.path.map(id => getName(id)).join(' → '),
  }));
}

/**
 * 선택한 두 그룹의 장비들 사이에서 가장 적은 홉 순으로 K개의 경로를 찾아 추천합니다.
 * @param srcGroupId 출발 그룹 ID
 * @param dstGroupId 도착 그룹 ID
 * @param k 추천할 경로 수
 */
export function findGroupToGroupPaths(
  srcGroupId: number,
  dstGroupId: number,
  k: number = 5
): PathResult[] {
  const raw = getRawData();
  if (!raw) return [];

  const srcDevices = raw.nodes.filter(n => n.deviceGroupId === srcGroupId).map(n => n.deviceId);
  const dstDevices = raw.nodes.filter(n => n.deviceGroupId === dstGroupId).map(n => n.deviceId);

  if (srcDevices.length === 0 || dstDevices.length === 0) return [];

  const { adj, deviceNameMap } = buildAdjacencyMap();
  if (adj.size === 0) return [];
  const getName = (id: number) => deviceNameMap.get(id) || `장비 ${id}`;

  const allPaths: PathResult[] = [];

  for (const src of srcDevices) {
    for (const dst of dstDevices) {
      if (src === dst) continue;
      
      const result = dijkstra(adj, src, dst, 'hop');
      if (result) {
        allPaths.push({
          path: result.path,
          hopCount: result.cost,
          minAvailBandwidth: result.minBw,
          pathDescription: result.path.map(id => getName(id)).join(' → '),
        });
      }
    }
  }

  // 홉 수가 가장 적은 순으로 정렬하고 상위 k개 반환
  allPaths.sort((a, b) => a.hopCount - b.hopCount || b.minAvailBandwidth - a.minAvailBandwidth);
  
  return allPaths.slice(0, k);
}

export function findMixedPaths(
  srcType: 'group' | 'device',
  srcId: number,
  dstType: 'group' | 'device',
  dstId: number,
  k: number = 5
): PathResult[] {
  const raw = getRawData();
  if (!raw) return [];

  const srcDevices = srcType === 'group' 
    ? raw.nodes.filter(n => n.deviceGroupId === srcId).map(n => n.deviceId).filter(Boolean) as number[]
    : [srcId];
  const dstDevices = dstType === 'group'
    ? raw.nodes.filter(n => n.deviceGroupId === dstId).map(n => n.deviceId).filter(Boolean) as number[]
    : [dstId];

  if (srcDevices.length === 0 || dstDevices.length === 0) return [];

  const { adj, deviceNameMap } = buildAdjacencyMap();
  if (adj.size === 0) return [];
  const getName = (id: number) => deviceNameMap.get(id) || `장비 ${id}`;

  const allPaths: PathResult[] = [];

  for (const src of srcDevices) {
    for (const dst of dstDevices) {
      if (src === dst) continue;
      
      const result = dijkstra(adj, src, dst, 'hop');
      if (result) {
        allPaths.push({
          path: result.path,
          hopCount: result.cost,
          minAvailBandwidth: result.minBw,
          pathDescription: result.path.map(id => getName(id)).join(' → '),
        });
      }
    }
  }

  allPaths.sort((a, b) => a.hopCount - b.hopCount || b.minAvailBandwidth - a.minAvailBandwidth);
  return allPaths.slice(0, k);
}
