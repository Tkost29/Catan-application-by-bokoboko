export type { Agent, AiLevel, TradeRequest } from './agent.js';
export { RandomAgent } from './random.js';
export { RuleBasedAgent } from './ruleBased.js';
export { AI_LEVELS, createAgent, DEFAULT_AI_LEVEL } from './registry.js';
export { playMatch, type MatchResult } from './match.js';
export * as evaluate from './evaluate.js';
export {
  DEFAULT_PLAY,
  DEFAULT_STRATEGY,
  IMPROVED_PLACEMENT,
  PLACEMENT_PRESETS,
  PLAY_PRESETS,
  strategyOf,
  type Goal,
  type PlacementPreset,
  type PlayPreset,
  type PlayStyle,
  type Strategy,
} from './strategy.js';
export { DEFAULT_PLACEMENT, type PlacementWeights } from './evaluate.js';
export { boardScarcity, handShare, leaderGap, threatOf, threats, usefulStealChance } from './threat.js';
export { FEATURE_NAMES, afterAction, asIs, features, type Hypothetical } from './learned/features.js';
export { predict, type ValueModel } from './learned/model.js';
export { LearnedAgent, type LearnedOptions } from './learned/agent.js';
