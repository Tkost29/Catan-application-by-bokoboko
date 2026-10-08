import { describe, expect, it } from 'vitest';
import {
  BoardGenerationError,
  createConfig,
  DEFAULT_CONFIG,
  generateBoard,
  hasAdjacentRestricted,
  STANDARD_TOPOLOGY as T,
} from '../src/index.js';

const SEEDS = Array.from({ length: 500 }, (_, i) => `seed-${i}`);

const countBy = <K extends string | number>(items: readonly K[]): Map<K, number> => {
  const m = new Map<K, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

describe('盤面生成', () => {
  it('同じシードなら同じ盤面、違うシードなら（ほぼ）違う盤面', () => {
    const a = generateBoard(DEFAULT_CONFIG, 'abc');
    const b = generateBoard(DEFAULT_CONFIG, 'abc');
    const c = generateBoard(DEFAULT_CONFIG, 'abd');
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('地形タイルの枚数が設定どおり', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const board = generateBoard(DEFAULT_CONFIG, seed);
      const counts = countBy(board.terrains);
      for (const [terrain, n] of Object.entries(DEFAULT_CONFIG.terrainCounts)) {
        expect(counts.get(terrain as never) ?? 0).toBe(n);
      }
    }
  });

  it('砂漠だけ数字なし・盗賊は砂漠から、他は数字チップを1枚ずつ使い切る', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const board = generateBoard(DEFAULT_CONFIG, seed);
      board.terrains.forEach((t, h) => {
        expect(board.numbers[h] === null).toBe(t === 'desert');
      });
      expect(board.terrains[board.initialRobberHex]).toBe('desert');
      const used = board.numbers.filter((n): n is number => n !== null).sort((x, y) => x - y);
      expect(used).toEqual([...DEFAULT_CONFIG.numberTokens].sort((x, y) => x - y));
    }
  });

  it('6 と 8 は隣接しない（500シード）', () => {
    const restricted = new Set(DEFAULT_CONFIG.noAdjacentNumbers);
    for (const seed of SEEDS) {
      const board = generateBoard(DEFAULT_CONFIG, seed);
      expect(hasAdjacentRestricted(T, board.numbers, restricted)).toBe(false);
    }
  });

  it('制約を外すと 6 と 8 が隣接する盤面も出る（制約が効いていることの確認）', () => {
    const config = createConfig({ noAdjacentNumbers: [] });
    const restricted = new Set([6, 8]);
    const violations = SEEDS.filter((seed) =>
      hasAdjacentRestricted(T, generateBoard(config, seed).numbers, restricted),
    ).length;
    expect(violations).toBeGreaterThan(0);
  });

  it('港は9つ、海岸の辺に重ならず、2つ以上離れて置かれ、種類の枚数が設定どおり', () => {
    const coastal = new Set(T.coastalEdges);
    for (const seed of SEEDS.slice(0, 50)) {
      const board = generateBoard(DEFAULT_CONFIG, seed);
      expect(board.ports).toHaveLength(9);
      const edges = board.ports.map((p) => p.edge);
      expect(new Set(edges).size).toBe(9);
      edges.forEach((e) => expect(coastal.has(e)).toBe(true));

      // 港同士が頂点を共有しない（同じ開拓地で2つの港を使えない）
      const vertices = edges.flatMap((e) => T.edgeVertices[e]!);
      expect(new Set(vertices).size).toBe(18);

      const kinds = countBy(board.ports.map((p) => p.kind));
      expect(kinds.get('generic')).toBe(4);
      for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) expect(kinds.get(r)).toBe(1);
    }
  });

  it('盤面の形と合わない設定はエラーにする', () => {
    expect(() => generateBoard(createConfig({ numberTokens: [2, 3] }), 'x')).toThrow(BoardGenerationError);
    expect(() => generateBoard(createConfig({ portSpacing: [3, 3, 3, 3, 3, 3, 3, 3, 3] }), 'x')).toThrow(
      BoardGenerationError,
    );
  });
});
