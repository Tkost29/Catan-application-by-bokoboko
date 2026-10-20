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

export function checkModel(model: ValueModel): void {
  const ok = model.features.length === FEATURE_NAMES.length && model.features.every((f, i) => f === FEATURE_NAMES[i]);
  if (!ok) throw new Error('value model was trained on different features; retrain it (train_value.py)');
}

/** 勝率の予測（0〜1） */
export function predict(model: ValueModel, x: readonly number[]): number {
  let h = x.map((v, i) => (v - model.mean[i]!) / (model.scale[i]! || 1));
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
