/**
 * シード付き疑似乱数。
 *
 * 同じシードからは必ず同じ乱数列が出るので、盤面生成やダイスを
 * 「シード + アクション列」だけで完全に再現できる（リプレイ・バグ再現用）。
 * アルゴリズム: 文字列ハッシュ xmur3 → mulberry32。
 */
export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [0, n) の整数 */
  int(n: number): number;
  /** 配列をシャッフルした新しい配列を返す（Fisher–Yates） */
  shuffle<T>(items: readonly T[]): T[];
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function createRng(seed: string): Rng {
  let a = xmur3(seed)();
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { next, int, shuffle };
}
