import { PLACEMENT_PRESETS, PLAY_PRESETS, type PlacementPreset, type PlayPreset } from '@bokoboko/ai';
import { resolveStrategy } from './styles.js';
import { createRng } from '@bokoboko/engine';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runGame, type SeatStrategy } from './runner.js';

/**
 * シミュレーションの実行。結果は1行1席の JSON Lines で書き出す。
 *
 *   baseline  4人とも標準AI。手番順の有利不利を見る
 *   grid      1席だけ方針（配置 × 手番中）を変え、残り3席は標準AI。
 *             試す席は試合ごとに 0→1→2→3 と回し、盤面は全方針で共通にする
 *   mixed     grid と同じだが、残り3席の方針も盤面ごとにランダム（ランダム配置は除く）。
 *             標準AI以外が相手でも結論が変わらないかを確かめる
 *
 * オプション: --games N --out FILE --shard K --shards M --placements a,b --plays x,y
 * --plays には標準からの小さな変更も書ける（例: city-0.5,devCard+1,noSpareDev,eagerKnights。styles.ts 参照）
 */

const args = process.argv.slice(2);
const command = args[0] ?? 'grid';
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};

const games = Number(opt('games', '100'));
const shard = Number(opt('shard', '0'));
const shards = Number(opt('shards', '1'));
const out = opt('out', `results/${command}.jsonl`);
const placements = opt('placements', Object.keys(PLACEMENT_PRESETS).join(',')).split(',');
const plays = opt('plays', Object.keys(PLAY_PRESETS).join(',')).split(',');

for (const p of placements) for (const q of plays) {
  try {
    resolveStrategy(p, q);
  } catch (e) {
    fail(String(e));
  }
}

mkdirSync(dirname(out), { recursive: true });
if (shards === 1) writeFileSync(out, '');

const STANDARD: SeatStrategy = { placement: 'standard', play: 'standard' };
const started = Date.now();
let done = 0;

for (let g = shard; g < games; g += shards) {
  const lines: string[] = [];
  if (command === 'baseline') {
    for (const r of runGame('baseline', `base:${g}`, [STANDARD, STANDARD, STANDARD, STANDARD], null)) {
      lines.push(JSON.stringify(r));
    }
  } else if (command === 'grid') {
    const testSeat = g % 4;
    for (const placement of placements) {
      for (const play of plays) {
        const strategies = [0, 1, 2, 3].map((s) => (s === testSeat ? { placement, play } : STANDARD));
        for (const r of runGame('grid', `grid:${g}`, strategies, testSeat)) lines.push(JSON.stringify(r));
      }
    }
  } else if (command === 'mixed') {
    const testSeat = g % 4;
    // 相手の方針は盤面ごとに決め、どの「試す方針」でも同じ相手にする
    const rng = createRng(`mixed-opponents:${g}`);
    const poolP = (Object.keys(PLACEMENT_PRESETS) as PlacementPreset[]).filter((p) => p !== 'random');
    const poolQ = Object.keys(PLAY_PRESETS) as PlayPreset[];
    const opponents = [0, 1, 2, 3].map(() => ({
      placement: poolP[rng.int(poolP.length)]!,
      play: poolQ[rng.int(poolQ.length)]!,
    }));
    for (const placement of placements) {
      for (const play of plays) {
        const strategies = opponents.map((o, s) => (s === testSeat ? { placement, play } : o));
        for (const r of runGame('mixed', `mixed:${g}`, strategies, testSeat)) lines.push(JSON.stringify(r));
      }
    }
  } else {
    fail(`unknown command: ${command}`);
  }
  appendFileSync(out, lines.join('\n') + '\n');
  done++;
  if (done % 50 === 0) {
    const sec = (Date.now() - started) / 1000;
    process.stderr.write(`[${command} ${shard}/${shards}] ${done} boards, ${sec.toFixed(0)}s\n`);
  }
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
