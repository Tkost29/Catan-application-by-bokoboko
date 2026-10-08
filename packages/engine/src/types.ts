/** 資源 */
export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];

/** 地形 */
export const TERRAINS = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'] as const;
export type Terrain = (typeof TERRAINS)[number];

/** 地形 → 産出資源（砂漠は何も産出しない） */
export const TERRAIN_RESOURCE: Readonly<Record<Terrain, Resource | null>> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
};

/** 港の種類: 特定資源の2:1港 か 汎用の3:1港 */
export type PortKind = Resource | 'generic';

/** 盤面要素のID（トポロジー内の連番） */
export type HexId = number;
export type VertexId = number;
export type EdgeId = number;

/** 席番号（手番順） */
export type Seat = 0 | 1 | 2 | 3;

export type ResourceCounts = Record<Resource, number>;
