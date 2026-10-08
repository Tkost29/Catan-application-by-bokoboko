import { RuleBasedAgent } from '@bokoboko/ai';
import { apply, createGame, STANDARD_TOPOLOGY as T, toPlayerView, type GameState } from '@bokoboko/engine';
import { describe, expect, it } from 'vitest';
import { renderBoard } from '../src/board.js';
import { describe as describeAction, LocalGame } from '../src/controller.js';
import { renderPanel } from '../src/panel.js';
import { highlightsFor, initialUi, zeroCounts, type UiState } from '../src/ui.js';

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('盤面の描画', () => {
  it('ヘックス19枚・数字チップ18枚・港9つ・盗賊1つを描く', () => {
    const html = renderBoard(toPlayerView(createGame('draw'), 0));
    expect(count(html, '<polygon class="hex ')).toBe(19);
    expect(count(html, 'class="token-bg"')).toBe(18);
    expect(count(html, '<g class="port')).toBe(9);
    expect(count(html, 'class="robber"')).toBe(1);
  });

  it('初期配置では置ける54頂点すべてがクリックできる', () => {
    const game = new LocalGame({ aiLevels: [1, 1, 1], randomSeat: false, seed: 'hl' });
    const html = renderBoard(game.view(), highlightsFor(game.legal(), initialUi()));
    expect(count(html, 'data-vertex=')).toBe(T.vertexPositions.length);
  });

  it('建物と道は持ち主の色のクラスで描く', () => {
    let s = createGame('pieces');
    s = apply(s, { type: 'placeSettlement', seat: 0, vertex: 10 });
    s = apply(s, { type: 'placeRoad', seat: 0, edge: T.vertexEdges[10]![0]! });
    const html = renderBoard(toPlayerView(s, 1));
    expect(html).toContain('class="building p0"');
    expect(html).toContain('class="road p0"');
  });
});

describe('ローカル対戦', () => {
  /** 人間の席もルールベースAIに指させ、画面を毎手描きながら最後まで進める */
  function playThrough(seed: string): LocalGame {
    const game = new LocalGame({ aiLevels: [1, 0, 1], randomSeat: true, seed });
    const me = new RuleBasedAgent(`human-${seed}`);
    const ui: UiState = initialUi();
    for (let i = 0; i < 20_000 && game.state.winner === null; i++) {
      renderBoard(game.view(), highlightsFor(game.legal(), ui));
      renderPanel(game, ui);
      if (game.aiStep()) continue;
      const legal = game.legal();
      expect(legal.length, `step ${i}: someone must be able to act`).toBeGreaterThan(0);
      expect(game.act(me.decide(game.view(), legal))).toBeNull();
    }
    return game;
  }

  it('人間1人とAI 3人で、画面を描きながら最後まで遊べる（5ゲーム）', () => {
    for (let i = 0; i < 5; i++) {
      const game = playThrough(`local-${i}`);
      expect(game.state.winner).not.toBeNull();
      const panel = renderPanel(game, initialUi());
      expect(panel).toContain('もう一度遊ぶ');
      // 終了後は伏せていた勝利点カードも含めて10点以上
      expect(game.points(game.state.winner!)).toBeGreaterThanOrEqual(10);
    }
  });

  it('手番でない操作や不正な操作は理由を返して受け付けない', () => {
    const game = new LocalGame({ aiLevels: [1, 1, 1], randomSeat: false, seed: 'bad' });
    expect(game.act({ type: 'rollDice', seat: 0 })).not.toBeNull();
    expect(game.act({ type: 'placeSettlement', seat: 1, vertex: 0 })).not.toBeNull();
    expect(game.act({ type: 'placeSettlement', seat: 0, vertex: 0 })).toBeNull();
  });
});

describe('交渉画面の向き', () => {
  /** 席1（AI）が人間（席0）に提案している状態 */
  function offeredToHuman(): LocalGame {
    const game = new LocalGame({ aiLevels: [1, 1, 1], randomSeat: false, seed: 'trade-ui' });
    const base = game.state;
    const bank = { ...base.bank, wood: 17, ore: 17 };
    const players = base.players.map((p) =>
      p.seat === 0 ? { ...p, hand: { ...zeroCounts(), ore: 2 } } : p.seat === 1 ? { ...p, hand: { ...zeroCounts(), wood: 2 } } : p,
    );
    let s: GameState = { ...base, bank, players, phase: { kind: 'main' }, currentSeat: 1, turn: 2 };
    s = apply(s, { type: 'proposeTrade', seat: 1, to: 0, terms: { give: { wood: 1 }, receive: { ore: 1 } } });
    game.state = s;
    return game;
  }

  it('相手から提案されたとき、「出す・もらう」は自分から見た向きで表示する', () => {
    const panel = renderPanel(offeredToHuman(), initialUi());
    expect(panel).toMatch(/あなたが出す<\/span><b>鉱石1/);
    expect(panel).toMatch(/あなたがもらう<\/span><b>木材1/);
  });

  it('逆提案は、自分から見た下書きを提案者から見た条件に変換して送る', () => {
    const game = offeredToHuman();
    const draft = { to: 1, myGive: { ...zeroCounts(), ore: 1 }, myGet: { ...zeroCounts(), wood: 2 }, counter: true };
    expect(game.tradeProblem(draft)).toBeNull();
    expect(game.tradeAction(draft)).toEqual({
      type: 'counterTrade',
      seat: 0,
      terms: { give: { wood: 2 }, receive: { ore: 1 } },
    });
  });

  it('送れない下書きには、直し方がわかる理由を出す', () => {
    const game = offeredToHuman();
    const empty = { to: 1, myGive: zeroCounts(), myGet: { ...zeroCounts(), wood: 1 }, counter: true };
    expect(game.tradeProblem(empty)).toContain('1枚以上');
  });
});

describe('できごとのログ', () => {
  it('他人同士の略奪では、奪われた資源の種類を書かない', () => {
    let s = createGame('log');
    const hex = [...Array(19).keys()].find((h) => h !== s.robberHex)!;
    const v = T.hexVertices[hex]![0]!;
    const bank = { ...s.bank, ore: 18 };
    const players = s.players.map((p) => (p.seat === 2 ? { ...p, hand: { ...zeroCounts(), ore: 1 } } : p));
    const buildings = s.buildings.slice();
    buildings[v] = { owner: 2, kind: 'settlement' };
    s = { ...s, bank, players, buildings, phase: { kind: 'moveRobber', returnTo: 'main' }, currentSeat: 1, turn: 3 };
    const action = { type: 'moveRobber', seat: 1, hex, victim: 2 } as const;
    const after = apply(s, action);
    const names = ['あなた', 'CPU 1', 'CPU 2', 'CPU 3'];
    expect(describeAction(s, action, after, names, 0).join()).toContain('1枚を奪った');
    expect(describeAction(s, action, after, names, 2).join()).toContain('鉱石1');
  });
});

describe('交換の募集', () => {
  it('入力が足りない募集には、直し方がわかる理由を出す', () => {
    const game = new LocalGame({ aiLevels: [1, 1, 1], randomSeat: false, seed: 'req-msg' });
    game.state = { ...game.state, phase: { kind: 'main' }, turn: 1 };
    expect(game.requestProblem(zeroCounts(), { ...zeroCounts(), wood: 1 })).toContain('ほしい物');
    expect(game.requestProblem({ ...zeroCounts(), ore: 1 }, zeroCounts())).toContain('あげてもいい物');
    expect(game.requestProblem({ ...zeroCounts(), ore: 1 }, { ...zeroCounts(), ore: 1 })).toContain('両方');
  });

  it('CPUが返した条件を選ぶと、そのCPUは必ず応じて交換が成立する', () => {
    let deals = 0;
    for (let g = 0; g < 6 && deals < 5; g++) {
      const game = new LocalGame({ aiLevels: [1, 0, 1], randomSeat: false, seed: `req-${g}` });
      const me = new RuleBasedAgent(`me-${g}`);
      for (let i = 0; i < 5000 && game.state.winner === null; i++) {
        if (game.aiStep()) continue;
        const legal = game.legal();
        // 自分の手番の main で、持っている物を全部出してよい条件で、足りない資源を1枚募集する
        if (legal.some((a) => a.type === 'proposeTrade') && i % 3 === 0) {
          const hand = game.view().me.hand;
          const want = (['ore', 'wheat', 'sheep', 'brick', 'wood'] as const).find((r) => hand[r] === 0);
          if (want) {
            const replies = game.askForOffers({ ...zeroCounts(), [want]: 1 }, { ...hand, [want]: 0 });
            const pick = replies.find((r) => r.terms !== null);
            if (pick) {
              const before = game.view().me.hand[want];
              expect(game.act({ type: 'proposeTrade', seat: game.humanSeat, to: pick.seat, terms: pick.terms! })).toBeNull();
              expect(game.aiStep()).toBe(true);
              expect(game.state.phase.kind).toBe('main');
              expect(game.view().me.hand[want]).toBe(before + 1);
              deals++;
              continue;
            }
          }
        }
        expect(game.act(me.decide(game.view(), legal))).toBeNull();
      }
    }
    expect(deals).toBeGreaterThanOrEqual(5);
  });
});
