import { describe, expect, it } from 'vitest';
import {
  apply,
  createGame,
  IllegalActionError,
  legalActions,
  longestRoadLength,
  STANDARD_TOPOLOGY as T,
  TERRAIN_RESOURCE,
  tradeRate,
  victoryPoints,
  type Action,
  type GameState,
  type VertexId,
} from '../src/index.js';
import { produce } from '../src/rules/dice.js';
import { updateLongestRoad } from '../src/rules/score.js';
import {
  builderPolicy,
  checkInvariants,
  emptyBoardMain,
  pathVertices,
  place,
  playRandomly,
  simplePath,
} from './helpers.js';

const rejects = (state: GameState, action: Action): void => {
  expect(() => apply(state, action)).toThrow(IllegalActionError);
};

/** 出目が1回しか出ない数字（12）のヘックス */
function hexWithNumber(state: GameState, n: number): number {
  const h = state.board.numbers.indexOf(n);
  if (h < 0) throw new Error(`no hex with ${n}`);
  return h;
}

/** 互いに隣り合わない頂点を k 個選ぶ */
function spacedVertices(k: number): VertexId[] {
  const chosen: VertexId[] = [];
  for (let v = 0; v < T.vertexPositions.length && chosen.length < k; v++) {
    if (chosen.every((c) => c !== v && !T.vertexNeighbors[c]!.includes(v))) chosen.push(v);
  }
  return chosen;
}

describe('ダイスと生産', () => {
  it('ダイスを振ると出目が記録され、7以外なら main に進む。同じ乱数状態なら同じ出目', () => {
    const s: GameState = { ...emptyBoardMain('d1'), phase: { kind: 'preRoll' } };
    expect(legalActions(s, 0)).toEqual([{ type: 'rollDice', seat: 0 }]);
    const a = apply(s, { type: 'rollDice', seat: 0 });
    const b = apply(s, { type: 'rollDice', seat: 0 });
    expect(a).toEqual(b);
    const [d1, d2] = a.lastRoll!;
    expect(d1).toBeGreaterThanOrEqual(1);
    expect(d2).toBeLessThanOrEqual(6);
    if (d1 + d2 !== 7) expect(a.phase.kind).toBe('main');
  });

  it('開拓地は1枚、都市は2枚。盗賊のいるヘックスは産出しない', () => {
    const base = emptyBoardMain('p1');
    const h = hexWithNumber(base, 12);
    const r = TERRAIN_RESOURCE[base.board.terrains[h]!]!;
    const [v0, , v2] = T.hexVertices[h]!;
    const s = place(base, { settlements: [[0, v0!]], cities: [[1, v2!]] });

    const produced = produce(s, 12);
    expect(produced.players[0]!.hand[r]).toBe(1);
    expect(produced.players[1]!.hand[r]).toBe(2);
    expect(produced.bank[r]).toBe(s.bank[r] - 3);

    const robbed = produce({ ...s, robberHex: h }, 12);
    expect(robbed.players[0]!.hand[r]).toBe(0);
    expect(robbed.players[1]!.hand[r]).toBe(0);
  });

  it('銀行の在庫が足りないとき: 受け取る人が複数なら誰も受け取れず、1人なら残りを受け取る', () => {
    const base = emptyBoardMain('p2');
    const h = hexWithNumber(base, 12);
    const r = TERRAIN_RESOURCE[base.board.terrains[h]!]!;
    const [v0, , v2] = T.hexVertices[h]!;
    const lowBank = (s: GameState): GameState => ({ ...s, bank: { ...s.bank, [r]: 1 } });

    const two = produce(lowBank(place(base, { settlements: [[0, v0!]], cities: [[1, v2!]] })), 12);
    expect(two.players[0]!.hand[r]).toBe(0);
    expect(two.players[1]!.hand[r]).toBe(0);
    expect(two.bank[r]).toBe(1);

    const one = produce(lowBank(place(base, { cities: [[1, v2!]] })), 12);
    expect(one.players[1]!.hand[r]).toBe(1);
    expect(one.bank[r]).toBe(0);
  });
});

describe('7 の目: 捨て札と盗賊', () => {
  /** 次のダイスが 7 になる乱数状態を探す */
  function rollSeven(s: GameState): GameState {
    for (let i = 0; i < 10_000; i++) {
      const next = apply({ ...s, rngState: i }, { type: 'rollDice', seat: s.currentSeat });
      if (next.lastRoll![0] + next.lastRoll![1] === 7) return next;
    }
    throw new Error('no seven found');
  }

  const base: GameState = {
    ...emptyBoardMain('seven', {
      1: { wood: 5, brick: 4 }, // 9枚 → 4枚捨てる
      2: { sheep: 7 }, // 7枚 → 捨てない
    }),
    phase: { kind: 'preRoll' },
  };

  it('手札が7枚を超える人だけが半分（切り捨て）を捨てる', () => {
    const s = rollSeven(base);
    expect(s.phase).toEqual({ kind: 'discard', remaining: [0, 4, 0, 0] });
    expect(legalActions(s, 0)).toEqual([]); // 手番の席でも捨てる必要がなければ待つだけ
    expect(legalActions(s, 2)).toEqual([]);
    const options = legalActions(s, 1);
    expect(options.length).toBeGreaterThan(0);
    for (const a of options) {
      expect(a.type).toBe('discard');
      if (a.type === 'discard') expect(Object.values(a.resources).reduce((x, y) => x + y, 0)).toBe(4);
    }
  });

  it('枚数が合わない捨て札は拒否、捨て終わると盗賊の移動へ', () => {
    const s = rollSeven(base);
    rejects(s, { type: 'discard', seat: 1, resources: { wood: 3 } });
    rejects(s, { type: 'discard', seat: 1, resources: { sheep: 4 } });
    rejects(s, { type: 'discard', seat: 2, resources: { sheep: 3 } });
    const after = apply(s, { type: 'discard', seat: 1, resources: { wood: 2, brick: 2 } });
    expect(after.phase).toEqual({ kind: 'moveRobber' });
    expect(after.players[1]!.hand).toMatchObject({ wood: 3, brick: 2 });
    checkInvariants(after);
  });

  it('誰も7枚を超えていなければ、すぐ盗賊の移動へ', () => {
    const s = rollSeven({ ...emptyBoardMain('seven2'), phase: { kind: 'preRoll' } });
    expect(s.phase).toEqual({ kind: 'moveRobber' });
  });

  it('盗賊は別のヘックスへ。建物を持つ相手がいればその人から1枚奪う', () => {
    const h = [...Array(19).keys()].find((x) => x !== base.robberHex)!;
    const s: GameState = {
      ...place(emptyBoardMain('rob', { 1: { wood: 2 } }), { settlements: [[1, T.hexVertices[h]![0]!]] }),
      phase: { kind: 'moveRobber' },
    };
    rejects(s, { type: 'moveRobber', seat: 0, hex: s.robberHex, victim: null });
    rejects(s, { type: 'moveRobber', seat: 0, hex: h, victim: null }); // 奪える相手がいるのに選ばない
    rejects(s, { type: 'moveRobber', seat: 0, hex: h, victim: 2 });
    expect(legalActions(s, 0).filter((a) => a.type === 'moveRobber' && a.hex === h)).toEqual([
      { type: 'moveRobber', seat: 0, hex: h, victim: 1 },
    ]);

    const after = apply(s, { type: 'moveRobber', seat: 0, hex: h, victim: 1 });
    expect(after.robberHex).toBe(h);
    expect(after.phase).toEqual({ kind: 'main' });
    expect(after.players[0]!.hand.wood).toBe(1);
    expect(after.players[1]!.hand.wood).toBe(1);
    checkInvariants(after);
  });
});

describe('建設', () => {
  const v0 = 20;
  const path = simplePath(v0, 3);
  const [, v1, v2] = pathVertices(v0, path);

  it('道: 自分の建物か道につながる辺だけ。費用を払い駒が減る', () => {
    const s = place(emptyBoardMain('b1', { 0: { wood: 1, brick: 1 } }), { settlements: [[0, v0]] });
    const roadEdges = legalActions(s, 0).flatMap((a) => (a.type === 'buildRoad' ? [a.edge] : []));
    expect(roadEdges.sort()).toEqual([...T.vertexEdges[v0]!].sort());

    const after = apply(s, { type: 'buildRoad', seat: 0, edge: path[0]! });
    expect(after.roads[path[0]!]).toBe(0);
    expect(after.players[0]!.hand).toMatchObject({ wood: 0, brick: 0 });
    expect(after.players[0]!.piecesLeft.road).toBe(14);
    checkInvariants(after);
  });

  it('道: 資源が足りなければ置けない', () => {
    const s = place(emptyBoardMain('b2', { 0: { wood: 1 } }), { settlements: [[0, v0]] });
    rejects(s, { type: 'buildRoad', seat: 0, edge: path[0]! });
  });

  it('道: 相手の建物がある頂点の先には伸ばせない', () => {
    let s = emptyBoardMain('b3', { 0: { wood: 1, brick: 1 } });
    s = place(s, { settlements: [[0, v0], [1, v2!]], roads: [[0, path[0]!], [0, path[1]!]] });
    const beyond = T.vertexEdges[v2!]!.find((e) => e !== path[1]);
    rejects(s, { type: 'buildRoad', seat: 0, edge: beyond! });
  });

  it('開拓地: 自分の道に接し、距離ルールを満たす頂点だけ', () => {
    const cost = { wood: 1, brick: 1, sheep: 1, wheat: 1 };
    const s = place(emptyBoardMain('b4', { 0: cost }), {
      settlements: [[0, v0]],
      roads: [[0, path[0]!], [0, path[1]!], [0, path[2]!]],
    });
    rejects(s, { type: 'buildSettlement', seat: 0, vertex: v1! }); // 自分の開拓地の隣
    const ok = apply(s, { type: 'buildSettlement', seat: 0, vertex: v2! });
    expect(ok.buildings[v2!]).toEqual({ owner: 0, kind: 'settlement' });
    checkInvariants(ok);

    const far = spacedVertices(30).find((v) => !T.vertexEdges[v]!.some((e) => s.roads[e] === 0) && v !== v0)!;
    rejects(s, { type: 'buildSettlement', seat: 0, vertex: far }); // 道が届いていない
  });

  it('都市: 自分の開拓地を置き換え、開拓地の駒は手元に戻る', () => {
    const s = place(emptyBoardMain('b5', { 0: { wheat: 2, ore: 3 } }), { settlements: [[0, v0], [1, v2!]] });
    rejects(s, { type: 'buildCity', seat: 0, vertex: v2! }); // 他人の開拓地
    rejects(s, { type: 'buildCity', seat: 0, vertex: v1! }); // 何もない頂点
    const after = apply(s, { type: 'buildCity', seat: 0, vertex: v0 });
    expect(after.buildings[v0]).toEqual({ owner: 0, kind: 'city' });
    expect(after.players[0]!.piecesLeft).toMatchObject({ city: 3, settlement: 5 });
    checkInvariants(after);
  });
});

describe('海外交易', () => {
  it('港がなければ 4:1', () => {
    const s = emptyBoardMain('t1', { 0: { wood: 4 } });
    expect(tradeRate(s, 0, 'wood')).toBe(4);
    const after = apply(s, { type: 'bankTrade', seat: 0, give: 'wood', receive: 'ore' });
    expect(after.players[0]!.hand).toMatchObject({ wood: 0, ore: 1 });
    rejects(emptyBoardMain('t1', { 0: { wood: 3 } }), { type: 'bankTrade', seat: 0, give: 'wood', receive: 'ore' });
    rejects(s, { type: 'bankTrade', seat: 0, give: 'wood', receive: 'wood' });
  });

  it('汎用港は 3:1、専門港はその資源だけ 2:1', () => {
    const base = emptyBoardMain('t2');
    const generic = base.board.ports.find((p) => p.kind === 'generic')!;
    const special = base.board.ports.find((p) => p.kind !== 'generic')!;
    const s = place(base, {
      settlements: [
        [0, T.edgeVertices[generic.edge]![0]],
        [0, T.edgeVertices[special.edge]![1]],
      ],
    });
    const r = special.kind as Exclude<typeof special.kind, 'generic'>;
    expect(tradeRate(s, 0, r)).toBe(2);
    const other = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as const).find((x) => x !== r)!;
    expect(tradeRate(s, 0, other)).toBe(3);
    expect(tradeRate(s, 1, r)).toBe(4);
  });
});

describe('手番終了と勝利', () => {
  it('手番終了で次の席のサイコロ前になる', () => {
    const s = emptyBoardMain('e1');
    const after = apply(s, { type: 'endTurn', seat: 0 });
    expect(after.currentSeat).toBe(1);
    expect(after.phase).toEqual({ kind: 'preRoll' });
    expect(after.turn).toBe(s.turn + 1);
    rejects(after, { type: 'endTurn', seat: 0 });
  });

  it('自分の手番中に10点に届いたら勝利し、それ以降は何もできない', () => {
    const vs = spacedVertices(6);
    const s = place(emptyBoardMain('w1', { 0: { wheat: 2, ore: 3 } }), {
      cities: vs.slice(0, 3).map((v) => [0, v]),
      settlements: vs.slice(3).map((v) => [0, v]),
    });
    expect(victoryPoints(s, 0)).toBe(9);
    const won = apply(s, { type: 'buildCity', seat: 0, vertex: vs[3]! });
    expect(won.winner).toBe(0);
    expect(won.phase).toEqual({ kind: 'gameOver' });
    expect(legalActions(won, 0)).toEqual([]);
    rejects(won, { type: 'endTurn', seat: 0 });
  });

  it('他人の手番中に10点になっても、勝つのは自分の手番が来たとき', () => {
    const vs = spacedVertices(5);
    const s = place(emptyBoardMain('w2'), { cities: vs.map((v) => [1, v]) }); // 席1が10点
    expect(victoryPoints(s, 1)).toBe(10);
    expect(s.winner).toBeNull();
    const next = apply(s, { type: 'endTurn', seat: 0 });
    expect(next.winner).toBe(1);
  });
});

describe('最長交易路', () => {
  const topVertex = T.vertexPositions.reduce((best, p, v) => (p.y < T.vertexPositions[best]!.y ? v : best), 0);
  const bottomVertex = T.vertexPositions.reduce((best, p, v) => (p.y > T.vertexPositions[best]!.y ? v : best), 0);

  it('5本つながると最長交易路（2点）、4本では誰も持たない', () => {
    const base = emptyBoardMain('l1');
    const p5 = simplePath(topVertex, 5);
    const four = updateLongestRoad(place(base, { roads: p5.slice(0, 4).map((e) => [0, e]) }));
    expect(longestRoadLength(four, 0)).toBe(4);
    expect(four.longestRoad).toBeNull();
    const five = updateLongestRoad(place(base, { roads: p5.map((e) => [0, e]) }));
    expect(five.longestRoad).toBe(0);
    expect(victoryPoints(five, 0)).toBe(2);
  });

  it('ヘックスを一周する6本は長さ6（輪も数えられる）', () => {
    const s = place(emptyBoardMain('l2'), { roads: T.hexEdges[9]!.map((e) => [0, e]) });
    expect(longestRoadLength(s, 0)).toBe(6);
  });

  it('同じ長さに追いつかれても保持者のまま、抜かれたら移る', () => {
    const base = emptyBoardMain('l3');
    const mine = simplePath(topVertex, 5);
    const theirs = simplePath(bottomVertex, 6);
    expect(mine.some((e) => theirs.includes(e))).toBe(false);

    let s = updateLongestRoad(place(base, { roads: mine.map((e) => [0, e]) }));
    expect(s.longestRoad).toBe(0);
    s = updateLongestRoad(place(s, { roads: theirs.slice(0, 5).map((e) => [1, e]) }));
    expect(s.longestRoad).toBe(0);
    s = updateLongestRoad(place(s, { roads: [[1, theirs[5]!]] }));
    expect(s.longestRoad).toBe(1);
  });

  it('相手の開拓地で分断されて5本未満になると失う', () => {
    const p5 = simplePath(topVertex, 5);
    const vs = pathVertices(topVertex, p5);
    let s = updateLongestRoad(place(emptyBoardMain('l4'), { roads: p5.map((e) => [0, e]) }));
    expect(s.longestRoad).toBe(0);
    s = updateLongestRoad(place(s, { settlements: [[1, vs[2]!]] }));
    expect(longestRoadLength(s, 0)).toBe(3);
    expect(s.longestRoad).toBeNull();
  });
});

describe('通しプレイ', () => {
  it('ランダムな打ち手で30ゲーム、毎手で不変条件を満たし、全ゲームで10点以上の勝者が出る', () => {
    for (let i = 0; i < 30; i++) {
      const { state } = playRandomly(createGame(`full-${i}`), `policy-${i}`, 30_000, checkInvariants, builderPolicy);
      expect(state.winner, `game ${i}`).not.toBeNull();
      expect(victoryPoints(state, state.winner!)).toBeGreaterThanOrEqual(10);
      expect(state.phase).toEqual({ kind: 'gameOver' });
    }
  });

  it('1ゲーム通してもシード＋アクション列から同じ最終状態を再現できる', () => {
    const { state, actions } = playRandomly(createGame('replay-full'), 'p', 30_000, undefined, builderPolicy);
    expect(state.winner).not.toBeNull();
    expect(actions.reduce(apply, createGame('replay-full'))).toEqual(state);
  });
});
