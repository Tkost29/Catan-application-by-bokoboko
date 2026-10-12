export type { Agent, AiLevel, TradeRequest } from './agent.js';
export { RandomAgent } from './random.js';
export { RuleBasedAgent } from './ruleBased.js';
export { AI_LEVELS, createAgent, DEFAULT_AI_LEVEL } from './registry.js';
export { playMatch, type MatchResult } from './match.js';
export * as evaluate from './evaluate.js';
export {
  DEFAULT_PLAY,
  DEFAULT_STRATEGY,
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
