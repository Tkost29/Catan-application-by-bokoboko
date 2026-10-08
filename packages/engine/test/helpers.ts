import { expect } from 'vitest';
import {
  apply,
  createRng,
  legalActions,
  RESOURCES,
  STANDARD_TOPOLOGY as T,
  type Action,
  type GameState,
} from '../src/index.js';

/**
 * どの状態でも成り立つべき条件。ルールを追加しても常にこれを通すこと。
 */
export function checkInvariants(state: GameState): void {
  const { config } = state;

  // 資源の総数は銀行＋全員の手札で常に一定
  for (const r of RESOURCES) {
    const total = state.bank[r] + state.players.reduce((s, p) => s + p.hand[r], 0);
    expect(total, `resource ${r}`).toBe(config.resourcesPerType);
  }

  for (const p of state.players) {
    // 駒の残り数は 0 以上、置かれた数と合計が上限に一致
    const settlements = state.buildings.filter((b) => b?.owner === p.seat && b.kind === 'settlement').length;
    const cities = state.buildings.filter((b) => b?.owner === p.seat && b.kind === 'city').length;
    const roads = state.roads.filter((o) => o === p.seat).length;
    expect(p.piecesLeft.settlement + settlements).toBe(config.pieceLimits.settlement);
    expect(p.piecesLeft.city + cities).toBe(config.pieceLimits.city);
    expect(p.piecesLeft.road + roads).toBe(config.pieceLimits.road);
    for (const n of Object.values(p.piecesLeft)) expect(n).toBeGreaterThanOrEqual(0);
    for (const r of RESOURCES) expect(p.hand[r]).toBeGreaterThanOrEqual(0);
  }

  // 距離ルール: 隣り合う頂点の両方に建物はない
  state.buildings.forEach((b, v) => {
    if (b === null) return;
    for (const n of T.vertexNeighbors[v]!) expect(state.buildings[n], `vertex ${v} and ${n}`).toBeNull();
  });

  // 発展カードの総数は保存される
  const devTotal = Object.values(config.devCardCounts).reduce((a, b) => a + b, 0);
  const held = state.players.reduce((s, p) => s + p.devCards.length, 0);
  expect(state.devDeck.length + held).toBeLessThanOrEqual(devTotal);
}

/**
 * 合法手からランダムに選んで、合法手がなくなるまで進める。
 * 返り値は最終状態と、適用したアクション列。
 */
export function playRandomly(
  start: GameState,
  rngSeed: string,
  maxSteps = 10_000,
  onStep?: (s: GameState) => void,
): { state: GameState; actions: Action[] } {
  const rng = createRng(rngSeed);
  let state = start;
  const actions: Action[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const legal = legalActions(state, state.currentSeat);
    if (legal.length === 0) break;
    const action = legal[rng.int(legal.length)]!;
    state = apply(state, action);
    actions.push(action);
    onStep?.(state);
  }
  return { state, actions };
}
