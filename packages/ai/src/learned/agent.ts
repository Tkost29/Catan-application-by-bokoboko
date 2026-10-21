import {
  createRng,
  RESOURCES,
  type Action,
  type ActionOf,
  type ActionType,
  type PlayerView,
  type ResourceCounts,
  type Rng,
  type TradeTerms,
} from '@bokoboko/engine';
import type { Agent, TradeRequest } from '../agent.js';
import { topologyOf, visiblePoints } from '../evaluate.js';
import { handShare } from '../threat.js';
import { RuleBasedAgent } from '../ruleBased.js';
import { DEFAULT_STRATEGY, IMPROVED_PLACEMENT } from '../strategy.js';
import { afterAction, asIs, features, myTotalPoints, withHand, type Hypothetical } from './features.js';
import { checkModel, predict, type ValueModel } from './model.js';

/** 手番中の操作の上限（評価関数の誤差で同じような操作を繰り返し続けないため） */
const MAX_STEPS_PER_TURN = 30;
/** 交換に応じるのに必要な勝率の上がり幅（小さな誤差で応じないため） */
const TRADE_MARGIN = 0.002;

export interface LearnedOptions {
  /** 学習データを集めるときの探索の割合（0〜1）。この割合で候補からランダムに選ぶ。対戦では 0 */
  readonly explore?: number;
  /** 勝利点になる建設（開拓地・都市）ができるときは必ず建てる（どこに建てるかは評価関数で選ぶ） */
  readonly forceBuild?: boolean;
  /** 交換に応じるのは、ルールベースAIも応じる（目標に近づく）ときだけにする */
  readonly tradeGate?: boolean;
  /** 騎士・収穫をルールベースAIと同じ基準で使う（評価関数で比べない） */
  readonly ruleDevCards?: boolean;
  /** ルールベースAIの基準で使うとき、騎士は持っていればすぐ使う */
  readonly eagerKnights?: boolean;
}

/**
 * 難易度2: 学習AI。
 *
 * CPU同士の自己対戦から学習した評価関数（「この局面から勝てる確率」の予測）を使い、
 * 打てる手ごとに「打った後の局面」の勝率を予測して、一番高い手を選ぶ。
 * - 評価関数で選ぶ: 建設・発展カードの購入・海外交易・手番終了、捨て札、街道建設の道、盗賊、交換に応じるか
 * - ルールベースAIに任せる: 初期配置（点数表に合わせた重み）、発展カードの使用、交換の提案
 */
export class LearnedAgent implements Agent {
  readonly name = 'learned';
  private readonly rule: RuleBasedAgent;
  private readonly rng: Rng;
  private readonly explore: number;
  private readonly forceBuild: boolean;
  private readonly tradeGate: boolean;
  private readonly ruleDevCards: boolean;
  private steps = { turn: -1, n: 0 };

  constructor(
    seed: string,
    private readonly model: ValueModel,
    options: LearnedOptions = {},
  ) {
    checkModel(model);
    this.rule = new RuleBasedAgent(`learned:${seed}`, {
      ...DEFAULT_STRATEGY,
      placement: IMPROVED_PLACEMENT,
      play: { ...DEFAULT_STRATEGY.play, knights: options.eagerKnights ? 'eager' : 'standard' },
    });
    this.rng = createRng(`learned:${seed}`);
    this.explore = options.explore ?? 0;
    this.forceBuild = options.forceBuild ?? true;
    this.tradeGate = options.tradeGate ?? true;
    this.ruleDevCards = options.ruleDevCards ?? true;
  }

  decide(view: PlayerView, legal: readonly Action[]): Action {
    if (legal.length === 0) throw new Error('no legal actions');
    switch (view.phase.kind) {
      case 'main':
        return this.main(view, legal);
      case 'discard':
        return this.pick(view, of(legal, 'discard')) ?? this.rule.decide(view, legal);
      case 'roadBuilding':
        return this.pick(view, of(legal, 'buildRoad'), true) ?? this.rule.decide(view, legal);
      case 'moveRobber':
        return this.moveRobber(view, legal);
      case 'negotiating':
        return this.negotiate(view, legal);
      case 'preRoll':
        if (this.ruleDevCards) return this.rule.decide(view, legal);
        return this.knightNow(view, legal) ?? of(legal, 'rollDice')[0] ?? this.rule.decide(view, legal);
      default:
        return this.rule.decide(view, legal);
    }
  }

  /** 局面の価値。勝ちが確定する局面は最大 */
  value(h: Hypothetical): number {
    if (myTotalPoints(h) >= h.view.config.victoryPointsToWin) return 2;
    return predict(this.model, features(h));
  }

  // -------------------------------------------------------------------------

  private main(view: PlayerView, legal: readonly Action[]): Action {
    if (this.steps.turn !== view.turn) this.steps = { turn: view.turn, n: 0 };
    this.steps.n++;
    const end = of(legal, 'endTurn')[0];
    if (this.steps.n > MAX_STEPS_PER_TURN && end) return end;

    // 騎士と収穫は評価関数で、独占・街道建設と交換の提案はルールベースAIの判断を使う
    const dev = this.ruleDevCards ? undefined : (this.knightNow(view, legal) ?? this.plentyNow(view, legal));
    if (dev) return dev;
    const ruled = this.rule.decide(view, legal);
    if (this.ruleDevCards && ruled.type.startsWith('play')) return ruled;
    if (ruled.type === 'playMonopoly' || ruled.type === 'playRoadBuilding' || ruled.type === 'proposeTrade') return ruled;

    const points = legal.filter((a) => a.type === 'buildSettlement' || a.type === 'buildCity');
    if (this.forceBuild && points.length > 0) return this.pick(view, points) ?? ruled;
    const candidates = legal.filter((a) =>
      ['buildSettlement', 'buildCity', 'buildRoad', 'buyDevCard', 'bankTrade', 'endTurn'].includes(a.type),
    );
    return this.pick(view, candidates) ?? ruled;
  }

  /** 候補のうち、打った後の局面の価値が一番高いもの */
  private pick<A extends Action>(view: PlayerView, candidates: readonly A[], free = false): A | undefined {
    if (candidates.length === 0) return undefined;
    if (this.explore > 0 && this.rng.next() < this.explore) return candidates[this.rng.int(candidates.length)];
    const now = asIs(view);
    let best: A | undefined;
    let bestValue = -Infinity;
    for (const a of candidates) {
      const after = afterAction(now, a, free);
      if (!after) continue;
      const v = this.value(after) + this.rng.next() * 1e-9;
      if (v > bestValue) {
        best = a;
        bestValue = v;
      }
    }
    return best;
  }

  /**
   * 盗賊を置く手の価値 = 置いた後の局面の価値（止めた相手の生産が減る）
   *                    + 奪う1枚の期待値（相手の生産から推定した手札の中身で、もらった後の局面の価値を平均）
   * 一番脅威な相手を止めると評価関数の「一番脅威な相手」の特徴量が下がり、欲しい資源を持っていそうな相手ほど期待値が高くなる
   */
  robberScore(h: Hypothetical, hex: number, victim: number | null): number {
    const moved: Hypothetical = { ...h, view: { ...h.view, robberHex: hex } };
    const count = victim === null ? 0 : (h.view.opponents.find((o) => o.seat === victim)?.handCount ?? 0);
    if (victim === null || count === 0) return this.value(moved);
    const share = handShare(h.view, victim);
    let ev = 0;
    for (const r of RESOURCES) {
      const hand = { ...moved.view.me.hand, [r]: moved.view.me.hand[r] + 1 };
      ev += share[r] * this.value(withHand(moved, hand));
    }
    return ev;
  }

  /** 局面 h で盗賊を置ける手のうち、一番よいものとその価値 */
  private bestRobber(h: Hypothetical): { hex: number; victim: number | null; score: number } {
    const view = h.view;
    const topology = topologyOf(view);
    let best = { hex: -1, victim: null as number | null, score: -Infinity };
    view.board.terrains.forEach((_, hex) => {
      if (hex === view.robberHex) return;
      const victims = new Set<number>();
      for (const v of topology.hexVertices[hex]!) {
        const b = view.buildings[v];
        if (b && b.owner !== view.seat && (view.opponents.find((o) => o.seat === b.owner)?.handCount ?? 0) > 0) victims.add(b.owner);
      }
      for (const victim of victims.size ? [...victims] : [null]) {
        const score = this.robberScore(h, hex, victim) + this.rng.next() * 1e-9;
        if (score > best.score) best = { hex, victim, score };
      }
    });
    return best;
  }

  private moveRobber(view: PlayerView, legal: readonly Action[]): Action {
    const moves = of(legal, 'moveRobber');
    if (moves.length === 0) return this.rule.decide(view, legal);
    if (this.explore > 0 && this.rng.next() < this.explore) return moves[this.rng.int(moves.length)]!;
    const now = asIs(view);
    let best: Action | undefined;
    let bestScore = -Infinity;
    for (const a of moves) {
      const score = this.robberScore(now, a.hex, a.victim) + this.rng.next() * 1e-9;
      if (score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
    return best ?? this.rule.decide(view, legal);
  }

  /**
   * 騎士を今使うか。使った後（騎士の枚数 +1、最大騎士力の取り直し、一番よい場所に盗賊）の価値と、
   * 取っておく（今の局面）の価値を比べる
   */
  private knightNow(view: PlayerView, legal: readonly Action[]): Action | undefined {
    const knight = of(legal, 'playKnight')[0];
    if (!knight) return undefined;
    const now = asIs(view);
    const after = afterAction(now, knight);
    if (!after) return undefined;
    if (this.explore > 0 && this.rng.next() < this.explore) return this.rng.next() < 0.5 ? knight : undefined;
    const play = myTotalPoints(after) >= view.config.victoryPointsToWin ? 2 : this.bestRobber(after).score;
    return play > this.value(now) ? knight : undefined;
  }

  /** 収穫: 一番よい2枚を選び、使った後の価値が今より高ければ使う */
  private plentyNow(view: PlayerView, legal: readonly Action[]): Action | undefined {
    const options = of(legal, 'playYearOfPlenty');
    if (options.length === 0) return undefined;
    const now = asIs(view);
    const best = this.pick(view, options);
    if (!best) return undefined;
    const after = afterAction(now, best);
    return after && this.value(after) > this.value(now) ? best : undefined;
  }

  // -------------------------------------------------------------------------
  // 国内交易: 応じた後の局面の勝率が上がるときだけ応じる
  // -------------------------------------------------------------------------

  private negotiate(view: PlayerView, legal: readonly Action[]): Action {
    if (view.phase.kind !== 'negotiating') return this.rule.decide(view, legal);
    const { trade } = view.phase;
    if (view.seat !== trade.awaiting) return this.rule.decide(view, legal);
    const accept = of(legal, 'acceptTrade')[0];
    const reject = of(legal, 'rejectTrade')[0];
    if (!accept || !reject) return this.rule.decide(view, legal);
    const terms = trade.history.at(-1)!.terms;
    const iAmProposer = view.seat === trade.proposer;
    const partner = iAmProposer ? trade.counterparty : trade.proposer;
    if (this.tradeGate && this.rule.decide(view, legal).type !== 'acceptTrade') return reject;
    return this.goodTrade(view, partner, terms, iAmProposer) ? accept : reject;
  }

  answerRequest(view: PlayerView, request: TradeRequest): TradeTerms | null {
    const terms = this.rule.answerRequest(view, request);
    if (!terms) return null;
    return this.goodTrade(view, request.from, terms, false) ? terms : null;
  }

  private goodTrade(view: PlayerView, partner: number, terms: TradeTerms, iAmProposer: boolean): boolean {
    if (visiblePoints(view, partner) >= view.config.victoryPointsToWin - 2) return false;
    const out = iAmProposer ? terms.give : terms.receive;
    const inn = iAmProposer ? terms.receive : terms.give;
    const hand: ResourceCounts = { ...view.me.hand };
    for (const r of RESOURCES) hand[r] += (inn[r] ?? 0) - (out[r] ?? 0);
    if (RESOURCES.some((r) => hand[r] < 0)) return false;
    const now = asIs(view);
    return this.value(withHand(now, hand)) > this.value(now) + TRADE_MARGIN;
  }
}

function of<T extends ActionType>(legal: readonly Action[], type: T): ActionOf<T>[] {
  return legal.filter((a): a is ActionOf<T> => a.type === type);
}
