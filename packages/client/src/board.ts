import { topologyFor, type PlayerView, type Port } from '@bokoboko/engine';
import { RESOURCE_SHORT, TERRAIN_LABEL } from './labels.js';

/**
 * 盤面を SVG 文字列として描く（DOM を使わない純粋関数なのでテストしやすい）。
 *
 * クリックできる場所には data-vertex / data-edge / data-hex 属性を付け、
 * main.ts 側でイベントを1か所で受け取る。
 */

export interface BoardHighlights {
  readonly vertices: ReadonlySet<number>;
  readonly edges: ReadonlySet<number>;
  readonly hexes: ReadonlySet<number>;
}

export const NO_HIGHLIGHTS: BoardHighlights = { vertices: new Set(), edges: new Set(), hexes: new Set() };

/** ヘックスの外接円の半径（SVG 座標） */
const S = 50;
const SQRT3_2 = Math.sqrt(3) / 2;

/** トポロジーの整数格子 (x, y) → SVG 座標 */
const px = (p: { x: number; y: number }): [number, number] => [p.x * S * SQRT3_2, (p.y * S) / 2];

const f = (n: number): string => n.toFixed(1);

/** 数字の出やすさの点（2・12 は1個、6・8 は5個） */
const pipCount = (n: number): number => 6 - Math.abs(7 - n);

export function renderBoard(view: PlayerView, highlights: BoardHighlights = NO_HIGHLIGHTS): string {
  const t = topologyFor(view.config);
  const verts = t.vertexPositions.map(px);
  const xs = verts.map((v) => v[0]);
  const ys = verts.map((v) => v[1]);
  const pad = S * 1.15;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  const out: string[] = [];
  out.push(
    `<svg class="board" viewBox="${f(minX)} ${f(minY)} ${f(w)} ${f(h)}" role="img" aria-label="ゲーム盤面" xmlns="http://www.w3.org/2000/svg">`,
  );

  // 海
  out.push(
    `<rect class="sea" x="${f(minX + 6)}" y="${f(minY + 6)}" width="${f(w - 12)}" height="${f(h - 12)}" rx="${S * 0.9}"/>`,
  );

  // 港（海から盤面へ桟橋を2本）
  view.board.ports.forEach((port) => out.push(renderPort(port, t.edgeVertices[port.edge]!, verts, cx, cy)));

  // 地形
  t.hexVertices.forEach((corners, hex) => {
    const pts = corners.map((v) => verts[v]!.map(f).join(',')).join(' ');
    const terrain = view.board.terrains[hex]!;
    out.push(
      `<polygon class="hex t-${terrain}" points="${pts}"><title>${TERRAIN_LABEL[terrain]}</title></polygon>`,
    );
  });

  // 数字チップと盗賊
  t.hexVertices.forEach((corners, hex) => {
    const [hx, hy] = center(corners.map((v) => verts[v]!));
    const n = view.board.numbers[hex];
    if (n !== null && n !== undefined) {
      const hot = n === 6 || n === 8 ? ' hot' : '';
      const dots = Array.from({ length: pipCount(n) }, (_, i) => {
        const dx = (i - (pipCount(n) - 1) / 2) * 4.2;
        return `<circle class="pip${hot}" cx="${f(hx + dx)}" cy="${f(hy + 9)}" r="1.5"/>`;
      }).join('');
      out.push(
        `<g class="token"><circle class="token-bg" cx="${f(hx)}" cy="${f(hy)}" r="16"/>` +
          `<text class="token-num${hot}" x="${f(hx)}" y="${f(hy + 3)}">${n}</text>${dots}</g>`,
      );
    }
    if (hex === view.robberHex) {
      const rx = hx + (n === null ? 0 : 20);
      out.push(
        `<g class="robber" aria-label="盗賊"><ellipse cx="${f(rx)}" cy="${f(hy + 12)}" rx="9" ry="3.5"/>` +
          `<path d="M${f(rx - 7)} ${f(hy + 11)} Q${f(rx - 8)} ${f(hy - 4)} ${f(rx)} ${f(hy - 6)} Q${f(rx + 8)} ${f(hy - 4)} ${f(rx + 7)} ${f(hy + 11)} Z"/>` +
          `<circle cx="${f(rx)}" cy="${f(hy - 11)}" r="5.5"/></g>`,
      );
    }
  });

  // 盗賊の移動先の候補
  t.hexVertices.forEach((corners, hex) => {
    if (!highlights.hexes.has(hex)) return;
    const pts = corners.map((v) => verts[v]!.map(f).join(',')).join(' ');
    out.push(`<polygon class="target hex-target" data-hex="${hex}" points="${pts}"><title>ここに盗賊を置く</title></polygon>`);
  });

  // 道
  view.roads.forEach((owner, edge) => {
    if (owner === null) return;
    const [a, b] = t.edgeVertices[edge]!.map((v) => verts[v]!);
    const [x1, y1, x2, y2] = shorten(a!, b!, 9);
    out.push(`<line class="road p${owner}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`);
  });

  // 道を置ける辺
  highlights.edges.forEach((edge) => {
    const [a, b] = t.edgeVertices[edge]!.map((v) => verts[v]!);
    const [x1, y1, x2, y2] = shorten(a!, b!, 10);
    out.push(
      `<line class="target edge-target" data-edge="${edge}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"><title>ここに道を置く</title></line>`,
    );
  });

  // 建物
  view.buildings.forEach((b, v) => {
    if (!b) return;
    const [x, y] = verts[v]!;
    out.push(b.kind === 'city' ? cityShape(x, y, b.owner) : settlementShape(x, y, b.owner));
  });

  // 建物を置ける頂点
  highlights.vertices.forEach((v) => {
    const [x, y] = verts[v]!;
    out.push(`<circle class="target vertex-target" data-vertex="${v}" cx="${f(x)}" cy="${f(y)}" r="10"><title>ここに建てる</title></circle>`);
  });

  out.push('</svg>');
  return out.join('');
}

function center(points: [number, number][]): [number, number] {
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return [sx / points.length, sy / points.length];
}

/** 線分の両端を d だけ縮める（道が建物に重ならないように） */
function shorten(a: [number, number], b: [number, number], d: number): [number, number, number, number] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  return [a[0] + ux * d, a[1] + uy * d, b[0] - ux * d, b[1] - uy * d];
}

function renderPort(
  port: Port,
  [va, vb]: readonly [number, number],
  verts: [number, number][],
  cx: number,
  cy: number,
): string {
  const a = verts[va]!;
  const b = verts[vb]!;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const len = Math.hypot(mx - cx, my - cy);
  const ox = mx + ((mx - cx) / len) * S * 0.62;
  const oy = my + ((my - cy) / len) * S * 0.62;
  const generic = port.kind === 'generic';
  const label = generic ? '3:1' : `2:1`;
  const sub = generic ? '' : `<text class="port-res" x="${f(ox)}" y="${f(oy + 10)}">${RESOURCE_SHORT[port.kind]}</text>`;
  return (
    `<g class="port${generic ? '' : ` port-${port.kind}`}">` +
    `<line class="pier" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(ox)}" y2="${f(oy)}"/>` +
    `<line class="pier" x1="${f(b[0])}" y1="${f(b[1])}" x2="${f(ox)}" y2="${f(oy)}"/>` +
    `<circle class="port-bg" cx="${f(ox)}" cy="${f(oy)}" r="15"/>` +
    `<text class="port-rate" x="${f(ox)}" y="${f(oy + (generic ? 3.5 : -1))}">${label}</text>${sub}</g>`
  );
}

function settlementShape(x: number, y: number, owner: number): string {
  const d = `M${f(x - 7)} ${f(y + 7)} V${f(y - 2)} L${f(x)} ${f(y - 9)} L${f(x + 7)} ${f(y - 2)} V${f(y + 7)} Z`;
  return `<path class="building p${owner}" d="${d}"><title>開拓地</title></path>`;
}

function cityShape(x: number, y: number, owner: number): string {
  const d =
    `M${f(x - 11)} ${f(y + 8)} V${f(y - 2)} L${f(x - 5)} ${f(y - 8)} L${f(x + 1)} ${f(y - 2)} ` +
    `V${f(y - 4)} H${f(x + 11)} V${f(y + 8)} Z`;
  return `<path class="building city p${owner}" d="${d}"><title>都市</title></path>`;
}
