import { describe, expect, it } from 'vitest';
import {
  apply,
  awaitingSeats,
  createConfig,
  IllegalActionError,
  legalActions,
  type Action,
  type GameState,
  type TradeTerms,
} from '../src/index.js';
import { checkInvariants, emptyBoardMain } from './helpers.js';

const rejects = (state: GameState, action: Action, message?: RegExp): void => {
  expect(() => apply(state, action)).toThrow(message ?? IllegalActionError);
};

// 席0: 木3・羊1、席1: 鉱2・麦1、席2: なし
const base = (): GameState =>
  emptyBoardMain('trade', { 0: { wood: 3, sheep: 1 }, 1: { ore: 2, wheat: 1 } });

const woodForOre: TradeTerms = { give: { wood: 2 }, receive: { ore: 1 } };

describe('提案', () => {
  it('手番プレイヤーが相手を指定して、種類・枚数を自由に組んで提案できる', () => {
    const s = apply(base(), { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: 3, sheep: 1 }, receive: { ore: 2, wheat: 1 } } });
    expect(s.phase.kind).toBe('negotiating');
    if (s.phase.kind !== 'negotiating') return;
    expect(s.phase.trade).toMatchObject({ proposer: 0, counterparty: 1, awaiting: 1 });
    expect(awaitingSeats(s)).toEqual([1]);
    checkInvariants(s);
  });

  it('形のおかしい提案は拒否する', () => {
    const s = base();
    rejects(s, { type: 'proposeTrade', seat: 0, to: 0, terms: woodForOre }); // 自分自身
    rejects(s, { type: 'proposeTrade', seat: 0, to: 9, terms: woodForOre }); // 存在しない席
    rejects(s, { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: 1 }, receive: {} } }); // 贈与
    rejects(s, { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: 1 }, receive: { wood: 1 } } }); // 同じ資源
    rejects(s, { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: 4 }, receive: { ore: 1 } } }); // 手札不足
    rejects(s, { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: -1, sheep: 2 }, receive: { ore: 1 } } });
    rejects(s, { type: 'proposeTrade', seat: 1, to: 0, terms: { give: { ore: 1 }, receive: { wood: 1 } } }); // 手番でない
  });

  it('相手が持っていない資源を求める提案もできる（相手の手札を漏らさないため）', () => {
    const s = apply(base(), { type: 'proposeTrade', seat: 0, to: 2, terms: woodForOre });
    // 承認はできない（成立時に手札を確かめる）が、拒否はできる
    expect(legalActions(s, 2).map((a) => a.type)).not.toContain('acceptTrade');
    rejects(s, { type: 'acceptTrade', seat: 2 });
    expect(apply(s, { type: 'rejectTrade', seat: 2 }).phase).toEqual({ kind: 'main' });
  });

  it('サイコロ前や交渉中には提案できない', () => {
    rejects({ ...base(), phase: { kind: 'preRoll' } }, { type: 'proposeTrade', seat: 0, to: 1, terms: woodForOre });
    const s = apply(base(), { type: 'proposeTrade', seat: 0, to: 1, terms: woodForOre });
    rejects(s, { type: 'proposeTrade', seat: 0, to: 2, terms: woodForOre });
    rejects(s, { type: 'endTurn', seat: 0 });
  });
});

describe('応答', () => {
  const proposed = (): GameState => apply(base(), { type: 'proposeTrade', seat: 0, to: 1, terms: woodForOre });

  it('承認すると交換が成立し main に戻る', () => {
    const s = apply(proposed(), { type: 'acceptTrade', seat: 1 });
    expect(s.phase).toEqual({ kind: 'main' });
    expect(s.players[0]!.hand).toMatchObject({ wood: 1, ore: 1, sheep: 1 });
    expect(s.players[1]!.hand).toMatchObject({ wood: 2, ore: 1, wheat: 1 });
    checkInvariants(s);
  });

  it('拒否すると何も変わらず main に戻る', () => {
    const before = base();
    const s = apply(proposed(), { type: 'rejectTrade', seat: 1 });
    expect(s.phase).toEqual({ kind: 'main' });
    expect(s.players).toEqual(before.players);
  });

  it('応答できるのは指名された相手だけ', () => {
    rejects(proposed(), { type: 'acceptTrade', seat: 2 });
    rejects(proposed(), { type: 'acceptTrade', seat: 0 }); // 提案者は自分の提案を承認できない
    expect(legalActions(proposed(), 2)).toEqual([]);
  });

  it('提案者は相手の応答待ちの間も取り下げられる。相手は取り下げられない', () => {
    expect(legalActions(proposed(), 0)).toEqual([{ type: 'withdrawTrade', seat: 0 }]);
    rejects(proposed(), { type: 'withdrawTrade', seat: 1 });
    expect(apply(proposed(), { type: 'withdrawTrade', seat: 0 }).phase).toEqual({ kind: 'main' });
  });
});

describe('逆提案', () => {
  const proposed = (s = base()): GameState => apply(s, { type: 'proposeTrade', seat: 0, to: 1, terms: woodForOre });
  // 条件は常に提案者（席0）から見た向き: 席1が「木3枚なら鉱1枚」と返す
  const counter: TradeTerms = { give: { wood: 3 }, receive: { ore: 1 } };

  it('逆提案は提案者に戻り、提案者が承認すれば逆提案の条件で成立する', () => {
    const c = apply(proposed(), { type: 'counterTrade', seat: 1, terms: counter });
    if (c.phase.kind !== 'negotiating') throw new Error('expected negotiating');
    expect(c.phase.trade.awaiting).toBe(0);
    expect(c.phase.trade.history.map((h) => h.by)).toEqual([0, 1]);
    rejects(c, { type: 'acceptTrade', seat: 1 }); // 今は提案者の番

    const done = apply(c, { type: 'acceptTrade', seat: 0 });
    expect(done.players[0]!.hand).toMatchObject({ wood: 0, ore: 1 });
    expect(done.players[1]!.hand).toMatchObject({ wood: 3, ore: 1 });
    checkInvariants(done);
  });

  it('提案者がさらに逆提案すると相手に戻る', () => {
    let s = apply(proposed(), { type: 'counterTrade', seat: 1, terms: counter });
    s = apply(s, { type: 'counterTrade', seat: 0, terms: { give: { wood: 2, sheep: 1 }, receive: { ore: 1 } } });
    if (s.phase.kind !== 'negotiating') throw new Error('expected negotiating');
    expect(s.phase.trade.awaiting).toBe(1);
  });

  it('逆提案する側は、自分が渡す分を持っていなければならない', () => {
    // 席1は鉱を2枚しか持っていない
    rejects(proposed(), { type: 'counterTrade', seat: 1, terms: { give: { wood: 2 }, receive: { ore: 3 } } });
  });

  it('条件を変えない逆提案はできない', () => {
    rejects(proposed(), { type: 'counterTrade', seat: 1, terms: woodForOre });
  });

  it('往復回数の上限に達したら、承認か拒否しかできない', () => {
    const config = createConfig({ maxTradeCounterRounds: 2 });
    let s = proposed({ ...base(), config });
    s = apply(s, { type: 'counterTrade', seat: 1, terms: counter });
    s = apply(s, { type: 'counterTrade', seat: 0, terms: { give: { wood: 2, sheep: 1 }, receive: { ore: 1 } } });
    rejects(s, { type: 'counterTrade', seat: 1, terms: counter }, /limit/);
    expect(new Set(legalActions(s, 1).map((a) => a.type))).toEqual(new Set(['acceptTrade', 'rejectTrade']));
  });
});

describe('通しプレイとの組み合わせ', () => {
  it('交渉の合法手は提案者・応答者ともに有限で、どれを選んでも不変条件を満たす', () => {
    let s = apply(base(), { type: 'proposeTrade', seat: 0, to: 1, terms: { give: { wood: 1 }, receive: { ore: 1 } } });
    for (const a of legalActions(s, 1)) checkInvariants(apply(s, a));
    s = apply(s, { type: 'counterTrade', seat: 1, terms: { give: { wood: 2 }, receive: { ore: 1 } } });
    for (const a of legalActions(s, 0)) checkInvariants(apply(s, a));
  });
});
