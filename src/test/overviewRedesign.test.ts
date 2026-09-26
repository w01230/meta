import { describe, expect, it } from 'vitest';
import type { TrafficTick } from '../types/api';
import { getAdaptiveRateAxis } from '../utils/trafficAxis';
import {
  getTrafficSampleX,
  selectTrafficWindow,
  splitTrafficSamplesAtGaps,
} from '../components/overview/TrafficRateChart';

describe('TrafficRateChart time-window helpers', () => {
  const now = 1_700_000_000_000;

  it('filters real timestamped samples against fixed 1, 5 and 15 minute windows', () => {
    const samples: TrafficTick[] = [
      { up: 1, down: 2, time: now - 16 * 60_000 },
      { up: 3, down: 4, time: now - 10 * 60_000 },
      { up: 5, down: 6, time: now - 5 * 60_000 },
      { up: 7, down: 8, time: now - 30_000 },
      { up: 9, down: 10, time: now },
      { up: 11, down: 12, time: now + 1 },
      { up: 13, down: 14 },
    ];

    expect(selectTrafficWindow(samples, 1, now).samples.map((sample) => sample.down)).toEqual([8, 10]);
    expect(selectTrafficWindow(samples, 5, now).samples.map((sample) => sample.down)).toEqual([6, 8, 10]);
    expect(selectTrafficWindow(samples, 15, now).samples.map((sample) => sample.down)).toEqual([4, 6, 8, 10]);
    expect(selectTrafficWindow(samples, 5, now).startTime).toBe(now - 5 * 60_000);
    expect(selectTrafficWindow(samples, 5, now).endTime).toBe(now);
  });

  it('drops an expired peak from the rate axis even when no new sample arrives', () => {
    const samples: TrafficTick[] = [
      { up: 0, down: 4 * 1024 * 1024, time: now - 5 * 60_000 + 500 },
      { up: 0, down: 900 * 1024, time: now - 1_000 },
    ];
    const axisAt = (time: number) => getAdaptiveRateAxis(
      Math.max(...selectTrafficWindow(samples, 5, time).samples.map(({ up, down }) => Math.max(up, down))),
    );

    expect(axisAt(now).maxBytesPerSecond).toBe(5 * 1024 * 1024);
    expect(axisAt(now + 1_000).maxBytesPerSecond).toBe(1024 * 1024);
  });

  it('maps sparse points to their real positions in the fixed window, not evenly by index', () => {
    const start = now - 5 * 60_000;
    const end = now;
    const plotLeft = 74;
    const plotWidth = 806;

    expect(getTrafficSampleX(start, start, end, plotLeft, plotWidth)).toBe(plotLeft);
    expect(getTrafficSampleX(start + 150_000, start, end, plotLeft, plotWidth)).toBe(plotLeft + plotWidth / 2);
    expect(getTrafficSampleX(end, start, end, plotLeft, plotWidth)).toBe(plotLeft + plotWidth);
    // Two samples close together stay close together on a five-minute axis.
    expect(getTrafficSampleX(start + 2_000, start, end, plotLeft, plotWidth) - plotLeft).toBeCloseTo(5.373, 2);
  });

  it('keeps isolated samples and breaks lines across long sampling interruptions', () => {
    const samples: TrafficTick[] = [
      { up: 10, down: 20, time: now - 20_000 },
      { up: 30, down: 40, time: now - 19_000 },
      { up: 50, down: 60, time: now - 1_000 },
      { up: 70, down: 80, time: now },
    ];
    const segments = splitTrafficSamplesAtGaps(samples);
    expect(segments.map((segment) => segment.length)).toEqual([2, 2]);
    expect(segments.flat()).toEqual(samples);

    const single = splitTrafficSamplesAtGaps([{ up: 100, down: 200, time: now }]);
    expect(single).toEqual([[{ up: 100, down: 200, time: now }]]);
    expect(single[0]).toHaveLength(1); // Rendered as an isolated measured dot, not an invented line.
  });
});
