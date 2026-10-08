import type { Action, PlayerView } from '@bokoboko/engine';

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
}

/** 難易度（席ごとに設定する） */
export type AiLevel = 0 | 1;
