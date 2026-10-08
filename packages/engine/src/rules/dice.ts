import { topologyFor } from '../board/generate.js';
import type { ActionOf } from '../actions.js';
import type { GameState } from '../state.js';
import { RESOURCES, TERRAIN_RESOURCE, type HexId, type ResourceCounts, type Seat } from '../types.js';
import { drawInt, hasResources, payToBank, pickRandomCard, totalCards, updatePlayer, addResources } from './common.js';

const ROBBER_NUMBER = 7;

// ---------------------------------------------------------------------------
// ダイス
// ---------------------------------------------------------------------------

/** ダイスを振る。7 なら捨て札／盗賊へ、それ以外なら生産して main へ */
export function applyRollDice(state: GameState): GameState {
  const d1 = drawInt(state, 6);
  const d2 = drawInt(d1.state, 6);
  const roll: [number, number] = [d1.value + 1, d2.value + 1];
  const rolled: GameState = { ...d2.state, lastRoll: roll };
  const sum = roll[0] + roll[1];

  if (sum !== ROBBER_NUMBER) return { ...produce(rolled, sum), phase: { kind: 'main' } };

  const remaining = rolled.players.map((p) => {
    const n = totalCards(p.hand);
    return n > rolled.config.discardLimit ? Math.floor(n / 2) : 0;
  });
  return remaining.some((n) => n > 0)
    ? { ...rolled, phase: { kind: 'discard', remaining } }
    : { ...rolled, phase: { kind: 'moveRobber' } };
}

/**
 * 出目 sum のヘックスに接する建物へ資源を配る（盗賊のいるヘックスは除く）。
 * 銀行の在庫が全員分に足りない資源は、受け取る人が1人だけなら残りを渡し、
 * 複数人なら誰も受け取れない。
 */
export function produce(state: GameState, sum: number): GameState {
  const topology = topologyFor(state.config);
  const demand: ResourceCounts[] = state.players.map(() => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }));

  state.board.numbers.forEach((n, hex) => {
    if (n !== sum || hex === state.robberHex) return;
    const resource = TERRAIN_RESOURCE[state.board.terrains[hex]!];
    if (resource === null) return;
    for (const v of topology.hexVertices[hex]!) {
      const b = state.buildings[v];
      if (b) demand[b.owner]![resource] += b.kind === 'city' ? 2 : 1;
    }
  });

  const gains: ResourceCounts[] = demand.map(() => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }));
  for (const r of RESOURCES) {
    const total = demand.reduce((s, d) => s + d[r], 0);
    if (total === 0) continue;
    if (total <= state.bank[r]) {
      demand.forEach((d, seat) => (gains[seat]![r] = d[r]));
    } else {
      const takers = demand.flatMap((d, seat) => (d[r] > 0 ? [seat] : []));
      if (takers.length === 1) gains[takers[0]!]![r] = state.bank[r];
    }
  }

  let bank = state.bank;
  for (const g of gains) bank = addResources(bank, g, -1);
  return {
    ...state,
    bank,
    players: state.players.map((p) => ({ ...p, hand: addResources(p.hand, gains[p.seat]!, 1) })),
  };
}

// ---------------------------------------------------------------------------
// 捨て札（7 が出たとき、手札が上限を超える全員が同時に半分を捨てる）
// ---------------------------------------------------------------------------

type DiscardPhase = Extract<GameState['phase'], { kind: 'discard' }>;

export function validateDiscard(state: GameState, phase: DiscardPhase, action: ActionOf<'discard'>): string | null {
  const required = phase.remaining[action.seat] ?? 0;
  if (required === 0) return 'you do not need to discard';
  const counts = action.resources;
  for (const [key, n] of Object.entries(counts)) {
    if (!(RESOURCES as readonly string[]).includes(key)) return `unknown resource ${key}`;
    if (!Number.isInteger(n) || (n as number) < 0) return 'discard counts must be non-negative integers';
  }
  if (totalCards(counts) !== required) return `must discard exactly ${required} cards`;
  if (!hasResources(state.players[action.seat]!.hand, counts)) return 'not enough cards';
  return null;
}

/** 手札から required 枚を選ぶ組み合わせをすべて列挙する */
export function discardCandidates(state: GameState, phase: DiscardPhase, seat: Seat): ActionOf<'discard'>[] {
  const required = phase.remaining[seat] ?? 0;
  if (required === 0) return [];
  const hand = state.players[seat]!.hand;
  const out: ActionOf<'discard'>[] = [];
  const pick: Partial<ResourceCounts> = {};
  const rec = (i: number, left: number): void => {
    if (i === RESOURCES.length) {
      if (left === 0) out.push({ type: 'discard', seat, resources: { ...pick } });
      return;
    }
    const r = RESOURCES[i]!;
    const max = Math.min(hand[r], left);
    for (let n = 0; n <= max; n++) {
      if (n > 0) pick[r] = n;
      else delete pick[r];
      rec(i + 1, left - n);
    }
    delete pick[r];
  };
  rec(0, required);
  return out;
}

export function applyDiscard(state: GameState, phase: DiscardPhase, action: ActionOf<'discard'>): GameState {
  const paid = payToBank(state, action.seat, action.resources);
  const remaining = phase.remaining.map((n, seat) => (seat === action.seat ? 0 : n));
  return remaining.every((n) => n === 0)
    ? { ...paid, phase: { kind: 'moveRobber' } }
    : { ...paid, phase: { kind: 'discard', remaining } };
}

// ---------------------------------------------------------------------------
// 盗賊の移動と略奪
// ---------------------------------------------------------------------------

/** hex に建物を持ち、手札が1枚以上ある、手番プレイヤー以外の席 */
export function robberVictims(state: GameState, hex: HexId): Seat[] {
  const topology = topologyFor(state.config);
  const seats = new Set<Seat>();
  for (const v of topology.hexVertices[hex]!) {
    const b = state.buildings[v];
    if (b && b.owner !== state.currentSeat && totalCards(state.players[b.owner]!.hand) > 0) seats.add(b.owner);
  }
  return [...seats].sort((a, b) => a - b);
}

export function validateMoveRobber(state: GameState, action: ActionOf<'moveRobber'>): string | null {
  const { hex, victim } = action;
  if (!Number.isInteger(hex) || hex < 0 || hex >= state.board.terrains.length) return 'no such hex';
  if (hex === state.robberHex) return 'robber must move to a different hex';
  const victims = robberVictims(state, hex);
  if (victims.length === 0) return victim === null ? null : 'nobody to steal from on that hex';
  if (victim === null) return 'must choose a player to steal from';
  return victims.includes(victim) ? null : 'that player cannot be stolen from on that hex';
}

export function moveRobberCandidates(state: GameState): ActionOf<'moveRobber'>[] {
  const seat = state.currentSeat;
  return state.board.terrains.flatMap((_, hex): ActionOf<'moveRobber'>[] => {
    if (hex === state.robberHex) return [];
    const victims: (Seat | null)[] = robberVictims(state, hex);
    return (victims.length === 0 ? [null] : victims).map((victim) => ({ type: 'moveRobber', seat, hex, victim }));
  });
}

export function applyMoveRobber(state: GameState, action: ActionOf<'moveRobber'>): GameState {
  let next: GameState = { ...state, robberHex: action.hex, phase: { kind: 'main' } };
  if (action.victim === null) return next;

  const victim = action.victim;
  const pick = pickRandomCard(next, next.players[victim]!.hand);
  next = pick.state;
  if (pick.resource === null) return next;
  const card = { [pick.resource]: 1 };
  const players = updatePlayer(next, victim, (p) => ({ ...p, hand: addResources(p.hand, card, -1) }));
  return {
    ...next,
    players: players.map((p) => (p.seat === action.seat ? { ...p, hand: addResources(p.hand, card, 1) } : p)),
  };
}
