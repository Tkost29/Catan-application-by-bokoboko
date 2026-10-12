import { DEFAULT_CONFIG, generateBoard, STANDARD_TOPOLOGY as T, TERRAIN_RESOURCE } from '@bokoboko/engine';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * シミュレーション結果（JSON Lines）の各席について、初期配置の開拓地2軒が
 * どの資源のどの数字に接していたかを盤面から復元し、CSV に書き出す。
 *
 * 使い方: bun src/export-hexes.ts OUT.csv FILTER IN1.jsonl [IN2.jsonl ...]
 *   FILTER: all（全席）/ test（試す席だけ）/ standard（手番中が標準の席だけ）/ test-standard
 *
 * 出力列: source, game, seat, win, placement, play, s1, s2
 *   s1・s2 は「資源:数字」をセミコロンでつないだもの（例: ore:5;wheat:8;sheep:10）。砂漠と海は含めない
 */

const [out, filter, ...inputs] = process.argv.slice(2);
if (!out || !filter || inputs.length === 0) {
  process.stderr.write('usage: export-hexes OUT.csv FILTER IN.jsonl...\n');
  process.exit(1);
}

const boards = new Map<string, ReturnType<typeof generateBoard>>();
const boardOf = (seed: string): ReturnType<typeof generateBoard> => {
  let b = boards.get(seed);
  if (!b) {
    b = generateBoard(DEFAULT_CONFIG, seed);
    boards.set(seed, b);
  }
  return b;
};

const describe = (seed: string, v: number): string => {
  const b = boardOf(seed);
  return T.vertexHexes[v]!
    .flatMap((h) => {
      const r = TERRAIN_RESOURCE[b.terrains[h]!];
      const n = b.numbers[h];
      return r && n != null ? [`${r}:${n}`] : [];
    })
    .join(';');
};

writeFileSync(out, 'source,game,seat,win,placement,play,s1,s2\n');
let count = 0;
for (const path of inputs) {
  const source = path.split('/').at(-1)!.split('.')[0]!;
  const lines: string[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as {
      game: string;
      seat: number;
      test: boolean;
      placement: string;
      play: string;
      unfinished: boolean;
      features: { vertices: [number, number] };
      outcome: { win: boolean };
    };
    if (r.unfinished) continue;
    if ((filter === 'test' || filter === 'test-standard') && !r.test) continue;
    if ((filter === 'standard' || filter === 'test-standard') && r.play !== 'standard') continue;
    const [v1, v2] = r.features.vertices;
    lines.push(
      [source, r.game, r.seat, r.outcome.win ? 1 : 0, r.placement, r.play, describe(r.game, v1), describe(r.game, v2)].join(','),
    );
    count++;
  }
  appendFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
}
process.stderr.write(`wrote ${count} rows to ${out}\n`);
