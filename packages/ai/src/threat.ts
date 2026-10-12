import { RESOURCES, TERRAIN_RESOURCE, type PlayerView, type Resource, type ResourceCounts, type Seat } from '@bokoboko/engine';
import { pips, productionBySeat, topologyOf, visiblePoints } from './evaluate.js';

/**
 * 相手の「脅威度」と手札の中身の推定。すべて PlayerView（見える情報）だけから計算する。
 *
 * 脅威度 = 見えている勝利点
 *        + 生産力（出やすさの合計）
 *        + 自分の生産と合う 2:1 港（交換で資源を回せる見えない強さ）
 *        + 手元の発展カードの枚数（勝利点カードや騎士かもしれない）
 */

const W_PRODUCTION = 0.12;
const W_MATCHED_PORT = 0.6;
const W_GENERIC_PORT = 0.2;
const W_DEV_CARD = 0.35;

export function threatOf(view: PlayerView, seat: Seat): number {
  const topology = topologyOf(view);
  const prod = productionBySeat(view, seat);
  const total = RESOURCES.reduce((s, r) => s + prod[r], 0);

  let ports = 0;
  for (const port of view.board.ports) {
    const owns = topology.edgeVertices[port.edge]!.some((v) => view.buildings[v]?.owner === seat);
    if (!owns) continue;
    if (port.kind === 'generic') ports += W_GENERIC_PORT;
    else if (prod[port.kind] >= 4) ports += W_MATCHED_PORT;
  }

  const devCards =
    seat === view.seat ? view.me.devCards.length : (view.opponents.find((o) => o.seat === seat)?.devCardCount ?? 0);

  return visiblePoints(view, seat) + W_PRODUCTION * total + ports + W_DEV_CARD * devCards;
}

/** 全員の脅威度（index = Seat） */
export function threats(view: PlayerView): number[] {
  const n = view.opponents.length + 1;
  return Array.from({ length: n }, (_, seat) => threatOf(view, seat));
}

/**
 * 相手の中で突出しているか。
 * 一番脅威度の高い相手が、2番目の相手より gap 以上離れていれば、その差を返す（そうでなければ 0）。
 */
export function leaderGap(view: PlayerView, seat: Seat, all: readonly number[] = threats(view)): number {
  const others = view.opponents.map((o) => ({ seat: o.seat, t: all[o.seat]! })).sort((a, b) => b.t - a.t);
  if (others.length < 2 || others[0]!.seat !== seat) return 0;
  return others[0]!.t - others[1]!.t;
}

/**
 * 相手の手札の中身の推定（資源ごとの割合）。
 * 手札は生産から増えるので、生産の割合に比例すると見なす（どの資源も少しは持ちうるよう平滑化）。
 */
export function handShare(view: PlayerView, seat: Seat): Record<Resource, number> {
  const prod = productionBySeat(view, seat);
  const total = RESOURCES.reduce((s, r) => s + prod[r], 0);
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) out[r] = (prod[r] + 1) / (total + RESOURCES.length);
  return out;
}

/** 盤面全体で各資源がどれだけ出るか（希少な資源ほど止められると痛い） */
export function boardScarcity(view: PlayerView): Record<Resource, number> {
  const total: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  view.board.terrains.forEach((t, h) => {
    const r = TERRAIN_RESOURCE[t];
    if (r) total[r] += pips(view.board.numbers[h] ?? null);
  });
  const avg = RESOURCES.reduce((s, r) => s + total[r], 0) / RESOURCES.length;
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) out[r] = Math.sqrt(avg / Math.max(1, total[r]));
  return out;
}

/** 奪った1枚が、自分の足りない資源である確率の推定 */
export function usefulStealChance(view: PlayerView, victim: Seat, missing: Partial<ResourceCounts>): number {
  const share = handShare(view, victim);
  return RESOURCES.reduce((s, r) => s + ((missing[r] ?? 0) > 0 ? share[r] : 0), 0);
}
