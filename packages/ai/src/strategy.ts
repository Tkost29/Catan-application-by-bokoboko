import { DEFAULT_PLACEMENT, type PlacementWeights } from './evaluate.js';

/** 次に何を作るか */
export type Goal = 'city' | 'settlement' | 'road' | 'devCard';

/**
 * 手番中の方針。ルールベースAIの「次に作るもの」の選び方と、発展カードの扱いを変える。
 */
export interface PlayStyle {
  /**
   * 目標ごとの補正。目標は「足りない枚数 + 補正」が最小のものを選ぶ。
   * マイナスにすると、その目標を優先する（足りない枚数がその分多くても選ぶ）。
   */
  readonly goalBias: Readonly<Record<Goal, number>>;
  /** 目標を達成して資源が余ったら発展カードを買うか */
  readonly buyDevWhenSpare: boolean;
  /** 騎士の使い方。standard: 盗賊に塞がれたときと最大騎士力を取れるとき / eager: 持っていれば毎手番使う */
  readonly knights: 'standard' | 'eager';
  /**
   * 盗賊の置き方。
   * basic: 見えている勝利点の高い相手の、出やすいヘックス
   * threat: 脅威度（点数・生産力・港・発展カード）で相手を見て、突出した相手を優先し、
   *         欲しい資源を持っていそうな相手から奪い、盤面で希少な資源のヘックスを止める
   */
  readonly robber: 'basic' | 'threat';
  /**
   * 交渉で相手を助けないための基準。
   * basic: あと2点以内で勝ちそうな相手とは交換しない
   * threat: さらに、脅威度が突出している相手（自分より強い）とも交換しない。提案は脅威度の低い相手から
   */
  readonly tradeGuard: 'basic' | 'threat';
}

/** AI の方針 = 配置の方針 + 手番中の方針 */
export interface Strategy {
  readonly placement: PlacementWeights;
  /** true なら初期配置の開拓地をランダムに選ぶ（配置の効果を測る対照用） */
  readonly randomPlacement: boolean;
  readonly play: PlayStyle;
}

export const DEFAULT_PLAY: PlayStyle = {
  goalBias: { settlement: 0, city: 0, road: 0, devCard: 0 },
  buyDevWhenSpare: true,
  knights: 'standard',
  robber: 'basic',
  tradeGuard: 'basic',
};

/**
 * 勝敗データから推定した点数表に合わせた配置の重み + 盤面で少ない資源を少し重く見る補正。
 * シミュレーションで標準より勝率が約2.7ポイント高かった（sim の "standard_data_scarcity0.5"）。
 * 学習AI（難易度2）の初期配置に使う。
 */
export const IMPROVED_PLACEMENT: PlacementWeights = {
  resource: { wood: 1, brick: 1.05, sheep: 1.08, wheat: 1.3, ore: 1.43 },
  diversity: 4,
  port: 1,
  earlyWoodBrick: 1,
  scarcity: 0.5,
};

export const DEFAULT_STRATEGY: Strategy = {
  placement: DEFAULT_PLACEMENT,
  randomPlacement: false,
  play: DEFAULT_PLAY,
};

// ---------------------------------------------------------------------------
// シミュレーションで比べる方針のプリセット
// ---------------------------------------------------------------------------

export type PlacementPreset = 'standard' | 'production' | 'oreWheat' | 'woodBrick' | 'diversity' | 'port' | 'random';
export type PlayPreset = 'standard' | 'expand' | 'city' | 'devCard';

export const PLACEMENT_PRESETS: Readonly<Record<PlacementPreset, { label: string; weights: PlacementWeights; random?: boolean }>> = {
  standard: { label: '標準（バランス）', weights: DEFAULT_PLACEMENT },
  production: {
    label: '出やすさ最優先',
    weights: { resource: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 }, diversity: 0, port: 0, earlyWoodBrick: 1 },
  },
  oreWheat: {
    label: '鉱石・小麦重視',
    weights: { resource: { wood: 0.6, brick: 0.6, sheep: 0.9, wheat: 1.5, ore: 1.6 }, diversity: 0.5, port: 1, earlyWoodBrick: 1 },
  },
  woodBrick: {
    label: '木材・レンガ重視',
    weights: { resource: { wood: 1.6, brick: 1.6, sheep: 0.9, wheat: 0.9, ore: 0.6 }, diversity: 0.5, port: 1, earlyWoodBrick: 1 },
  },
  diversity: {
    label: '資源の種類重視',
    weights: { resource: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 }, diversity: 4, port: 1, earlyWoodBrick: 1 },
  },
  port: {
    label: '港重視',
    weights: { ...DEFAULT_PLACEMENT, port: 4 },
  },
  random: { label: 'ランダム（対照）', weights: DEFAULT_PLACEMENT, random: true },
};

export const PLAY_PRESETS: Readonly<Record<PlayPreset, { label: string; style: PlayStyle }>> = {
  standard: { label: '標準', style: DEFAULT_PLAY },
  expand: {
    label: '拡張優先（開拓地・道）',
    style: { ...DEFAULT_PLAY, goalBias: { settlement: -1.5, road: -1, city: 1, devCard: 2 }, buyDevWhenSpare: false },
  },
  city: {
    label: '都市優先',
    style: { ...DEFAULT_PLAY, goalBias: { settlement: 0.5, road: 1, city: -1.5, devCard: 1 } },
  },
  devCard: {
    label: '発展カード重視',
    style: { ...DEFAULT_PLAY, goalBias: { settlement: 0.5, road: 1, city: 0, devCard: -2 }, knights: 'eager' },
  },
};

export function strategyOf(placement: PlacementPreset, play: PlayPreset): Strategy {
  const p = PLACEMENT_PRESETS[placement];
  return { placement: p.weights, randomPlacement: p.random === true, play: PLAY_PRESETS[play].style };
}
