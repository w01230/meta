import { describe, expect, it } from 'vitest';
import { getAdaptiveRateAxis, getTrafficTimeTicks } from '../utils/trafficAxis';

describe('getTrafficTimeTicks', () => {
  it('generates 45-second intervals and appends the exact five-minute endpoint', () => {
    const start = 1_000_000;
    const end = start + 300_000;
    const ticks = getTrafficTimeTicks(start, end);
    expect(ticks).toHaveLength(8);
    expect(ticks).toEqual([
      start, start + 45_000, start + 90_000, start + 135_000,
      start + 180_000, start + 225_000, start + 270_000, end,
    ]);
  });

  it('includes aligned endpoints once and safely handles degenerate ranges', () => {
    expect(getTrafficTimeTicks(0, 90_000)).toEqual([0, 45_000, 90_000]);
    expect(getTrafficTimeTicks(100, 100)).toEqual([100]);
    expect(getTrafficTimeTicks(200, 100)).toEqual([]);
    expect(getTrafficTimeTicks(Number.NaN, 100)).toEqual([]);
  });
});

describe('getAdaptiveRateAxis', () => {
  it('uses a minimum 1 KB/s axis for zero and very small peaks', () => {
    for (const peak of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE, 1, 50]) {
      const axis = getAdaptiveRateAxis(peak);
      expect(axis.maxBytesPerSecond).toBe(1024);
      expect(axis.unit).toBe('KB/s');
      expect(axis.ticks).toHaveLength(6);
      expect(axis.ticks.map(({ label }) => label)).toEqual([
        '0 KB/s', '0.2 KB/s', '0.4 KB/s', '0.6 KB/s', '0.8 KB/s', '1 KB/s',
      ]);
    }
  });

  it.each([
    [1024, 1024, 'KB/s'],
    [1025, 2 * 1024, 'KB/s'],
    [2 * 1024 + 1, 5 * 1024, 'KB/s'],
    [5 * 1024 + 1, 10 * 1024, 'KB/s'],
    [10 * 1024, 10 * 1024, 'KB/s'],
    [10 * 1024 + 1, 20 * 1024, 'KB/s'],
    [20 * 1024 + 1, 50 * 1024, 'KB/s'],
    [50 * 1024 + 1, 100 * 1024, 'KB/s'],
    [100 * 1024 + 1, 200 * 1024, 'KB/s'],
    [200 * 1024 + 1, 500 * 1024, 'KB/s'],
    [500 * 1024 + 1, 1024 * 1024, 'MB/s'],
    [1_200_000, 2 * 1024 * 1024, 'MB/s'],
    [2 * 1024 * 1024 + 1, 5 * 1024 * 1024, 'MB/s'],
    [200 * 1024 * 1024 + 1, 500 * 1024 * 1024, 'MB/s'],
    [500 * 1024 * 1024 + 1, 1024 * 1024 * 1024, 'GB/s'],
  ])('selects the smallest ladder bound for peak %i', (peak, expectedMax, expectedUnit) => {
    const axis = getAdaptiveRateAxis(peak);
    expect(axis.maxBytesPerSecond).toBe(expectedMax);
    expect(axis.unit).toBe(expectedUnit);
    expect(axis.maxBytesPerSecond).toBeGreaterThanOrEqual(peak);
    expect(axis.ticks.map(({ bytesPerSecond }) => bytesPerSecond)).toEqual(
      Array.from({ length: 6 }, (_, index) => (axis.maxBytesPerSecond / 5) * index),
    );
  });

  it('keeps headroom small when the peak is close to a ladder bound', () => {
    const peak = 1.99 * 1024 * 1024;
    const axis = getAdaptiveRateAxis(peak);
    expect(axis.unit).toBe('MB/s');
    expect(axis.maxBytesPerSecond).toBe(2 * 1024 * 1024);
    expect(axis.maxBytesPerSecond - peak).toBeLessThan(0.011 * 1024 * 1024);
  });

  it('uses consistent MB/s labels and scales beyond known unit names without clipping', () => {
    const megabytePeak = 1_200_000;
    const megabyteAxis = getAdaptiveRateAxis(megabytePeak);
    expect(megabyteAxis.unit).toBe('MB/s');
    expect(megabyteAxis.ticks[0].label).toBe('0 MB/s');
    expect(megabyteAxis.ticks[5].label).toBe('2 MB/s');

    const largePeak = 1e30;
    const largeAxis = getAdaptiveRateAxis(largePeak);
    expect(largeAxis.maxBytesPerSecond).toBeGreaterThanOrEqual(largePeak);
    expect(largeAxis.unit).toBe('1024^10 B/s');
    expect(largeAxis.ticks).toHaveLength(6);
  });
});
