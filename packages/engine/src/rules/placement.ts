import type { Topology } from '../board/topology.js';
import type { GameState } from '../state.js';
import type { EdgeId, Seat, VertexId } from '../types.js';

/**
 * 距離ルール: 頂点が空いていて、辺で隣り合う頂点にも建物がないこと。
 * 初期配置でも通常手番でも共通のルール。
 */
export function satisfiesDistanceRule(state: GameState, topology: Topology, vertex: VertexId): boolean {
  if (state.buildings[vertex] !== null) return false;
  return topology.vertexNeighbors[vertex]!.every((n) => state.buildings[n] === null);
}

/** 道を置ける空き辺か */
export function isEdgeEmpty(state: GameState, edge: EdgeId): boolean {
  return state.roads[edge] === null;
}

/** 頂点がその席の開拓地か都市か */
export function ownsBuildingAt(state: GameState, vertex: VertexId, seat: Seat): boolean {
  return state.buildings[vertex]?.owner === seat;
}
