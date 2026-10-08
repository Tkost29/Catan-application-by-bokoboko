import {
  RESOURCES,
  TERRAIN_RESOURCE,
  topologyFor,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Seat,
  type Topology,
  type VertexId,
} from '@bokoboko/engine';

/**
 * AI が盤面を評価するための道具。すべて PlayerView（見える情報）だけから計算する。
 */

export const topologyOf = (view: PlayerView): Topology => topologyFor(view.config);

/** 数字チップの出やすさ（36回あたりの出現回数）。2,12 → 1、6,8 → 5 */
export function pips(n: number | null): number {
  if (n === null || n === 7) return 0;
  return 6 - Math.abs(7 - n);
}

/** 資源ごとの基本的な重み（序盤から終盤まで使う小麦・鉱石をやや重く） */
const RESOURCE_WEIGHT: Readonly<Record<Resource, number>> = {
  wood: 1,
  brick: 1,
  sheep: 0.8,
  wheat: 1.1,
  ore: 1.1,
};

/** 自分の建物から見込める、資源ごとの生産量（pips の合計。都市は2倍、盗賊のヘックスは除く） */
export function productionBySeat(view: PlayerView, seat: Seat): ResourceCounts {
  const topology = topologyOf(view);
  const out: ResourceCounts = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  view.buildings.forEach((b, v) => {
    if (b?.owner !== seat) return;
    for (const h of topology.vertexHexes[v]!) {
      if (h === view.robberHex) continue;
      const r = TERRAIN_RESOURCE[view.board.terrains[h]!];
      if (r) out[r] += pips(view.board.numbers[h] ?? null) * (b.kind === 'city' ? 2 : 1);
    }
  });
  return out;
}

/** 頂点の生産力（pips の合計、盗賊のヘックスは半分） */
export function vertexPips(view: PlayerView, v: VertexId): number {
  const topology = topologyOf(view);
  return topology.vertexHexes[v]!.reduce((sum, h) => {
    const p = pips(view.board.numbers[h] ?? null);
    return sum + (h === view.robberHex ? p / 2 : p);
  }, 0);
}

/**
 * 開拓地を置く場所としての価値。
 * 生産力 × 資源の重み + まだ持っていない資源の種類のボーナス + 港のボーナス
 */
export function settlementValue(view: PlayerView, v: VertexId, early = false): number {
  const topology = topologyOf(view);
  const mine = productionBySeat(view, view.seat);
  let value = 0;
  const newTypes = new Set<Resource>();
  for (const h of topology.vertexHexes[v]!) {
    const r = TERRAIN_RESOURCE[view.board.terrains[h]!];
    if (!r) continue;
    const p = pips(view.board.numbers[h] ?? null) * (h === view.robberHex ? 0.5 : 1);
    // 序盤は道と開拓地に使う木・レンガを重視
    const w = RESOURCE_WEIGHT[r] * (early && (r === 'wood' || r === 'brick') ? 1.2 : 1);
    value += p * w;
    if (mine[r] === 0) newTypes.add(r);
  }
  value += newTypes.size * 1.5;

  for (const port of view.board.ports) {
    if (!topology.edgeVertices[port.edge]!.includes(v)) continue;
    if (port.kind === 'generic') value += 1;
    else value += mine[port.kind] >= 5 ? 2.5 : 0.8;
  }
  return value;
}

/** 距離ルールを満たす空き頂点か（道の接続は見ない） */
export function isOpenSpot(view: PlayerView, v: VertexId): boolean {
  const topology = topologyOf(view);
  if (view.buildings[v] !== null) return false;
  return topology.vertexNeighbors[v]!.every((n) => view.buildings[n] === null);
}

/** 自分の道が届いていて、開拓地を置ける頂点 */
export function reachableSpots(view: PlayerView): VertexId[] {
  const topology = topologyOf(view);
  return view.buildings.flatMap((_, v) =>
    isOpenSpot(view, v) && topology.vertexEdges[v]!.some((e) => view.roads[e] === view.seat) ? [v] : [],
  );
}

/**
 * 辺 edge に道を置いたとき、その先2本以内で届く開拓地候補の最高価値。
 * 道をどちらに伸ばすかの判断に使う。
 */
export function roadValue(view: PlayerView, edge: number): number {
  const topology = topologyOf(view);
  const ends = topology.edgeVertices[edge]!;
  let best = 0;
  for (const end of ends) {
    // 相手の建物の先には伸ばせない
    const b = view.buildings[end];
    if (b && b.owner !== view.seat) continue;
    if (isOpenSpot(view, end)) best = Math.max(best, settlementValue(view, end) + 1);
    for (const n of topology.vertexNeighbors[end]!) {
      if (isOpenSpot(view, n)) best = Math.max(best, settlementValue(view, n));
    }
  }
  return best;
}

/** 他人から見える勝利点（勝利点カードは自分の分だけ数える） */
export function visiblePoints(view: PlayerView, seat: Seat): number {
  let points = 0;
  for (const b of view.buildings) if (b?.owner === seat) points += b.kind === 'city' ? 2 : 1;
  if (view.longestRoad === seat) points += 2;
  if (view.largestArmy === seat) points += 2;
  if (seat === view.seat) points += view.me.devCards.filter((c) => c.card === 'victoryPoint').length;
  return points;
}

export function totalCards(counts: Partial<ResourceCounts>): number {
  return RESOURCES.reduce((s, r) => s + (counts[r] ?? 0), 0);
}

/** cost を満たすのに足りない枚数 */
export function missingCards(hand: ResourceCounts, cost: Partial<ResourceCounts>): number {
  return RESOURCES.reduce((s, r) => s + Math.max(0, (cost[r] ?? 0) - hand[r]), 0);
}

export function addCounts(a: ResourceCounts, b: Partial<ResourceCounts>, sign: 1 | -1): ResourceCounts {
  const out = { ...a };
  for (const r of RESOURCES) out[r] += sign * (b[r] ?? 0);
  return out;
}
