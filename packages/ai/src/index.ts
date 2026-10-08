export type { Agent, AiLevel } from './agent.js';
export { RandomAgent } from './random.js';
export { RuleBasedAgent } from './ruleBased.js';
export { AI_LEVELS, createAgent, DEFAULT_AI_LEVEL } from './registry.js';
export { playMatch, type MatchResult } from './match.js';
export * as evaluate from './evaluate.js';
