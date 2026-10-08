import { topologyFor } from '../board/generate.js';
import type { GameState } from '../state.js';
import type { EdgeId, Seat, VertexId } from '../types.js';

/** 最長交易路・最大騎士力のボーナス点 */
const BONUS_POINTS = 2;

/**
 * その席の最長の道の長さ（同じ辺を2度通らない一筆書きの最大本数）。
 * 他プレイヤーの建物がある頂点では道が分断される（そこで終わることはできるが通り抜けられない）。
 */
export function longestRoadLength(state: GameState, seat: Seat): number {
  const topology = topologyFor(state.config);
  const owned = state.roads.map((o) => o === seat);
  const used = state.roads.map(() => false);
  const blocked = (v: VertexId): boolean => {
    const b = state.buildings[v];
    return b !== null && b !== undefined && b.owner !== seat;
  };

  const dfs = (v: VertexId): number => {
    let best = 0;
    for (const e of topology.vertexEdges[v]!) {
      if (!owned[e] || used[e]) continue;
      const [a, b] = topology.edgeVertices[e]!;
      const next = a === v ? b : a;
      used[e] = true;
      best = Math.max(best, 1 + (blocked(next) ? 0 : dfs(next)));
      used[e] = false;
    }
    return best;
  };

  let best = 0;
  const starts = new Set<VertexId>();
  owned.forEach((o, e: EdgeId) => {
    if (!o) return;
    const [a, b] = topology.edgeVertices[e]!;
    starts.add(a);
    starts.add(b);
  });
  for (const v of starts) best = Math.max(best, dfs(v));
  return best;
}

/**
 * 最長交易路の保持者を更新する（道や開拓地を置いたあとに呼ぶ）。
 * - 規定の長さ（通常5）未満なら誰も持たない
 * - 今の保持者が最長タイなら保持者のまま
 * - 保持者が抜かれた／分断された場合、最長が1人ならその人、複数いれば誰も持たない
 */
export function updateLongestRoad(state: GameState): GameState {
  const lengths = state.players.map((p) => longestRoadLength(state, p.seat));
  const max = Math.max(...lengths);
  const holder = state.longestRoad;
  let next: Seat | null;
  if (max < state.config.longestRoadMinLength) {
    next = null;
  } else if (holder !== null && lengths[holder] === max) {
    next = holder;
  } else {
    const leaders = state.players.filter((p) => lengths[p.seat] === max).map((p) => p.seat);
    next = leaders.length === 1 ? leaders[0]! : null;
  }
  return next === holder ? state : { ...state, longestRoad: next };
}

/**
 * 勝利点。includeHidden が false なら他人から見える点（勝利点カードを除く）。
 */
export function victoryPoints(state: GameState, seat: Seat, includeHidden = true): number {
  let points = 0;
  for (const b of state.buildings) {
    if (b?.owner === seat) points += b.kind === 'city' ? 2 : 1;
  }
  if (state.longestRoad === seat) points += BONUS_POINTS;
  if (state.largestArmy === seat) points += BONUS_POINTS;
  if (includeHidden) {
    points += state.players[seat]!.devCards.filter((c) => c.card === 'victoryPoint').length;
  }
  return points;
}

/** 手番プレイヤーが目標点に届いていれば勝者を確定する（勝てるのは自分の手番中だけ） */
export function checkWinner(state: GameState): GameState {
  if (state.winner !== null || state.phase.kind === 'setup') return state;
  const seat = state.currentSeat;
  if (victoryPoints(state, seat) < state.config.victoryPointsToWin) return state;
  return { ...state, winner: seat, phase: { kind: 'gameOver' } };
}
