import type { GameConfig } from '../config.js';
import { createRng, type Rng } from '../rng.js';
import type { EdgeId, HexId, PortKind, Terrain, VertexId } from '../types.js';
import { buildTopology, STANDARD_TOPOLOGY, type Topology } from './topology.js';

export interface Port {
  readonly edge: EdgeId;
  readonly kind: PortKind;
}

/** ゲーム開始後は変わらない盤面のデータ */
export interface Board {
  /** ヘックスごとの地形（index = HexId） */
  readonly terrains: readonly Terrain[];
  /** ヘックスごとの数字チップ。砂漠は null */
  readonly numbers: readonly (number | null)[];
  readonly ports: readonly Port[];
  /** 盗賊の初期位置（砂漠） */
  readonly initialRobberHex: HexId;
}

/** 数字チップの並べ直しを諦めるまでの試行回数 */
const MAX_NUMBER_ATTEMPTS = 10_000;

export class BoardGenerationError extends Error {}

/** 半径に応じたトポロジーを返す（通常版は事前計算済みのものを使う） */
export function topologyFor(config: GameConfig): Topology {
  return config.boardRadius === STANDARD_TOPOLOGY.radius ? STANDARD_TOPOLOGY : buildTopology(config.boardRadius);
}

/**
 * 盤面をランダム生成する。同じ config と seed からは必ず同じ盤面になる。
 *
 * 1. 地形タイルをシャッフルして並べる
 * 2. 砂漠以外に数字チップを並べる。noAdjacentNumbers（6 と 8）が隣接したら並べ直す
 * 3. 港の種類をシャッフルし、海岸の辺に portSpacing の間隔で置く
 */
export function generateBoard(config: GameConfig, seed: string): Board {
  const topology = topologyFor(config);
  validateBoardConfig(config, topology);
  const rng = createRng(`board:${seed}`);

  const terrains = rng.shuffle(expandTerrains(config.terrainCounts));
  const numbers = placeNumbers(config, topology, terrains, rng);
  const ports = placePorts(config, topology, rng);

  const initialRobberHex = terrains.indexOf('desert');
  if (initialRobberHex < 0) throw new BoardGenerationError('desert is required for the robber');

  return { terrains, numbers, ports, initialRobberHex };
}

function expandTerrains(counts: GameConfig['terrainCounts']): Terrain[] {
  return (Object.keys(counts) as Terrain[]).flatMap((t) => Array<Terrain>(counts[t]).fill(t));
}

function placeNumbers(config: GameConfig, topology: Topology, terrains: readonly Terrain[], rng: Rng): (number | null)[] {
  const slots = terrains.flatMap((t, h) => (t === 'desert' ? [] : [h]));
  const restricted = new Set(config.noAdjacentNumbers);

  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
    const tokens = rng.shuffle(config.numberTokens);
    const numbers: (number | null)[] = terrains.map(() => null);
    slots.forEach((h, i) => {
      numbers[h] = tokens[i]!;
    });
    if (restricted.size === 0 || !hasAdjacentRestricted(topology, numbers, restricted)) {
      return numbers;
    }
  }
  throw new BoardGenerationError(`could not place number tokens within ${MAX_NUMBER_ATTEMPTS} attempts`);
}

/** 制約対象の数字（6 と 8）同士が隣接しているか */
export function hasAdjacentRestricted(
  topology: Topology,
  numbers: readonly (number | null)[],
  restricted: ReadonlySet<number>,
): boolean {
  return numbers.some((n, h) => {
    if (n === null || !restricted.has(n)) return false;
    return topology.hexNeighbors[h]!.some((m) => {
      const other = numbers[m];
      return other !== null && other !== undefined && restricted.has(other);
    });
  });
}

function placePorts(config: GameConfig, topology: Topology, rng: Rng): Port[] {
  const kinds = rng.shuffle(config.portKinds);
  const ports: Port[] = [];
  let position = 0;
  config.portSpacing.forEach((gap, i) => {
    ports.push({ edge: topology.coastalEdges[position]!, kind: kinds[i]! });
    position += gap;
  });
  return ports;
}

/** 港の辺の両端の頂点（ここに建物があるとその港を使える） */
export function portVertices(topology: Topology, port: Port): readonly [VertexId, VertexId] {
  return topology.edgeVertices[port.edge]!;
}

/** 設定と盤面の形が矛盾していないかを確認する */
export function validateBoardConfig(config: GameConfig, topology: Topology): void {
  const hexCount = topology.hexCoords.length;
  const terrainTotal = Object.values(config.terrainCounts).reduce((a, b) => a + b, 0);
  if (terrainTotal !== hexCount) {
    throw new BoardGenerationError(`terrain count ${terrainTotal} does not match hex count ${hexCount}`);
  }
  const producing = hexCount - config.terrainCounts.desert;
  if (config.numberTokens.length !== producing) {
    throw new BoardGenerationError(
      `number token count ${config.numberTokens.length} does not match non-desert hex count ${producing}`,
    );
  }
  if (config.portKinds.length !== config.portSpacing.length) {
    throw new BoardGenerationError('portKinds and portSpacing must have the same length');
  }
  const spacingTotal = config.portSpacing.reduce((a, b) => a + b, 0);
  if (spacingTotal !== topology.coastalEdges.length) {
    throw new BoardGenerationError(
      `port spacing total ${spacingTotal} does not match coastal edge count ${topology.coastalEdges.length}`,
    );
  }
}
