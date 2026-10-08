import { topologyFor } from '../board/generate.js';
import type { Action } from '../actions.js';
import type { GameState, Phase, PlayerState } from '../state.js';
import { TERRAIN_RESOURCE, type ResourceCounts, type Seat } from '../types.js';
import { isEdgeEmpty, satisfiesDistanceRule } from './placement.js';

type SetupPhase = Extract<Phase, { kind: 'setup' }>;
type SetupAction = Extract<Action, { type: 'placeSettlement' | 'placeRoad' }>;

/**
 * 初期配置のアクションが不正なら理由を返す。合法なら null。
 * legalActions と apply の両方がこの関数を使うので、判定は1か所にまとまる。
 */
export function validateSetupAction(state: GameState, phase: SetupPhase, action: SetupAction): string | null {
  const topology = topologyFor(state.config);
  if (action.type === 'placeSettlement') {
    if (phase.step !== 'settlement') return 'a road must be placed now';
    const { vertex } = action;
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= state.buildings.length) return 'no such vertex';
    if (!satisfiesDistanceRule(state, topology, vertex)) return 'vertex is occupied or too close to another building';
    return null;
  }
  if (phase.step !== 'road') return 'a settlement must be placed now';
  const { edge } = action;
  if (!Number.isInteger(edge) || edge < 0 || edge >= state.roads.length) return 'no such edge';
  if (!isEdgeEmpty(state, edge)) return 'edge already has a road';
  const [a, b] = topology.edgeVertices[edge]!;
  if (a !== phase.lastSettlement && b !== phase.lastSettlement) {
    return 'road must touch the settlement just placed';
  }
  return null;
}

/** 初期配置で currentSeat が取りうるアクションの候補（validate で絞る前） */
export function setupCandidates(state: GameState, phase: SetupPhase): SetupAction[] {
  const seat = state.currentSeat;
  if (phase.step === 'settlement') {
    return state.buildings.map((_, vertex) => ({ type: 'placeSettlement', seat, vertex }));
  }
  const topology = topologyFor(state.config);
  const edges = phase.lastSettlement === null ? [] : topology.vertexEdges[phase.lastSettlement]!;
  return edges.map((edge) => ({ type: 'placeRoad', seat, edge }));
}

/** 検証済みの初期配置アクションを適用した新しい状態を返す */
export function applySetupAction(state: GameState, phase: SetupPhase, action: SetupAction): GameState {
  return action.type === 'placeSettlement'
    ? placeSetupSettlement(state, phase, action.seat, action.vertex)
    : placeSetupRoad(state, phase, action.seat, action.edge);
}

function updatePlayer(state: GameState, seat: Seat, update: (p: PlayerState) => PlayerState): PlayerState[] {
  return state.players.map((p) => (p.seat === seat ? update(p) : p));
}

function placeSetupSettlement(state: GameState, phase: SetupPhase, seat: Seat, vertex: number): GameState {
  const buildings = state.buildings.slice();
  buildings[vertex] = { owner: seat, kind: 'settlement' };

  // 2巡目の開拓地は、接するヘックスの資源を1枚ずつ受け取る
  let bank = state.bank;
  let gained: Partial<ResourceCounts> = {};
  if (phase.round === 2) {
    const topology = topologyFor(state.config);
    const nextBank = { ...bank };
    const nextGained: Partial<ResourceCounts> = {};
    for (const hex of topology.vertexHexes[vertex]!) {
      const resource = TERRAIN_RESOURCE[state.board.terrains[hex]!];
      if (resource === null || nextBank[resource] <= 0) continue;
      nextBank[resource] -= 1;
      nextGained[resource] = (nextGained[resource] ?? 0) + 1;
    }
    bank = nextBank;
    gained = nextGained;
  }

  const players = updatePlayer(state, seat, (p) => {
    const hand = { ...p.hand };
    for (const [r, n] of Object.entries(gained) as [keyof ResourceCounts, number][]) hand[r] += n;
    return { ...p, hand, piecesLeft: { ...p.piecesLeft, settlement: p.piecesLeft.settlement - 1 } };
  });

  return {
    ...state,
    buildings,
    bank,
    players,
    phase: { ...phase, step: 'road', lastSettlement: vertex },
  };
}

function placeSetupRoad(state: GameState, phase: SetupPhase, seat: Seat, edge: number): GameState {
  const roads = state.roads.slice();
  roads[edge] = seat;
  const players = updatePlayer(state, seat, (p) => ({
    ...p,
    piecesLeft: { ...p.piecesLeft, road: p.piecesLeft.road - 1 },
  }));
  const placed: GameState = { ...state, roads, players };

  // 1巡目は席順に進み、最後の席はそのまま2巡目の先頭になる。2巡目は逆順に戻る
  const last = state.config.playerCount - 1;
  if (phase.round === 1) {
    return seat < last
      ? { ...placed, currentSeat: seat + 1, phase: { kind: 'setup', round: 1, step: 'settlement', lastSettlement: null } }
      : { ...placed, currentSeat: last, phase: { kind: 'setup', round: 2, step: 'settlement', lastSettlement: null } };
  }
  return seat > 0
    ? { ...placed, currentSeat: seat - 1, phase: { kind: 'setup', round: 2, step: 'settlement', lastSettlement: null } }
    : { ...placed, currentSeat: 0, turn: 1, phase: { kind: 'preRoll' } };
}
