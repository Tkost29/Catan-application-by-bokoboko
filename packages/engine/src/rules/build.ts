import { portVertices, topologyFor } from '../board/generate.js';
import type { ActionOf } from '../actions.js';
import type { GameState } from '../state.js';
import { RESOURCES, type EdgeId, type Resource, type Seat, type VertexId } from '../types.js';
import { hasResources, payToBank, takeFromBank, updatePlayer } from './common.js';
import { isEdgeEmpty, ownsBuildingAt, satisfiesDistanceRule } from './placement.js';
import { updateLongestRoad } from './score.js';

// ---------------------------------------------------------------------------
// 接続の判定
// ---------------------------------------------------------------------------

/** 辺が自分の建物か、（相手の建物で分断されていない）自分の道につながっているか */
export function roadConnects(state: GameState, seat: Seat, edge: EdgeId): boolean {
  const topology = topologyFor(state.config);
  return topology.edgeVertices[edge]!.some((v) => {
    const b = state.buildings[v];
    if (b?.owner === seat) return true;
    if (b) return false; // 相手の建物の先には伸ばせない
    return topology.vertexEdges[v]!.some((e) => e !== edge && state.roads[e] === seat);
  });
}

/** 頂点に自分の道がつながっているか */
export function vertexTouchesOwnRoad(state: GameState, seat: Seat, vertex: VertexId): boolean {
  return topologyFor(state.config).vertexEdges[vertex]!.some((e) => state.roads[e] === seat);
}

// ---------------------------------------------------------------------------
// 建設
// ---------------------------------------------------------------------------

export function validateBuildRoad(state: GameState, action: ActionOf<'buildRoad'>): string | null {
  const { seat, edge } = action;
  if (!Number.isInteger(edge) || edge < 0 || edge >= state.roads.length) return 'no such edge';
  if (state.players[seat]!.piecesLeft.road <= 0) return 'no roads left';
  if (!hasResources(state.players[seat]!.hand, state.config.buildCosts.road)) return 'not enough resources';
  if (!isEdgeEmpty(state, edge)) return 'edge already has a road';
  if (!roadConnects(state, seat, edge)) return 'road must connect to your road or building';
  return null;
}

export function validateBuildSettlement(state: GameState, action: ActionOf<'buildSettlement'>): string | null {
  const { seat, vertex } = action;
  if (!Number.isInteger(vertex) || vertex < 0 || vertex >= state.buildings.length) return 'no such vertex';
  if (state.players[seat]!.piecesLeft.settlement <= 0) return 'no settlements left';
  if (!hasResources(state.players[seat]!.hand, state.config.buildCosts.settlement)) return 'not enough resources';
  if (!satisfiesDistanceRule(state, topologyFor(state.config), vertex)) {
    return 'vertex is occupied or too close to another building';
  }
  if (!vertexTouchesOwnRoad(state, seat, vertex)) return 'settlement must touch your road';
  return null;
}

export function validateBuildCity(state: GameState, action: ActionOf<'buildCity'>): string | null {
  const { seat, vertex } = action;
  if (!Number.isInteger(vertex) || vertex < 0 || vertex >= state.buildings.length) return 'no such vertex';
  if (state.players[seat]!.piecesLeft.city <= 0) return 'no cities left';
  if (!hasResources(state.players[seat]!.hand, state.config.buildCosts.city)) return 'not enough resources';
  const b = state.buildings[vertex];
  if (!ownsBuildingAt(state, vertex, seat) || b?.kind !== 'settlement') return 'city must replace your settlement';
  return null;
}

export function applyBuildRoad(state: GameState, action: ActionOf<'buildRoad'>): GameState {
  const paid = payToBank(state, action.seat, state.config.buildCosts.road);
  const roads = paid.roads.slice();
  roads[action.edge] = action.seat;
  return updateLongestRoad({
    ...paid,
    roads,
    players: updatePlayer(paid, action.seat, (p) => ({
      ...p,
      piecesLeft: { ...p.piecesLeft, road: p.piecesLeft.road - 1 },
    })),
  });
}

export function applyBuildSettlement(state: GameState, action: ActionOf<'buildSettlement'>): GameState {
  const paid = payToBank(state, action.seat, state.config.buildCosts.settlement);
  const buildings = paid.buildings.slice();
  buildings[action.vertex] = { owner: action.seat, kind: 'settlement' };
  // 開拓地は他人の道を分断しうるので最長交易路を再計算する
  return updateLongestRoad({
    ...paid,
    buildings,
    players: updatePlayer(paid, action.seat, (p) => ({
      ...p,
      piecesLeft: { ...p.piecesLeft, settlement: p.piecesLeft.settlement - 1 },
    })),
  });
}

export function applyBuildCity(state: GameState, action: ActionOf<'buildCity'>): GameState {
  const paid = payToBank(state, action.seat, state.config.buildCosts.city);
  const buildings = paid.buildings.slice();
  buildings[action.vertex] = { owner: action.seat, kind: 'city' };
  return {
    ...paid,
    buildings,
    players: updatePlayer(paid, action.seat, (p) => ({
      ...p,
      // 都市にすると開拓地の駒は手元に戻る
      piecesLeft: { ...p.piecesLeft, city: p.piecesLeft.city - 1, settlement: p.piecesLeft.settlement + 1 },
    })),
  };
}

// ---------------------------------------------------------------------------
// 海外交易（銀行・港）
// ---------------------------------------------------------------------------

const BANK_RATE = 4;
const GENERIC_PORT_RATE = 3;
const SPECIAL_PORT_RATE = 2;

/** resource を1枚もらうのに必要な枚数（持っている港で最良のレート） */
export function tradeRate(state: GameState, seat: Seat, resource: Resource): number {
  const topology = topologyFor(state.config);
  let rate = BANK_RATE;
  for (const port of state.board.ports) {
    if (!portVertices(topology, port).some((v) => ownsBuildingAt(state, v, seat))) continue;
    if (port.kind === resource) rate = Math.min(rate, SPECIAL_PORT_RATE);
    else if (port.kind === 'generic') rate = Math.min(rate, GENERIC_PORT_RATE);
  }
  return rate;
}

export function validateBankTrade(state: GameState, action: ActionOf<'bankTrade'>): string | null {
  const { seat, give, receive } = action;
  if (!RESOURCES.includes(give) || !RESOURCES.includes(receive)) return 'unknown resource';
  if (give === receive) return 'must receive a different resource';
  if (state.players[seat]!.hand[give] < tradeRate(state, seat, give)) return 'not enough cards to trade';
  if (state.bank[receive] <= 0) return 'bank has none of that resource';
  return null;
}

export function applyBankTrade(state: GameState, action: ActionOf<'bankTrade'>): GameState {
  const rate = tradeRate(state, action.seat, action.give);
  const paid = payToBank(state, action.seat, { [action.give]: rate });
  return takeFromBank(paid, action.seat, { [action.receive]: 1 });
}

// ---------------------------------------------------------------------------
// main フェーズの候補と手番終了
// ---------------------------------------------------------------------------

/** main フェーズで currentSeat が取りうるアクションの候補（validate で絞る前） */
export function mainCandidates(state: GameState): ActionOf<'buildRoad' | 'buildSettlement' | 'buildCity' | 'bankTrade' | 'endTurn'>[] {
  const seat = state.currentSeat;
  const out: ActionOf<'buildRoad' | 'buildSettlement' | 'buildCity' | 'bankTrade' | 'endTurn'>[] = [];
  state.roads.forEach((_, edge) => out.push({ type: 'buildRoad', seat, edge }));
  state.buildings.forEach((_, vertex) => {
    out.push({ type: 'buildSettlement', seat, vertex });
    out.push({ type: 'buildCity', seat, vertex });
  });
  for (const give of RESOURCES) {
    for (const receive of RESOURCES) {
      if (give !== receive) out.push({ type: 'bankTrade', seat, give, receive });
    }
  }
  out.push({ type: 'endTurn', seat });
  return out;
}

export function applyEndTurn(state: GameState): GameState {
  return {
    ...state,
    currentSeat: (state.currentSeat + 1) % state.config.playerCount,
    turn: state.turn + 1,
    phase: { kind: 'preRoll' },
  };
}
