const TIME_TICK_STEP_SECONDS = 45;
const BYTES_PER_KIBIBYTE = 1024;
const RATE_LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const;
const KNOWN_RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s', 'EB/s', 'ZB/s', 'YB/s'];

export interface RateAxisTick {
  /** Tick position in bytes per second. */
  bytesPerSecond: number;
  /** Human-readable value in the axis's consistent display unit. */
  label: string;
}

export interface AdaptiveRateAxis {
  /** Upper bound in bytes per second. */
  maxBytesPerSecond: number;
  /** Display unit shared by all tick labels. */
  unit: string;
  /** Number of bytes per display unit. */
  unitBytesPerSecond: number;
  /** Six ticks from zero through the maximum, evenly spaced in value. */
  ticks: RateAxisTick[];
}

/** Generate fixed-interval time ticks, always including the exact window end. */
export function getTrafficTimeTicks(
  startTime: number,
  endTime: number,
  stepSeconds = TIME_TICK_STEP_SECONDS,
): number[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  const safeStepSeconds = Number.isFinite(stepSeconds) && stepSeconds > 0
    ? stepSeconds
    : TIME_TICK_STEP_SECONDS;
  const stepMs = safeStepSeconds * 1000;
  if (!Number.isFinite(stepMs) || stepMs <= 0) return [startTime, endTime];

  const ticks: number[] = [];
  for (let index = 0; ; index++) {
    const tick = startTime + index * stepMs;
    if (!Number.isFinite(tick) || tick > endTime) break;
    if (ticks.length > 0 && tick <= ticks[ticks.length - 1]) break;
    ticks.push(tick);
  }
  if (ticks.length === 0 || ticks[ticks.length - 1] !== endTime) ticks.push(endTime);
  return ticks;
}

function formatAxisValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isFinite(rounded) ? String(rounded) : value.toPrecision(3);
}

/** Select a readable binary-rate scale without clipping finite input peaks. */
export function getAdaptiveRateAxis(peakBytesPerSecond: number): AdaptiveRateAxis {
  const peak = Number.isFinite(peakBytesPerSecond) && peakBytesPerSecond > 0
    ? peakBytesPerSecond
    : 0;
  let unitExponent = 1; // Low and zero peaks use a minimum 1 KB/s axis.
  let unitScale = BYTES_PER_KIBIBYTE;

  while (peak > 0 && peak / unitScale > RATE_LADDER[RATE_LADDER.length - 1]) {
    const nextScale = unitScale * BYTES_PER_KIBIBYTE;
    if (!Number.isFinite(nextScale)) break;
    unitScale = nextScale;
    unitExponent++;
  }

  let rung = RATE_LADDER.find((candidate) => peak / unitScale <= candidate) ?? RATE_LADDER[RATE_LADDER.length - 1];
  // For a peak too close to Number.MAX_VALUE, the next binary unit can overflow.
  // Use the peak itself as the bound in that case so no finite input is clipped.
  let maxBytesPerSecond = rung * unitScale;
  if (!Number.isFinite(maxBytesPerSecond) || maxBytesPerSecond < peak) {
    maxBytesPerSecond = peak;
    rung = peak / unitScale;
  }

  const unit = KNOWN_RATE_UNITS[unitExponent] ?? `1024^${unitExponent} B/s`;
  const ticks = Array.from({ length: 6 }, (_, index) => {
    const bytesPerSecond = index === 5 ? maxBytesPerSecond : (maxBytesPerSecond / 5) * index;
    const displayValue = bytesPerSecond / unitScale;
    return {
      bytesPerSecond,
      label: `${formatAxisValue(displayValue)} ${unit}`,
    };
  });

  return { maxBytesPerSecond, unit, unitBytesPerSecond: unitScale, ticks };
}
