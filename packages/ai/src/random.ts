import { createRng, type Action, type PlayerView, type Rng } from '@bokoboko/engine';
import type { Agent } from './agent.js';

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

  decide(_view: PlayerView, legal: readonly Action[]): Action {
    if (legal.length === 0) throw new Error('no legal actions');
    const types = [...new Set(legal.map((a) => a.type))];
    const type = types[this.rng.int(types.length)]!;
    const ofType = legal.filter((a) => a.type === type);
    return ofType[this.rng.int(ofType.length)]!;
  }
}
