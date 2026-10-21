import { FEATURE_NAMES } from './features.js';

/**
 * 勝率を予測する小さなニューラルネット（全結合・ReLU・出力はシグモイド）。
 * 重みは packages/sim/analysis/train_value.py が学習して weights.ts に書き出す。
 */
export interface ValueModel {
  /** 学習に使った特徴量の名前（FEATURE_NAMES と一致していること） */
  readonly features: readonly string[];
  /** 標準化: (x - mean) / scale */
  readonly mean: readonly number[];
  readonly scale: readonly number[];
  /** 各層の重み W[出力][入力] とバイアス。最後の層の出力は1つ */
  readonly layers: readonly { readonly W: readonly (readonly number[])[]; readonly b: readonly number[] }[];
  /** 学習の記録（世代・データ量・検証の成績） */
  readonly info?: Readonly<Record<string, string | number>>;
}

const indexCache = new WeakMap<ValueModel, number[]>();

/** モデルが使う特徴量の、FEATURE_NAMES の中での位置（古いモデルは一部の特徴量だけを使う） */
function indicesOf(model: ValueModel): number[] {
  let idx = indexCache.get(model);
  if (!idx) {
    idx = model.features.map((f) => (FEATURE_NAMES as readonly string[]).indexOf(f));
    indexCache.set(model, idx);
  }
  return idx;
}

export function checkModel(model: ValueModel): void {
  if (indicesOf(model).some((i) => i < 0)) {
    throw new Error('value model uses features that no longer exist; retrain it (train_value.py)');
  }
}

/** 勝率の予測（0〜1）。x は FEATURE_NAMES の順の特徴量 */
export function predict(model: ValueModel, x: readonly number[]): number {
  const idx = indicesOf(model);
  let h = idx.map((j, i) => (x[j]! - model.mean[i]!) / (model.scale[i]! || 1));
  model.layers.forEach((layer, li) => {
    const last = li === model.layers.length - 1;
    h = layer.W.map((row, j) => {
      let s = layer.b[j]!;
      for (let i = 0; i < row.length; i++) s += row[i]! * h[i]!;
      return last ? s : Math.max(0, s);
    });
  });
  return 1 / (1 + Math.exp(-h[0]!));
}
