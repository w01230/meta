import { describe, expect, it } from 'vitest';
import { getAdaptiveRateAxis, getTrafficTimeTicks } from '../utils/trafficAxis';

describe('getTrafficTimeTicks', () => {
  it.each([30, 60, 120, 300])('keeps eight evenly spaced ticks across a %i-second window', (spanSeconds) => {
    const start = 1_000_000;
    const end = start + spanSeconds * 1000;
    const ticks = getTrafficTimeTicks(start, end);
    expect(ticks).toHaveLength(8);
    expect(ticks[0]).toBe(start);
    expect(ticks[ticks.length - 1]).toBe(end);
    const intervals = ticks.slice(1).map((tick, index) => tick - ticks[index]);
    intervals.forEach((interval) => expect(interval).toBeCloseTo((end - start) / 7));
  });

  it('returns one tick for a zero span and safely handles invalid ranges or counts', () => {
    expect(getTrafficTimeTicks(100, 100)).toEqual([100]);
    expect(getTrafficTimeTicks(200, 100)).toEqual([]);
    expect(getTrafficTimeTicks(Number.NaN, 100)).toEqual([]);
    expect(getTrafficTimeTicks(0, 70_000, 0)).toHaveLength(8);
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
