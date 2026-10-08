// 公開API: createGame / legalActions / apply / toPlayerView（+ validateAction）
export { createGame, emptyResources } from './game.js';
export { apply, awaitingSeats, legalActions, validateAction } from './engine.js';
export { toPlayerView, type OpponentView, type PlayerView } from './view.js';
export { IllegalActionError, type Action, type ActionOf, type ActionType } from './actions.js';
export { longestRoadLength, victoryPoints } from './rules/score.js';
export { tradeRate } from './rules/build.js';
export type { Building, DevCard, GameState, Phase, PlayerState } from './state.js';

// 設定・盤面・共通の型
export * from './types.js';
export * from './config.js';
export * from './rng.js';
export * from './board/topology.js';
export * from './board/generate.js';
