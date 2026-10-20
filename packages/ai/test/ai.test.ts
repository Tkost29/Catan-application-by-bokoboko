import {
  apply,
  createGame,
  emptyResources,
  legalActions,
  STANDARD_TOPOLOGY as T,
  TERRAIN_RESOURCE,
  toPlayerView,
  type Action,
  type GameState,
  type PlayerView,
} from '@bokoboko/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACEMENT, pips, scarcityFactors, settlementValue } from '../src/evaluate.js';
import {
  AI_LEVELS,
  createAgent,
  DEFAULT_STRATEGY,
  leaderGap,
  playMatch,
  RandomAgent,
  RuleBasedAgent,
  threatOf,
  type Agent,
} from '../src/index.js';

/** decide が必ず legal の中から選んでいるかを見張るラッパー */
class Checked implements Agent {
  readonly name: string;
  constructor(
    private readonly inner: Agent,
    private readonly onDecide?: (view: PlayerView, action: Action) => void,
  ) {
    this.name = inner.name;
  }
  decide(view: PlayerView, legal: readonly Action[]): Action {
    const action = this.inner.decide(view, legal);
    expect(legal).toContainEqual(action);
    this.onDecide?.(view, action);
    return action;
  }
}

describe('対戦', () => {
  it('ルールベースAIはランダムAI3人を相手に9割以上勝つ（席を回して100戦）', () => {
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const aiSeat = i % 4;
      const agents = [0, 1, 2, 3].map((s) =>
        s === aiSeat ? new RuleBasedAgent(`rule-${i}`) : new RandomAgent(`rand-${i}-${s}`),
      );
      const result = playMatch(agents, `vs-random-${i}`);
      expect(result.winner, `game ${i}`).not.toBeNull();
      if (result.winner === aiSeat) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(90);
  });

  it('ルールベースAI同士でも、全ゲームが決着し、合法手だけを選ぶ', () => {
    for (let i = 0; i < 20; i++) {
      const agents = [0, 1, 2, 3].map((s) => new Checked(new RuleBasedAgent(`self-${i}-${s}`)));
      const result = playMatch(agents, `self-play-${i}`);
      expect(result.winner, `game ${i}`).not.toBeNull();
      expect(result.state.turn).toBeLessThan(300);
    }
  });

  it('同じシードなら同じ対戦結果（AIの判断も再現できる）', () => {
    const run = (): ReturnType<typeof playMatch> =>
      playMatch([0, 1, 2, 3].map((s) => new RuleBasedAgent(`same-${s}`)), 'same-game');
    expect(run().actions).toEqual(run().actions);
  });
});

describe('ルールベースAIの判断', () => {
  it('最初の開拓地は、置ける頂点のうち評価が最も高いところに置く', () => {
    const state = createGame('first-pick');
    const view = toPlayerView(state, 0);
    const action = new RuleBasedAgent('x').decide(view, legalActions(state, 0));
    expect(action.type).toBe('placeSettlement');
    const best = Math.max(...T.vertexPositions.map((_, v) => settlementValue(view, v, true)));
    if (action.type === 'placeSettlement') expect(settlementValue(view, action.vertex, true)).toBeCloseTo(best);
  });

  it('盗賊は、他に置き場所があれば自分の建物に接するヘックスには置かない', () => {
    for (let i = 0; i < 10; i++) {
      const agents = [0, 1, 2, 3].map(
        (s) =>
          new Checked(new RuleBasedAgent(`rob-${i}-${s}`), (view, action) => {
            if (action.type !== 'moveRobber') return;
            const touchesMe = T.hexVertices[action.hex]!.some((v) => view.buildings[v]?.owner === view.seat);
            expect(touchesMe).toBe(false);
          }),
      );
      playMatch(agents, `robber-${i}`);
    }
  });

  /** 席0が席1に提案した直後の状態（席1は応答待ち） */
  function proposal(hands: Partial<GameState['players'][number]['hand']>[], give: object, receive: object): GameState {
    const base = createGame('negotiate');
    const bank = { ...base.bank };
    const players = base.players.map((p, i) => {
      const hand = { ...emptyResources(), ...(hands[i] ?? {}) };
      for (const r of Object.keys(hand) as (keyof typeof hand)[]) bank[r] -= hand[r];
      return { ...p, hand };
    });
    // 席1は開拓地の候補地がない（建物も道もない）ので、目標は発展カード（羊・麦・鉱）になる
    const s: GameState = { ...base, bank, players, phase: { kind: 'main' }, turn: 3 };
    return apply(s, { type: 'proposeTrade', seat: 0, to: 1, terms: { give, receive } });
  }

  it('自分の目標に近づく交換は承認し、遠ざかる交換は拒否する', () => {
    // 席1は羊・麦を持ち、鉱がない。鉱1と羊1の交換は発展カードに近づく
    const good = proposal([{ ore: 1, wood: 1 }, { sheep: 2, wheat: 1 }], { ore: 1 }, { sheep: 1 });
    const agent = new RuleBasedAgent('n');
    expect(agent.decide(toPlayerView(good, 1), legalActions(good, 1)).type).toBe('acceptTrade');

    // 必要な麦を渡して木をもらう交換は遠ざかる
    const bad = proposal([{ wood: 1 }, { sheep: 1, wheat: 1, ore: 1 }], { wood: 1 }, { wheat: 1 });
    expect(agent.decide(toPlayerView(bad, 1), legalActions(bad, 1)).type).toBe('rejectTrade');
  });

  it('勝ちそうな相手（目標まで2点以内）とは交換しない', () => {
    let s = proposal([{ ore: 1 }, { sheep: 2, wheat: 1 }], { ore: 1 }, { sheep: 1 });
    // 席0に8点分の都市を与える
    const buildings = s.buildings.slice();
    const vs: number[] = [];
    for (let v = 0; vs.length < 4; v++) if (vs.every((c) => c !== v && !T.vertexNeighbors[c]!.includes(v))) vs.push(v);
    for (const v of vs) buildings[v] = { owner: 0, kind: 'city' };
    s = { ...s, buildings };
    const action = new RuleBasedAgent('n').decide(toPlayerView(s, 1), legalActions(s, 1));
    expect(action.type).toBe('rejectTrade');
  });
});

describe('難易度の登録', () => {
  it('難易度0はランダム、1はルールベース、2は学習AI', () => {
    expect(createAgent(0, 's').name).toBe('random');
    expect(createAgent(1, 's').name).toBe('rule-based');
    expect(createAgent(2, 's').name).toBe('learned');
    expect(Object.keys(AI_LEVELS)).toEqual(['0', '1', '2']);
  });
});

describe('交換の募集への返答', () => {
  /** AI 同士の対戦から、main フェーズの途中局面を集める */
  function midGameStates(seed: string, every = 7): GameState[] {
    const { actions } = playMatch([0, 1, 2, 3].map((s) => new RuleBasedAgent(`${seed}-${s}`)), seed);
    const states: GameState[] = [];
    let s = createGame(seed);
    actions.forEach((a, i) => {
      s = apply(s, a);
      if (s.phase.kind === 'main' && s.winner === null && i % every === 0) states.push(s);
    });
    return states;
  }

  for (const [label, make] of [
    ['ルールベース', (seed: string) => new RuleBasedAgent(seed)],
    ['ランダム', (seed: string) => new RandomAgent(seed)],
  ] as const) {
    it(`${label}AIは、自分が返した条件をそのまま提案されたら必ず応じる`, () => {
      let answered = 0;
      for (const state of midGameStates(`req-${label}`)) {
        const from = state.currentSeat;
        const hand = state.players[from]!.hand;
        for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
          for (const seat of [0, 1, 2, 3].filter((x) => x !== from)) {
            const agent = make(`answer-${seat}`);
            const offer = { ...hand, [r]: 0 };
            const terms = agent.answerRequest!(toPlayerView(state, seat), { from, want: { [r]: 1 }, offer });
            if (terms === null) continue;
            answered++;
            const proposed = apply(state, { type: 'proposeTrade', seat: from, to: seat, terms });
            const reply = agent.decide(toPlayerView(proposed, seat), legalActions(proposed, seat));
            expect(reply.type).toBe('acceptTrade');
          }
        }
      }
      expect(answered).toBeGreaterThan(10);
    });
  }

  it('ほしい物を持っていない、または相手が勝ちそうなら返答しない', () => {
    const base = createGame('req-none');
    const view1 = toPlayerView(base, 1); // 手札なし
    const agent = new RuleBasedAgent('n');
    expect(agent.answerRequest(view1, { from: 0, want: { ore: 1 }, offer: { wood: 2 } })).toBeNull();

    // 席0を8点（都市4つ）にすると、手札があっても応じない
    const buildings = base.buildings.slice();
    const vs: number[] = [];
    for (let v = 0; vs.length < 4; v++) if (vs.every((c) => c !== v && !T.vertexNeighbors[c]!.includes(v))) vs.push(v);
    for (const v of vs) buildings[v] = { owner: 0, kind: 'city' };
    const players = base.players.map((p) => (p.seat === 1 ? { ...p, hand: { ...emptyResources(), ore: 2, sheep: 0 } } : p));
    const s: GameState = { ...base, buildings, players, phase: { kind: 'main' } };
    expect(agent.answerRequest(toPlayerView(s, 1), { from: 0, want: { ore: 1 }, offer: { sheep: 1, wheat: 1 } })).toBeNull();
  });
});

describe('脅威度（盗賊と交渉の改良版）', () => {
  /** 席1と席2が同じ点数で、席1だけ生産力が高い状態 */
  function twoEqualLeaders(): GameState {
    const base = createGame('threat');
    const buildings = base.buildings.slice();
    // 生産力の高い頂点と低い頂点を選ぶ
    const byPips = T.vertexPositions
      .map((_, v) => ({ v, p: T.vertexHexes[v]!.reduce((s, h) => s + (base.board.numbers[h] == null ? 0 : 6 - Math.abs(7 - base.board.numbers[h]!)), 0) }))
      .sort((a, b) => b.p - a.p);
    const used: number[] = [];
    const pick = (fromTop: boolean): number => {
      const list = fromTop ? byPips : [...byPips].reverse();
      const c = list.find(({ v }) => used.every((u) => u !== v && !T.vertexNeighbors[u]!.includes(v)))!;
      used.push(c.v);
      return c.v;
    };
    for (let i = 0; i < 3; i++) buildings[pick(true)] = { owner: 1, kind: 'settlement' };
    for (let i = 0; i < 3; i++) buildings[pick(false)] = { owner: 2, kind: 'settlement' };
    return { ...base, buildings, phase: { kind: 'main' }, turn: 5 };
  }

  it('点数が同じなら、生産力の高い相手のほうが脅威度が高い', () => {
    const view = toPlayerView(twoEqualLeaders(), 0);
    expect(threatOf(view, 1)).toBeGreaterThan(threatOf(view, 2));
  });

  it('改良版の盗賊も、自分の建物があるヘックスは避ける', () => {
    let s = twoEqualLeaders();
    const mine = T.vertexPositions.findIndex((_, v) => s.buildings[v] === null && T.vertexNeighbors[v]!.every((n) => s.buildings[n] === null));
    const buildings = s.buildings.slice();
    buildings[mine] = { owner: 0, kind: 'settlement' };
    s = { ...s, buildings, phase: { kind: 'moveRobber', returnTo: 'main' } };
    const agent = new RuleBasedAgent('t', { ...DEFAULT_STRATEGY, play: { ...DEFAULT_STRATEGY.play, robber: 'threat' } });
    const a = agent.decide(toPlayerView(s, 0), legalActions(s, 0));
    expect(a.type).toBe('moveRobber');
    if (a.type === 'moveRobber') expect(T.hexVertices[a.hex]!.some((v) => s.buildings[v]?.owner === 0)).toBe(false);
  });

  it('改良版は、突出して強い相手（自分より強い）との交換に応じない', () => {
    const s0 = twoEqualLeaders();
    // 席1を突出させる（都市にする）
    const buildings = s0.buildings.map((b) => (b?.owner === 1 ? { owner: 1, kind: 'city' as const } : b));
    const bank = { ...s0.bank, ore: 18, sheep: 16, wheat: 18 };
    const players = s0.players.map((p) =>
      p.seat === 0 ? { ...p, hand: { ...emptyResources(), sheep: 2, wheat: 1 } } : p.seat === 1 ? { ...p, hand: { ...emptyResources(), ore: 1, sheep: 1 } } : p,
    );
    let s: GameState = { ...s0, buildings, bank, players, currentSeat: 1 };
    s = apply(s, { type: 'proposeTrade', seat: 1, to: 0, terms: { give: { ore: 1 }, receive: { sheep: 1 } } });
    const view = toPlayerView(s, 0);
    expect(leaderGap(view, 1)).toBeGreaterThanOrEqual(1.5);
    const basic = new RuleBasedAgent('b').decide(view, legalActions(s, 0));
    const guarded = new RuleBasedAgent('g', { ...DEFAULT_STRATEGY, play: { ...DEFAULT_STRATEGY.play, tradeGuard: 'threat' } }).decide(view, legalActions(s, 0));
    expect(basic.type).toBe('acceptTrade');
    expect(guarded.type).toBe('rejectTrade');
  });
});

describe('盤面での資源の少なさ', () => {
  it('少ない資源ほど倍率が大きく、量の加重平均はおよそ1になる', () => {
    const view = toPlayerView(createGame('scarcity'), 0);
    const f = scarcityFactors(view);
    const supply = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const tiles = { ...supply };
    view.board.terrains.forEach((t, h) => {
      const r = TERRAIN_RESOURCE[t];
      if (r) {
        supply[r] += pips(view.board.numbers[h] ?? null);
        tiles[r] += 1;
      }
    });
    const rs = Object.keys(supply) as (keyof typeof supply)[];
    const total = rs.reduce((a, r) => a + supply[r], 0);
    // 倍率 × 量 = 平均的な量。その合計は盤面全体の量に一致する
    expect(rs.reduce((a, r) => a + f[r] * supply[r], 0)).toBeCloseTo(total, 6);
    // タイル1枚あたりの量が最も少ない資源の倍率が最大
    const thinnest = rs.reduce((a, b) => (supply[a] / tiles[a] <= supply[b] / tiles[b] ? a : b));
    expect(f[thinnest]).toBe(Math.max(...rs.map((r) => f[r])));
  });

  it('scarcity 0（既定）では評価が変わらない', () => {
    const view = toPlayerView(createGame('scarcity'), 0);
    for (let v = 0; v < 54; v++) {
      expect(settlementValue(view, v, true, { ...DEFAULT_PLACEMENT, scarcity: 0 })).toBe(settlementValue(view, v, true, DEFAULT_PLACEMENT));
    }
  });
});
