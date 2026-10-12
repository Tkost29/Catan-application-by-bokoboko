import { PLACEMENT_PRESETS, PLAY_PRESETS } from '@bokoboko/ai';
import { describe, expect, it } from 'vitest';
import { runGame } from '../src/runner.js';

const STANDARD = { placement: 'standard', play: 'standard' } as const;

describe('シミュレーション', () => {
  it('1試合で4席分の記録を返し、勝者は1人、特徴量の合計が合う', () => {
    const rows = runGame('t', 'sim-test', [STANDARD, { placement: 'oreWheat', play: 'city' }, STANDARD, STANDARD], 1);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.test).map((r) => r.seat)).toEqual([1]);
    expect(rows.filter((r) => r.outcome.win)).toHaveLength(1);
    for (const r of rows) {
      const { pips, totalPips, vertices } = r.features;
      expect(Object.values(pips).reduce((a, b) => a + b, 0)).toBe(totalPips);
      expect(new Set(vertices).size).toBe(2);
      expect(r.outcome.settlements + r.outcome.cities).toBeGreaterThanOrEqual(2);
    }
    const winner = rows.find((r) => r.outcome.win)!;
    expect(winner.outcome.vp).toBeGreaterThanOrEqual(10);
  });

  it('同じ盤面・同じ方針なら同じ結果になる（比較の前提）', () => {
    const strategies = [STANDARD, { placement: 'woodBrick', play: 'expand' } as const, STANDARD, STANDARD];
    expect(runGame('t', 'same', strategies, 1)).toEqual(runGame('t', 'same', strategies, 1));
  });

  it('すべての方針の組み合わせで試合が最後まで終わる', () => {
    for (const placement of Object.keys(PLACEMENT_PRESETS) as (keyof typeof PLACEMENT_PRESETS)[]) {
      for (const play of Object.keys(PLAY_PRESETS) as (keyof typeof PLAY_PRESETS)[]) {
        const rows = runGame('t', `all-${placement}-${play}`, [{ placement, play }, STANDARD, STANDARD, STANDARD], 0);
        expect(rows[0]!.unfinished, `${placement} × ${play}`).toBe(false);
      }
    }
  });
});
