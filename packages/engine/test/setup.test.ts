import { describe, expect, it } from 'vitest';
import {
  apply,
  createGame,
  IllegalActionError,
  legalActions,
  STANDARD_TOPOLOGY as T,
  TERRAIN_RESOURCE,
  toPlayerView,
  type GameState,
} from '../src/index.js';
import { checkInvariants, playRandomly } from './helpers.js';

/** 初期配置を、毎回「合法手の先頭」を選んで最後まで進める */
function playSetupGreedy(state: GameState): { state: GameState; settlementSeats: number[] } {
  const settlementSeats: number[] = [];
  let s = state;
  while (s.phase.kind === 'setup') {
    const action = legalActions(s, s.currentSeat)[0]!;
    if (action.type === 'placeSettlement') settlementSeats.push(action.seat);
    s = apply(s, action);
  }
  return { state: s, settlementSeats };
}

describe('createGame', () => {
  it('初期状態: 席0の1巡目・開拓地から、銀行は各19枚、山札25枚、盗賊は砂漠', () => {
    const g = createGame('g1');
    expect(g.phase).toEqual({ kind: 'setup', round: 1, step: 'settlement', lastSettlement: null });
    expect(g.currentSeat).toBe(0);
    expect(g.players).toHaveLength(4);
    expect(Object.values(g.bank)).toEqual([19, 19, 19, 19, 19]);
    expect(g.devDeck).toHaveLength(25);
    expect(g.board.terrains[g.robberHex]).toBe('desert');
    expect(g.buildings).toHaveLength(54);
    expect(g.roads).toHaveLength(72);
    checkInvariants(g);
  });

  it('同じシードなら同じ初期状態', () => {
    expect(createGame('same')).toEqual(createGame('same'));
  });
});

describe('初期配置', () => {
  it('最初は54頂点すべてに開拓地を置ける', () => {
    const g = createGame('g1');
    expect(legalActions(g, 0)).toHaveLength(54);
    expect(legalActions(g, 1)).toEqual([]); // 手番でない席は何もできない
  });

  it('開拓地を置くと、その周りの頂点には置けず、道はその開拓地につながる辺だけ', () => {
    const g0 = createGame('g1');
    const v = 20;
    const g1 = apply(g0, { type: 'placeSettlement', seat: 0, vertex: v });
    const roads = legalActions(g1, 0);
    expect(roads.map((a) => a.type === 'placeRoad' && a.edge).sort()).toEqual([...T.vertexEdges[v]!].sort());

    const g2 = apply(g1, roads[0]!);
    const blocked = new Set([v, ...T.vertexNeighbors[v]!]);
    const settlements = legalActions(g2, 1).map((a) => (a.type === 'placeSettlement' ? a.vertex : -1));
    expect(settlements).toHaveLength(54 - blocked.size);
    for (const b of blocked) expect(settlements).not.toContain(b);
  });

  it('手番は 0→1→2→3→3→2→1→0 で、終わると席0のサイコロ前になる', () => {
    const { state, settlementSeats } = playSetupGreedy(createGame('g2'));
    expect(settlementSeats).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(state.currentSeat).toBe(0);
    expect(state.turn).toBe(1);
    checkInvariants(state);
  });

  it('各プレイヤーは開拓地2・道2を置き、2巡目の開拓地の周りの資源だけを受け取る', () => {
    let s = createGame('g3');
    const secondSettlement = new Map<number, number>();
    while (s.phase.kind === 'setup') {
      const action = legalActions(s, s.currentSeat)[0]!;
      if (action.type === 'placeSettlement' && s.phase.round === 2) secondSettlement.set(action.seat, action.vertex);
      s = apply(s, action);
    }
    for (const p of s.players) {
      expect(p.piecesLeft.settlement).toBe(3);
      expect(p.piecesLeft.road).toBe(13);

      const expected = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
      for (const hex of T.vertexHexes[secondSettlement.get(p.seat)!]!) {
        const r = TERRAIN_RESOURCE[s.board.terrains[hex]!];
        if (r !== null) expected[r] += 1;
      }
      expect(p.hand).toEqual(expected);
    }
    checkInvariants(s);
  });

  describe('不正なアクションは拒否し、状態を変えない', () => {
    const g0 = createGame('g4');
    const g1 = apply(g0, { type: 'placeSettlement', seat: 0, vertex: 10 });
    const g2 = apply(g1, legalActions(g1, 0)[0]!);

    const cases: [string, GameState, Parameters<typeof apply>[1]][] = [
      ['手番でない席', g0, { type: 'placeSettlement', seat: 1, vertex: 0 }],
      ['開拓地の番に道', g0, { type: 'placeRoad', seat: 0, edge: 0 }],
      ['道の番に開拓地', g1, { type: 'placeSettlement', seat: 0, vertex: 40 }],
      ['存在しない頂点', g0, { type: 'placeSettlement', seat: 0, vertex: 999 }],
      ['置いた開拓地につながらない道', g1, { type: 'placeRoad', seat: 0, edge: T.vertexEdges[40]![0]! }],
      ['埋まっている頂点', g2, { type: 'placeSettlement', seat: 1, vertex: 10 }],
      ['隣の頂点', g2, { type: 'placeSettlement', seat: 1, vertex: T.vertexNeighbors[10]![0]! }],
    ];
    for (const [name, state, action] of cases) {
      it(name, () => {
        const before = JSON.stringify(state);
        expect(() => apply(state, action)).toThrow(IllegalActionError);
        expect(JSON.stringify(state)).toBe(before);
      });
    }
  });

  it('ランダムな初期配置を300ゲーム回しても、毎手で不変条件を満たす', () => {
    for (let i = 0; i < 300; i++) {
      const { state, actions } = playRandomly(createGame(`rand-${i}`), `choice-${i}`, 100, checkInvariants);
      expect(actions).toHaveLength(16);
      expect(state.phase.kind).toBe('preRoll');
    }
  });

  it('同じシード・同じアクション列なら同じ最終状態（リプレイ可能）', () => {
    const { state, actions } = playRandomly(createGame('replay'), 'choices');
    const replayed = actions.reduce(apply, createGame('replay'));
    expect(replayed).toEqual(state);
  });
});

describe('toPlayerView', () => {
  it('自分の手札は見えるが、他人の手札は枚数だけ。山札・乱数・シードは含まない', () => {
    const { state } = playSetupGreedy(createGame('view'));
    const view = toPlayerView(state, 2);
    expect(view.me.hand).toEqual(state.players[2]!.hand);
    expect(view.opponents.map((o) => o.seat)).toEqual([0, 1, 3]);
    for (const o of view.opponents) {
      const total = Object.values(state.players[o.seat]!.hand).reduce((a, b) => a + b, 0);
      expect(o.handCount).toBe(total);
      expect(o).not.toHaveProperty('hand');
    }
    expect(view).not.toHaveProperty('devDeck');
    expect(view).not.toHaveProperty('rngState');
    expect(view).not.toHaveProperty('seed');
    expect(view.devDeckCount).toBe(25);
  });
});
