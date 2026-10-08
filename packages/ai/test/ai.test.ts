import {
  apply,
  createGame,
  emptyResources,
  legalActions,
  STANDARD_TOPOLOGY as T,
  toPlayerView,
  type Action,
  type GameState,
  type PlayerView,
} from '@bokoboko/engine';
import { describe, expect, it } from 'vitest';
import { settlementValue } from '../src/evaluate.js';
import { AI_LEVELS, createAgent, playMatch, RandomAgent, RuleBasedAgent, type Agent } from '../src/index.js';

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
  it('難易度0はランダム、1はルールベース', () => {
    expect(createAgent(0, 's').name).toBe('random');
    expect(createAgent(1, 's').name).toBe('rule-based');
    expect(Object.keys(AI_LEVELS)).toEqual(['0', '1']);
  });
});
