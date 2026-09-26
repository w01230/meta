import { describe, it, expect } from 'vitest';
import {
  calculateOutboundDistribution,
  calculateProtocolDistribution,
  matchFlagForNodeName,
  stripLeadingFlag,
  formatMicroTimestamp
} from '../utils/allocation';
import { ConnectionItem } from '../types/api';

describe('allocation utilities', () => {
  const mockConnections: ConnectionItem[] = [
    {
      id: 'c1',
      metadata: { network: 'tcp', type: 'HTTP', sourceIP: '1.1.1.1', destinationIP: '2.2.2.2', sourcePort: '123', destinationPort: '80', host: 'example.com' },
      upload: 100,
      download: 200,
      start: new Date().toISOString(),
      chains: ['节点选择', 'HK 01'],
      rule: 'MATCH',
      rulePayload: ''
    },
    {
      id: 'c2',
      metadata: { network: 'tcp', type: 'HTTP', sourceIP: '1.1.1.1', destinationIP: '2.2.2.2', sourcePort: '124', destinationPort: '80', host: 'example.org' },
      upload: 100,
      download: 200,
      start: new Date().toISOString(),
      chains: ['国外媒体', 'SG 01'],
      rule: 'MATCH',
      rulePayload: ''
    },
    {
      id: 'c3',
      metadata: { network: 'udp', type: 'UDP', sourceIP: '1.1.1.1', destinationIP: '2.2.2.2', sourcePort: '125', destinationPort: '53', host: 'dns.google' },
      upload: 50,
      download: 50,
      start: new Date().toISOString(),
      chains: ['节点选择', 'HK 01'],
      rule: 'MATCH',
      rulePayload: ''
    },
    {
      id: 'c4',
      metadata: { network: 'tcp', type: 'HTTP', sourceIP: '1.1.1.1', destinationIP: '2.2.2.2', sourcePort: '126', destinationPort: '80', host: 'bilibili.com' },
      upload: 100,
      download: 200,
      start: new Date().toISOString(),
      chains: ['直连', 'DIRECT'],
      rule: 'GEOIP',
      rulePayload: 'CN'
    }
  ];

  describe('calculateOutboundDistribution', () => {
    it('returns demo distribution when demoMode is true', () => {
      const demoResult = calculateOutboundDistribution([], true);
      expect(demoResult).toHaveLength(4);
      expect(demoResult[0].name).toBe('直连');
      expect(demoResult[0].percentage).toBe(56);
      expect(demoResult[1].percentage).toBe(18);
    });

    it('returns empty array when connections is empty in real mode (honest empty track)', () => {
      const emptyResult = calculateOutboundDistribution([], false);
      expect(emptyResult).toEqual([]);
    });

    it('dynamically aggregates connection chains[0] in real mode', () => {
      const result = calculateOutboundDistribution(mockConnections, false);
      expect(result.length).toBeGreaterThan(0);
      const totalPct = result.reduce((sum, seg) => sum + seg.percentage, 0);
      expect(totalPct).toBe(100);

      // '节点选择' has 2 out of 4 (50%)
      const nodeSelect = result.find((s) => s.name === '节点选择');
      expect(nodeSelect).toBeDefined();
      expect(nodeSelect?.count).toBe(2);
      expect(nodeSelect?.percentage).toBe(50);
    });
  });

  describe('calculateProtocolDistribution', () => {
    it('returns demo protocol distribution in demo mode', () => {
      const demoResult = calculateProtocolDistribution([], true);
      expect(demoResult).toHaveLength(2);
      expect(demoResult[0].name).toBe('TCP');
      expect(demoResult[0].percentage).toBe(70);
      expect(demoResult[1].name).toBe('UDP');
      expect(demoResult[1].percentage).toBe(30);
    });

    it('returns empty array when real connections is empty (honest empty track)', () => {
      const emptyResult = calculateProtocolDistribution([], false);
      expect(emptyResult).toEqual([]);
    });

    it('aggregates real TCP vs UDP without fabricating DNS slices', () => {
      const result = calculateProtocolDistribution(mockConnections, false);
      expect(result).toHaveLength(2);
      // 3 TCP, 1 UDP -> total 4 -> 75% TCP, 25% UDP
      const tcpSeg = result.find((s) => s.name === 'TCP');
      const udpSeg = result.find((s) => s.name === 'UDP');
      expect(tcpSeg?.count).toBe(3);
      expect(tcpSeg?.percentage).toBe(75);
      expect(udpSeg?.count).toBe(1);
      expect(udpSeg?.percentage).toBe(25);
    });
  });

  describe('matchFlagForNodeName', () => {
    it('matches known region flags', () => {
      expect(matchFlagForNodeName('🇭🇰 香港 01 [IEPL 专线]')).toBe('🇭🇰');
      expect(matchFlagForNodeName('HK BGP')).toBe('🇭🇰');
      expect(matchFlagForNodeName('🇯🇵 日本东京 01')).toBe('🇯🇵');
      expect(matchFlagForNodeName('SG 01 狮城')).toBe('🇸🇬');
      expect(matchFlagForNodeName('US 洛杉矶 4K')).toBe('🇺🇸');
      expect(matchFlagForNodeName('德国法兰克福')).toBe('🇩🇪');
      expect(matchFlagForNodeName('英国伦敦')).toBe('🇬🇧');
      expect(matchFlagForNodeName('台湾台北')).toBe('🇹🇼');
      expect(matchFlagForNodeName('韩国首尔')).toBe('🇰🇷');
    });

    it('returns globe fallback for unlisted nodes', () => {
      expect(matchFlagForNodeName('DIRECT')).toBe('🌐');
      expect(matchFlagForNodeName('')).toBe('🌐');
      expect(matchFlagForNodeName(undefined)).toBe('🌐');
    });
  });

  describe('stripLeadingFlag', () => {
    it('strips leading flag emoji and space for display', () => {
      expect(stripLeadingFlag('🇭🇰 香港 01 [IEPL 专线]')).toBe('香港 01 [IEPL 专线]');
      expect(stripLeadingFlag('🇯🇵 日本 01 [软银 Direct]')).toBe('日本 01 [软银 Direct]');
      expect(stripLeadingFlag('🇸🇬 新加坡 01 [企业专线]')).toBe('新加坡 01 [企业专线]');
      expect(stripLeadingFlag('🇺🇸 美国 01 [Anycast 4K]')).toBe('美国 01 [Anycast 4K]');
    });

    it('leaves plain node names and direct untouched', () => {
      expect(stripLeadingFlag('DIRECT')).toBe('DIRECT');
      expect(stripLeadingFlag('国内直连')).toBe('国内直连');
      expect(stripLeadingFlag('香港 01')).toBe('香港 01');
      expect(stripLeadingFlag('')).toBe('');
      expect(stripLeadingFlag(undefined)).toBe('');
    });
  });

  describe('formatMicroTimestamp', () => {
    it('formats a date with padded digits', () => {
      const testDate = new Date(2026, 8, 26, 14, 5, 9); // Month is 0-indexed: 8 is September
      const formatted = formatMicroTimestamp(testDate);
      expect(formatted).toBe('2026.09.26 14:05:09');
    });
  });
});

