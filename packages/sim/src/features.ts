import {
  RESOURCES,
  TERRAIN_RESOURCE,
  topologyFor,
  victoryPoints,
  type GameState,
  type Resource,
  type Seat,
  type VertexId,
} from '@bokoboko/engine';

/** 数字チップの出やすさ（36回あたりの出現回数） */
export const pipsOf = (n: number | null | undefined): number => (n == null ? 0 : 6 - Math.abs(7 - n));

/** 初期配置（開拓地2つ）の特徴 */
export interface PlacementFeatures {
  /** 1軒目・2軒目の頂点 */
  readonly vertices: readonly [VertexId, VertexId];
  /** 2軒の出やすさの合計（36回あたりの資源の期待枚数） */
  readonly totalPips: number;
  /** 資源ごとの出やすさ */
  readonly pips: Readonly<Record<Resource, number>>;
  /** 取れる資源の種類数（0〜5） */
  readonly resourceTypes: number;
  /** 接する数字の種類数（同じ数字に偏っていないか） */
  readonly distinctNumbers: number;
  /** 6・8 のヘックスからの出やすさ */
  readonly pips68: number;
  /** 港: なし / 3:1 / 2:1（自分が産出する資源の2:1なら matched） */
  readonly port: 'none' | 'generic' | 'special' | 'matched';
  /** 道2本以内で届き、開拓地を置ける空き頂点の数（初期配置が終わった時点） */
  readonly expansionSpots: number;
  /** 2軒目で受け取った初期資源の枚数 */
  readonly startCards: number;
}

/** 試合結果のうち、席ごとの記録 */
export interface PlayerOutcome {
  readonly win: boolean;
  /** 最終的な勝利点（伏せた勝利点カード込み） */
  readonly vp: number;
  readonly settlements: number;
  readonly cities: number;
  readonly roads: number;
  readonly devBought: number;
  readonly knights: number;
  readonly vpCards: number;
  readonly longestRoad: boolean;
  readonly largestArmy: boolean;
  /** 最初の都市を建てた手番（建てなければ null） */
  readonly firstCityTurn: number | null;
  /** 3軒目の開拓地を建てた手番（建てなければ null） */
  readonly thirdSettlementTurn: number | null;
}

/** 初期配置が終わった状態から、席ごとの配置の特徴を計算する */
export function placementFeatures(
  state: GameState,
  seat: Seat,
  vertices: readonly [VertexId, VertexId],
  startCards: number,
): PlacementFeatures {
  const t = topologyFor(state.config);
  const pips: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const numbers = new Set<number>();
  let pips68 = 0;
  for (const v of vertices) {
    for (const h of t.vertexHexes[v]!) {
      const r = TERRAIN_RESOURCE[state.board.terrains[h]!];
      const n = state.board.numbers[h];
      if (!r || n == null) continue;
      pips[r] += pipsOf(n);
      numbers.add(n);
      if (n === 6 || n === 8) pips68 += pipsOf(n);
    }
  }

  let port: PlacementFeatures['port'] = 'none';
  for (const p of state.board.ports) {
    if (!t.edgeVertices[p.edge]!.some((v) => vertices.includes(v))) continue;
    if (p.kind === 'generic') {
      if (port === 'none') port = 'generic';
    } else if (pips[p.kind] > 0) port = 'matched';
    else if (port !== 'matched') port = 'special';
  }

  // 自分の道から1本伸ばした先の頂点、さらに1本先の頂点のうち、開拓地を置ける場所
  const open = (v: VertexId): boolean =>
    state.buildings[v] === null && t.vertexNeighbors[v]!.every((n) => state.buildings[n] === null);
  const reach = new Set<VertexId>();
  const frontier = new Set<VertexId>();
  state.roads.forEach((owner, e) => {
    if (owner === seat) for (const v of t.edgeVertices[e]!) frontier.add(v);
  });
  for (const v of frontier) {
    for (const n of t.vertexNeighbors[v]!) {
      const b = state.buildings[n];
      if (b && b.owner !== seat) continue;
      reach.add(n);
      for (const m of t.vertexNeighbors[n]!) reach.add(m);
    }
  }
  const expansionSpots = [...reach].filter(open).length;

  return {
    vertices,
    totalPips: RESOURCES.reduce((s, r) => s + pips[r], 0),
    pips,
    resourceTypes: RESOURCES.filter((r) => pips[r] > 0).length,
    distinctNumbers: numbers.size,
    pips68,
    port,
    expansionSpots,
    startCards,
  };
}

export function playerOutcome(
  state: GameState,
  seat: Seat,
  devBought: number,
  firstCityTurn: number | null,
  thirdSettlementTurn: number | null,
): PlayerOutcome {
  const p = state.players[seat]!;
  const count = (kind: 'settlement' | 'city'): number =>
    state.buildings.filter((b) => b?.owner === seat && b.kind === kind).length;
  return {
    win: state.winner === seat,
    vp: victoryPoints(state, seat, true),
    settlements: count('settlement'),
    cities: count('city'),
    roads: state.roads.filter((o) => o === seat).length,
    devBought,
    knights: p.playedKnights,
    vpCards: p.devCards.filter((c) => c.card === 'victoryPoint').length,
    longestRoad: state.longestRoad === seat,
    largestArmy: state.largestArmy === seat,
    firstCityTurn,
    thirdSettlementTurn,
  };
}
