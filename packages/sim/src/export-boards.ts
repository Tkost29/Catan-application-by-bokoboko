import { DEFAULT_CONFIG, generateBoard, TERRAIN_RESOURCE } from '@bokoboko/engine';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * export-hexes.ts の CSV に出てくる盤面（game 列の seed）ごとに、資源ごとの「出やすさの合計」を書き出す。
 * 盤面ごとに資源の多い・少ないで、資源や数字の価値が変わるかを調べるために使う。
 *
 * 使い方: bun src/export-boards.ts OUT.csv IN.csv [IN2.csv ...]
 * 出力列: game, wood, brick, sheep, wheat, ore（盤面全体の出やすさの合計。36回振ったときの出る回数）
 */

const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  process.stderr.write('usage: export-boards OUT.csv IN.csv...\n');
  process.exit(1);
}

const games = new Set<string>();
for (const path of inputs) {
  const [header, ...rows] = readFileSync(path, 'utf8').split('\n');
  const col = header!.split(',').indexOf('game');
  for (const row of rows) if (row.trim()) games.add(row.split(',')[col]!);
}

const lines = ['game,' + RES.join(',')];
for (const game of games) {
  const b = generateBoard(DEFAULT_CONFIG, game);
  const supply: Record<string, number> = Object.fromEntries(RES.map((r) => [r, 0]));
  b.terrains.forEach((t, h) => {
    const r = TERRAIN_RESOURCE[t];
    const n = b.numbers[h];
    if (r && n != null) supply[r] = (supply[r] ?? 0) + PIPS[n]!;
  });
  lines.push([game, ...RES.map((r) => supply[r])].join(','));
}
writeFileSync(out, lines.join('\n') + '\n');
process.stderr.write(`wrote ${games.size} boards to ${out}\n`);
