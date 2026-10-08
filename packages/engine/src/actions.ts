import type { EdgeId, Seat, VertexId } from './types.js';

/**
 * プレイヤー（人間・AI 共通）が送る操作。
 * すべて「誰が」を seat に持ち、エンジンが手番・フェーズ・ルールを検証してから適用する。
 * 未実装のアクションは今後ここに追加する。
 */
export type Action =
  | { readonly type: 'placeSettlement'; readonly seat: Seat; readonly vertex: VertexId }
  | { readonly type: 'placeRoad'; readonly seat: Seat; readonly edge: EdgeId };

export type ActionType = Action['type'];

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
