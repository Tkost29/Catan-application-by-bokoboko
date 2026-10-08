import { createRng, RESOURCES, type Action, type PlayerView, type Rng, type TradeTerms } from '@bokoboko/engine';
import type { Agent, TradeRequest } from './agent.js';

/**
 * 難易度0: ランダムに選ぶ。エンジンのバグ出しや比較の基準に使う。
 *
 * まず操作の種類（建設・交易・手番終了など）を等確率で選び、次にその種類の中から選ぶ。
 * 合法手から一様に選ぶと、候補の多い交易の提案（約180通り）ばかりになって
 * ゲームが進まないため。
 */
export class RandomAgent implements Agent {
  readonly name = 'random';
  private readonly rng: Rng;

  constructor(seed: string) {
    this.rng = createRng(`random-agent:${seed}`);
  }

  /** 募集に返した条件（そのまま提案されたら応じる） */
  private readonly promised = new Set<string>();

  decide(view: PlayerView, legal: readonly Action[]): Action {
    if (legal.length === 0) throw new Error('no legal actions');
    if (view.phase.kind === 'negotiating' && view.phase.trade.awaiting === view.seat) {
      const key = termsKey(view.phase.trade.history.at(-1)!.terms);
      const accept = legal.find((a) => a.type === 'acceptTrade');
      if (accept && this.promised.has(key)) return accept;
    }
    const types = [...new Set(legal.map((a) => a.type))];
    const type = types[this.rng.int(types.length)]!;
    const ofType = legal.filter((a) => a.type === type);
    return ofType[this.rng.int(ofType.length)]!;
  }

  /** 募集には、ほしい物を持っていれば、あげてもいい物から1種類を同じ枚数（上限まで）求める */
  answerRequest(view: PlayerView, request: TradeRequest): TradeTerms | null {
    const want = request.want;
    if (!RESOURCES.every((r) => view.me.hand[r] >= (want[r] ?? 0))) return null;
    const pool = RESOURCES.filter((r) => (request.offer[r] ?? 0) > 0 && (want[r] ?? 0) === 0);
    if (pool.length === 0 || this.rng.next() < 0.3) return null;
    const r = pool[this.rng.int(pool.length)]!;
    const n = Math.min(request.offer[r]!, RESOURCES.reduce((s, x) => s + (want[x] ?? 0), 0));
    const terms: TradeTerms = { give: { [r]: n }, receive: want };
    this.promised.add(termsKey(terms));
    return terms;
  }
}

/** 資源の並び順に依存しない、条件の比較用キー */
function termsKey(terms: TradeTerms): string {
  return RESOURCES.map((r) => `${terms.give[r] ?? 0}/${terms.receive[r] ?? 0}`).join(',');
}
