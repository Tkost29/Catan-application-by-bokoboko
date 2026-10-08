import type { Action, PlayerView, ResourceCounts, Seat, TradeTerms } from '@bokoboko/engine';

/**
 * 交換の募集。「ほしい物」と「あげてもいい物（上限枚数）」だけを決めて、
 * 相手に具体的な条件を出してもらう。
 */
export interface TradeRequest {
  /** 募集した人（手番プレイヤー） */
  readonly from: Seat;
  /** ほしい資源と枚数 */
  readonly want: Partial<ResourceCounts>;
  /** あげてもいい資源と、それぞれの上限枚数 */
  readonly offer: Partial<ResourceCounts>;
}

/**
 * AI プレイヤーの共通インターフェース。
 *
 * 受け取るのは「その席から見える情報（PlayerView）」と「今取れる合法手」だけ。
 * 他人の手札や山札、今後のダイスは見えないので、ズルのしようがない。
 * 返すのは原則として legal の中の1つ（国内交易の提案のように条件が自由な操作は、
 * engine の validateAction を通る形なら legal にないものを組み立ててもよい）。
 */
export interface Agent {
  /** 表示・ログ用の名前（例: "rule-based"） */
  readonly name: string;
  decide(view: PlayerView, legal: readonly Action[]): Action;
  /**
   * 交換の募集に、自分なら応じられる条件を返す（応じられなければ null）。
   * 条件は募集した人（提案者）から見た向き。返した条件をそのまま提案されたら必ず応じること。
   */
  answerRequest?(view: PlayerView, request: TradeRequest): TradeTerms | null;
}

/** 難易度（席ごとに設定する） */
export type AiLevel = 0 | 1;
