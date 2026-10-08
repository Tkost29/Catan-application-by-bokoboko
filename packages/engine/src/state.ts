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
 *
 * setup（初期配置: 1巡目は席順、2巡目は逆順。開拓地 → 道）
 *   → preRoll（サイコロ前）
 *   → 7 以外: 生産して main（交易・建設）
 *   → 7: discard（手札が多い人が同時に捨てる）→ moveRobber（盗賊移動・略奪）→ main
 *   → main で endTurn すると次の席の preRoll。勝利点が目標に届いたら gameOver
 */
export type Phase =
  | {
      readonly kind: 'setup';
      readonly round: 1 | 2;
      readonly step: 'settlement' | 'road';
      /** 直前に置いた開拓地（道はここにつなげる）。step が 'road' のときだけ値を持つ */
      readonly lastSettlement: VertexId | null;
    }
  | { readonly kind: 'preRoll' }
  | {
      readonly kind: 'discard';
      /** 席ごとの「まだ捨てなければならない枚数」（index = Seat、0 なら済み） */
      readonly remaining: readonly number[];
    }
  | { readonly kind: 'moveRobber' }
  | { readonly kind: 'main' }
  | { readonly kind: 'gameOver' };

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
  /** 直近のダイスの目（UI 表示用）。まだ振っていなければ null */
  readonly lastRoll: readonly [number, number] | null;
  /** ダイスなどゲーム中に使う乱数の状態（rng.ts の nextRandom で進める） */
  readonly rngState: number;
  readonly winner: Seat | null;
}
