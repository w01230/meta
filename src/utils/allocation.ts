import { ConnectionItem } from '../types/api';

export interface OutboundDistributionSegment {
  name: string;
  percentage: number;
  count: number;
  colorClass: string;
}

export interface ProtocolDistributionSegment {
  name: string;
  percentage: number;
  count: number;
  patternClass: string;
}

/**
 * Calculates outbound distribution based on real active connection chains[0] or demo preset.
 * When real mode has 0 active connections, returns an empty array to signal an honest empty track.
 */
export function calculateOutboundDistribution(
  connections: ConnectionItem[],
  isDemo: boolean
): OutboundDistributionSegment[] {
  if (isDemo) {
    return [
      { name: '直连', percentage: 56, count: 56, colorClass: 'segment-blue-solid' },
      { name: '专线', percentage: 18, count: 18, colorClass: 'segment-blue-sky' },
      { name: '媒体', percentage: 16, count: 16, colorClass: 'segment-blue-periwinkle' },
      { name: '其他', percentage: 10, count: 10, colorClass: 'segment-mint-tint' }
    ];
  }

  if (!connections || connections.length === 0) {
    return [];
  }

  const counts: Record<string, number> = {};
  for (const conn of connections) {
    const chainName = conn.chains?.[0] || '直连';
    counts[chainName] = (counts[chainName] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = connections.length;

  const colorPalette = [
    'segment-blue-solid',
    'segment-blue-sky',
    'segment-blue-periwinkle',
    'segment-mint-tint'
  ];

  // If 4 or fewer segments, map them directly
  if (sorted.length <= 4) {
    let accumulatedPct = 0;
    const segments: OutboundDistributionSegment[] = sorted.map(([name, count], idx) => {
      const isLast = idx === sorted.length - 1;
      const pct = isLast
        ? Math.max(1, 100 - accumulatedPct)
        : Math.round((count / total) * 100);
      accumulatedPct += pct;
      return {
        name,
        percentage: pct,
        count,
        colorClass: colorPalette[idx % colorPalette.length]
      };
    });
    return segments;
  }

  // Top 3 + Others
  const top3 = sorted.slice(0, 3);
  const othersCount = sorted.slice(3).reduce((sum, [, count]) => sum + count, 0);

  let accumulatedPct = 0;
  const segments: OutboundDistributionSegment[] = top3.map(([name, count], idx) => {
    const pct = Math.round((count / total) * 100);
    accumulatedPct += pct;
    return {
      name,
      percentage: pct,
      count,
      colorClass: colorPalette[idx]
    };
  });

  const othersPct = Math.max(1, 100 - accumulatedPct);
  segments.push({
    name: '其他',
    percentage: othersPct,
    count: othersCount,
    colorClass: colorPalette[3]
  });

  return segments;
}

/**
 * Calculates network protocol distribution (TCP vs UDP) based on real connections or demo preset.
 * When real mode has 0 active connections, returns an empty array to signal an honest empty track.
 * DNS is not a transport protocol in mihomo connection metadata; do not fabricate DNS slices.
 */
export function calculateProtocolDistribution(
  connections: ConnectionItem[],
  isDemo: boolean
): ProtocolDistributionSegment[] {
  if (isDemo) {
    return [
      { name: 'TCP', percentage: 70, count: 70, patternClass: 'pattern-dots-dark' },
      { name: 'UDP', percentage: 30, count: 30, patternClass: 'pattern-stripes-gray' }
    ];
  }

  if (!connections || connections.length === 0) {
    return [];
  }

  let tcpCount = 0;
  let udpCount = 0;
  let otherCount = 0;

  for (const conn of connections) {
    const net = (conn.metadata?.network || '').toLowerCase();
    if (net === 'tcp') {
      tcpCount++;
    } else if (net === 'udp') {
      udpCount++;
    } else {
      otherCount++;
    }
  }

  const total = connections.length;
  const segments: ProtocolDistributionSegment[] = [];

  if (otherCount === 0) {
    const tcpPct = Math.round((tcpCount / total) * 100);
    const udpPct = 100 - tcpPct;

    if (tcpCount > 0) {
      segments.push({
        name: 'TCP',
        percentage: tcpPct,
        count: tcpCount,
        patternClass: 'pattern-dots-dark'
      });
    }
    if (udpCount > 0) {
      segments.push({
        name: 'UDP',
        percentage: udpPct,
        count: udpCount,
        patternClass: 'pattern-stripes-gray'
      });
    }
    return segments;
  }

  const tcpPct = Math.round((tcpCount / total) * 100);
  const udpPct = Math.round((udpCount / total) * 100);
  const otherPct = Math.max(1, 100 - (tcpPct + udpPct));

  if (tcpCount > 0) {
    segments.push({
      name: 'TCP',
      percentage: tcpPct,
      count: tcpCount,
      patternClass: 'pattern-dots-dark'
    });
  }
  if (udpCount > 0) {
    segments.push({
      name: 'UDP',
      percentage: udpPct,
      count: udpCount,
      patternClass: 'pattern-stripes-gray'
    });
  }
  if (otherCount > 0) {
    segments.push({
      name: '其他',
      percentage: otherPct,
      count: otherCount,
      patternClass: 'pattern-hatch-light'
    });
  }

  return segments;
}

/**
 * Heuristically matches a country/region flag emoji based on proxy node name.
 * Purely frontend visual enhancement; does not alter API data.
 */
export function matchFlagForNodeName(nodeName?: string): string {
  if (!nodeName) return '🌐';
  const lower = nodeName.toLowerCase();

  if (lower.includes('香港') || lower.includes('hk') || lower.includes('hong kong')) {
    return '🇭🇰';
  }
  if (lower.includes('日本') || lower.includes('jp') || lower.includes('japan') || lower.includes('东京') || lower.includes('大阪')) {
    return '🇯🇵';
  }
  if (lower.includes('新加坡') || lower.includes('sg') || lower.includes('singapore') || lower.includes('狮城')) {
    return '🇸🇬';
  }
  if (lower.includes('美国') || lower.includes('us') || lower.includes('united states') || lower.includes('洛杉矶') || lower.includes('圣何塞') || lower.includes('纽约')) {
    return '🇺🇸';
  }
  if (lower.includes('德国') || lower.includes('de') || lower.includes('germany') || lower.includes('法兰克福')) {
    return '🇩🇪';
  }
  if (lower.includes('英国') || lower.includes('uk') || lower.includes('gb') || lower.includes('london') || lower.includes('伦敦')) {
    return '🇬🇧';
  }
  if (lower.includes('台湾') || lower.includes('tw') || lower.includes('taiwan') || lower.includes('台北')) {
    return '🇹🇼';
  }
  if (lower.includes('韩国') || lower.includes('kr') || lower.includes('korea') || lower.includes('首尔')) {
    return '🇰🇷';
  }
  if (lower.includes('澳大利亚') || lower.includes('澳洲') || lower.includes('au') || lower.includes('australia') || lower.includes('悉尼')) {
    return '🇦🇺';
  }
  if (lower.includes('加拿大') || lower.includes('ca') || lower.includes('canada')) {
    return '🇨🇦';
  }

  return '🌐';
}

/**
 * Strips leading flag emoji (and optional following space) from a node name for clean UI display,
 * preventing duplicate flag rendering when a flag avatar is already present.
 * Does not mutate the underlying node name used in API requests.
 */
export function stripLeadingFlag(name?: string): string {
  if (!name) return '';
  return name.replace(/^(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, '').trim() || name;
}

/**
 * Format a Date object to YYYY.MM.DD HH:mm:ss for micro-typography
 */
export function formatMicroTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}.${mm}.${dd} ${hh}:${min}:${ss}`;
}
