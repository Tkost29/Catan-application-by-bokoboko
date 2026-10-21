import {
  FEATURE_NAMES,
  features,
  LearnedAgent,
  PLACEMENT_PRESETS,
  PLAY_PRESETS,
  RuleBasedAgent,
  type Agent,
  type ValueModel,
} from '@bokoboko/ai';
import { apply, awaitingSeats, createGame, createRng, legalActions, toPlayerView, type GameState } from '@bokoboko/engine';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveStrategy } from './styles.js';

/**
 * 学習AIのための自己対戦。
 *
 *   data  試合をして、各プレイヤーの手番の終わりの局面の特徴量と、その人が勝ったかを CSV に書き出す
 *         bun src/selfplay.ts data OUT.csv --games N --start S [--model M.json] [--learned 0.5] [--explore 0.05] [--sample 0.5]
 *           --learned  各席を学習AIにする確率（残りはルールベースAI。配置・手番中の方針はランダム）
 *   eval  1席だけを試すAIにし、残り3席を相手（標準のルールベースAI）にして勝率を測る。試す席は 0→1→2→3 と回す
 *         bun src/selfplay.ts eval OUT.jsonl --games N --start S --test learned|rule|improved [--model M.json] [--opponents rule|improved|learned]
 */

const args = process.argv.slice(2);
const [command, out] = args;
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
if (!command || !out) {
  process.stderr.write('usage: selfplay data|eval OUT [options]\n');
  process.exit(1);
}

const games = Number(opt('games', '100'));
const start = Number(opt('start', '0'));
const shard = Number(opt('shard', '0'));
const shards = Number(opt('shards', '1'));
const modelPath = opt('model', '');
const model: ValueModel | null = modelPath ? (JSON.parse(readFileSync(modelPath, 'utf8')) as ValueModel) : null;
/**
 * data で学習AIの席に使うモデルを複数から選ぶ（--models a.json,b.json）。昔の世代の弱いモデルも混ぜると、
 * 「資源を貯め込む」のような悪い打ち方の結果もデータに入り、評価関数がそれを避けられるようになる
 */
const pool: ValueModel[] = opt('models', '')
  .split(',')
  .filter(Boolean)
  .map((p) => JSON.parse(readFileSync(p, 'utf8')) as ValueModel);
/** data で、学習AIの席の何割を「勝利点の建設を強制しない」設定にするか */
const looseShare = Number(opt('loose', '0'));
const MAX_STEPS = 60_000;
/** 学習AIの切り替え（例: --flags noForceBuild,noTradeGate） */
const flags = opt('flags', '').split(',').filter(Boolean);
const learnedFlags = {
  forceBuild: !flags.includes('noForceBuild'),
  tradeGate: !flags.includes('noTradeGate'),
  ruleDevCards: !flags.includes('valueDevCards'),
  eagerKnights: flags.includes('eagerKnights'),
};

function makeAgent(kind: string, seed: string, explore = 0): Agent {
  if (kind === 'learned') {
    if (!model) throw new Error('--model is required for learned agents');
    return new LearnedAgent(seed, model, { explore, ...learnedFlags });
  }
  if (kind === 'rule') return new RuleBasedAgent(seed);
  if (kind === 'improved') return new RuleBasedAgent(seed, resolveStrategy('standard_data_scarcity0.5', 'standard'));
  throw new Error(`unknown agent kind: ${kind}`);
}

function play(state: GameState, agents: readonly Agent[], onTurnEnd?: (s: GameState, seat: number) => void): GameState {
  for (let step = 0; step < MAX_STEPS && state.winner === null; step++) {
    const seat = awaitingSeats(state)[0]!;
    const action = agents[seat]!.decide(toPlayerView(state, seat), legalActions(state, seat));
    if (action.type === 'endTurn' && onTurnEnd) onTurnEnd(state, seat);
    state = apply(state, action);
  }
  return state;
}

if (command === 'data') {
  const learnedShare = Number(opt('learned', model || pool.length ? '0.5' : '0'));
  const explore = Number(opt('explore', '0.05'));
  const sample = Number(opt('sample', '0.5'));
  writeFileSync(out, ['game', 'seat', 'agent', ...FEATURE_NAMES, 'win'].join(',') + '\n');
  const placements = Object.keys(PLACEMENT_PRESETS).filter((p) => p !== 'random');
  const plays = Object.keys(PLAY_PRESETS);
  let rows = 0;
  for (let g = start + shard; g < start + games; g += shards) {
    const seed = `self:${g}`;
    const rng = createRng(`selfplay-seats:${g}`);
    // 席ごとに、学習AI か いろいろな方針のルールベースAI を選ぶ（局面に幅を持たせる）
    const kinds: string[] = [];
    const agents: Agent[] = [0, 1, 2, 3].map((s) => {
      if (pool.length > 0 && rng.next() < learnedShare) {
        const i = rng.int(pool.length);
        const loose = rng.next() < looseShare;
        kinds.push(`learned:${i}${loose ? ':loose' : ''}`);
        return new LearnedAgent(`${seed}:${s}`, pool[i]!, { explore, forceBuild: !loose, tradeGate: !loose });
      }
      if (model && rng.next() < learnedShare) {
        kinds.push('learned');
        return makeAgent('learned', `${seed}:${s}`, explore);
      }
      const p = rng.next() < 0.5 ? 'standard_data_scarcity0.5' : placements[rng.int(placements.length)]!;
      const q = rng.next() < 0.5 ? 'standard' : plays[rng.int(plays.length)]!;
      kinds.push(`rule:${p}:${q}`);
      return new RuleBasedAgent(`${seed}:${s}:${p}:${q}`, resolveStrategy(p, q));
    });
    const pending: { seat: number; x: number[] }[] = [];
    const final = play(createGame(seed), agents, (s, seat) => {
      if (rng.next() < sample) pending.push({ seat, x: features({ view: toPlayerView(s, seat), unknownDev: 0 }) });
    });
    if (final.winner === null) continue;
    const lines = pending.map((p) =>
      [seed, p.seat, kinds[p.seat], ...p.x.map((v) => +v.toFixed(4)), final.winner === p.seat ? 1 : 0].join(','),
    );
    if (lines.length) appendFileSync(out, lines.join('\n') + '\n');
    rows += lines.length;
    if ((g - start) % 500 === shard) process.stderr.write(`[data ${shard}/${shards}] game ${g - start}, ${rows} rows\n`);
  }
  process.stderr.write(`wrote ${rows} rows\n`);
} else if (command === 'eval') {
  const test = opt('test', 'learned');
  const opponents = opt('opponents', 'rule');
  writeFileSync(out, '');
  let wins = 0;
  let played = 0;
  for (let g = start + shard; g < start + games; g += shards) {
    const seed = `eval:${g}`;
    const testSeat = g % 4;
    const agents = [0, 1, 2, 3].map((s) => makeAgent(s === testSeat ? test : opponents, `${seed}:${s}`));
    const final = play(createGame(seed), agents);
    const win = final.winner === testSeat;
    wins += win ? 1 : 0;
    played++;
    appendFileSync(
      out,
      JSON.stringify({ game: seed, seat: testSeat, test, opponents, win, unfinished: final.winner === null, turns: final.turn }) + '\n',
    );
    if (played % 200 === 0) process.stderr.write(`[eval ${shard}/${shards}] ${played} games, win ${((wins / played) * 100).toFixed(1)}%\n`);
  }
  process.stderr.write(`win ${wins}/${played} = ${((wins / played) * 100).toFixed(2)}%\n`);
} else {
  process.stderr.write(`unknown command: ${command}\n`);
  process.exit(1);
}
