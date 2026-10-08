import { IllegalActionError, type Action, type ActionType } from './actions.js';
import {
  applyBankTrade,
  applyBuildCity,
  applyBuildRoad,
  applyBuildSettlement,
  applyEndTurn,
  mainCandidates,
  validateBankTrade,
  validateBuildCity,
  validateBuildRoad,
  validateBuildSettlement,
} from './rules/build.js';
import {
  applyDiscard,
  applyMoveRobber,
  applyRollDice,
  discardCandidates,
  moveRobberCandidates,
  validateDiscard,
  validateMoveRobber,
} from './rules/dice.js';
import {
  applyBuyDevCard,
  applyFreeRoad,
  applyPlayDevCard,
  devCardCandidates,
  validateBuyDevCard,
  validateFreeRoad,
  validatePlayDevCard,
} from './rules/devcards.js';
import { checkWinner } from './rules/score.js';
import {
  applyNegotiationAction,
  applyProposeTrade,
  negotiationCandidates,
  proposeTradeCandidates,
  validateNegotiationAction,
  validateProposeTrade,
} from './rules/trade.js';
import { applySetupAction, setupCandidates, validateSetupAction } from './rules/setup.js';
import type { GameState, Phase } from './state.js';
import type { Seat } from './types.js';

/**
 * エンジンの公開API。UI・サーバ・AI はこの関数（と createGame, toPlayerView）だけを使う。
 * 内部をどう書き換えても、これらの振る舞いが同じなら外側は壊れない。
 */

/** フェーズごとに受け付けるアクションの種類 */
const PLAY_DEV_CARD: readonly ActionType[] = ['playKnight', 'playRoadBuilding', 'playYearOfPlenty', 'playMonopoly'];
const ALLOWED: Readonly<Record<Phase['kind'], readonly ActionType[]>> = {
  setup: ['placeSettlement', 'placeRoad'],
  preRoll: ['rollDice', ...PLAY_DEV_CARD],
  discard: ['discard'],
  moveRobber: ['moveRobber'],
  roadBuilding: ['buildRoad'],
  main: ['buildRoad', 'buildSettlement', 'buildCity', 'bankTrade', 'buyDevCard', ...PLAY_DEV_CARD, 'proposeTrade', 'endTurn'],
  negotiating: ['acceptTrade', 'rejectTrade', 'counterTrade', 'withdrawTrade'],
  gameOver: [],
};

/** アクションが不正なら理由を返す。合法なら null */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.winner !== null) return 'game is over';
  if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= state.players.length) return 'no such seat';
  const { phase } = state;
  if (!ALLOWED[phase.kind].includes(action.type)) return `${action.type} is not allowed in phase ${phase.kind}`;
  // 捨て札と交易の応答は手番以外の席も入力する（席の確認は各ルールで行う）
  if (phase.kind !== 'discard' && phase.kind !== 'negotiating' && action.seat !== state.currentSeat) {
    return 'not your turn';
  }

  switch (action.type) {
    case 'placeSettlement':
    case 'placeRoad':
      return phase.kind === 'setup' ? validateSetupAction(state, phase, action) : 'not in setup';
    case 'rollDice':
      return null;
    case 'discard':
      return phase.kind === 'discard' ? validateDiscard(state, phase, action) : 'not discarding';
    case 'moveRobber':
      return validateMoveRobber(state, action);
    case 'buildRoad':
      // 街道建設カードの道は無料
      return phase.kind === 'roadBuilding' ? validateFreeRoad(state, action) : validateBuildRoad(state, action);
    case 'buildSettlement':
      return validateBuildSettlement(state, action);
    case 'buildCity':
      return validateBuildCity(state, action);
    case 'bankTrade':
      return validateBankTrade(state, action);
    case 'endTurn':
      return null;
    case 'buyDevCard':
      return validateBuyDevCard(state, action);
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly':
      return validatePlayDevCard(state, action);
    case 'proposeTrade':
      return validateProposeTrade(state, action);
    case 'acceptTrade':
    case 'rejectTrade':
    case 'counterTrade':
    case 'withdrawTrade':
      return phase.kind === 'negotiating' ? validateNegotiationAction(state, phase, action) : 'no trade in progress';
  }
}

/** その席が今取れるアクションの一覧。何もできなければ空 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.winner !== null) return [];
  const { phase } = state;
  if (phase.kind === 'discard') return discardCandidates(state, phase, seat);
  if (phase.kind === 'negotiating') {
    return negotiationCandidates(phase, seat).filter((a) => validateAction(state, a) === null);
  }
  if (seat !== state.currentSeat) return [];

  const candidates: Action[] = (() => {
    switch (phase.kind) {
      case 'setup':
        return setupCandidates(state, phase);
      case 'preRoll':
        return [{ type: 'rollDice', seat }, ...devCardCandidates(state)];
      case 'moveRobber':
        return moveRobberCandidates(state);
      case 'roadBuilding':
        return state.roads.map((_, edge) => ({ type: 'buildRoad' as const, seat, edge }));
      case 'main':
        return [...mainCandidates(state), ...devCardCandidates(state), ...proposeTradeCandidates(state)];
      case 'gameOver':
        return [];
    }
  })();
  return candidates.filter((a) => validateAction(state, a) === null);
}

/** 今入力を待っている席（捨て札中は複数、それ以外は手番の席だけ。終了後は空） */
export function awaitingSeats(state: GameState): Seat[] {
  if (state.winner !== null) return [];
  if (state.phase.kind === 'discard') {
    return state.phase.remaining.flatMap((n, seat) => (n > 0 ? [seat] : []));
  }
  // 交渉中は応答する側（提案者は待っている間も取り下げだけはできる）
  if (state.phase.kind === 'negotiating') return [state.phase.trade.awaiting];
  return [state.currentSeat];
}

/** アクションを適用した新しい状態を返す。不正なら IllegalActionError（元の状態は変わらない） */
export function apply(state: GameState, action: Action): GameState {
  const reason = validateAction(state, action);
  if (reason !== null) throw new IllegalActionError(reason, action);
  return checkWinner(applyValidated(state, action));
}

function applyValidated(state: GameState, action: Action): GameState {
  const { phase } = state;
  switch (action.type) {
    case 'placeSettlement':
    case 'placeRoad':
      if (phase.kind === 'setup') return applySetupAction(state, phase, action);
      break;
    case 'rollDice':
      return applyRollDice(state);
    case 'discard':
      if (phase.kind === 'discard') return applyDiscard(state, phase, action);
      break;
    case 'moveRobber':
      return applyMoveRobber(state, action);
    case 'buildRoad':
      return phase.kind === 'roadBuilding' ? applyFreeRoad(state, phase, action) : applyBuildRoad(state, action);
    case 'buildSettlement':
      return applyBuildSettlement(state, action);
    case 'buildCity':
      return applyBuildCity(state, action);
    case 'bankTrade':
      return applyBankTrade(state, action);
    case 'endTurn':
      return applyEndTurn(state);
    case 'buyDevCard':
      return applyBuyDevCard(state, action);
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly':
      return applyPlayDevCard(state, action);
    case 'proposeTrade':
      return applyProposeTrade(state, action);
    case 'acceptTrade':
    case 'rejectTrade':
    case 'counterTrade':
    case 'withdrawTrade':
      if (phase.kind === 'negotiating') return applyNegotiationAction(state, phase, action);
      break;
  }
  throw new IllegalActionError('unreachable', action);
}
