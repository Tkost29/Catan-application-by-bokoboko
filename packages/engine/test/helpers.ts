import { expect } from 'vitest';
import {
  apply,
  awaitingSeats,
  createGame,
  createRng,
  emptyResources,
  legalActions,
  RESOURCES,
  STANDARD_TOPOLOGY as T,
  type Action,
  type EdgeId,
  type GameState,
  type ResourceCounts,
  type Seat,
  type VertexId,
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
    expect(state.bank[r]).toBeGreaterThanOrEqual(0);
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

  // 盗賊は盤面の上
  expect(state.robberHex).toBeGreaterThanOrEqual(0);
  expect(state.robberHex).toBeLessThan(state.board.terrains.length);

  // 発展カードの総数は保存される
  const devTotal = Object.values(config.devCardCounts).reduce((a, b) => a + b, 0);
  const held = state.players.reduce((s, p) => s + p.devCards.length, 0);
  expect(state.devDeck.length + held).toBeLessThanOrEqual(devTotal);
}

export type Policy = (legal: Action[], rng: ReturnType<typeof createRng>) => Action;

/** 合法手から一様ランダムに選ぶ */
export const uniformPolicy: Policy = (legal, rng) => legal[rng.int(legal.length)]!;

/**
 * 建設できるなら優先して建設し、交易は時々、手番終了は他に何もなければ選ぶ。
 * 一様ランダムだとゲームがなかなか終わらないので、通しプレイの確認用に使う。
 */
export const builderPolicy: Policy = (legal, rng) => {
  const pick = (types: Action['type'][]): Action | undefined => {
    const xs = legal.filter((a) => types.includes(a.type));
    return xs.length > 0 ? xs[rng.int(xs.length)] : undefined;
  };
  return (
    pick(['buildCity']) ??
    pick(['buildSettlement']) ??
    (rng.next() < 0.5 ? pick(['buildRoad']) : undefined) ??
    (rng.next() < 0.3 ? pick(['bankTrade']) : undefined) ??
    pick(['endTurn']) ??
    legal[rng.int(legal.length)]!
  );
};

/**
 * 入力待ちの席の合法手から1つ選んで、合法手がなくなるか maxSteps に達するまで進める。
 * 返り値は最終状態と、適用したアクション列。
 */
export function playRandomly(
  start: GameState,
  rngSeed: string,
  maxSteps = 10_000,
  onStep?: (s: GameState) => void,
  policy: Policy = uniformPolicy,
): { state: GameState; actions: Action[] } {
  const rng = createRng(rngSeed);
  let state = start;
  const actions: Action[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const seat = awaitingSeats(state)[0];
    if (seat === undefined) break;
    const legal = legalActions(state, seat);
    if (legal.length === 0) break;
    const action = policy(legal, rng);
    state = apply(state, action);
    actions.push(action);
    onStep?.(state);
  }
  return { state, actions };
}

/** 初期配置を「合法手の先頭」で最後まで進めた状態 */
export function afterSetup(seed: string): GameState {
  let s = createGame(seed);
  while (s.phase.kind === 'setup') s = apply(s, legalActions(s, s.currentSeat)[0]!);
  return s;
}

/**
 * 何も置かれていない盤面で、席0の main フェーズから始まる状態（ルール単体のテスト用）。
 * 手札は銀行から引いた形にして資源の総数を保つ。
 */
export function emptyBoardMain(seed: string, hands: Partial<Record<Seat, Partial<ResourceCounts>>> = {}): GameState {
  const g = createGame(seed);
  const bank = { ...g.bank };
  const players = g.players.map((p) => {
    const hand = { ...emptyResources(), ...(hands[p.seat] ?? {}) };
    for (const r of RESOURCES) bank[r] -= hand[r];
    return { ...p, hand };
  });
  return { ...g, bank, players, phase: { kind: 'main' }, turn: 1, currentSeat: 0 };
}

/** 状態に建物と道を直接置く（駒の残り数も合わせる） */
export function place(
  state: GameState,
  items: {
    settlements?: [Seat, VertexId][];
    cities?: [Seat, VertexId][];
    roads?: [Seat, EdgeId][];
  },
): GameState {
  const buildings = state.buildings.slice();
  const roads = state.roads.slice();
  const players = state.players.map((p) => ({ ...p, piecesLeft: { ...p.piecesLeft } }));
  for (const [seat, v] of items.settlements ?? []) {
    buildings[v] = { owner: seat, kind: 'settlement' };
    players[seat]!.piecesLeft.settlement -= 1;
  }
  for (const [seat, v] of items.cities ?? []) {
    buildings[v] = { owner: seat, kind: 'city' };
    players[seat]!.piecesLeft.city -= 1;
  }
  for (const [seat, e] of items.roads ?? []) {
    roads[e] = seat;
    players[seat]!.piecesLeft.road -= 1;
  }
  return { ...state, buildings, roads, players };
}

/** start から始まる、同じ頂点を2度通らない長さ n の道（辺の列）を1つ探す */
export function simplePath(start: VertexId, n: number): EdgeId[] {
  const path: EdgeId[] = [];
  const seen = new Set<VertexId>([start]);
  const dfs = (v: VertexId): boolean => {
    if (path.length === n) return true;
    for (const e of T.vertexEdges[v]!) {
      const [a, b] = T.edgeVertices[e]!;
      const next = a === v ? b : a;
      if (seen.has(next)) continue;
      seen.add(next);
      path.push(e);
      if (dfs(next)) return true;
      path.pop();
      seen.delete(next);
    }
    return false;
  };
  if (!dfs(start)) throw new Error(`no simple path of length ${n} from ${start}`);
  return path;
}

/** 道 path の頂点列 */
export function pathVertices(start: VertexId, path: EdgeId[]): VertexId[] {
  const vs = [start];
  for (const e of path) {
    const [a, b] = T.edgeVertices[e]!;
    vs.push(a === vs.at(-1) ? b : a);
  }
  return vs;
}
