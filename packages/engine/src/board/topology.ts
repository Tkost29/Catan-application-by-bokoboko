import type { EdgeId, HexId, VertexId } from '../types.js';

/**
 * 盤面の幾何構造（ヘックス・頂点・辺の隣接関係）。
 *
 * 地形や数字チップとは独立した「形だけ」の情報で、半径が同じなら常に同じになる。
 * 起動時に一度だけ計算し、以降は配列アクセスだけで隣接判定ができるようにする。
 *
 * 座標系:
 * - ヘックスはアキシャル座標 (q, r)、とがった頂点が上（pointy-top）。
 * - 頂点・辺の位置は整数格子 (x, y) で表す。x の単位は √3/2、y の単位は 1/2。
 *   ヘックス中心は (2q + r, 3r)、6頂点は中心から
 *   上(0,-2) 右上(1,-1) 右下(1,1) 下(0,2) 左下(-1,1) 左上(-1,-1)。
 *   整数で表すので浮動小数点の誤差なく頂点の同一判定ができる。
 */
export interface Topology {
  readonly radius: number;
  /** ヘックスのアキシャル座標 */
  readonly hexCoords: readonly { readonly q: number; readonly r: number }[];
  /** 各ヘックスの隣接ヘックス */
  readonly hexNeighbors: readonly (readonly HexId[])[];
  /** 各ヘックスの6頂点（上から時計回り） */
  readonly hexVertices: readonly (readonly VertexId[])[];
  /** 各ヘックスの6辺（上→右上の辺から時計回り） */
  readonly hexEdges: readonly (readonly EdgeId[])[];
  /** 頂点の格子座標（描画用） */
  readonly vertexPositions: readonly { readonly x: number; readonly y: number }[];
  /** 各頂点に接するヘックス（1〜3個） */
  readonly vertexHexes: readonly (readonly HexId[])[];
  /** 各頂点から出る辺（2〜3本） */
  readonly vertexEdges: readonly (readonly EdgeId[])[];
  /** 各頂点に辺で隣接する頂点（2〜3個）。距離ルールの判定に使う */
  readonly vertexNeighbors: readonly (readonly VertexId[])[];
  /** 各辺の両端の頂点 */
  readonly edgeVertices: readonly (readonly [VertexId, VertexId])[];
  /** 各辺に接するヘックス（海岸の辺は1個、内側の辺は2個） */
  readonly edgeHexes: readonly (readonly HexId[])[];
  /** 海岸の辺。盤面の周りを一周する順に並ぶ（港の配置に使う） */
  readonly coastalEdges: readonly EdgeId[];
}

const CORNER_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -2],
  [1, -1],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-1, -1],
];

const AXIAL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** 半径 radius の六角形盤面のトポロジーを構築する（通常版は半径2 = 19ヘックス） */
export function buildTopology(radius: number): Topology {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`radius must be a non-negative integer: ${radius}`);
  }

  // ヘックス: 上の行（r が小さい）から、各行は左から
  const hexCoords: { q: number; r: number }[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) hexCoords.push({ q, r });
    }
  }
  const hexIndex = new Map<string, HexId>();
  hexCoords.forEach((h, i) => hexIndex.set(`${h.q},${h.r}`, i));

  const hexNeighbors = hexCoords.map(({ q, r }) =>
    AXIAL_DIRECTIONS.flatMap(([dq, dr]) => {
      const n = hexIndex.get(`${q + dq},${r + dr}`);
      return n === undefined ? [] : [n];
    }),
  );

  // 頂点: 出現順に連番を振る
  const vertexIndex = new Map<string, VertexId>();
  const vertexPositions: { x: number; y: number }[] = [];
  const vertexHexes: HexId[][] = [];
  const hexVertices: VertexId[][] = hexCoords.map(({ q, r }, hexId) => {
    const cx = 2 * q + r;
    const cy = 3 * r;
    return CORNER_OFFSETS.map(([dx, dy]) => {
      const x = cx + dx;
      const y = cy + dy;
      const key = `${x},${y}`;
      let v = vertexIndex.get(key);
      if (v === undefined) {
        v = vertexPositions.length;
        vertexIndex.set(key, v);
        vertexPositions.push({ x, y });
        vertexHexes.push([]);
      }
      vertexHexes[v]!.push(hexId);
      return v;
    });
  });

  // 辺: 各ヘックスの隣り合う頂点の組。同じ組は1本にまとめる
  const edgeIndex = new Map<string, EdgeId>();
  const edgeVertices: [VertexId, VertexId][] = [];
  const edgeHexes: HexId[][] = [];
  const hexEdges: EdgeId[][] = hexVertices.map((corners, hexId) =>
    corners.map((a, i) => {
      const b = corners[(i + 1) % 6]!;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo},${hi}`;
      let e = edgeIndex.get(key);
      if (e === undefined) {
        e = edgeVertices.length;
        edgeIndex.set(key, e);
        edgeVertices.push([lo, hi]);
        edgeHexes.push([]);
      }
      edgeHexes[e]!.push(hexId);
      return e;
    }),
  );

  const vertexEdges: EdgeId[][] = vertexPositions.map(() => []);
  const vertexNeighbors: VertexId[][] = vertexPositions.map(() => []);
  edgeVertices.forEach(([a, b], e) => {
    vertexEdges[a]!.push(e);
    vertexEdges[b]!.push(e);
    vertexNeighbors[a]!.push(b);
    vertexNeighbors[b]!.push(a);
  });

  // 海岸の辺を、盤面中心から見た角度の順（時計回り）に並べる
  const SQRT3_2 = Math.sqrt(3) / 2;
  const edgeAngle = (e: EdgeId): number => {
    const [a, b] = edgeVertices[e]!;
    const pa = vertexPositions[a]!;
    const pb = vertexPositions[b]!;
    const x = ((pa.x + pb.x) / 2) * SQRT3_2;
    const y = (pa.y + pb.y) / 4;
    // y は下向きが正なので、atan2 の増加方向が画面上の時計回りになる
    return Math.atan2(y, x);
  };
  const coastalEdges = edgeHexes
    .map((hexes, e) => ({ e, coastal: hexes.length === 1 }))
    .filter((x) => x.coastal)
    .map((x) => x.e)
    .sort((a, b) => edgeAngle(a) - edgeAngle(b));

  return {
    radius,
    hexCoords,
    hexNeighbors,
    hexVertices,
    hexEdges,
    vertexPositions,
    vertexHexes,
    vertexEdges,
    vertexNeighbors,
    edgeVertices,
    edgeHexes,
    coastalEdges,
  };
}

/** 通常版（19ヘックス）のトポロジー */
export const STANDARD_TOPOLOGY: Topology = buildTopology(2);
