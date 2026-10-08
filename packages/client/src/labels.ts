import { RESOURCES, type DevCard, type Resource, type ResourceCounts, type Seat, type Terrain } from '@bokoboko/engine';

export const RESOURCE_LABEL: Readonly<Record<Resource, string>> = {
  wood: '木材',
  brick: 'レンガ',
  sheep: '羊毛',
  wheat: '小麦',
  ore: '鉱石',
};

/** 盤面の港など、1文字で示す場所に使う */
export const RESOURCE_SHORT: Readonly<Record<Resource, string>> = {
  wood: '木',
  brick: 'レ',
  sheep: '羊',
  wheat: '麦',
  ore: '鉱',
};

export const TERRAIN_LABEL: Readonly<Record<Terrain, string>> = {
  forest: '森',
  hills: '丘',
  pasture: '牧草地',
  fields: '畑',
  mountains: '山',
  desert: '砂漠',
};

export const DEV_LABEL: Readonly<Record<DevCard, string>> = {
  knight: '騎士',
  victoryPoint: '勝利点',
  roadBuilding: '街道建設',
  yearOfPlenty: '収穫',
  monopoly: '独占',
};

export const DEV_HELP: Readonly<Record<DevCard, string>> = {
  knight: '盗賊を動かして1枚奪う',
  victoryPoint: '持っているだけで1点',
  roadBuilding: '道を2本無料で置く',
  yearOfPlenty: '銀行から好きな資源を2枚',
  monopoly: '指定した資源を全員から集める',
};

/** 席ごとの名前。人間の席は「あなた」、AI は手番順に CPU 1〜3 */
export function seatNames(playerCount: number, humanSeat: Seat): string[] {
  let cpu = 0;
  return Array.from({ length: playerCount }, (_, seat) => (seat === humanSeat ? 'あなた' : `CPU ${++cpu}`));
}

/** 「木材2・小麦1」のような表記。空なら「なし」 */
export function formatCounts(counts: Partial<ResourceCounts>): string {
  const parts = RESOURCES.filter((r) => (counts[r] ?? 0) > 0).map((r) => `${RESOURCE_LABEL[r]}${counts[r]}`);
  return parts.length > 0 ? parts.join('・') : 'なし';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
