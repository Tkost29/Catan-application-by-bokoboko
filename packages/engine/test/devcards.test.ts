import { describe, expect, it } from 'vitest';
import {
  apply,
  IllegalActionError,
  legalActions,
  STANDARD_TOPOLOGY as T,
  victoryPoints,
  type Action,
  type GameState,
} from '../src/index.js';
import { checkInvariants, emptyBoardMain, giveDevCards, place, simplePath } from './helpers.js';

const rejects = (state: GameState, action: Action): void => {
  expect(() => apply(state, action)).toThrow(IllegalActionError);
};

const DEV_COST = { sheep: 1, wheat: 1, ore: 1 };

describe('購入', () => {
  it('費用を払って山札の一番上を引き、買った手番が記録される', () => {
    const s = emptyBoardMain('buy', { 0: DEV_COST });
    const top = s.devDeck[0]!;
    const after = apply(s, { type: 'buyDevCard', seat: 0 });
    expect(after.devDeck).toHaveLength(24);
    expect(after.players[0]!.devCards).toEqual([{ card: top, boughtTurn: s.turn }]);
    expect(after.players[0]!.hand).toMatchObject({ sheep: 0, wheat: 0, ore: 0 });
    checkInvariants(after);
  });

  it('資源が足りない、または山札が空なら買えない', () => {
    rejects(emptyBoardMain('buy2', { 0: { sheep: 1, wheat: 1 } }), { type: 'buyDevCard', seat: 0 });
    const s = emptyBoardMain('buy3', { 0: DEV_COST });
    rejects({ ...s, devDeck: [] }, { type: 'buyDevCard', seat: 0 });
  });

  it('サイコロ前には買えない', () => {
    const s: GameState = { ...emptyBoardMain('buy4', { 0: DEV_COST }), phase: { kind: 'preRoll' } };
    rejects(s, { type: 'buyDevCard', seat: 0 });
  });
});

describe('使用の制限', () => {
  it('買ったその手番には使えず、次の自分の手番から使える', () => {
    const s = giveDevCards(emptyBoardMain('lim1'), 0, ['monopoly'], 1);
    rejects(s, { type: 'playMonopoly', seat: 0, resource: 'wood' });
    const later = { ...s, turn: 2 };
    expect(() => apply(later, { type: 'playMonopoly', seat: 0, resource: 'wood' })).not.toThrow();
  });

  it('1手番に使えるのは1枚まで。手番が変わればまた使える', () => {
    const s = giveDevCards(emptyBoardMain('lim2'), 0, ['monopoly', 'monopoly']);
    const once = apply(s, { type: 'playMonopoly', seat: 0, resource: 'wood' });
    expect(once.devCardPlayedThisTurn).toBe(true);
    rejects(once, { type: 'playMonopoly', seat: 0, resource: 'ore' });
    expect(legalActions(once, 0).some((a) => a.type === 'playMonopoly')).toBe(false);

    const nextTurn = apply(once, { type: 'endTurn', seat: 0 });
    expect(nextTurn.devCardPlayedThisTurn).toBe(false);
  });

  it('勝利点カードは使えないが、持っているだけで点になる', () => {
    const s = giveDevCards(emptyBoardMain('vp'), 0, ['victoryPoint', 'victoryPoint']);
    expect(victoryPoints(s, 0)).toBe(2);
    expect(victoryPoints(s, 0, false)).toBe(0); // 他人からは見えない
  });

  it('勝利点カードを買って10点に届けばその場で勝つ', () => {
    // 互いに隣り合わない頂点を5つ
    const vs: number[] = [];
    for (let v = 0; vs.length < 5; v++) {
      if (vs.every((c) => !T.vertexNeighbors[c]!.includes(v))) vs.push(v);
    }
    let s = place(emptyBoardMain('vpwin', { 0: DEV_COST }), {
      cities: vs.slice(0, 4).map((v) => [0, v]),
      settlements: [[0, vs[4]!]],
    });
    expect(victoryPoints(s, 0)).toBe(9);
    // 山札の一番上が勝利点カードになるよう並べ替える
    const i = s.devDeck.indexOf('victoryPoint');
    s = { ...s, devDeck: [s.devDeck[i]!, ...s.devDeck.filter((_, j) => j !== i)] };
    const won = apply(s, { type: 'buyDevCard', seat: 0 });
    expect(won.winner).toBe(0);
  });
});

describe('騎士', () => {
  /** 盗賊のいないヘックス h に席1の開拓地があり、席0が騎士を1枚持つ状態 */
  const withVictim = (seed: string): { state: GameState; h: number } => {
    const base = emptyBoardMain(seed, { 1: { ore: 1 } });
    const h = [...Array(19).keys()].find((x) => x !== base.robberHex)!;
    const state = giveDevCards(place(base, { settlements: [[1, T.hexVertices[h]![0]!]] }), 0, ['knight']);
    return { state, h };
  };

  it('main で使うと盗賊を動かして1枚奪い、終わると main に戻る', () => {
    const { state: s, h } = withVictim('k1');
    const robber = apply(s, { type: 'playKnight', seat: 0 });
    expect(robber.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(robber.players[0]!.playedKnights).toBe(1);
    const after = apply(robber, { type: 'moveRobber', seat: 0, hex: h, victim: 1 });
    expect(after.phase).toEqual({ kind: 'main' });
    expect(after.players[0]!.hand.ore).toBe(1);
    checkInvariants(after);
  });

  it('サイコロ前に使うと、盗賊を動かしたあとサイコロ前に戻る', () => {
    const s: GameState = { ...withVictim('k2').state, phase: { kind: 'preRoll' } };
    const robber = apply(s, { type: 'playKnight', seat: 0 });
    expect(robber.phase).toEqual({ kind: 'moveRobber', returnTo: 'preRoll' });
    const target = [...Array(19).keys()].find((x) => x !== robber.robberHex)!;
    const move = legalActions(robber, 0).find((a) => a.type === 'moveRobber' && a.hex === target)!;
    const after = apply(robber, move);
    expect(after.phase).toEqual({ kind: 'preRoll' });
    expect(legalActions(after, 0)).toContainEqual({ type: 'rollDice', seat: 0 });
  });
});

describe('最大騎士力', () => {
  /** 席 seat が騎士を n 枚使った状態にする（各回、盗賊は奪う相手のいないヘックスへ） */
  function playKnights(state: GameState, seat: number, n: number): GameState {
    let s: GameState = giveDevCards({ ...state, currentSeat: seat }, seat, Array(n).fill('knight'));
    for (let i = 0; i < n; i++) {
      s = { ...s, phase: { kind: 'main' }, devCardPlayedThisTurn: false };
      s = apply(s, { type: 'playKnight', seat });
      const move = legalActions(s, seat).find((a) => a.type === 'moveRobber')!;
      s = apply(s, move);
    }
    return s;
  }

  it('3枚で最大騎士力（2点）、2枚では誰も持たない', () => {
    const two = playKnights(emptyBoardMain('a1'), 0, 2);
    expect(two.largestArmy).toBeNull();
    const three = playKnights(emptyBoardMain('a1'), 0, 3);
    expect(three.largestArmy).toBe(0);
    expect(victoryPoints(three, 0)).toBe(2);
    checkInvariants(three);
  });

  it('同数に追いつかれても保持者のまま、上回られたら移る', () => {
    let s = playKnights(emptyBoardMain('a2'), 0, 3);
    s = playKnights(s, 1, 3);
    expect(s.largestArmy).toBe(0);
    s = playKnights(s, 1, 1);
    expect(s.largestArmy).toBe(1);
    checkInvariants(s);
  });
});

describe('街道建設', () => {
  const v0 = 20;

  it('無料で道を2本置き、元のフェーズに戻る', () => {
    const s = giveDevCards(place(emptyBoardMain('rb1'), { settlements: [[0, v0]] }), 0, ['roadBuilding']);
    let r = apply(s, { type: 'playRoadBuilding', seat: 0 });
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 2, returnTo: 'main' });
    expect(legalActions(r, 0).every((a) => a.type === 'buildRoad')).toBe(true);
    rejects(r, { type: 'endTurn', seat: 0 });

    const path = simplePath(v0, 2);
    r = apply(r, { type: 'buildRoad', seat: 0, edge: path[0]! });
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 1, returnTo: 'main' });
    r = apply(r, { type: 'buildRoad', seat: 0, edge: path[1]! });
    expect(r.phase).toEqual({ kind: 'main' });
    expect(r.players[0]!.piecesLeft.road).toBe(13);
    expect(r.players[0]!.hand).toEqual(s.players[0]!.hand); // 資源は使わない
    checkInvariants(r);
  });

  it('道の駒が1つしか残っていなければ1本で終わる', () => {
    let s = giveDevCards(place(emptyBoardMain('rb2'), { settlements: [[0, v0]] }), 0, ['roadBuilding']);
    s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, piecesLeft: { ...p.piecesLeft, road: 1 } } : p)) };
    // 駒の数の不変条件が崩れるので、このテストでは checkInvariants は使わない
    const r = apply(s, { type: 'playRoadBuilding', seat: 0 });
    expect(r.phase).toEqual({ kind: 'roadBuilding', remaining: 1, returnTo: 'main' });
    const after = apply(r, legalActions(r, 0)[0]!);
    expect(after.phase).toEqual({ kind: 'main' });
  });

  it('道を置ける場所がなければ使えない', () => {
    const s = giveDevCards(emptyBoardMain('rb3'), 0, ['roadBuilding']);
    rejects(s, { type: 'playRoadBuilding', seat: 0 });
  });
});

describe('収穫', () => {
  it('銀行から好きな資源を2枚（同じ資源でもよい）受け取る', () => {
    const s = giveDevCards(emptyBoardMain('yp'), 0, ['yearOfPlenty', 'yearOfPlenty']);
    const a = apply(s, { type: 'playYearOfPlenty', seat: 0, resources: ['ore', 'ore'] });
    expect(a.players[0]!.hand.ore).toBe(2);
    expect(a.bank.ore).toBe(17);
    const b = apply(s, { type: 'playYearOfPlenty', seat: 0, resources: ['wood', 'brick'] });
    expect(b.players[0]!.hand).toMatchObject({ wood: 1, brick: 1 });
    checkInvariants(a);
  });

  it('銀行に足りなければ使えない', () => {
    let s = giveDevCards(emptyBoardMain('yp2', { 1: { ore: 18 } }), 0, ['yearOfPlenty']);
    rejects(s, { type: 'playYearOfPlenty', seat: 0, resources: ['ore', 'ore'] });
    s = giveDevCards(emptyBoardMain('yp3'), 0, ['yearOfPlenty']);
    expect(legalActions(s, 0).filter((a) => a.type === 'playYearOfPlenty')).toHaveLength(15);
  });
});

describe('独占', () => {
  it('他の全員から指定した資源をすべて受け取る', () => {
    const s = giveDevCards(
      emptyBoardMain('mono', { 0: { wheat: 1 }, 1: { wheat: 3, ore: 2 }, 2: { wheat: 1 }, 3: { brick: 4 } }),
      0,
      ['monopoly'],
    );
    const after = apply(s, { type: 'playMonopoly', seat: 0, resource: 'wheat' });
    expect(after.players.map((p) => p.hand.wheat)).toEqual([5, 0, 0, 0]);
    expect(after.players[1]!.hand.ore).toBe(2);
    expect(after.players[0]!.playedDevCards).toEqual(['monopoly']);
    checkInvariants(after);
  });
});
