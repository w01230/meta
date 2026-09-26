/**
 * Format raw byte values into human readable units (B, KB, MB, GB, TB)
 */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i <= 0) return `${bytes} B`;
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`;
}

/**
 * Format network speed per second
 */
export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec === null || bytesPerSec === undefined || isNaN(bytesPerSec) || bytesPerSec <= 0) {
    return '0 B/s';
  }
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

/**
 * Format connection duration relative to start time
 */
export function formatDuration(startTime: string | number | Date): string {
  const startMs = typeof startTime === 'string' 
    ? new Date(startTime).getTime() 
    : typeof startTime === 'number' 
      ? startTime 
      : startTime.getTime();

  if (isNaN(startMs)) return '—';

  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - startMs) / 1000));

  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  const diffMin = Math.floor(diffSec / 60);
  const remainingSec = diffSec % 60;
  if (diffMin < 60) {
    return `${diffMin}m ${remainingSec}s`;
  }
  const diffHours = Math.floor(diffMin / 60);
  const remainingMin = diffMin % 60;
  return `${diffHours}h ${remainingMin}m`;
}

/**
 * Format timestamp to HH:mm:ss
 */
export function formatTime(timestamp?: string | number | Date): string {
  if (!timestamp) return '—';
  const d = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  if (isNaN(d.getTime())) return '—';
  return d.toTimeString().split(' ')[0];
}

export type LatencyLevel = 'fast' | 'medium' | 'slow' | 'timeout' | 'untested';

export interface LatencyInfo {
  level: LatencyLevel;
  text: string;
  className: string;
}

/**
 * Categorize latency in milliseconds for color badges
 */
export function getLatencyInfo(delay?: number): LatencyInfo {
  if (delay === undefined || delay === null) {
    return { level: 'untested', text: '未测速', className: 'latency-untested' };
  }
  if (delay <= 0) {
    return { level: 'timeout', text: '超时', className: 'latency-timeout' };
  }
  if (delay < 150) {
    return { level: 'fast', text: `${delay} ms`, className: 'latency-fast' };
  }
  if (delay < 350) {
    return { level: 'medium', text: `${delay} ms`, className: 'latency-medium' };
  }
  return { level: 'slow', text: `${delay} ms`, className: 'latency-slow' };
}

/**
 * Extract a concise version token (e.g. 'v1.19.3') from raw version strings
 * Handles:
 *  - 'v1.19.3' -> 'v1.19.3'
 *  - '1.19.3' -> 'v1.19.3'
 *  - 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2' -> 'v1.19.3'
 *  - 'Meta v1.19.3-alpha-abc' -> 'v1.19.3-alpha-abc'
 *  - missing/invalid/plain 'mihomo' -> null
 */
export function extractVersionToken(rawVersion?: string | null): string | null {
  if (!rawVersion || typeof rawVersion !== 'string') return null;
  const trimmed = rawVersion.trim();
  if (!trimmed) return null;

  // Match standard semantic version pattern like v1.19.3 or 1.19.3(-suffix)
  const semverMatch = trimmed.match(/\b(v?\d+\.\d+(?:\.\d+)?(?:-[\w.\-]+)?)\b/i);
  if (semverMatch) {
    const v = semverMatch[1];
    return v.startsWith('v') || v.startsWith('V') ? v : `v${v}`;
  }

  // Fallback: exclude common binary/brand tokens
  const tokens = trimmed.split(/\s+/).filter(
    (t) => !/^(mihomo|meta|clash|core)$/i.test(t)
  );

  return tokens[0] || null;
}
