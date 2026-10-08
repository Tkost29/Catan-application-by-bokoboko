import type { Board } from './board/generate.js';
import type { GameConfig } from './config.js';
import type { HexId, ResourceCounts, Seat, VertexId } from './types.js';

export type DevCard = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';

export interface Building {
  readonly owner: Seat;
  readonly kind: 'settlement' | 'city';
}

export interface PlayerState {
  readonly seat: Seat;
  readonly hand: ResourceCounts;
  readonly devCards: readonly { readonly card: DevCard; readonly boughtTurn: number }[];
  readonly playedKnights: number;
  readonly piecesLeft: { readonly road: number; readonly settlement: number; readonly city: number };
}

/**
 * ゲームの進行段階。
 * 初期配置は1巡目（席順）→ 2巡目（逆順）で、各巡とも開拓地 → 道の順に置く。
 * 未実装のフェーズは今後ここに追加する。
 */
export type Phase =
  | {
      readonly kind: 'setup';
      readonly round: 1 | 2;
      readonly step: 'settlement' | 'road';
      /** 直前に置いた開拓地（道はここにつなげる）。step が 'road' のときだけ値を持つ */
      readonly lastSettlement: VertexId | null;
    }
  | { readonly kind: 'preRoll' };

/** サーバだけが持つ完全情報のゲーム状態。プレイヤーには toPlayerView で絞って渡す */
export interface GameState {
  readonly schemaVersion: 1;
  readonly config: GameConfig;
  readonly seed: string;
  readonly board: Board;
  /** 頂点ごとの建物（index = VertexId） */
  readonly buildings: readonly (Building | null)[];
  /** 辺ごとの道の持ち主（index = EdgeId） */
  readonly roads: readonly (Seat | null)[];
  readonly robberHex: HexId;
  readonly players: readonly PlayerState[];
  readonly bank: ResourceCounts;
  readonly devDeck: readonly DevCard[];
  readonly longestRoad: Seat | null;
  readonly largestArmy: Seat | null;
  readonly phase: Phase;
  /** 通常手番の通し番号。初期配置中は 0 */
  readonly turn: number;
  readonly currentSeat: Seat;
  /** ダイスなどゲーム中に使う乱数の状態（rng.ts の nextRandom で進める） */
  readonly rngState: number;
  readonly winner: Seat | null;
}
