import {
  DEFAULT_PLAY,
  PLACEMENT_PRESETS,
  PLAY_PRESETS,
  type Goal,
  type PlacementPreset,
  type PlacementWeights,
  type PlayPreset,
  type PlayStyle,
  type Strategy,
} from '@bokoboko/ai';

const GOALS: readonly Goal[] = ['settlement', 'city', 'road', 'devCard'];

/**
 * 手番中の方針を文字列から作る。
 *   - プリセット名: standard / expand / city / devCard
 *   - 標準からの小さな変更を "_" でつないだもの:
 *       city-0.5     都市を少し優先（目標の補正 −0.5）
 *       devCard+1    発展カードを後回し（補正 +1）
 *       noSpareDev   資源が余っても発展カードを買わない
 *       eagerKnights 騎士を持っていれば毎手番使う
 *       threatRobber 盗賊を脅威度で置く / threatTrade 突出した相手とは交換しない
 *       basicRobber / basicTrade  既定がそれ以外になったあとに、元の置き方・交換に戻す
 *     例: "city-0.5_eagerKnights"
 */
export function resolvePlay(spec: string): PlayStyle {
  if (spec in PLAY_PRESETS) return PLAY_PRESETS[spec as PlayPreset].style;
  const bias: Record<Goal, number> = { ...DEFAULT_PLAY.goalBias };
  let buyDevWhenSpare = DEFAULT_PLAY.buyDevWhenSpare;
  let knights = DEFAULT_PLAY.knights;
  let robber = DEFAULT_PLAY.robber;
  let tradeGuard = DEFAULT_PLAY.tradeGuard;
  for (const token of spec.split('_')) {
    if (token === 'noSpareDev') buyDevWhenSpare = false;
    else if (token === 'eagerKnights') knights = 'eager';
    else if (token === 'threatRobber') robber = 'threat';
    else if (token === 'threatTrade') tradeGuard = 'threat';
    else if (token === 'basicRobber') robber = 'basic';
    else if (token === 'basicTrade') tradeGuard = 'basic';
    else {
      const m = /^(settlement|city|road|devCard)([+-]\d+(?:\.\d+)?)$/.exec(token);
      if (!m) throw new Error(`unknown play style token: ${token}`);
      bias[m[1] as Goal] = Number(m[2]);
    }
  }
  for (const g of GOALS) if (!Number.isFinite(bias[g])) throw new Error(`bad bias for ${g}`);
  return { goalBias: bias, buyDevWhenSpare, knights, robber, tradeGuard };
}

/**
 * 配置の方針を文字列から作る。
 *   - プリセット名: standard / production / oreWheat / woodBrick / diversity / port / random
 *   - プリセットのあとに "_" でつないだ変更:
 *       scarcity1    盤面で少ない資源ほど重く見る（(平均的な量/この盤面の量)^1 を重みに掛ける）
 *       data         資源の重みを勝敗データの点数（hex_value.py）に合わせる
 *     例: "standard_scarcity1", "standard_data_scarcity0.5"
 */
export function resolvePlacement(spec: string): { weights: PlacementWeights; random: boolean } {
  const [name, ...tokens] = spec.split('_');
  if (!name || !(name in PLACEMENT_PRESETS)) throw new Error(`unknown placement: ${spec}`);
  const preset = PLACEMENT_PRESETS[name as PlacementPreset];
  let weights: PlacementWeights = preset.weights;
  for (const token of tokens) {
    const m = /^scarcity(\d+(?:\.\d+)?)$/.exec(token);
    if (m) weights = { ...weights, scarcity: Number(m[1]) };
    else if (token === 'data') weights = { ...weights, ...DATA_WEIGHTS };
    else throw new Error(`unknown placement token: ${token}`);
  }
  return { weights, random: preset.random === true };
}

/**
 * 勝敗データから推定した点数（5・9 の1ヘックス、木材の出やすさ1つ = 1点）に合わせた重み。
 * 出やすさ1つあたり: 木材 1.0 / レンガ 1.05 / 羊毛 1.08 / 小麦 1.3 / 鉱石 1.43。
 * 初めての資源の上乗せは平均で出やすさ約4つ分
 */
const DATA_WEIGHTS: Partial<PlacementWeights> = {
  resource: { wood: 1, brick: 1.05, sheep: 1.08, wheat: 1.3, ore: 1.43 },
  diversity: 4,
  earlyWoodBrick: 1,
};

export function resolveStrategy(placement: string, play: string): Strategy {
  const p = resolvePlacement(placement);
  return { placement: p.weights, randomPlacement: p.random, play: resolvePlay(play) };
}
