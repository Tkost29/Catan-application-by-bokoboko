import type { EdgeId, HexId, Resource, ResourceCounts, Seat, VertexId } from './types.js';

/**
 * プレイヤー（人間・AI 共通）が送る操作。
 * すべて「誰が」を seat に持ち、エンジンが手番・フェーズ・ルールを検証してから適用する。
 * 未実装のアクション（国内交易）は今後ここに追加する。
 * 街道建設カードで置く無料の道は、roadBuilding フェーズ中の buildRoad として送る。
 */
export type Action =
  // 初期配置（setup）
  | { readonly type: 'placeSettlement'; readonly seat: Seat; readonly vertex: VertexId }
  | { readonly type: 'placeRoad'; readonly seat: Seat; readonly edge: EdgeId }
  // サイコロ前（preRoll）
  | { readonly type: 'rollDice'; readonly seat: Seat }
  // 7 が出たとき（discard → moveRobber）
  | { readonly type: 'discard'; readonly seat: Seat; readonly resources: Partial<ResourceCounts> }
  | {
      readonly type: 'moveRobber';
      readonly seat: Seat;
      readonly hex: HexId;
      /** 1枚奪う相手。奪える相手がいなければ null */
      readonly victim: Seat | null;
    }
  // メイン（main）
  | { readonly type: 'buildRoad'; readonly seat: Seat; readonly edge: EdgeId }
  | { readonly type: 'buildSettlement'; readonly seat: Seat; readonly vertex: VertexId }
  | { readonly type: 'buildCity'; readonly seat: Seat; readonly vertex: VertexId }
  | {
      /** 銀行・港との交易（海外交易）。give をレート分渡して receive を1枚受け取る */
      readonly type: 'bankTrade';
      readonly seat: Seat;
      readonly give: Resource;
      readonly receive: Resource;
    }
  | { readonly type: 'endTurn'; readonly seat: Seat }
  // 発展カード（購入は main、使用は preRoll と main）
  | { readonly type: 'buyDevCard'; readonly seat: Seat }
  | { readonly type: 'playKnight'; readonly seat: Seat }
  | { readonly type: 'playRoadBuilding'; readonly seat: Seat }
  | {
      readonly type: 'playYearOfPlenty';
      readonly seat: Seat;
      /** 銀行から受け取る2枚（同じ資源でもよい） */
      readonly resources: readonly [Resource, Resource];
    }
  | { readonly type: 'playMonopoly'; readonly seat: Seat; readonly resource: Resource };

export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

/** 不正なアクションを適用しようとしたときのエラー（状態は変わらない） */
export class IllegalActionError extends Error {
  constructor(
    message: string,
    readonly action: Action,
  ) {
    super(message);
    this.name = 'IllegalActionError';
  }
}
