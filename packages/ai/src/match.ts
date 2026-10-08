import { apply, awaitingSeats, createGame, legalActions, toPlayerView, type Action, type GameState } from '@bokoboko/engine';
import type { Agent } from './agent.js';

export interface MatchResult {
  readonly state: GameState;
  readonly actions: readonly Action[];
  /** 勝者の席。手数の上限で打ち切ったら null */
  readonly winner: number | null;
}

/**
 * AI 同士で1ゲーム対戦させる（自己対戦による強さの評価・回帰テスト用）。
 * agents[i] が席 i を担当する。各 AI には自分の席の PlayerView と合法手だけを渡す。
 */
export function playMatch(agents: readonly Agent[], seed: string, maxSteps = 50_000): MatchResult {
  let state = createGame(seed);
  if (agents.length !== state.players.length) {
    throw new Error(`need ${state.players.length} agents, got ${agents.length}`);
  }
  const actions: Action[] = [];
  for (let i = 0; i < maxSteps && state.winner === null; i++) {
    const seat = awaitingSeats(state)[0];
    if (seat === undefined) break;
    const legal = legalActions(state, seat);
    if (legal.length === 0) break;
    const action = agents[seat]!.decide(toPlayerView(state, seat), legal);
    state = apply(state, action);
    actions.push(action);
  }
  return { state, actions, winner: state.winner };
}
