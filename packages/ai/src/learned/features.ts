import {
  RESOURCES,
  type Action,
  type Building,
  type PlayerState,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Seat,
  type VertexId,
} from '@bokoboko/engine';
import { isOpenSpot, missingCards, pips, productionBySeat, settlementValue, topologyOf } from '../evaluate.js';
import { threatOf } from '../threat.js';

/**
 * 学習AIの評価関数に渡す、局面の特徴量。
 *
 * すべて「その席から見える情報（PlayerView）」だけから計算する。
 * 学習用データの書き出し（sim）と、対戦中の評価（LearnedAgent）で同じ関数を使うので、
 * ここを変えたら学習し直すこと（FEATURE_NAMES と重みの features が一致しないと読み込みで止まる）。
 */
export const FEATURE_NAMES = [
  'vp',
  'vpCards',
  'prod_wood',
  'prod_brick',
  'prod_sheep',
  'prod_wheat',
  'prod_ore',
  'prodTotal',
  'resourceTypes',
  'hand_wood',
  'hand_brick',
  'hand_sheep',
  'hand_wheat',
  'hand_ore',
  'handTotal',
  'overLimit',
  'missSettlement',
  'missCity',
  'missDevCard',
  'missRoad',
  'settlements',
  'cities',
  'settlementsLeft',
  'citiesLeft',
  'spotsReachable',
  'bestSpot',
  'spotsNear',
  'roadLength',
  'oppMaxRoadLength',
  'hasLongestRoad',
  'knights',
  'oppMaxKnights',
  'hasLargestArmy',
  'devHeld',
  'genericPort',
  'matchedPortProd',
  'robberOnMe',
  'oppMaxVp',
  'oppSumVp',
  'oppMaxProd',
  'oppMaxHand',
  'oppMaxDev',
  'vpGap',
  'turn',
  // 第2版で追加: 騎士と、一番脅威な相手（点数・生産・港・発展カードの脅威度が一番高い相手）
  'knightsHeld',
  'armyGap',
  'leaderThreat',
  'threatGap',
  'leaderVp',
  'leaderProd',
  'leaderDev',
  'leaderHand',
  'leaderPortProd',
  'leaderBlocked',
  'oppBlocked',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * 「打った後の局面」を作るための差分。PlayerView を直接書き換えずに、
 * 建物・道・手札・残りの駒を差し替えた見かけ上の局面を作る。
 */
export interface Hypothetical {
  readonly view: PlayerView;
  /** 買ったばかりで中身のわからない発展カードの枚数 */
  readonly unknownDev: number;
}

export const asIs = (view: PlayerView): Hypothetical => ({ view, unknownDev: 0 });

/** 発展カードの山に占める勝利点カードの割合（通常版 5/25） */
function vpCardShare(view: PlayerView): number {
  const counts = view.config.devCardCounts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return total > 0 ? counts.victoryPoint / total : 0;
}

/** その席の最長の道（engine の longestRoadLength と同じ数え方。見える情報だけで計算できる） */
export function roadLength(view: PlayerView, seat: Seat): number {
  const topology = topologyOf(view);
  const owned = view.roads.map((o) => o === seat);
  const used = view.roads.map(() => false);
  const blocked = (v: VertexId): boolean => {
    const b = view.buildings[v];
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
  owned.forEach((o, e) => {
    if (!o) return;
    for (const v of topology.edgeVertices[e]!) best = Math.max(best, dfs(v));
  });
  return best;
}

/** 道の長さから最長交易路の持ち主を決め直す（自分が道を足した局面用） */
function longestRoadHolder(view: PlayerView, lengths: readonly number[]): Seat | null {
  const max = Math.max(...lengths);
  if (max < view.config.longestRoadMinLength) return null;
  const holder = view.longestRoad;
  if (holder !== null && lengths[holder] === max) return holder;
  const top = lengths.flatMap((l, s) => (l === max ? [s] : []));
  return top.length === 1 ? top[0]! : holder;
}

function buildingPoints(view: PlayerView, seat: Seat): number {
  let p = 0;
  for (const b of view.buildings) if (b?.owner === seat) p += b.kind === 'city' ? 2 : 1;
  return p;
}

/** 自分が持つ港。generic: 3:1 があるか、special: 2:1 の資源 */
function myPorts(view: PlayerView, seat: Seat = view.seat): { generic: boolean; special: Set<Resource> } {
  const topology = topologyOf(view);
  const special = new Set<Resource>();
  let generic = false;
  for (const port of view.board.ports) {
    if (!topology.edgeVertices[port.edge]!.some((v) => view.buildings[v]?.owner === seat)) continue;
    if (port.kind === 'generic') generic = true;
    else special.add(port.kind);
  }
  return { generic, special };
}

/** 自分の交換レート（4:1、3:1 の港、2:1 の港） */
export function myTradeRate(view: PlayerView, r: Resource): number {
  const ports = myPorts(view);
  if (ports.special.has(r)) return 2;
  return ports.generic ? 3 : 4;
}

/** 自分の道のネットワークから、道を2本まで足せば届く空き地の数（すでに届く所は除く） */
function nearSpots(view: PlayerView): number {
  const topology = topologyOf(view);
  const start = new Set<VertexId>();
  view.roads.forEach((o, e) => {
    if (o === view.seat) for (const v of topology.edgeVertices[e]!) start.add(v);
  });
  view.buildings.forEach((b, v) => {
    if (b?.owner === view.seat) start.add(v);
  });
  const blocked = (v: VertexId): boolean => {
    const b = view.buildings[v];
    return b !== null && b !== undefined && b.owner !== view.seat;
  };
  const dist = new Map<VertexId, number>();
  let frontier = [...start].filter((v) => !blocked(v));
  for (const v of frontier) dist.set(v, 0);
  for (let d = 1; d <= 2; d++) {
    const next: VertexId[] = [];
    for (const v of frontier) {
      for (const e of topology.vertexEdges[v]!) {
        if (view.roads[e] !== null && view.roads[e] !== view.seat) continue;
        const [a, b] = topology.edgeVertices[e]!;
        const n = a === v ? b : a;
        if (dist.has(n)) continue;
        dist.set(n, d);
        if (!blocked(n)) next.push(n);
      }
    }
    frontier = next;
  }
  let count = 0;
  for (const [v, d] of dist) if (d > 0 && isOpenSpot(view, v)) count++;
  return count;
}

/** 特徴量を計算する（FEATURE_NAMES の順） */
export function features(h: Hypothetical): number[] {
  const f = featureRecord(h);
  return FEATURE_NAMES.map((k) => f[k]);
}

/** 盗賊のヘックスで止められている、その席の生産（出やすさ。都市は2倍） */
function blockedPips(view: PlayerView, seat: Seat): number {
  const topology = topologyOf(view);
  let out = 0;
  for (const v of topology.hexVertices[view.robberHex]!) {
    const b = view.buildings[v];
    if (b?.owner === seat) out += pips(view.board.numbers[view.robberHex] ?? null) * (b.kind === 'city' ? 2 : 1);
  }
  return out;
}

/** 特徴量を名前つきで計算する */
export function featureRecord(h: Hypothetical): Record<FeatureName, number> {
  const { view } = h;
  const me = view.me;
  const topology = topologyOf(view);
  const n = view.config.playerCount;

  const prod = productionBySeat(view, view.seat);
  const prodTotal = RESOURCES.reduce((s, r) => s + prod[r], 0);
  const handTotal = RESOURCES.reduce((s, r) => s + me.hand[r], 0);
  const costs = view.config.buildCosts;

  // 道の長さと最長交易路（自分の道を足した局面でも正しく数え直す）
  const lengths = Array.from({ length: n }, (_, s) => roadLength(view, s));
  const lrHolder = longestRoadHolder(view, lengths);
  const knightsOf = (s: Seat): number =>
    s === view.seat ? me.playedKnights : (view.opponents.find((o) => o.seat === s)?.playedKnights ?? 0);
  const laHolder = view.largestArmy;
  const visible = (s: Seat): number =>
    buildingPoints(view, s) + (lrHolder === s ? 2 : 0) + (laHolder === s ? 2 : 0);

  const vpCards = me.devCards.filter((c) => c.card === 'victoryPoint').length + h.unknownDev * vpCardShare(view);
  const devHeld = me.devCards.filter((c) => c.card !== 'victoryPoint').length + h.unknownDev * (1 - vpCardShare(view));

  // 届く空き地
  const reachable = view.buildings.flatMap((_, v) =>
    isOpenSpot(view, v) && topology.vertexEdges[v]!.some((e) => view.roads[e] === view.seat) ? [v] : [],
  );
  const bestSpot = reachable.reduce((m, v) => Math.max(m, settlementValue(view, v)), 0);

  const ports = myPorts(view);
  const matchedPortProd = [...ports.special].reduce((s, r) => s + prod[r], 0);

  // 盗賊に止められている自分の生産
  const robberOnMe = blockedPips(view, view.seat);

  // 騎士: 手元の騎士（買ったばかりのカードは割合で）と、使った騎士の差
  const knightShare = (view.config.devCardCounts.knight ?? 0) / Math.max(1, Object.values(view.config.devCardCounts).reduce((a, b) => a + b, 0));
  const knightsHeld = me.devCards.filter((c) => c.card === 'knight').length + h.unknownDev * knightShare;

  // 一番脅威な相手（点数・生産・港・発展カード）
  const threat = (s: Seat): number => threatOf(view, s);
  let leader = view.opponents[0]?.seat ?? view.seat;
  for (const o of view.opponents) if (threat(o.seat) > threat(leader)) leader = o.seat;
  const leaderInfo = view.opponents.find((o) => o.seat === leader);
  const leaderProd = productionBySeat(view, leader);
  const leaderPorts = myPorts(view, leader);

  const opp = view.opponents.map((o) => {
    const p = productionBySeat(view, o.seat);
    return {
      vp: visible(o.seat),
      prod: RESOURCES.reduce((s, r) => s + p[r], 0),
      hand: o.handCount,
      dev: o.devCardCount,
      road: lengths[o.seat]!,
      knights: o.playedKnights,
    };
  });
  const oppMaxVp = Math.max(0, ...opp.map((o) => o.vp));
  const myVp = visible(view.seat);

  return {
    vp: myVp,
    vpCards,
    prod_wood: prod.wood,
    prod_brick: prod.brick,
    prod_sheep: prod.sheep,
    prod_wheat: prod.wheat,
    prod_ore: prod.ore,
    prodTotal,
    resourceTypes: RESOURCES.filter((r) => prod[r] > 0).length,
    hand_wood: me.hand.wood,
    hand_brick: me.hand.brick,
    hand_sheep: me.hand.sheep,
    hand_wheat: me.hand.wheat,
    hand_ore: me.hand.ore,
    handTotal,
    overLimit: Math.max(0, handTotal - view.config.discardLimit),
    missSettlement: missingCards(me.hand, costs.settlement),
    missCity: missingCards(me.hand, costs.city),
    missDevCard: missingCards(me.hand, costs.devCard),
    missRoad: missingCards(me.hand, costs.road),
    settlements: view.buildings.filter((b) => b?.owner === view.seat && b.kind === 'settlement').length,
    cities: view.buildings.filter((b) => b?.owner === view.seat && b.kind === 'city').length,
    settlementsLeft: me.piecesLeft.settlement,
    citiesLeft: me.piecesLeft.city,
    spotsReachable: reachable.length,
    bestSpot,
    spotsNear: nearSpots(view),
    roadLength: lengths[view.seat]!,
    oppMaxRoadLength: Math.max(0, ...opp.map((o) => o.road)),
    hasLongestRoad: lrHolder === view.seat ? 1 : 0,
    knights: knightsOf(view.seat),
    oppMaxKnights: Math.max(0, ...opp.map((o) => o.knights)),
    hasLargestArmy: laHolder === view.seat ? 1 : 0,
    devHeld,
    genericPort: ports.generic ? 1 : 0,
    matchedPortProd,
    robberOnMe,
    oppMaxVp,
    oppSumVp: opp.reduce((s, o) => s + o.vp, 0),
    oppMaxProd: Math.max(0, ...opp.map((o) => o.prod)),
    oppMaxHand: Math.max(0, ...opp.map((o) => o.hand)),
    oppMaxDev: Math.max(0, ...opp.map((o) => o.dev)),
    vpGap: myVp + vpCards - oppMaxVp,
    turn: view.turn / 100,
    knightsHeld,
    armyGap: me.playedKnights - Math.max(0, ...opp.map((o) => o.knights)),
    leaderThreat: threat(leader),
    threatGap: threat(leader) - threat(view.seat),
    leaderVp: visible(leader),
    leaderProd: RESOURCES.reduce((s, r) => s + leaderProd[r], 0),
    leaderDev: leaderInfo?.devCardCount ?? 0,
    leaderHand: leaderInfo?.handCount ?? 0,
    leaderPortProd: [...leaderPorts.special].reduce((s, r) => s + leaderProd[r], 0),
    leaderBlocked: blockedPips(view, leader),
    oppBlocked: view.opponents.reduce((s, o) => s + blockedPips(view, o.seat), 0),
  };
}

/** 自分の勝利点（伏せている勝利点カードも含む）。打った後の局面で勝ちが確定するかの判定用 */
export function myTotalPoints(h: Hypothetical): number {
  const view = h.view;
  const vpCards = view.me.devCards.filter((c) => c.card === 'victoryPoint').length + h.unknownDev * vpCardShare(view);
  const lengths = Array.from({ length: view.config.playerCount }, (_, s) => roadLength(view, s));
  const lr = longestRoadHolder(view, lengths) === view.seat ? 2 : 0;
  const la = view.largestArmy === view.seat ? 2 : 0;
  return buildingPoints(view, view.seat) + lr + la + vpCards;
}

// ---------------------------------------------------------------------------
// 打った後の局面
// ---------------------------------------------------------------------------

function withMe(view: PlayerView, me: Partial<PlayerState>, extra: Partial<PlayerView> = {}): PlayerView {
  return { ...view, ...extra, me: { ...view.me, ...me } };
}

function pay(hand: ResourceCounts, cost: Partial<ResourceCounts>, sign: 1 | -1 = -1): ResourceCounts {
  const out = { ...hand };
  for (const r of RESOURCES) out[r] += sign * (cost[r] ?? 0);
  return out;
}

/**
 * 自分の手番中の操作（建設・発展カードの購入・海外交易・手番終了）を打った後の局面。
 * 結果が運で決まらない操作だけを扱う。対象外の操作なら null
 */
export function afterAction(h: Hypothetical, action: Action, free = false): Hypothetical | null {
  const view = h.view;
  const me = view.me;
  const costs = view.config.buildCosts;
  switch (action.type) {
    case 'endTurn':
      return h;
    case 'buildSettlement': {
      const buildings = view.buildings.slice();
      buildings[action.vertex] = { owner: view.seat, kind: 'settlement' } satisfies Building;
      return {
        ...h,
        view: withMe(
          view,
          { hand: pay(me.hand, costs.settlement), piecesLeft: { ...me.piecesLeft, settlement: me.piecesLeft.settlement - 1 } },
          { buildings },
        ),
      };
    }
    case 'buildCity': {
      const buildings = view.buildings.slice();
      buildings[action.vertex] = { owner: view.seat, kind: 'city' } satisfies Building;
      return {
        ...h,
        view: withMe(
          view,
          {
            hand: pay(me.hand, costs.city),
            piecesLeft: { ...me.piecesLeft, city: me.piecesLeft.city - 1, settlement: me.piecesLeft.settlement + 1 },
          },
          { buildings },
        ),
      };
    }
    case 'buildRoad': {
      const roads = view.roads.slice();
      roads[action.edge] = view.seat;
      return {
        ...h,
        view: withMe(
          view,
          { hand: free ? me.hand : pay(me.hand, costs.road), piecesLeft: { ...me.piecesLeft, road: me.piecesLeft.road - 1 } },
          { roads },
        ),
      };
    }
    case 'buyDevCard':
      return {
        view: withMe(view, { hand: pay(me.hand, costs.devCard) }, { devDeckCount: view.devDeckCount - 1 }),
        unknownDev: h.unknownDev + 1,
      };
    case 'bankTrade': {
      const rate = myTradeRate(view, action.give);
      return { ...h, view: withMe(view, { hand: pay(pay(me.hand, { [action.give]: rate }), { [action.receive]: 1 }, 1) }) };
    }
    case 'discard':
      return { ...h, view: withMe(view, { hand: pay(me.hand, action.resources) }) };
    case 'playKnight': {
      // 騎士を1枚使う（盗賊を動かす前の局面。最大騎士力は使った枚数で決め直す）
      const i = me.devCards.findIndex((c) => c.card === 'knight' && c.boughtTurn < view.turn);
      if (i < 0) return null;
      const played = me.playedKnights + 1;
      const best = Math.max(0, ...view.opponents.map((o) => o.playedKnights));
      const holder = view.largestArmy;
      const takes = played >= view.config.largestArmyMinKnights && (holder === view.seat || played > best);
      return {
        ...h,
        view: withMe(
          view,
          { devCards: me.devCards.filter((_, j) => j !== i), playedKnights: played },
          { largestArmy: takes ? view.seat : holder, devCardPlayedThisTurn: true },
        ),
      };
    }
    case 'playYearOfPlenty': {
      const i = me.devCards.findIndex((c) => c.card === 'yearOfPlenty' && c.boughtTurn < view.turn);
      if (i < 0) return null;
      const [a, b] = action.resources;
      const hand = pay(pay(me.hand, { [a]: 1 }, 1), { [b]: 1 }, 1);
      return { ...h, view: withMe(view, { hand, devCards: me.devCards.filter((_, j) => j !== i) }, { devCardPlayedThisTurn: true }) };
    }
    case 'moveRobber':
      return { ...h, view: { ...view, robberHex: action.hex } };
    default:
      return null;
  }
}

/** 手札を差し替えた局面（国内交易の評価用） */
export function withHand(h: Hypothetical, hand: ResourceCounts): Hypothetical {
  return { ...h, view: withMe(h.view, { hand }) };
}
