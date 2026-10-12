import {
  DEFAULT_PLAY,
  PLACEMENT_PRESETS,
  PLAY_PRESETS,
  type Goal,
  type PlacementPreset,
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

export function resolveStrategy(placement: string, play: string): Strategy {
  if (!(placement in PLACEMENT_PRESETS)) throw new Error(`unknown placement: ${placement}`);
  const p = PLACEMENT_PRESETS[placement as PlacementPreset];
  return { placement: p.weights, randomPlacement: p.random === true, play: resolvePlay(play) };
}
