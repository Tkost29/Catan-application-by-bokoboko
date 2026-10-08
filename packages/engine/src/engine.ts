import { IllegalActionError, type Action } from './actions.js';
import { applySetupAction, setupCandidates, validateSetupAction } from './rules/setup.js';
import type { GameState } from './state.js';
import type { Seat } from './types.js';

/**
 * エンジンの公開API。UI・サーバ・AI はこの関数（と createGame, toPlayerView）だけを使う。
 * 内部をどう書き換えても、これらの振る舞いが同じなら外側は壊れない。
 */

/** アクションが不正なら理由を返す。合法なら null */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.winner !== null) return 'game is over';
  if (action.seat !== state.currentSeat) return 'not your turn';
  const { phase } = state;
  switch (phase.kind) {
    case 'setup':
      if (action.type !== 'placeSettlement' && action.type !== 'placeRoad') return 'not allowed during setup';
      return validateSetupAction(state, phase, action);
    case 'preRoll':
      return `${action.type} is not implemented yet in phase ${phase.kind}`;
  }
}

/** その席が今取れるアクションの一覧。手番でなければ空 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.winner !== null || seat !== state.currentSeat) return [];
  const { phase } = state;
  switch (phase.kind) {
    case 'setup':
      return setupCandidates(state, phase).filter((a) => validateSetupAction(state, phase, a) === null);
    case 'preRoll':
      return []; // 通常手番は未実装
  }
}

/** アクションを適用した新しい状態を返す。不正なら IllegalActionError（元の状態は変わらない） */
export function apply(state: GameState, action: Action): GameState {
  const reason = validateAction(state, action);
  if (reason !== null) throw new IllegalActionError(reason, action);
  const { phase } = state;
  switch (phase.kind) {
    case 'setup':
      if (action.type !== 'placeSettlement' && action.type !== 'placeRoad') break;
      return applySetupAction(state, phase, action);
    case 'preRoll':
      break;
  }
  throw new IllegalActionError('unreachable', action);
}
