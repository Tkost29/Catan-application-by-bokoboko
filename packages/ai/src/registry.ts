import type { Agent, AiLevel } from './agent.js';
import { RandomAgent } from './random.js';
import { RuleBasedAgent } from './ruleBased.js';

/**
 * 難易度 → AI 実装の対応表。
 * 新しい AI を足すときはここに1行追加するだけで、ルームの席設定から選べるようになる。
 */
export const AI_LEVELS: Readonly<Record<AiLevel, { readonly label: string; readonly create: (seed: string) => Agent }>> = {
  0: { label: 'ランダム', create: (seed) => new RandomAgent(seed) },
  1: { label: 'ふつう（ルールベース）', create: (seed) => new RuleBasedAgent(seed) },
};

/** 既定の難易度（空き席の自動補充に使う） */
export const DEFAULT_AI_LEVEL: AiLevel = 1;

export function createAgent(level: AiLevel, seed: string): Agent {
  return AI_LEVELS[level].create(seed);
}
