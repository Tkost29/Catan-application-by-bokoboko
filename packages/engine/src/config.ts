import type { PortKind, ResourceCounts, Terrain } from './types.js';

/**
 * ゲームのルール定数をすべてここに集める。
 *
 * コードに数値を直書きせず、ルーム作成時に確定した GameConfig を状態に保存する。
 * ハウスルールや拡張に対応するときは、ここを変えるだけで済むようにするのが目的。
 */
export interface GameConfig {
  /** 設定の形式のバージョン（保存データのマイグレーション用） */
  readonly schemaVersion: 1;

  /** プレイヤー人数（通常版は4。足りない席はルーム側でAIが埋める） */
  readonly playerCount: number;

  // --- 盤面 ---
  /** 盤面の半径（通常版は2 = 19ヘックス） */
  readonly boardRadius: number;
  /** 地形タイルの枚数 */
  readonly terrainCounts: Readonly<Record<Terrain, number>>;
  /** 数字チップ（砂漠以外のヘックスに1枚ずつ） */
  readonly numberTokens: readonly number[];
  /** 隣接させない数字（通常は 6 と 8）。空配列なら制約なし */
  readonly noAdjacentNumbers: readonly number[];
  /** 港の種類（シャッフルして配置） */
  readonly portKinds: readonly PortKind[];
  /** 海岸の辺の上で、港と港の間隔（辺の本数）。合計が海岸の辺の数に一致すること */
  readonly portSpacing: readonly number[];

  // --- 資源・カード ---
  readonly resourcesPerType: number;
  readonly buildCosts: Readonly<Record<'road' | 'settlement' | 'city' | 'devCard', Partial<ResourceCounts>>>;
  readonly pieceLimits: Readonly<{ road: number; settlement: number; city: number }>;
  readonly devCardCounts: Readonly<{
    knight: number;
    victoryPoint: number;
    roadBuilding: number;
    yearOfPlenty: number;
    monopoly: number;
  }>;

  // --- 勝敗・特殊ルール ---
  readonly victoryPointsToWin: number;
  /** 7が出たとき、手札がこの枚数を超えるプレイヤーは半分を捨てる */
  readonly discardLimit: number;
  readonly longestRoadMinLength: number;
  readonly largestArmyMinKnights: number;

  // --- ルーム設定（機能フラグ） ---
  /** 手番の制限時間（秒）。null なら無制限 */
  readonly turnTimeLimitSec: number | null;
  /** 国内交易の逆提案の往復回数の上限 */
  readonly maxTradeCounterRounds: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  schemaVersion: 1,
  playerCount: 4,
  boardRadius: 2,
  terrainCounts: { forest: 4, hills: 3, pasture: 4, fields: 4, mountains: 3, desert: 1 },
  numberTokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  noAdjacentNumbers: [6, 8],
  portKinds: ['generic', 'generic', 'generic', 'generic', 'wood', 'brick', 'sheep', 'wheat', 'ore'],
  portSpacing: [3, 3, 4, 3, 3, 4, 3, 3, 4],
  resourcesPerType: 19,
  buildCosts: {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    devCard: { sheep: 1, wheat: 1, ore: 1 },
  },
  pieceLimits: { road: 15, settlement: 5, city: 4 },
  devCardCounts: { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
  victoryPointsToWin: 10,
  discardLimit: 7,
  longestRoadMinLength: 5,
  largestArmyMinKnights: 3,
  turnTimeLimitSec: null,
  maxTradeCounterRounds: 5,
};

/** 既定値に一部だけ上書きした設定を作る */
export function createConfig(overrides: Partial<Omit<GameConfig, 'schemaVersion'>> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
