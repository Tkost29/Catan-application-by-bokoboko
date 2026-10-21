import {
  apply,
  awaitingSeats,
  createGame,
  emptyResources,
  legalActions,
  toPlayerView,
  type Action,
  type GameState,
  type PlayerView,
} from '@bokoboko/engine';
import { describe, expect, it } from 'vitest';
import { afterAction, asIs, features, FEATURE_NAMES } from '../src/learned/features.js';
import { VALUE_MODEL } from '../src/learned/weights.js';
import { AI_LEVELS, createAgent, LearnedAgent, playMatch, RuleBasedAgent, type Agent } from '../src/index.js';

/** 初期配置をルールベースAIで済ませ、席0の手番（サイコロ後）にして手札を配った局面 */
function midGame(hand: Partial<Record<'wood' | 'brick' | 'sheep' | 'wheat' | 'ore', number>>): GameState {
  let s = createGame('learned-mid');
  const agents = [0, 1, 2, 3].map((i) => new RuleBasedAgent(`mid-${i}`));
  while (s.phase.kind === 'setup') {
    const seat = awaitingSeats(s)[0]!;
    s = apply(s, agents[seat]!.decide(toPlayerView(s, seat), legalActions(s, seat)));
  }
  const players = s.players.map((p) => (p.seat === 0 ? { ...p, hand: { ...emptyResources(), ...hand } } : p));
  return { ...s, players, currentSeat: 0, turn: 3, phase: { kind: 'main' } };
}

const idx = (name: (typeof FEATURE_NAMES)[number]): number => FEATURE_NAMES.indexOf(name);

class Checked implements Agent {
  readonly name: string;
  constructor(private readonly inner: Agent) {
    this.name = inner.name;
  }
  decide(view: PlayerView, legal: readonly Action[]): Action {
    const action = this.inner.decide(view, legal);
    expect(legal).toContainEqual(action);
    return action;
  }
}

describe('学習AIの特徴量', () => {
  it('名前の数と同じ数の有限な値を返す', () => {
    const x = features(asIs(toPlayerView(midGame({ wood: 2 }), 0)));
    expect(x).toHaveLength(FEATURE_NAMES.length);
    expect(x.every(Number.isFinite)).toBe(true);
  });

  it('打った後の局面: 開拓地なら1点増えて手札が減る、海外交易はレート分だけ減る', () => {
    const s = midGame({ wood: 4, brick: 1, sheep: 1, wheat: 1 });
    const view = toPlayerView(s, 0);
    const legal = legalActions(s, 0);
    const before = features(asIs(view));

    const build = legal.find((a) => a.type === 'buildSettlement');
    if (build) {
      const after = features(afterAction(asIs(view), build)!);
      expect(after[idx('vp')]).toBe(before[idx('vp')]! + 1);
      expect(after[idx('handTotal')]).toBe(before[idx('handTotal')]! - 4);
    }
    const trade = legal.find((a) => a.type === 'bankTrade' && a.give === 'wood' && a.receive === 'ore')!;
    const traded = features(afterAction(asIs(view), trade)!);
    expect(traded[idx('hand_ore')]).toBe(1);
    expect(before[idx('hand_wood')]! - traded[idx('hand_wood')]!).toBeGreaterThanOrEqual(2);
  });

  it('発展カードを買った局面は、伏せカードの期待分だけ点と手持ちが増える', () => {
    const s = midGame({ sheep: 1, wheat: 1, ore: 1 });
    const view = toPlayerView(s, 0);
    const buy = legalActions(s, 0).find((a) => a.type === 'buyDevCard')!;
    const after = features(afterAction(asIs(view), buy)!);
    expect(after[idx('vpCards')]).toBeCloseTo(5 / 25, 6);
    expect(after[idx('devHeld')]).toBeCloseTo(20 / 25, 6);
  });
});

describe('騎士を使った後の局面', () => {
  it('使った騎士が1枚増え、3枚目で相手より多ければ最大騎士力を取る', () => {
    const base = midGame({});
    const players = base.players.map((p) =>
      p.seat === 0 ? { ...p, playedKnights: 2, devCards: [{ card: 'knight' as const, boughtTurn: 0 }] } : p,
    );
    const s = { ...base, players, phase: { kind: 'preRoll' as const } };
    const view = toPlayerView(s, 0);
    const knight = legalActions(s, 0).find((a) => a.type === 'playKnight')!;
    expect(knight).toBeDefined();
    const after = afterAction(asIs(view), knight)!;
    const f = features(after);
    expect(f[idx('knights')]).toBe(3);
    expect(f[idx('hasLargestArmy')]).toBe(1);
    expect(f[idx('knightsHeld')]).toBe(0);
  });
});

describe('学習AI（難易度2）', () => {
  it('難易度2として登録されている', () => {
    expect(AI_LEVELS[2].label).toContain('学習');
    expect(createAgent(2, 'x').name).toBe('learned');
  });

  it('学習AI同士でも、全ゲームが決着し、合法手だけを選ぶ', () => {
    for (let i = 0; i < 4; i++) {
      const agents = [0, 1, 2, 3].map((s) => new Checked(new LearnedAgent(`l-${i}-${s}`, VALUE_MODEL)));
      const result = playMatch(agents, `learned-self-${i}`);
      expect(result.winner, `game ${i}`).not.toBeNull();
    }
  });

  it('ルールベースAIと混ぜても決着する', () => {
    for (let i = 0; i < 4; i++) {
      const agents = [0, 1, 2, 3].map((s) =>
        s % 2 === 0 ? new Checked(new LearnedAgent(`m-${i}-${s}`, VALUE_MODEL)) : new RuleBasedAgent(`m-${i}-${s}`),
      );
      expect(playMatch(agents, `learned-mixed-${i}`).winner).not.toBeNull();
    }
  });

  it('勝ちが決まる建設があれば必ずそれを選ぶ', () => {
    let s = midGame({ wheat: 2, ore: 3 });
    // 席0を9点にする（開拓地を都市に替える）
    const mine = s.buildings.flatMap((b, v) => (b?.owner === 0 ? [v] : []));
    const buildings = s.buildings.slice();
    buildings[mine[1]!] = { owner: 0, kind: 'city' };
    s = { ...s, buildings, longestRoad: 0, largestArmy: 0 };
    s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, devCards: [{ card: 'victoryPoint', boughtTurn: 0 }, { card: 'victoryPoint', boughtTurn: 0 }] } : p)) };
    // 2(開拓地1+都市2=3) + 最長2 + 最大2 + 勝利点2 = 9点 → 都市でちょうど10点
    const action = new LearnedAgent('win', VALUE_MODEL).decide(toPlayerView(s, 0), legalActions(s, 0));
    expect(action.type).toBe('buildCity');
  });
});
