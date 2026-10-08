import type { ActionOf } from '../actions.js';
import type { GameState, TradeNegotiation, TradeTerms } from '../state.js';
import { RESOURCES, type Seat } from '../types.js';
import { addResources, hasResources, totalCards } from './common.js';

/**
 * 国内交易（プレイヤー同士の交換）。
 *
 * 1. 手番プレイヤーが相手1人に、出す資源と受け取る資源を種類・枚数とも自由に組んで提案する
 * 2. 応答側は 承認 / 拒否 / 逆提案。逆提案は相手に戻り、同じ3択を繰り返す
 * 3. 手番プレイヤーはいつでも取り下げられる
 *
 * 条件（TradeTerms）は常に提案者（手番プレイヤー）から見た向きで書く。
 *
 * 相手の手札は非公開なので、提案の時点では相手が資源を持っているかを確かめない
 * （確かめると「提案できるか」で相手の手札がばれる）。成立時に両者の手札を確かめる。
 */

type NegotiatingPhase = Extract<GameState['phase'], { kind: 'negotiating' }>;

/** 条件の形が正しいか（資源名・非負整数・両方1枚以上・同じ資源を両側に置かない） */
export function validateTerms(terms: TradeTerms): string | null {
  for (const side of [terms.give, terms.receive]) {
    for (const [key, n] of Object.entries(side)) {
      if (!(RESOURCES as readonly string[]).includes(key)) return `unknown resource ${key}`;
      if (!Number.isInteger(n) || (n as number) < 0) return 'counts must be non-negative integers';
    }
  }
  if (totalCards(terms.give) === 0 || totalCards(terms.receive) === 0) {
    return 'both sides must offer at least one card (no gifts)';
  }
  if (RESOURCES.some((r) => (terms.give[r] ?? 0) > 0 && (terms.receive[r] ?? 0) > 0)) {
    return 'the same resource cannot be on both sides';
  }
  return null;
}

/** 条件を出す側が、自分が渡す分の資源を持っているか */
function offererCanPay(state: GameState, trade: Pick<TradeNegotiation, 'proposer'>, by: Seat, terms: TradeTerms): boolean {
  const hand = state.players[by]!.hand;
  return by === trade.proposer ? hasResources(hand, terms.give) : hasResources(hand, terms.receive);
}

export function currentTerms(trade: TradeNegotiation): TradeTerms {
  return trade.history.at(-1)!.terms;
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

export function validateProposeTrade(state: GameState, action: ActionOf<'proposeTrade'>): string | null {
  const { seat, to, terms } = action;
  if (!Number.isInteger(to) || to < 0 || to >= state.players.length) return 'no such seat';
  if (to === seat) return 'cannot trade with yourself';
  const shape = validateTerms(terms);
  if (shape !== null) return shape;
  if (!hasResources(state.players[seat]!.hand, terms.give)) return 'you do not have those cards';
  return null;
}

export function validateNegotiationAction(
  state: GameState,
  phase: NegotiatingPhase,
  action: ActionOf<'acceptTrade' | 'rejectTrade' | 'counterTrade' | 'withdrawTrade'>,
): string | null {
  const { trade } = phase;
  if (action.type === 'withdrawTrade') {
    return action.seat === trade.proposer ? null : 'only the proposer can withdraw';
  }
  if (action.seat !== trade.awaiting) return 'not your turn to respond';

  switch (action.type) {
    case 'rejectTrade':
      return null;
    case 'acceptTrade': {
      const terms = currentTerms(trade);
      if (!hasResources(state.players[trade.proposer]!.hand, terms.give)) return 'proposer cannot pay';
      if (!hasResources(state.players[trade.counterparty]!.hand, terms.receive)) return 'counterparty cannot pay';
      return null;
    }
    case 'counterTrade': {
      const counters = trade.history.length - 1;
      if (counters >= state.config.maxTradeCounterRounds) return 'counter-offer limit reached';
      const shape = validateTerms(action.terms);
      if (shape !== null) return shape;
      if (!offererCanPay(state, trade, action.seat, action.terms)) return 'you do not have those cards';
      if (sameTerms(action.terms, currentTerms(trade))) return 'counter-offer must change the terms';
      return null;
    }
  }
}

function sameTerms(a: TradeTerms, b: TradeTerms): boolean {
  return RESOURCES.every(
    (r) => (a.give[r] ?? 0) === (b.give[r] ?? 0) && (a.receive[r] ?? 0) === (b.receive[r] ?? 0),
  );
}

// ---------------------------------------------------------------------------
// 適用
// ---------------------------------------------------------------------------

export function applyProposeTrade(state: GameState, action: ActionOf<'proposeTrade'>): GameState {
  return {
    ...state,
    phase: {
      kind: 'negotiating',
      trade: {
        proposer: action.seat,
        counterparty: action.to,
        history: [{ by: action.seat, terms: action.terms }],
        awaiting: action.to,
      },
    },
  };
}

export function applyNegotiationAction(
  state: GameState,
  phase: NegotiatingPhase,
  action: ActionOf<'acceptTrade' | 'rejectTrade' | 'counterTrade' | 'withdrawTrade'>,
): GameState {
  const { trade } = phase;
  switch (action.type) {
    case 'rejectTrade':
    case 'withdrawTrade':
      return { ...state, phase: { kind: 'main' } };
    case 'counterTrade':
      return {
        ...state,
        phase: {
          kind: 'negotiating',
          trade: {
            ...trade,
            history: [...trade.history, { by: action.seat, terms: action.terms }],
            awaiting: action.seat === trade.proposer ? trade.counterparty : trade.proposer,
          },
        },
      };
    case 'acceptTrade': {
      const { give, receive } = currentTerms(trade);
      return {
        ...state,
        phase: { kind: 'main' },
        players: state.players.map((p) => {
          if (p.seat === trade.proposer) return { ...p, hand: addResources(addResources(p.hand, give, -1), receive, 1) };
          if (p.seat === trade.counterparty) {
            return { ...p, hand: addResources(addResources(p.hand, receive, -1), give, 1) };
          }
          return p;
        }),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 合法手の候補
// ---------------------------------------------------------------------------
//
// 提案・逆提案の条件は組み合わせが無限にあるので、legalActions には
// 代表的な単純な条件（1:1 と 2:1）だけを並べる。validateAction / apply は
// それ以外の任意の正しい条件も受け付ける（人間の UI は自由に組める）。

function simpleTerms(): TradeTerms[] {
  const out: TradeTerms[] = [];
  for (const a of RESOURCES) {
    for (const b of RESOURCES) {
      if (a === b) continue;
      out.push({ give: { [a]: 1 }, receive: { [b]: 1 } });
      out.push({ give: { [a]: 2 }, receive: { [b]: 1 } });
      out.push({ give: { [a]: 1 }, receive: { [b]: 2 } });
    }
  }
  return out;
}

const SIMPLE_TERMS = simpleTerms();

export function proposeTradeCandidates(state: GameState): ActionOf<'proposeTrade'>[] {
  const seat = state.currentSeat;
  return state.players
    .filter((p) => p.seat !== seat)
    .flatMap((p) => SIMPLE_TERMS.map((terms) => ({ type: 'proposeTrade' as const, seat, to: p.seat, terms })));
}

export function negotiationCandidates(
  phase: NegotiatingPhase,
  seat: Seat,
): ActionOf<'acceptTrade' | 'rejectTrade' | 'counterTrade' | 'withdrawTrade'>[] {
  const { trade } = phase;
  const out: ActionOf<'acceptTrade' | 'rejectTrade' | 'counterTrade' | 'withdrawTrade'>[] = [];
  if (seat === trade.awaiting) {
    out.push({ type: 'acceptTrade', seat }, { type: 'rejectTrade', seat });
    for (const terms of SIMPLE_TERMS) out.push({ type: 'counterTrade', seat, terms });
  }
  if (seat === trade.proposer) out.push({ type: 'withdrawTrade', seat });
  return out;
}
