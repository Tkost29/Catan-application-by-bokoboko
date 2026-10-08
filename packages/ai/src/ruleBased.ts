import {
  createRng,
  RESOURCES,
  type Action,
  type ActionOf,
  type ActionType,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Rng,
  type TradeTerms,
} from '@bokoboko/engine';
import type { Agent, TradeRequest } from './agent.js';
import {
  addCounts,
  missingCards,
  productionBySeat,
  reachableSpots,
  roadValue,
  settlementValue,
  topologyOf,
  totalCards,
  vertexPips,
  visiblePoints,
} from './evaluate.js';

/** 次に何を作るか */
type Goal = 'city' | 'settlement' | 'road' | 'devCard';

/** 1手番あたりの国内交易の提案の上限（人間を待たせすぎないため） */
const MAX_PROPOSALS_PER_TURN = 2;

/**
 * 難易度1: ルールベースAI。
 *
 * 優先度付きのヒューリスティックで1手を選ぶ。
 * - 初期配置: 生産力・資源の種類・港で頂点を評価
 * - 手番中: 「次に作るもの（目標）」を決め、建設 → 発展カード → 海外交易 → 国内交易 → 手番終了 の順に検討
 * - 盗賊: 勝利点の高い相手の、生産力の高いヘックスへ
 * - 捨て札: 目標に必要な資源を残す
 * - 交易の応答: 自分の目標に近づくなら承認、勝ちそうな相手とは交換しない
 */
export class RuleBasedAgent implements Agent {
  readonly name = 'rule-based';
  private readonly rng: Rng;
  /** この手番に出した提案（同じ提案を繰り返さないため） */
  private proposals: { turn: number; tried: Set<string> } = { turn: -1, tried: new Set() };

  constructor(seed: string) {
    this.rng = createRng(`rule-based:${seed}`);
  }

  decide(view: PlayerView, legal: readonly Action[]): Action {
    if (legal.length === 0) throw new Error('no legal actions');
    const choice = this.choose(view, legal);
    return choice ?? legal[0]!;
  }

  private choose(view: PlayerView, legal: readonly Action[]): Action | undefined {
    switch (view.phase.kind) {
      case 'setup':
        return this.setup(view, legal);
      case 'preRoll':
        return this.preRoll(view, legal);
      case 'discard':
        return this.discard(view, legal);
      case 'moveRobber':
        return this.moveRobber(view, legal);
      case 'roadBuilding':
        return this.bestBy(of(legal, 'buildRoad'), (a) => roadValue(view, a.edge));
      case 'main':
        return this.main(view, legal);
      case 'negotiating':
        return this.negotiate(view, legal);
      case 'gameOver':
        return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // 初期配置
  // -------------------------------------------------------------------------

  private setup(view: PlayerView, legal: readonly Action[]): Action | undefined {
    const settlements = of(legal, 'placeSettlement');
    if (settlements.length > 0) return this.bestBy(settlements, (a) => settlementValue(view, a.vertex, true));
    return this.bestBy(of(legal, 'placeRoad'), (a) => roadValue(view, a.edge));
  }

  // -------------------------------------------------------------------------
  // サイコロ前: 盗賊に自分の土地を塞がれていれば騎士で追い払う
  // -------------------------------------------------------------------------

  private preRoll(view: PlayerView, legal: readonly Action[]): Action | undefined {
    const knight = of(legal, 'playKnight')[0];
    if (knight && this.robberBlocksMe(view)) return knight;
    return of(legal, 'rollDice')[0];
  }

  private robberBlocksMe(view: PlayerView): boolean {
    const topology = topologyOf(view);
    return topology.hexVertices[view.robberHex]!.some((v) => view.buildings[v]?.owner === view.seat);
  }

  // -------------------------------------------------------------------------
  // 捨て札: 目標に必要な分を残し、余っている資源から捨てる
  // -------------------------------------------------------------------------

  private discard(view: PlayerView, legal: readonly Action[]): Action | undefined {
    if (view.phase.kind !== 'discard') return undefined;
    const required = view.phase.remaining[view.seat] ?? 0;
    const need = this.costOf(view, this.goal(view));
    const hand = { ...view.me.hand };
    const discard: Partial<ResourceCounts> = {};
    for (let i = 0; i < required; i++) {
      // 「持っている数 − 目標に必要な数」が一番大きい資源を1枚捨てる
      const r = [...RESOURCES]
        .filter((x) => hand[x] > 0)
        .sort((a, b) => hand[b] - (need[b] ?? 0) - (hand[a] - (need[a] ?? 0)))[0]!;
      hand[r] -= 1;
      discard[r] = (discard[r] ?? 0) + 1;
    }
    return of(legal, 'discard').find((a) => RESOURCES.every((r) => (a.resources[r] ?? 0) === (discard[r] ?? 0)));
  }

  // -------------------------------------------------------------------------
  // 盗賊: 勝利点の高い相手の、生産力の高いヘックスへ。自分の土地は避ける
  // -------------------------------------------------------------------------

  private moveRobber(view: PlayerView, legal: readonly Action[]): Action | undefined {
    const topology = topologyOf(view);
    const handCount = (seat: number): number => view.opponents.find((o) => o.seat === seat)?.handCount ?? 0;
    return this.bestBy(of(legal, 'moveRobber'), (a) => {
      const n = view.board.numbers[a.hex] ?? null;
      const p = n === null ? 0 : 6 - Math.abs(7 - n);
      let score = 0;
      for (const v of topology.hexVertices[a.hex]!) {
        const b = view.buildings[v];
        if (!b) continue;
        const weight = b.kind === 'city' ? 2 : 1;
        if (b.owner === view.seat) score -= 100;
        else score += weight * p * (1 + 0.3 * visiblePoints(view, b.owner));
      }
      if (a.victim !== null) score += 2 + visiblePoints(view, a.victim) + 0.2 * handCount(a.victim);
      return score;
    });
  }

  // -------------------------------------------------------------------------
  // 手番中
  // -------------------------------------------------------------------------

  private main(view: PlayerView, legal: readonly Action[]): Action | undefined {
    // 1. 勝利点に直結する建設
    const city = this.bestBy(of(legal, 'buildCity'), (a) => vertexPips(view, a.vertex));
    if (city) return city;
    const settlement = this.bestBy(of(legal, 'buildSettlement'), (a) => settlementValue(view, a.vertex));
    if (settlement) return settlement;

    const goal = this.goal(view);
    const cost = this.costOf(view, goal);
    const missing = missingCards(view.me.hand, cost);

    // 2. 発展カードの使用
    const dev = this.playDevCard(view, legal, goal, cost);
    if (dev) return dev;

    // 3. 目標が道なら道を伸ばす（開拓地の候補地に向かって）
    if (goal === 'road') {
      const road = this.bestBy(of(legal, 'buildRoad'), (a) => roadValue(view, a.edge));
      if (road) return road;
    }

    // 4. 目標が発展カードなら買う
    if (goal === 'devCard') {
      const buy = of(legal, 'buyDevCard')[0];
      if (buy) return buy;
    }

    // 5. 海外交易で目標に近づくなら交換
    if (missing > 0) {
      const trade = this.bestBy(
        of(legal, 'bankTrade').filter((a) => this.surplus(view, a.give, cost) > 0 && (cost[a.receive] ?? 0) > view.me.hand[a.receive]),
        (a) => this.surplus(view, a.give, cost),
      );
      if (trade) return trade;
    }

    // 6. 国内交易: 余っている資源1枚と足りない資源1枚の交換を、勝ちそうでない相手に提案
    if (missing > 0) {
      const proposal = this.proposeTrade(view, legal, cost);
      if (proposal) return proposal;
    }

    // 7. 余力があれば道や発展カードにも使う
    if (missing === 0 && goal !== 'road') {
      const extra = of(legal, 'buyDevCard')[0];
      if (extra) return extra;
    }
    const spareRoad = this.bestBy(of(legal, 'buildRoad'), (a) => roadValue(view, a.edge));
    if (spareRoad && reachableSpots(view).length < 2 && roadValue(view, spareRoad.edge) > 0) return spareRoad;

    return of(legal, 'endTurn')[0];
  }

  /** 次に作るもの。足りない枚数が少ないもの優先、同数なら 開拓地 > 都市 > 道 > 発展カード */
  private goal(view: PlayerView): Goal {
    const { me } = view;
    const hasSettlement = view.buildings.some((b) => b?.owner === view.seat && b.kind === 'settlement');
    const spots = reachableSpots(view);
    const options: Goal[] = [];
    if (me.piecesLeft.settlement > 0 && spots.length > 0) options.push('settlement');
    if (me.piecesLeft.city > 0 && hasSettlement) options.push('city');
    if (me.piecesLeft.road > 0 && spots.length === 0 && me.piecesLeft.settlement > 0) options.push('road');
    if (view.devDeckCount > 0) options.push('devCard');
    if (options.length === 0) return 'devCard';
    const order: Goal[] = ['settlement', 'city', 'road', 'devCard'];
    return options.sort(
      (a, b) =>
        missingCards(me.hand, this.costOf(view, a)) - missingCards(me.hand, this.costOf(view, b)) ||
        order.indexOf(a) - order.indexOf(b),
    )[0]!;
  }

  private costOf(view: PlayerView, goal: Goal): Partial<ResourceCounts> {
    return view.config.buildCosts[goal];
  }

  /** 目標に必要な分を除いて余っている枚数 */
  private surplus(view: PlayerView, r: Resource, cost: Partial<ResourceCounts>): number {
    return view.me.hand[r] - (cost[r] ?? 0);
  }

  private playDevCard(
    view: PlayerView,
    legal: readonly Action[],
    goal: Goal,
    cost: Partial<ResourceCounts>,
  ): Action | undefined {
    // 騎士: 盗賊に塞がれているか、最大騎士力を取れるなら
    const knight = of(legal, 'playKnight')[0];
    if (knight) {
      const mine = view.me.playedKnights + 1;
      const best = Math.max(0, ...view.opponents.map((o) => o.playedKnights));
      const takesArmy = view.largestArmy !== view.seat && mine >= view.config.largestArmyMinKnights && mine > best;
      if (this.robberBlocksMe(view) || takesArmy) return knight;
    }

    // 街道建設: 開拓地の候補地がなく、道で取りに行くとき
    const roadBuilding = of(legal, 'playRoadBuilding')[0];
    if (roadBuilding && goal === 'road') return roadBuilding;

    // 収穫: 足りない資源を2枚まで埋める
    const missing = RESOURCES.flatMap((r) => Array<Resource>(Math.max(0, (cost[r] ?? 0) - view.me.hand[r])).fill(r));
    if (missing.length > 0 && missing.length <= 2) {
      const [a, b] = [missing[0]!, missing[1] ?? missing[0]!];
      const plenty = of(legal, 'playYearOfPlenty').find(
        (x) => (x.resources[0] === a && x.resources[1] === b) || (x.resources[0] === b && x.resources[1] === a),
      );
      if (plenty) return plenty;
    }

    // 独占: 足りない資源のうち、相手が多く生産しているもの
    const monopoly = of(legal, 'playMonopoly');
    if (monopoly.length > 0 && missing.length > 0) {
      const produced = (r: Resource): number =>
        view.opponents.reduce((s, o) => s + productionBySeat(view, o.seat)[r], 0);
      const target = [...new Set(missing)].sort((a, b) => produced(b) - produced(a))[0]!;
      if (produced(target) >= 8) return monopoly.find((x) => x.resource === target);
    }
    return undefined;
  }

  private proposeTrade(view: PlayerView, legal: readonly Action[], cost: Partial<ResourceCounts>): Action | undefined {
    if (this.proposals.turn !== view.turn) this.proposals = { turn: view.turn, tried: new Set() };
    if (this.proposals.tried.size >= MAX_PROPOSALS_PER_TURN) return undefined;
    const key = (a: ActionOf<'proposeTrade'>): string => JSON.stringify([a.to, a.terms]);

    const target = view.config.victoryPointsToWin;
    const candidates = of(legal, 'proposeTrade').filter((a) => {
      const give = singleResource(a.terms.give);
      const receive = singleResource(a.terms.receive);
      if (!give || !receive || totalCards(a.terms.give) !== 1 || totalCards(a.terms.receive) !== 1) return false;
      if (visiblePoints(view, a.to) >= target - 2) return false; // 勝ちそうな相手は助けない
      if (this.proposals.tried.has(key(a))) return false; // 断られた提案は繰り返さない
      return this.surplus(view, give, cost) > 0 && (cost[receive] ?? 0) > view.me.hand[receive];
    });
    // 相手は点数の低い人を少し優先しつつ、毎回同じ人に偏らないようにばらけさせる
    const choice = this.bestBy(candidates, (a) => -0.5 * visiblePoints(view, a.to) + 3 * this.rng.next());
    if (choice) this.proposals.tried.add(key(choice));
    return choice;
  }

  // -------------------------------------------------------------------------
  // 国内交易の応答
  // -------------------------------------------------------------------------

  private negotiate(view: PlayerView, legal: readonly Action[]): Action | undefined {
    if (view.phase.kind !== 'negotiating') return undefined;
    const { trade } = view.phase;
    if (view.seat !== trade.awaiting) return of(legal, 'withdrawTrade')[0];

    const terms = trade.history.at(-1)!.terms;
    const partner = view.seat === trade.proposer ? trade.counterparty : trade.proposer;
    const accept = of(legal, 'acceptTrade')[0];
    const reject = of(legal, 'rejectTrade')[0];
    if (!accept) return reject;
    return this.wouldAccept(view, partner, terms, view.seat === trade.proposer) ? accept : reject;
  }

  /**
   * この条件の交換に応じるか。
   * - あと2点以内で勝ちそうな相手とは交換しない
   * - 自分の目標（次に作るもの）に近づくときだけ応じる
   */
  private wouldAccept(view: PlayerView, partner: number, terms: TradeTerms, iAmProposer: boolean): boolean {
    if (visiblePoints(view, partner) >= view.config.victoryPointsToWin - 2) return false;
    return this.tradeGain(view, terms, iAmProposer) > 0;
  }

  /**
   * 募集への返答。自分がほしい物を渡せて、相手の「あげてもいい物」の中から
   * 自分の目標に一番近づく組み合わせを選ぶ。受け取る枚数は渡す枚数以下にする。
   */
  answerRequest(view: PlayerView, request: TradeRequest): TradeTerms | null {
    const want = request.want;
    const giveCount = totalCards(want);
    if (giveCount === 0 || !RESOURCES.every((r) => view.me.hand[r] >= (want[r] ?? 0))) return null;

    // 相手のほしい物と同じ資源は、もらう側に入れられない
    const pool = RESOURCES.filter((r) => (request.offer[r] ?? 0) > 0 && (want[r] ?? 0) === 0);
    let best: { terms: TradeTerms; score: number } | null = null;
    for (const pick of distributions(pool, request.offer, giveCount)) {
      const terms: TradeTerms = { give: pick, receive: want };
      if (!this.wouldAccept(view, request.from, terms, false)) continue;
      // 目標への前進が大きいもの、同じなら多くもらえるもの
      const score = this.tradeGain(view, terms, false) + 0.01 * totalCards(pick);
      if (!best || score > best.score) best = { terms, score };
    }
    return best?.terms ?? null;
  }

  /** 交換したら目標に何枚近づくか（マイナスなら遠ざかる） */
  private tradeGain(view: PlayerView, terms: TradeTerms, iAmProposer: boolean): number {
    const out = iAmProposer ? terms.give : terms.receive;
    const inn = iAmProposer ? terms.receive : terms.give;
    const after = addCounts(addCounts(view.me.hand, out, -1), inn, 1);
    if (RESOURCES.some((r) => after[r] < 0)) return -Infinity;
    const cost = this.costOf(view, this.goal(view));
    const gain = missingCards(view.me.hand, cost) - missingCards(after, cost);
    // 同じ前進なら、渡す枚数が少ないほうがよい
    return gain - 0.1 * Math.max(0, totalCards(out) - totalCards(inn));
  }

  // -------------------------------------------------------------------------

  /** score が最大の要素（同点は乱数で崩す）。空なら undefined */
  private bestBy<T>(items: readonly T[], score: (x: T) => number): T | undefined {
    let best: T | undefined;
    let bestScore = -Infinity;
    for (const x of items) {
      const s = score(x) + this.rng.next() * 1e-6;
      if (s > bestScore) {
        best = x;
        bestScore = s;
      }
    }
    return best;
  }
}

function of<T extends ActionType>(legal: readonly Action[], type: T): ActionOf<T>[] {
  return legal.filter((a): a is ActionOf<T> => a.type === type);
}

/** pool の資源から、上限 max を超えずに合計 1〜limit 枚を選ぶ組み合わせをすべて列挙する */
function distributions(
  pool: readonly Resource[],
  max: Partial<ResourceCounts>,
  limit: number,
): Partial<ResourceCounts>[] {
  const out: Partial<ResourceCounts>[] = [];
  const pick: Partial<ResourceCounts> = {};
  const rec = (i: number, used: number): void => {
    if (i === pool.length) {
      if (used > 0) out.push({ ...pick });
      return;
    }
    const r = pool[i]!;
    for (let n = 0; n <= Math.min(max[r] ?? 0, limit - used); n++) {
      if (n > 0) pick[r] = n;
      else delete pick[r];
      rec(i + 1, used + n);
    }
    delete pick[r];
  };
  rec(0, 0);
  return out;
}

function singleResource(counts: Partial<ResourceCounts>): Resource | undefined {
  const rs = RESOURCES.filter((r) => (counts[r] ?? 0) > 0);
  return rs.length === 1 ? rs[0] : undefined;
}

