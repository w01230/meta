import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed, formatDuration, getLatencyInfo, extractVersionToken } from '../utils/format';

describe('formatBytes', () => {
  it('formats zero or invalid bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
  });

  it('formats bytes in B, KB, MB, GB properly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('handles non-finite values and invalid decimal precision', () => {
    expect(formatBytes(Infinity)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(1536, Infinity)).toBe('1.5 KB');
    expect(formatBytes(1536, 1.5)).toBe('1.5 KB');
  });
});

describe('formatSpeed', () => {
  it('formats speed per second', () => {
    expect(formatSpeed(0)).toBe('0 B/s');
    expect(formatSpeed(2048)).toBe('2 KB/s');
    expect(formatSpeed(10485760)).toBe('10 MB/s');
  });
});

describe('formatDuration', () => {
  it('calculates duration string based on diff', () => {
    const now = Date.now();
    expect(formatDuration(now - 15000)).toBe('15s');
    expect(formatDuration(now - 125000)).toBe('2m 5s');
    expect(formatDuration(now - 7200000)).toBe('2h 0m');
  });

  it('returns a placeholder for missing or invalid runtime timestamps', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration('not a timestamp')).toBe('—');
    expect(formatDuration(Infinity)).toBe('—');
    expect(formatDuration({} as any)).toBe('—');
  });
});

describe('getLatencyInfo', () => {
  it('categorizes latency accurately', () => {
    expect(getLatencyInfo(undefined).level).toBe('untested');
    expect(getLatencyInfo(0).level).toBe('timeout');
    expect(getLatencyInfo(80).level).toBe('fast');
    expect(getLatencyInfo(220).level).toBe('medium');
    expect(getLatencyInfo(600).level).toBe('slow');
  });

  it('treats malformed and non-finite latency values as untested', () => {
    expect(getLatencyInfo(NaN).level).toBe('untested');
    expect(getLatencyInfo(Infinity).level).toBe('untested');
    expect(getLatencyInfo(-Infinity).level).toBe('untested');
    expect(getLatencyInfo('bad' as any).level).toBe('untested');
  });
});

describe('extractVersionToken', () => {
  it('extracts concise version from full mihomo string', () => {
    expect(extractVersionToken('mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3');
  });

  it('extracts standard semver directly', () => {
    expect(extractVersionToken('v1.18.0')).toBe('v1.18.0');
    expect(extractVersionToken('1.19.2')).toBe('v1.19.2');
    expect(extractVersionToken('v1.20.0-beta.1')).toBe('v1.20.0-beta.1');
  });

  it('avoids displaying meaningless single token mihomo or meta', () => {
    expect(extractVersionToken('mihomo')).toBe(null);
    expect(extractVersionToken('meta')).toBe(null);
  });

  it('handles null, undefined, and empty string', () => {
    expect(extractVersionToken(null)).toBe(null);
    expect(extractVersionToken(undefined)).toBe(null);
    expect(extractVersionToken('')).toBe(null);
    expect(extractVersionToken('   ')).toBe(null);
  });
});
