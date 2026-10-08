import { describe, expect, it } from 'vitest';
import { buildTopology, STANDARD_TOPOLOGY as T } from '../src/board/topology.js';

describe('通常版トポロジー', () => {
  it('ヘックス19・頂点54・辺72', () => {
    expect(T.hexCoords).toHaveLength(19);
    expect(T.vertexPositions).toHaveLength(54);
    expect(T.edgeVertices).toHaveLength(72);
  });

  it('海岸の辺は30本', () => {
    expect(T.coastalEdges).toHaveLength(30);
    expect(new Set(T.coastalEdges).size).toBe(30);
  });

  it('海岸の辺は一周つながっている（隣同士が頂点を共有する）', () => {
    const n = T.coastalEdges.length;
    for (let i = 0; i < n; i++) {
      const a = T.edgeVertices[T.coastalEdges[i]!]!;
      const b = T.edgeVertices[T.coastalEdges[(i + 1) % n]!]!;
      const shared = a.filter((v) => b.includes(v));
      expect(shared).toHaveLength(1);
    }
  });

  it('各ヘックスは6頂点・6辺を持ち、辺は隣り合う頂点を結ぶ', () => {
    T.hexVertices.forEach((vs, h) => {
      expect(new Set(vs).size).toBe(6);
      const es = T.hexEdges[h]!;
      expect(new Set(es).size).toBe(6);
      es.forEach((e, i) => {
        const [a, b] = T.edgeVertices[e]!;
        const expected = [vs[i]!, vs[(i + 1) % 6]!].sort((x, y) => x - y);
        expect([a, b]).toEqual(expected);
      });
    });
  });

  it('頂点は1〜3ヘックス・2〜3本の辺に接する', () => {
    const hexCounts = T.vertexHexes.map((h) => h.length);
    expect(Math.min(...hexCounts)).toBe(1);
    expect(Math.max(...hexCounts)).toBe(3);
    T.vertexEdges.forEach((es, v) => {
      expect(es.length).toBeGreaterThanOrEqual(2);
      expect(es.length).toBeLessThanOrEqual(3);
      expect(T.vertexNeighbors[v]).toHaveLength(es.length);
    });
  });

  it('ヘックスの隣接は対称で、中央ヘックスは6つの隣を持つ', () => {
    T.hexNeighbors.forEach((ns, h) => {
      for (const n of ns) expect(T.hexNeighbors[n]).toContain(h);
    });
    const center = T.hexCoords.findIndex((c) => c.q === 0 && c.r === 0);
    expect(T.hexNeighbors[center]).toHaveLength(6);
  });

  it('辺に接するヘックスは1個（海岸）か2個（内側）', () => {
    const coastal = T.edgeHexes.filter((h) => h.length === 1).length;
    const inner = T.edgeHexes.filter((h) => h.length === 2).length;
    expect(coastal).toBe(30);
    expect(inner).toBe(42);
  });

  it('半径を変えても構築できる（拡張用）', () => {
    const t3 = buildTopology(3);
    expect(t3.hexCoords).toHaveLength(37);
    expect(t3.coastalEdges).toHaveLength(42);
  });
});
