import type { Action, Resource, ResourceCounts, Seat, TradeTerms } from '@bokoboko/engine';
import type { BoardHighlights } from './board.js';

/** 画面だけが持つ状態（ゲームのルールには関係しない） */
export type BuildMode = 'none' | 'road' | 'settlement' | 'city';

export type Counts = Record<Resource, number>;

export const zeroCounts = (): Counts => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });

export type Dialog =
  | { readonly kind: 'none' }
  | { readonly kind: 'bank'; give: Resource; receive: Resource }
  /** 交易の条件を組む。my* は「自分から見た」向き（提案者かどうかで terms に変換する） */
  | { readonly kind: 'trade'; to: Seat; myGive: Counts; myGet: Counts; readonly counter: boolean }
  /** 募集: ほしい物とあげてもいい物（上限）を決め、各 CPU が出した条件から選ぶ */
  | { readonly kind: 'request'; want: Counts; offer: Counts; replies: OfferReply[] | null }
  | { readonly kind: 'plenty'; a: Resource; b: Resource }
  | { readonly kind: 'monopoly'; resource: Resource }
  | { readonly kind: 'newGame' };

/** 募集への返答。terms は募集した人（自分）から見た向き。応じられなければ null */
export interface OfferReply {
  readonly seat: Seat;
  readonly terms: TradeTerms | null;
}

export interface UiState {
  mode: BuildMode;
  dialog: Dialog;
  /** 盗賊の移動先を選んだあと、奪う相手を選ぶ段階 */
  robberHex: number | null;
  discard: Counts;
  error: string | null;
}

export function initialUi(): UiState {
  return { mode: 'none', dialog: { kind: 'none' }, robberHex: null, discard: zeroCounts(), error: null };
}

/** 人間の合法手と画面の状態から、盤面で光らせる場所を決める */
export function highlightsFor(legal: readonly Action[], ui: UiState): BoardHighlights {
  const vertices = new Set<number>();
  const edges = new Set<number>();
  const hexes = new Set<number>();
  for (const a of legal) {
    switch (a.type) {
      case 'placeSettlement':
        vertices.add(a.vertex);
        break;
      case 'placeRoad':
        edges.add(a.edge);
        break;
      case 'buildSettlement':
        if (ui.mode === 'settlement') vertices.add(a.vertex);
        break;
      case 'buildCity':
        if (ui.mode === 'city') vertices.add(a.vertex);
        break;
      case 'buildRoad':
        // 街道建設カードの道（roadBuilding）は建設モードを選ばなくても光らせる
        if (ui.mode === 'road' || legal.every((x) => x.type === 'buildRoad')) edges.add(a.edge);
        break;
      case 'moveRobber':
        if (ui.robberHex === null) hexes.add(a.hex);
        break;
      default:
        break;
    }
  }
  return { vertices, edges, hexes };
}

/** 盤面のクリック（頂点・辺・ヘックス）を合法手に対応させる */
export function actionForVertex(legal: readonly Action[], ui: UiState, vertex: number): Action | undefined {
  return legal.find(
    (a) =>
      (a.type === 'placeSettlement' && a.vertex === vertex) ||
      (a.type === 'buildSettlement' && ui.mode === 'settlement' && a.vertex === vertex) ||
      (a.type === 'buildCity' && ui.mode === 'city' && a.vertex === vertex),
  );
}

export function actionForEdge(legal: readonly Action[], edge: number): Action | undefined {
  return legal.find((a) => (a.type === 'placeRoad' || a.type === 'buildRoad') && a.edge === edge);
}

export function robberChoices(legal: readonly Action[], hex: number): Extract<Action, { type: 'moveRobber' }>[] {
  return legal.filter((a): a is Extract<Action, { type: 'moveRobber' }> => a.type === 'moveRobber' && a.hex === hex);
}

export function toPartial(c: Counts): Partial<ResourceCounts> {
  return Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0)) as Partial<ResourceCounts>;
}
