import { nextRandom } from '../rng.js';
import type { GameState, PlayerState } from '../state.js';
import { RESOURCES, type Resource, type ResourceCounts, type Seat } from '../types.js';

/** 指定した席のプレイヤーだけを差し替えた players 配列を返す */
export function updatePlayer(
  state: GameState,
  seat: Seat,
  update: (p: PlayerState) => PlayerState,
): PlayerState[] {
  return state.players.map((p) => (p.seat === seat ? update(p) : p));
}

export function playerAt(state: GameState, seat: Seat): PlayerState {
  const p = state.players[seat];
  if (p === undefined || p.seat !== seat) throw new Error(`no player at seat ${seat}`);
  return p;
}

export function totalCards(counts: Partial<ResourceCounts>): number {
  return RESOURCES.reduce((sum, r) => sum + (counts[r] ?? 0), 0);
}

/** counts を満たすだけの資源を hand が持っているか */
export function hasResources(hand: ResourceCounts, counts: Partial<ResourceCounts>): boolean {
  return RESOURCES.every((r) => hand[r] >= (counts[r] ?? 0));
}

/** a + sign * b を返す（sign は 1 か -1） */
export function addResources(a: ResourceCounts, b: Partial<ResourceCounts>, sign: 1 | -1 = 1): ResourceCounts {
  const out = { ...a };
  for (const r of RESOURCES) out[r] += sign * (b[r] ?? 0);
  return out;
}

/** プレイヤーが銀行に資源を払う */
export function payToBank(state: GameState, seat: Seat, cost: Partial<ResourceCounts>): GameState {
  return {
    ...state,
    bank: addResources(state.bank, cost, 1),
    players: updatePlayer(state, seat, (p) => ({ ...p, hand: addResources(p.hand, cost, -1) })),
  };
}

/** 銀行からプレイヤーに資源を渡す（足りるかは呼び出し側で確認済みであること） */
export function takeFromBank(state: GameState, seat: Seat, gain: Partial<ResourceCounts>): GameState {
  return {
    ...state,
    bank: addResources(state.bank, gain, -1),
    players: updatePlayer(state, seat, (p) => ({ ...p, hand: addResources(p.hand, gain, 1) })),
  };
}

/** ゲーム状態の乱数で [0, n) の整数を引き、乱数状態を進めた状態と一緒に返す */
export function drawInt(state: GameState, n: number): { value: number; state: GameState } {
  const r = nextRandom(state.rngState);
  return { value: Math.floor(r.value * n), state: { ...state, rngState: r.state } };
}

/** hand から1枚をランダムに選ぶ（枚数に比例した確率） */
export function pickRandomCard(
  state: GameState,
  hand: ResourceCounts,
): { resource: Resource | null; state: GameState } {
  const total = totalCards(hand);
  if (total === 0) return { resource: null, state };
  const draw = drawInt(state, total);
  let k = draw.value;
  for (const r of RESOURCES) {
    if (k < hand[r]) return { resource: r, state: draw.state };
    k -= hand[r];
  }
  throw new Error('unreachable');
}
