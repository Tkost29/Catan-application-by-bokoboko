import {
  asIs,
  featureRecord,
  LearnedAgent,
  RuleBasedAgent,
  evaluate,
  threatOf,
  type Agent,
  type ValueModel,
} from '@bokoboko/ai';
import {
  apply,
  awaitingSeats,
  createGame,
  legalActions,
  STANDARD_TOPOLOGY as T,
  toPlayerView,
  type Action,
  type PlayerView,
} from '@bokoboko/engine';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * 学習AIの判断の記録。判断の基準（いつ騎士を使うか、都市と開拓地のどちらを建てるか、
 * 盗賊で誰を狙うか）を読み取るために、判断した局面の特徴量と選んだ手を JSON Lines に書き出す。
 *
 *   bun src/decisions.ts OUT.jsonl --model M.json --games N --start S [--who learned|rule]
 *
 * 記録する場面:
 *   build   開拓地・都市・発展カードのうち2つ以上を買える局面で、最初に選んだ手
 *   dev     発展カードを買える（勝利点になる建設はできない）局面で、買ったか
 *   knight  騎士を使える局面で、使ったか（サイコロ前・手番中）
 *   robber  盗賊を置いた先: 止めた相手・奪った相手が、一番脅威な相手か・点数が一番の相手か
 */

const args = process.argv.slice(2);
const out = args[0]!;
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const model = JSON.parse(readFileSync(opt('model', ''), 'utf8')) as ValueModel;
const games = Number(opt('games', '500'));
const start = Number(opt('start', '500000'));
const who = opt('who', 'learned');
writeFileSync(out, '');

const has = (legal: readonly Action[], t: Action['type']): boolean => legal.some((a) => a.type === t);

function record(kind: string, view: PlayerView, choice: Record<string, unknown>): string {
  const f = featureRecord(asIs(view));
  return JSON.stringify({ kind, phase: view.phase.kind, ...choice, f });
}

for (let g = start; g < start + games; g++) {
  const seed = `decide:${g}`;
  const testSeat = g % 4;
  const agents: Agent[] = [0, 1, 2, 3].map((s) =>
    s === testSeat && who === 'learned' ? new LearnedAgent(`${seed}:${s}`, model) : new RuleBasedAgent(`${seed}:${s}`),
  );
  let state = createGame(seed);
  const lines: string[] = [];
  let lastMainTurn = -1;
  for (let step = 0; step < 60_000 && state.winner === null; step++) {
    const seat = awaitingSeats(state)[0]!;
    const view = toPlayerView(state, seat);
    const legal = legalActions(state, seat);
    const action = agents[seat]!.decide(view, legal);
    if (seat === testSeat) {
      const phase = view.phase.kind;
      if (has(legal, 'playKnight') && (phase === 'preRoll' || phase === 'main')) {
        lines.push(record('knight', view, { played: action.type === 'playKnight' }));
      }
      if (phase === 'main' && lastMainTurn !== view.turn) {
        const options = (['buildSettlement', 'buildCity', 'buyDevCard'] as const).filter((t) => has(legal, t));
        if (options.length >= 2) {
          lines.push(record('build', view, { options, chose: action.type }));
          lastMainTurn = view.turn;
        }
      }
      if (phase === 'main' && has(legal, 'buyDevCard') && !has(legal, 'buildSettlement') && !has(legal, 'buildCity')) {
        lines.push(record('dev', view, { bought: action.type === 'buyDevCard', chose: action.type }));
      }
      if (action.type === 'moveRobber') {
        const opponents = view.opponents.map((o) => o.seat);
        const threat = Object.fromEntries(opponents.map((s) => [s, threatOf(view, s)]));
        const points = Object.fromEntries(opponents.map((s) => [s, evaluate.visiblePoints(view, s)]));
        const leader = opponents.reduce((a, b) => (threat[b]! > threat[a]! ? b : a));
        const vpLeader = opponents.reduce((a, b) => (points[b]! > points[a]! ? b : a));
        const blocked = [...new Set(T.hexVertices[action.hex]!.flatMap((v) => {
          const b = view.buildings[v];
          return b && b.owner !== seat ? [b.owner] : [];
        }))];
        lines.push(
          record('robber', view, {
            victim: action.victim,
            victimIsLeader: action.victim === leader,
            victimIsVpLeader: action.victim === vpLeader,
            blocksLeader: blocked.includes(leader),
            blocksVpLeader: blocked.includes(vpLeader),
            blockedCount: blocked.length,
            hexNumber: view.board.numbers[action.hex] ?? null,
            victimHand: view.opponents.find((o) => o.seat === action.victim)?.handCount ?? 0,
            maxHand: Math.max(...view.opponents.map((o) => o.handCount)),
          }),
        );
      }
    }
    state = apply(state, action);
  }
  if (lines.length) appendFileSync(out, lines.join('\n') + '\n');
  // 勝敗もあとで突き合わせられるように
  appendFileSync(out, JSON.stringify({ kind: 'result', game: seed, seat: testSeat, win: state.winner === testSeat }) + '\n');
}
process.stderr.write(`done ${games} games\n`);
