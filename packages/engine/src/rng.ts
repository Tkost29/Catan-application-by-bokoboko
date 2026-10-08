/**
 * シード付き疑似乱数。
 *
 * 同じシードからは必ず同じ乱数列が出るので、盤面生成やダイスを
 * 「シード + アクション列」だけで完全に再現できる（リプレイ・バグ再現用）。
 * アルゴリズム: 文字列ハッシュ xmur3 → mulberry32。
 *
 * 乱数の内部状態は 32bit 整数1つなので、ゲーム状態に保存して
 * `nextRandom` で純粋関数的に進められる（ダイスなどに使う）。
 */
export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [0, n) の整数 */
  int(n: number): number;
  /** 配列をシャッフルした新しい配列を返す（Fisher–Yates） */
  shuffle<T>(items: readonly T[]): T[];
}

/** 文字列シードから乱数の初期状態を作る */
export function seedState(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** 乱数状態を1つ進め、[0, 1) の値と次の状態を返す（mulberry32） */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

/** 使い捨ての乱数生成器（盤面生成など、一度に使い切る場面向け） */
export function createRng(seed: string): Rng {
  let state = seedState(seed);
  const next = (): number => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
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
