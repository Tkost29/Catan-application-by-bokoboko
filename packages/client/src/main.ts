import type { AiLevel } from '@bokoboko/ai';
import { RESOURCES, type Action, type Resource } from '@bokoboko/engine';
import { renderBoard } from './board.js';
import { LocalGame, type GameSettings } from './controller.js';
import { renderPanel } from './panel.js';
import {
  actionForEdge,
  actionForVertex,
  highlightsFor,
  initialUi,
  robberChoices,
  zeroCounts,
  type Counts,
  type UiState,
} from './ui.js';

/**
 * 画面の組み立て。ゲームの進行は LocalGame、描画は board.ts / panel.ts の純粋関数に任せ、
 * ここではクリックの受け取りと AI の自動進行（少し間を置いて1手ずつ）だけを行う。
 */

const SPEEDS = { slow: 900, normal: 450, fast: 120 } as const;
type Speed = keyof typeof SPEEDS;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`bokoboko:${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`bokoboko:${key}`, value);
    } catch {
      /* 保存できない環境では覚えないだけ */
    }
  },
};

const randomSeed = (): string => Math.random().toString(36).slice(2, 10);

function loadSettings(): GameSettings {
  const levels = (store.get('aiLevels') ?? '1,1,1').split(',').map((x) => (x === '0' ? 0 : 1) as AiLevel);
  return { aiLevels: levels, randomSeat: store.get('randomSeat') !== 'false', seed: randomSeed() };
}

let game = new LocalGame(loadSettings());
let ui: UiState = initialUi();
let speed: Speed = (store.get('speed') as Speed | null) ?? 'normal';
if (!(speed in SPEEDS)) speed = 'normal';
let aiTimer: ReturnType<typeof setTimeout> | null = null;

const boardEl = document.getElementById('board')!;
const panelEl = document.getElementById('panel')!;
const speedEl = document.getElementById('speed') as HTMLSelectElement;
const newGameEl = document.getElementById('new-game')!;

speedEl.value = speed;
speedEl.addEventListener('change', () => {
  speed = speedEl.value as Speed;
  store.set('speed', speed);
});
newGameEl.addEventListener('click', () => {
  ui = { ...initialUi(), dialog: { kind: 'newGame' } };
  render();
  panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function render(): void {
  const legal = game.legal();
  // 合法手が変わって今の画面の状態が意味を失ったら戻す
  if (ui.mode !== 'none' && !legal.some((a) => a.type === modeAction(ui.mode))) ui.mode = 'none';
  if (game.state.phase.kind !== 'moveRobber') ui.robberHex = null;
  if (game.state.phase.kind !== 'discard') ui.discard = zeroCounts();
  if (ui.dialog.kind === 'trade' && ui.dialog.counter && game.state.phase.kind !== 'negotiating') ui.dialog = { kind: 'none' };

  boardEl.innerHTML = renderBoard(game.view(), highlightsFor(legal, ui));
  panelEl.innerHTML = renderPanel(game, ui);
  scheduleAi();
}

function modeAction(mode: UiState['mode']): Action['type'] {
  return mode === 'road' ? 'buildRoad' : mode === 'settlement' ? 'buildSettlement' : 'buildCity';
}

function scheduleAi(): void {
  if (aiTimer !== null || game.nextAiSeat() === undefined) return;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    game.aiStep();
    render();
  }, SPEEDS[speed]);
}

function act(action: Action | undefined): void {
  if (!action) return;
  ui.error = game.act(action);
  if (ui.error === null) {
    ui.mode = 'none';
    ui.dialog = { kind: 'none' };
  }
  render();
}

// --- 盤面のクリック -------------------------------------------------------

boardEl.addEventListener('click', (e) => {
  const target = (e.target as Element).closest('[data-vertex],[data-edge],[data-hex]');
  if (!target) return;
  const legal = game.legal();
  const vertex = target.getAttribute('data-vertex');
  const edge = target.getAttribute('data-edge');
  const hex = target.getAttribute('data-hex');
  if (vertex !== null) act(actionForVertex(legal, ui, Number(vertex)));
  else if (edge !== null) act(actionForEdge(legal, Number(edge)));
  else if (hex !== null) {
    const choices = robberChoices(legal, Number(hex));
    if (choices.length === 1) act(choices[0]);
    else {
      ui.robberHex = Number(hex);
      render();
    }
  }
});

// --- パネルのボタン -------------------------------------------------------

panelEl.addEventListener('click', (e) => {
  const el = (e.target as Element).closest('[data-act]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const [cmd, arg, arg2] = el.getAttribute('data-act')!.split(':');
  const seat = game.humanSeat;
  const legal = game.legal();
  ui.error = null;

  switch (cmd) {
    case 'roll':
      return act({ type: 'rollDice', seat });
    case 'endTurn':
      return act({ type: 'endTurn', seat });
    case 'buy':
      return act({ type: 'buyDevCard', seat });
    case 'mode': {
      const mode = arg as UiState['mode'];
      ui.mode = ui.mode === mode ? 'none' : mode;
      return render();
    }
    case 'play':
      return act(arg === 'knight' ? { type: 'playKnight', seat } : { type: 'playRoadBuilding', seat });
    case 'victim':
      return act(robberChoices(legal, ui.robberHex ?? -1).find((c) => c.victim === Number(arg)));
    case 'robber':
      ui.robberHex = null;
      return render();
    case 'discard':
      return act({ type: 'discard', seat, resources: nonZero(ui.discard) });
    case 'inc':
    case 'dec':
      return step(cmd === 'inc' ? 1 : -1, arg!, arg2 as Resource);
    case 'open':
      return open(arg!);
    case 'close':
      ui.dialog = { kind: 'none' };
      return render();
    case 'bank':
      if (ui.dialog.kind === 'bank') return act({ type: 'bankTrade', seat, give: ui.dialog.give, receive: ui.dialog.receive });
      return;
    case 'plenty':
      if (ui.dialog.kind === 'plenty') return act({ type: 'playYearOfPlenty', seat, resources: [ui.dialog.a, ui.dialog.b] });
      return;
    case 'monopoly':
      if (ui.dialog.kind === 'monopoly') return act({ type: 'playMonopoly', seat, resource: ui.dialog.resource });
      return;
    case 'trade':
      if (arg === 'send' && ui.dialog.kind === 'trade') return act(game.tradeAction(ui.dialog));
      if (arg === 'accept') return act({ type: 'acceptTrade', seat });
      if (arg === 'reject') return act({ type: 'rejectTrade', seat });
      if (arg === 'withdraw') return act({ type: 'withdrawTrade', seat });
      return;
    case 'newGame':
      return startNewGame();
  }
});

/** 選択欄（資源・相手・難易度）の変更 */
panelEl.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement | HTMLInputElement;
  const field = el.getAttribute('data-field');
  const d = ui.dialog;
  const r = el.value as Resource;
  if (field === 'bank-give' && d.kind === 'bank') d.give = r;
  else if (field === 'bank-receive' && d.kind === 'bank') d.receive = r;
  else if (field === 'plenty-a' && d.kind === 'plenty') d.a = r;
  else if (field === 'plenty-b' && d.kind === 'plenty') d.b = r;
  else if (field === 'monopoly-r' && d.kind === 'monopoly') d.resource = r;
  else if (field === 'trade-to' && d.kind === 'trade') d.to = Number(el.value);
  else return; // 新しいゲームの設定は「はじめる」で読む
  render();
});

function step(delta: 1 | -1, group: string, r: Resource): void {
  const d = ui.dialog;
  const target: Counts | undefined =
    group === 'discard' ? ui.discard : d.kind === 'trade' ? (group === 'myGive' ? d.myGive : d.myGet) : undefined;
  if (!target) return;
  target[r] = Math.max(0, target[r] + delta);
  render();
}

function open(what: string): void {
  const view = game.view();
  const richest = [...RESOURCES].sort((a, b) => view.me.hand[b] - view.me.hand[a])[0]!;
  const poorest = [...RESOURCES].sort((a, b) => view.me.hand[a] - view.me.hand[b])[0]!;
  switch (what) {
    case 'bank':
      ui.dialog = { kind: 'bank', give: richest, receive: poorest === richest ? 'ore' : poorest };
      break;
    case 'trade':
      ui.dialog = { kind: 'trade', to: view.opponents[0]!.seat, myGive: zeroCounts(), myGet: zeroCounts(), counter: false };
      break;
    case 'counter': {
      if (view.phase.kind !== 'negotiating') return;
      const t = view.phase.trade;
      const terms = t.history.at(-1)!.terms;
      const iAmProposer = t.proposer === view.seat;
      const fill = (p: Partial<Record<Resource, number>>): Counts => ({ ...zeroCounts(), ...p });
      ui.dialog = {
        kind: 'trade',
        to: iAmProposer ? t.counterparty : t.proposer,
        myGive: fill(iAmProposer ? terms.give : terms.receive),
        myGet: fill(iAmProposer ? terms.receive : terms.give),
        counter: true,
      };
      break;
    }
    case 'plenty':
      ui.dialog = { kind: 'plenty', a: poorest, b: poorest };
      break;
    case 'monopoly':
      ui.dialog = { kind: 'monopoly', resource: poorest };
      break;
    case 'newGame':
      ui.dialog = { kind: 'newGame' };
      break;
  }
  render();
}

function startNewGame(): void {
  const levels = [0, 1, 2].map((i) => {
    const el = document.getElementById(`ai-${i}`) as HTMLSelectElement | null;
    return (el?.value === '0' ? 0 : 1) as AiLevel;
  });
  const randomSeat = (document.getElementById('random-seat') as HTMLInputElement | null)?.checked ?? true;
  store.set('aiLevels', levels.join(','));
  store.set('randomSeat', String(randomSeat));
  if (aiTimer !== null) clearTimeout(aiTimer);
  aiTimer = null;
  game = new LocalGame({ aiLevels: levels, randomSeat, seed: randomSeed() });
  ui = initialUi();
  render();
}

function nonZero(c: Counts): Partial<Record<Resource, number>> {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) if (c[r] > 0) out[r] = c[r];
  return out;
}

render();
