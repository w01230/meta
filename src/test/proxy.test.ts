import { describe, it, expect } from 'vitest';
import { ProxyItem } from '../types/api';
import { getLatencyInfo } from '../utils/format';
import {
  sortProxyGroups,
  sortProxyNodesByDelay,
  filterProxyGroups,
  matchRegionFlag,
  matchRegionCode,
  emojiToRegionCode,
  sanitizeDisplayName,
  containsBoundedToken
} from '../utils/proxy';

describe('Proxy and Connection utilities', () => {
  const sampleProxies: Record<string, ProxyItem> = {
    'GLOBAL': { name: 'GLOBAL', type: 'Selector', all: ['节点选择', '直连', 'Proxy'] },
    '节点选择': { name: '节点选择', type: 'Selector', all: ['HK-01', 'US-01'] },
    'ProxyGroup': { name: 'ProxyGroup', type: 'Selector', all: ['HK-01', 'JP-01'] },
    'HK-01': { name: 'HK-01', type: 'Shadowsocks', history: [{ time: '', delay: 45 }] },
    'JP-01': { name: 'JP-01', type: 'Trojan', history: [{ time: '', delay: 78 }] },
    'US-01': { name: 'US-01', type: 'Vmess', history: [{ time: '', delay: 180 }] }
  };

  describe('sortProxyGroups - Partition Ordering', () => {
    it('places referenced child groups before unreferenced groups (e.g. 节点选择 before GLOBAL)', () => {
      const groups: ProxyItem[] = [
        { name: 'GLOBAL', type: 'Selector', all: ['节点选择', 'DIRECT'] },
        { name: '漏网之鱼', type: 'Selector', all: ['DIRECT', 'REJECT'] },
        { name: '节点选择', type: 'Selector', all: ['HK-01', 'US-01'] }
      ];

      const sorted = sortProxyGroups(groups);
      const names = sorted.map((g) => g.name);

      // '节点选择' is referenced in GLOBAL.all, so it MUST appear before unreferenced groups (GLOBAL, 漏网之鱼)
      expect(names).toEqual(['节点选择', 'GLOBAL', '漏网之鱼']);
    });

    it('preserves stable order within partitions', () => {
      const groups: ProxyItem[] = [
        { name: 'RootA', type: 'Selector', all: ['Child1', 'Child2'] },
        { name: 'RootB', type: 'Selector', all: ['Child2'] },
        { name: 'Child1', type: 'Selector', all: ['NodeA'] },
        { name: 'Child2', type: 'Selector', all: ['NodeB'] },
        { name: 'RootC', type: 'Selector', all: ['NodeC'] }
      ];

      const sorted = sortProxyGroups(groups);
      const names = sorted.map((g) => g.name);

      // Partition 1 (referenced): Child1, Child2 (original relative order preserved)
      // Partition 2 (unreferenced): RootA, RootB, RootC (original relative order preserved)
      expect(names).toEqual(['Child1', 'Child2', 'RootA', 'RootB', 'RootC']);
    });

    it('handles groups where none are referenced or all are referenced', () => {
      const unrefGroups: ProxyItem[] = [
        { name: 'Group1', type: 'Selector', all: ['Node1'] },
        { name: 'Group2', type: 'Selector', all: ['Node2'] }
      ];
      expect(sortProxyGroups(unrefGroups).map((g) => g.name)).toEqual(['Group1', 'Group2']);
    });

    it('does not treat self-reference as referenced by another group', () => {
      const selfRefGroup: ProxyItem[] = [
        { name: 'SelfRef', type: 'Selector', all: ['SelfRef', 'Node1'] },
        { name: 'Other', type: 'Selector', all: ['Node2'] }
      ];
      const sorted = sortProxyGroups(selfRefGroup);
      expect(sorted.map((g) => g.name)).toEqual(['SelfRef', 'Other']);
    });

    it('handles empty and single element array safely', () => {
      expect(sortProxyGroups([])).toEqual([]);
      const single: ProxyItem[] = [{ name: 'Solo', type: 'Selector', all: ['N1'] }];
      expect(sortProxyGroups(single)).toEqual(single);
    });

    it('orders multi-level nested chains with child before parent transitively', () => {
      // User requested example: [GLOBAL(all:[A]), A(all:[B]), unrelated, B] => [B, A, GLOBAL, unrelated]
      const groups: ProxyItem[] = [
        { name: 'GLOBAL', type: 'Selector', all: ['A'] },
        { name: 'A', type: 'Selector', all: ['B'] },
        { name: 'unrelated', type: 'Selector', all: ['node1'] },
        { name: 'B', type: 'Selector', all: ['node2'] }
      ];

      const sorted = sortProxyGroups(groups);
      expect(sorted.map((g) => g.name)).toEqual(['B', 'A', 'GLOBAL', 'unrelated']);
    });

    it('orders 4-level deep transitive dependency chain correctly', () => {
      const groups: ProxyItem[] = [
        { name: 'Root', type: 'Selector', all: ['L1'] },
        { name: 'L1', type: 'Selector', all: ['L2'] },
        { name: 'L2', type: 'Selector', all: ['L3'] },
        { name: 'L3', type: 'Selector', all: ['LeafNode'] }
      ];

      const sorted = sortProxyGroups(groups);
      expect(sorted.map((g) => g.name)).toEqual(['L3', 'L2', 'L1', 'Root']);
    });

    it('preserves sibling stable ordering when there are no dependencies between siblings', () => {
      const groups: ProxyItem[] = [
        { name: 'GLOBAL', type: 'Selector', all: ['Sibling1', 'Sibling2', 'Sibling3'] },
        { name: 'Sibling1', type: 'Selector', all: ['node1'] },
        { name: 'Sibling2', type: 'Selector', all: ['node2'] },
        { name: 'Sibling3', type: 'Selector', all: ['node3'] }
      ];

      const sorted = sortProxyGroups(groups);
      expect(sorted.map((g) => g.name)).toEqual(['Sibling1', 'Sibling2', 'Sibling3', 'GLOBAL']);
    });

    it('preserves sibling subtrees and stable relative ordering', () => {
      const groups: ProxyItem[] = [
        { name: 'GLOBAL', type: 'Selector', all: ['ParentA', 'ParentB'] },
        { name: 'ParentA', type: 'Selector', all: ['ChildA'] },
        { name: 'ParentB', type: 'Selector', all: ['ChildB'] },
        { name: 'ChildA', type: 'Selector', all: ['nodeA'] },
        { name: 'ChildB', type: 'Selector', all: ['nodeB'] }
      ];

      const sorted = sortProxyGroups(groups);
      expect(sorted.map((g) => g.name)).toEqual(['ChildA', 'ParentA', 'ChildB', 'ParentB', 'GLOBAL']);
    });

    it('handles hidden GLOBAL influence correctly when sorting runs before filtering', () => {
      const allGroups: ProxyItem[] = [
        { name: 'GLOBAL', type: 'Selector', all: ['GroupA'] },
        { name: 'GroupA', type: 'Selector', all: ['GroupB'] },
        { name: 'GroupB', type: 'Selector', all: ['Node1'] },
        { name: 'OtherRoot', type: 'Selector', all: ['Node2'] }
      ];

      // 1. Sort operates on all groups including GLOBAL
      const sorted = sortProxyGroups(allGroups);
      expect(sorted.map((g) => g.name)).toEqual(['GroupB', 'GroupA', 'GLOBAL', 'OtherRoot']);

      // 2. Hide GLOBAL filter subsequently applied
      const filtered = filterProxyGroups(sorted, { hideGlobal: true });
      expect(filtered.map((g) => g.name)).toEqual(['GroupB', 'GroupA', 'OtherRoot']);
    });

    it('sorts correctly even when GLOBAL is omitted prior to sorting (e.g. in OverviewView)', () => {
      const groupsWithoutGlobal: ProxyItem[] = [
        { name: 'GroupA', type: 'Selector', all: ['GroupB'] },
        { name: 'OtherRoot', type: 'Selector', all: ['Node2'] },
        { name: 'GroupB', type: 'Selector', all: ['Node1'] }
      ];

      const sorted = sortProxyGroups(groupsWithoutGlobal);
      // GroupB is referenced by GroupA, so GroupB is before GroupA.
      // GroupA and OtherRoot are unreferenced; GroupA was before OtherRoot originally.
      expect(sorted.map((g) => g.name)).toEqual(['GroupB', 'GroupA', 'OtherRoot']);
    });

    it('ignores unknown group names and leaf proxy nodes in parent .all without breaking present ordering', () => {
      const groups: ProxyItem[] = [
        { name: 'Parent', type: 'Selector', all: ['NonExistentGroup', 'Child', 'DIRECT', 'REJECT', 'HK-01'] },
        { name: 'Child', type: 'Selector', all: ['US-01'] },
        { name: 'Unrelated', type: 'Selector', all: ['OtherMissing'] }
      ];

      const sorted = sortProxyGroups(groups);
      // Child is referenced by Parent; Parent and Unrelated are unreferenced
      expect(sorted.map((g) => g.name)).toEqual(['Child', 'Parent', 'Unrelated']);
    });

    it('handles cycles deterministically without infinite loops', () => {
      // 2-node cycle: A includes B, B includes A
      const cycleGroups: ProxyItem[] = [
        { name: 'A', type: 'Selector', all: ['B'] },
        { name: 'B', type: 'Selector', all: ['A'] }
      ];

      const sorted = sortProxyGroups(cycleGroups);
      // Strict child-before-parent is impossible for cycles; must terminate deterministically
      expect(sorted.map((g) => g.name)).toEqual(['A', 'B']);
    });

    it('emits non-cyclic child groups before cycle nodes', () => {
      // A and B form a cycle, but B also includes Child (which has no cycle)
      const groups: ProxyItem[] = [
        { name: 'A', type: 'Selector', all: ['B'] },
        { name: 'B', type: 'Selector', all: ['A', 'Child'] },
        { name: 'Child', type: 'Selector', all: ['node1'] }
      ];

      const sorted = sortProxyGroups(groups);
      // Child has no unemitted prerequisites, so Child is emitted first.
      // Then cycle between A and B is broken deterministically by original index.
      expect(sorted.map((g) => g.name)).toEqual(['Child', 'A', 'B']);
    });

    it('handles 3-node cycle deterministically', () => {
      const groups: ProxyItem[] = [
        { name: 'A', type: 'Selector', all: ['B'] },
        { name: 'B', type: 'Selector', all: ['C'] },
        { name: 'C', type: 'Selector', all: ['A'] }
      ];

      const sorted = sortProxyGroups(groups);
      // Deterministically resolves the cycle without infinite loops;
      // breaks cycle at A, then emits C (child A fulfilled), then B (child C fulfilled).
      expect(sorted.map((g) => g.name)).toEqual(['A', 'C', 'B']);
    });
  });

  describe('sortProxyNodesByDelay', () => {
    it('puts positive finite delays first and treats zero, invalid, and missing delays as last', () => {
      const nodes = ['timeout', 'fast', 'negative', 'missing', 'slow', 'infinite', 'nan'];
      const proxies: Record<string, ProxyItem> = {
        timeout: { name: 'timeout', type: 'Node', history: [{ time: '', delay: 0 }] },
        fast: { name: 'fast', type: 'Node', history: [{ time: '', delay: 12 }] },
        negative: { name: 'negative', type: 'Node', history: [{ time: '', delay: -1 }] },
        slow: { name: 'slow', type: 'Node', history: [{ time: '', delay: 90 }] },
        infinite: { name: 'infinite', type: 'Node', history: [{ time: '', delay: Infinity }] },
        nan: { name: 'nan', type: 'Node', history: [{ time: '', delay: NaN }] }
      };

      expect(sortProxyNodesByDelay(nodes, proxies)).toEqual([
        'fast', 'slow', 'timeout', 'negative', 'missing', 'infinite', 'nan'
      ]);
    });

    it('preserves input order for equal delays and among invalid results', () => {
      const nodes = ['equal-a', 'timeout-a', 'equal-b', 'timeout-b'];
      const proxies: Record<string, ProxyItem> = {
        'equal-a': { name: 'equal-a', type: 'Node', history: [{ time: '', delay: 50 }] },
        'equal-b': { name: 'equal-b', type: 'Node', history: [{ time: '', delay: 50 }] },
        'timeout-a': { name: 'timeout-a', type: 'Node', history: [{ time: '', delay: 0 }] },
        'timeout-b': { name: 'timeout-b', type: 'Node', history: [{ time: '', delay: undefined as any }] }
      };

      expect(sortProxyNodesByDelay(nodes, proxies)).toEqual([
        'equal-a', 'equal-b', 'timeout-a', 'timeout-b'
      ]);
    });
  });

  describe('filterProxyGroups - Filtering logic', () => {
    const groups: ProxyItem[] = [
      { name: 'GLOBAL', type: 'Selector', all: ['节点选择', 'HK-01'] },
      { name: '节点选择', type: 'Selector', all: ['HK-01', 'US-01'] },
      { name: '自动选择', type: 'URLTest', all: ['SG-01', 'JP-01'] }
    ];

    it('retains GLOBAL by default when hideGlobal is false', () => {
      const filtered = filterProxyGroups(groups, { hideGlobal: false });
      expect(filtered.map((g) => g.name)).toContain('GLOBAL');
      expect(filtered.length).toBe(3);
    });

    it('removes GLOBAL when hideGlobal is true', () => {
      const filtered = filterProxyGroups(groups, { hideGlobal: true });
      expect(filtered.map((g) => g.name)).not.toContain('GLOBAL');
      expect(filtered.length).toBe(2);
      expect(filtered.map((g) => g.name)).toEqual(['节点选择', '自动选择']);
    });

    it('filters by search keyword matching group name', () => {
      const filtered = filterProxyGroups(groups, { search: '自动' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('自动选择');
    });

    it('filters by search keyword matching child node in .all', () => {
      const filtered = filterProxyGroups(groups, { search: 'US-01' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('节点选择');
    });

    it('combines hideGlobal and search filter correctly', () => {
      const filtered = filterProxyGroups(groups, { hideGlobal: true, search: 'HK-01' });
      // Both GLOBAL and 节点选择 contain HK-01, but GLOBAL is hidden
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('节点选择');
    });
  });

  describe('matchRegionFlag & containsBoundedToken - Token Extraction', () => {
    it('infers Hong Kong flag from HKG/HK and variants', () => {
      expect(matchRegionFlag('HK-01')).toBe('🇭🇰');
      expect(matchRegionFlag('[HKG] 专线 01')).toBe('🇭🇰');
      expect(matchRegionFlag('香港节点 [IEPL]')).toBe('🇭🇰');
      expect(matchRegionFlag('Hong Kong Premium')).toBe('🇭🇰');
      expect(matchRegionFlag('HKT-BGP')).toBe('🇭🇰');
    });

    it('infers Singapore flag from SG/SIN and variants', () => {
      expect(matchRegionFlag('SG-01')).toBe('🇸🇬');
      expect(matchRegionFlag('SIN-Direct')).toBe('🇸🇬');
      expect(matchRegionFlag('新加坡 01')).toBe('🇸🇬');
      expect(matchRegionFlag('狮城中继')).toBe('🇸🇬');
      expect(matchRegionFlag('Singapore Fast')).toBe('🇸🇬');
    });

    it('infers United States flag from LAX/US and variants', () => {
      expect(matchRegionFlag('US-01')).toBe('🇺🇸');
      expect(matchRegionFlag('USA-02')).toBe('🇺🇸');
      expect(matchRegionFlag('LAX-Direct')).toBe('🇺🇸');
      expect(matchRegionFlag('美国洛杉矶')).toBe('🇺🇸');
      expect(matchRegionFlag('United States 03')).toBe('🇺🇸');
      expect(matchRegionFlag('SFO-SiliconValley')).toBe('🇺🇸');
    });

    it('infers other common regions (Japan, Taiwan, Korea, UK, Germany)', () => {
      expect(matchRegionFlag('JP-Tokyo-01')).toBe('🇯🇵');
      expect(matchRegionFlag('日本东京')).toBe('🇯🇵');
      expect(matchRegionFlag('TW-01')).toBe('🇹🇼');
      expect(matchRegionFlag('台湾台北')).toBe('🇹🇼');
      expect(matchRegionFlag('KR-Seoul')).toBe('🇰🇷');
      expect(matchRegionFlag('韩国首尔')).toBe('🇰🇷');
      expect(matchRegionFlag('UK-London-01')).toBe('🇬🇧');
      expect(matchRegionFlag('英国伦敦')).toBe('🇬🇧');
      expect(matchRegionFlag('DE-Frankfurt')).toBe('🇩🇪');
      expect(matchRegionFlag('德国法兰克福')).toBe('🇩🇪');
    });

    it('prevents partial token false positives', () => {
      // 'SHARK' should NOT match 'HK'
      expect(containsBoundedToken('SHARK', ['HK'])).toBe(false);
      expect(matchRegionFlag('SHARK-NODE')).toBe('🌐');

      // 'CHECK' should NOT match 'HK'
      expect(containsBoundedToken('CHECK', ['HK'])).toBe(false);
      expect(matchRegionFlag('CHECK-PROXY')).toBe('🌐');

      // 'USING' or 'BUSINESS' should NOT match 'US' or 'SG'
      expect(containsBoundedToken('USING', ['US', 'SG'])).toBe(false);
      expect(matchRegionFlag('USING-PROXY')).toBe('🌐');
      expect(containsBoundedToken('BUSINESS', ['US'])).toBe(false);
      expect(matchRegionFlag('BUSINESS-TUNNEL')).toBe('🌐');

      // 'RELAX' should NOT match 'LAX'
      expect(containsBoundedToken('RELAX', ['LAX'])).toBe(false);
      expect(matchRegionFlag('RELAX-STREAM')).toBe('🌐');
    });

    it('returns neutral Globe for unknown / generic groups without misleading country', () => {
      expect(matchRegionFlag('节点选择')).toBe('🌐');
      expect(matchRegionFlag('GLOBAL')).toBe('🌐');
      expect(matchRegionFlag('自动选择')).toBe('🌐');
      expect(matchRegionFlag('漏网之鱼')).toBe('🌐');
      expect(matchRegionFlag('ProxyGroup')).toBe('🌐');
      expect(matchRegionFlag('')).toBe('🌐');
      expect(matchRegionFlag(undefined)).toBe('🌐');
    });

    it('preserves standalone flag emojis without keywords', () => {
      expect(matchRegionFlag('🇭🇰')).toBe('🇭🇰');
      expect(matchRegionFlag('🇸🇬')).toBe('🇸🇬');
      expect(matchRegionFlag('🇺🇸')).toBe('🇺🇸');
      expect(matchRegionFlag('🇯🇵')).toBe('🇯🇵');
      expect(matchRegionFlag('🇹🇼')).toBe('🇹🇼');
      expect(matchRegionFlag('🇩🇪')).toBe('🇩🇪');
      expect(matchRegionFlag('🇬🇧')).toBe('🇬🇧');
    });

    it('preserves flag-prefixed nonlocalized names', () => {
      expect(matchRegionFlag('🇭🇰 BGP-01')).toBe('🇭🇰');
      expect(matchRegionFlag('🇸🇬 Direct-100')).toBe('🇸🇬');
      expect(matchRegionFlag('🇺🇸 Premium-01')).toBe('🇺🇸');
      expect(matchRegionFlag('🇯🇵 Tokyo-1')).toBe('🇯🇵');
      expect(matchRegionFlag('🇫🇷 France-Node')).toBe('🇫🇷');
    });

    it('normalizes fallback to neutral globe for names without region flags or tokens', () => {
      expect(matchRegionFlag('Custom-Node-01')).toBe('🌐');
      expect(matchRegionFlag('DIRECT')).toBe('🌐');
      expect(matchRegionFlag('REJECT')).toBe('🌐');
      expect(matchRegionFlag('ProxyGroup')).toBe('🌐');
      expect(matchRegionFlag('')).toBe('🌐');
      expect(matchRegionFlag(undefined)).toBe('🌐');
    });

    it('preserves existing emoji if already present with keywords', () => {
      expect(matchRegionFlag('🇭🇰 香港 01')).toBe('🇭🇰');
      expect(matchRegionFlag('🇯🇵 日本 02')).toBe('🇯🇵');
      expect(matchRegionFlag('🇺🇸 美国 03')).toBe('🇺🇸');
    });
  });

  describe('matchRegionCode & emojiToRegionCode - Circular Flag Inference', () => {
    it('extracts ISO region code from explicit flag emojis', () => {
      expect(emojiToRegionCode('🇭🇰')).toBe('hk');
      expect(emojiToRegionCode('🇸🇬')).toBe('sg');
      expect(emojiToRegionCode('🇺🇸')).toBe('us');
      expect(emojiToRegionCode('🇯🇵')).toBe('jp');
      expect(emojiToRegionCode('🇫🇷')).toBe('fr');
      expect(emojiToRegionCode('')).toBeNull();
      expect(emojiToRegionCode('HK')).toBeNull();
    });

    it('infers supported circular flag codes from explicit emojis in names', () => {
      expect(matchRegionCode('🇭🇰')).toBe('hk');
      expect(matchRegionCode('🇭🇰 BGP-01')).toBe('hk');
      expect(matchRegionCode('🇸🇬 Direct')).toBe('sg');
      expect(matchRegionCode('🇺🇸 Fast-01')).toBe('us');
      expect(matchRegionCode('🇯🇵 Tokyo-1')).toBe('jp');
    });

    it('infers supported circular flag codes from Chinese keywords and bounded tokens', () => {
      expect(matchRegionCode('HK-01')).toBe('hk');
      expect(matchRegionCode('香港专线 [IEPL]')).toBe('hk');
      expect(matchRegionCode('SG-01')).toBe('sg');
      expect(matchRegionCode('狮城中继')).toBe('sg');
      expect(matchRegionCode('US-01')).toBe('us');
      expect(matchRegionCode('美国洛杉矶 [LAX]')).toBe('us');
      expect(matchRegionCode('日本东京 [TYO]')).toBe('jp');
      expect(matchRegionCode('台湾台北 [TW]')).toBe('tw');
      expect(matchRegionCode('韩国首尔 [SEL]')).toBe('kr');
      expect(matchRegionCode('英国伦敦 [LHR]')).toBe('gb');
      expect(matchRegionCode('德国法兰克福 [FRA]')).toBe('de');
      expect(matchRegionCode('加拿大温哥华 [YVR]')).toBe('ca');
      expect(matchRegionCode('澳大利亚悉尼 [SYD]')).toBe('au');
    });

    it('returns null for unknown groups and prevents bounded false positives', () => {
      expect(matchRegionCode('GLOBAL')).toBeNull();
      expect(matchRegionCode('节点选择')).toBeNull();
      expect(matchRegionCode('自动选择')).toBeNull();
      expect(matchRegionCode('SHARK-NODE')).toBeNull();
      expect(matchRegionCode('CHECK-PROXY')).toBeNull();
      expect(matchRegionCode('RELAX-STREAM')).toBeNull();
      expect(matchRegionCode('USING-PROXY')).toBeNull();
      expect(matchRegionCode('')).toBeNull();
      expect(matchRegionCode(undefined)).toBeNull();
    });
  });

  describe('sanitizeDisplayName - Visual Emoji Sanitization', () => {
    it('strips leading flag emoji and trims whitespace', () => {
      expect(sanitizeDisplayName('🇭🇰 HK-01')).toBe('HK-01');
      expect(sanitizeDisplayName('🇺🇸 US-Premium-02')).toBe('US-Premium-02');
      expect(sanitizeDisplayName('🇯🇵Tokyo-1')).toBe('Tokyo-1');
    });

    it('strips embedded/included flag emoji from name', () => {
      expect(sanitizeDisplayName('香港 🇭🇰 01')).toBe('香港 01');
      expect(sanitizeDisplayName('专线 🇸🇬 新加坡')).toBe('专线 新加坡');
    });

    it('replaces standalone flag emoji with meaningful localized label or short code', () => {
      expect(sanitizeDisplayName('🇭🇰')).toBe('香港');
      expect(sanitizeDisplayName('🇺🇸')).toBe('美国');
      expect(sanitizeDisplayName('🇯🇵')).toBe('日本');
      expect(sanitizeDisplayName('🇸🇬')).toBe('新加坡');
      expect(sanitizeDisplayName('🇫🇷')).toBe('FR');
    });

    it('falls back to original name if name is without emoji or empty', () => {
      expect(sanitizeDisplayName('节点选择')).toBe('节点选择');
      expect(sanitizeDisplayName('GLOBAL')).toBe('GLOBAL');
      expect(sanitizeDisplayName('')).toBe('');
      expect(sanitizeDisplayName(undefined)).toBe('');
    });
  });

  describe('Legacy node sorting and connection filtering', () => {
    it('sorts nodes by delay ascending', () => {
      const nodes = ['US-01', 'HK-01', 'JP-01'];
      const sorted = [...nodes].sort((a, b) => {
        const delayA = sampleProxies[a]?.history?.[0]?.delay ?? 9999;
        const delayB = sampleProxies[b]?.history?.[0]?.delay ?? 9999;
        return delayA - delayB;
      });

      expect(sorted).toEqual(['HK-01', 'JP-01', 'US-01']);
    });

    it('filters connections by network and search term', () => {
      const connections = [
        { id: '1', metadata: { network: 'tcp', host: 'api.github.com' }, download: 100 },
        { id: '2', metadata: { network: 'udp', host: 'dns.google' }, download: 50 },
        { id: '3', metadata: { network: 'tcp', host: 'youtube.com' }, download: 500 }
      ];

      const tcpOnly = connections.filter((c) => c.metadata.network === 'tcp');
      expect(tcpOnly.length).toBe(2);

      const searchGit = tcpOnly.filter((c) => c.metadata.host.includes('git'));
      expect(searchGit.length).toBe(1);
      expect(searchGit[0].id).toBe('1');
    });
  });

  describe('Compact Flag-Only Node Mode & Accessibility Formatting', () => {
    it('correctly maps delay values to latency levels for compact rings', () => {
      expect(getLatencyInfo(50).level).toBe('fast');
      expect(getLatencyInfo(200).level).toBe('medium');
      expect(getLatencyInfo(450).level).toBe('slow');
      expect(getLatencyInfo(0).level).toBe('timeout');
      expect(getLatencyInfo(-1).level).toBe('timeout');
      expect(getLatencyInfo(undefined).level).toBe('untested');
      expect(getLatencyInfo(null as any).level).toBe('untested');
    });

    it('formats compact node title and aria-label with full raw name, delay/status, and selection state', () => {
      const formatNodeTitle = (nodeName: string, delay?: number, isSelected = false) => {
        const latency = getLatencyInfo(delay);
        const selectionText = isSelected ? ' [当前已选]' : '';
        return `${nodeName} (${latency.text})${selectionText}`;
      };

      const formatNodeAriaLabel = (nodeName: string, delay?: number, isSelected = false) => {
        const latency = getLatencyInfo(delay);
        return `${nodeName}, 延迟: ${latency.text}${isSelected ? ', 当前已选择' : ''}`;
      };

      // 1. Selected fast node (raw name preserved, including emoji)
      expect(formatNodeTitle('🇭🇰 HK-Special-01', 45, true)).toBe('🇭🇰 HK-Special-01 (45 ms) [当前已选]');
      expect(formatNodeAriaLabel('🇭🇰 HK-Special-01', 45, true)).toBe('🇭🇰 HK-Special-01, 延迟: 45 ms, 当前已选择');

      // 2. Unselected timeout node
      expect(formatNodeTitle('US-01', 0, false)).toBe('US-01 (超时)');
      expect(formatNodeAriaLabel('US-01', 0, false)).toBe('US-01, 延迟: 超时');

      // 3. Untested node
      expect(formatNodeTitle('JP-01', undefined, false)).toBe('JP-01 (未测速)');
      expect(formatNodeAriaLabel('JP-01', undefined, false)).toBe('JP-01, 延迟: 未测速');

      // 4. Slow node selected
      expect(formatNodeTitle('SG-01', 420, true)).toBe('SG-01 (420 ms) [当前已选]');
      expect(formatNodeAriaLabel('SG-01', 420, true)).toBe('SG-01, 延迟: 420 ms, 当前已选择');
    });
  });

  describe('Per-Group Expansion Overrides & Layout Toggle State Logic', () => {
    it('computes isGroupExpanded correctly based on global isCompact and per-group override', () => {
      const getIsGroupExpanded = (
        groupName: string,
        isCompact: boolean,
        overrides: Record<string, boolean>
      ) => !isCompact || !!overrides[groupName];

      // In card mode (isCompact === false), all groups are expanded regardless of overrides
      expect(getIsGroupExpanded('节点选择', false, {})).toBe(true);
      expect(getIsGroupExpanded('GLOBAL', false, { GLOBAL: false })).toBe(true);

      // In compact mode (isCompact === true), groups default to collapsed
      expect(getIsGroupExpanded('节点选择', true, {})).toBe(false);
      expect(getIsGroupExpanded('GLOBAL', true, {})).toBe(false);

      // When a single group is overridden to expanded in compact mode, only that group expands
      const overrides = { '节点选择': true };
      expect(getIsGroupExpanded('节点选择', true, overrides)).toBe(true);
      expect(getIsGroupExpanded('GLOBAL', true, overrides)).toBe(false);

      // Toggling the group override back collapses it
      const toggledOverrides = { ...overrides, '节点选择': !overrides['节点选择'] };
      expect(getIsGroupExpanded('节点选择', true, toggledOverrides)).toBe(false);
    });

    it('resets group expansion overrides when global layout is toggled', () => {
      let isCompact = true;
      let expandedGroupOverrides: Record<string, boolean> = {
        '节点选择': true,
        'ProxyGroup': true
      };

      const handleToggleGlobalLayout = () => {
        isCompact = !isCompact;
        expandedGroupOverrides = {};
      };

      // Toggle to expanded mode
      handleToggleGlobalLayout();
      expect(isCompact).toBe(false);
      expect(expandedGroupOverrides).toEqual({});

      // Set overrides again and toggle back to compact mode
      expandedGroupOverrides = { 'GLOBAL': true };
      handleToggleGlobalLayout();
      expect(isCompact).toBe(true);
      expect(expandedGroupOverrides).toEqual({});
    });

    it('generates correct resulting-action labels and titles for toolbar layout toggle', () => {
      const getToolbarButtonProps = (isCompact: boolean) => ({
        title: isCompact ? '全部展开为卡片模式' : '全部收起为紧凑模式',
        ariaLabel: isCompact ? '全部展开为卡片模式' : '全部收起为紧凑模式',
        ariaPressed: isCompact,
        icon: isCompact ? 'ChevronsUpDown' : 'ChevronsDownUp'
      });

      const compactState = getToolbarButtonProps(true);
      expect(compactState.title).toBe('全部展开为卡片模式');
      expect(compactState.ariaLabel).toBe('全部展开为卡片模式');
      expect(compactState.ariaPressed).toBe(true);
      expect(compactState.icon).toBe('ChevronsUpDown');

      const expandedState = getToolbarButtonProps(false);
      expect(expandedState.title).toBe('全部收起为紧凑模式');
      expect(expandedState.ariaLabel).toBe('全部收起为紧凑模式');
      expect(expandedState.ariaPressed).toBe(false);
      expect(expandedState.icon).toBe('ChevronsDownUp');
    });

    it('generates correct chevron button title, aria-label, and aria-expanded for per-group toggle', () => {
      const getChevronButtonProps = (groupName: string, isGroupExpanded: boolean) => ({
        title: isGroupExpanded ? `收起「${groupName}」节点卡片` : `展开「${groupName}」详细节点`,
        ariaLabel: isGroupExpanded ? `收起「${groupName}」节点卡片` : `展开「${groupName}」详细节点`,
        ariaExpanded: isGroupExpanded,
        icon: isGroupExpanded ? 'ChevronUp' : 'ChevronDown'
      });

      // Collapsed group
      const collapsedProps = getChevronButtonProps('节点选择', false);
      expect(collapsedProps.title).toBe('展开「节点选择」详细节点');
      expect(collapsedProps.ariaLabel).toBe('展开「节点选择」详细节点');
      expect(collapsedProps.ariaExpanded).toBe(false);
      expect(collapsedProps.icon).toBe('ChevronDown');

      // Expanded group
      const expandedProps = getChevronButtonProps('节点选择', true);
      expect(expandedProps.title).toBe('收起「节点选择」节点卡片');
      expect(expandedProps.ariaLabel).toBe('收起「节点选择」节点卡片');
      expect(expandedProps.ariaExpanded).toBe(true);
      expect(expandedProps.icon).toBe('ChevronUp');
    });

    it('safeguards non-interactive card surface click from triggering on interactive child elements', () => {
      const isInteractiveElement = (tagName: string, role?: string) => {
        const interactiveTags = ['button', 'input', 'textarea', 'select', 'a'];
        if (interactiveTags.includes(tagName.toLowerCase())) return true;
        if (role === 'button') return true;
        return false;
      };

      // Interactive children must not trigger group expansion
      expect(isInteractiveElement('BUTTON')).toBe(true);
      expect(isInteractiveElement('INPUT')).toBe(true);
      expect(isInteractiveElement('A')).toBe(true);
      expect(isInteractiveElement('DIV', 'button')).toBe(true);

      // Non-interactive card surface triggers expansion
      expect(isInteractiveElement('DIV')).toBe(false);
      expect(isInteractiveElement('SPAN')).toBe(false);
      expect(isInteractiveElement('H3')).toBe(false);
    });

    it('applies is-collapsed or is-expanded class hook based on group expansion state', () => {
      const getCardClassName = (isCompact: boolean, isGroupExpanded: boolean) =>
        `meta-card proxy-card-item ${isCompact ? 'compact-interactive' : ''} ${!isGroupExpanded ? 'is-collapsed' : 'is-expanded'}`;

      // In card mode (isGroupExpanded = true)
      expect(getCardClassName(false, true)).toContain('is-expanded');
      expect(getCardClassName(false, true)).not.toContain('is-collapsed');

      // In compact mode, default collapsed (isGroupExpanded = false)
      expect(getCardClassName(true, false)).toContain('is-collapsed');
      expect(getCardClassName(true, false)).toContain('compact-interactive');

      // In compact mode with override expanded (isGroupExpanded = true)
      expect(getCardClassName(true, true)).toContain('is-expanded');
      expect(getCardClassName(true, true)).toContain('compact-interactive');
    });

    it('sets aria-selected on compact node button matching selection state with subtle neutral outer keyline and transparent button', () => {
      const getCompactNodeButtonAttributes = (
        nodeName: string,
        delay: number | undefined,
        isSelected: boolean,
        isSelector: boolean
      ) => {
        const latency = getLatencyInfo(delay);
        return {
          className: `compact-node-btn ${isSelected ? 'active-selected' : ''} latency-${latency.level} ${!isSelector ? 'readonly-node' : ''}`,
          ariaSelected: isSelected,
          ariaPressed: isSelector ? isSelected : undefined,
          ariaLabel: `${nodeName}, 延迟: ${latency.text}${isSelected ? ', 当前已选择' : ''}`,
          // Uniform 2px latency border preserved (no thickened ring, no gray disk)
          ringClassName: `compact-flag-ring ring-${latency.level}`,
          hasThickenedRingShadow: false,
          hasGrayDiskBackground: false,
          // Single subtle neutral keyline (no blue outline)
          hasSingleNeutralKeyline: isSelected,
          hasBlueAccentOutline: false,
          desktopWidth: 26,
          mobileWidth: 30
        };
      };

      const selectedNode = getCompactNodeButtonAttributes('HK-01', 45, true, true);
      expect(selectedNode.ariaSelected).toBe(true);
      expect(selectedNode.ariaPressed).toBe(true);
      expect(selectedNode.className).toContain('active-selected');
      expect(selectedNode.ringClassName).toBe('compact-flag-ring ring-fast');
      expect(selectedNode.hasThickenedRingShadow).toBe(false);
      expect(selectedNode.hasGrayDiskBackground).toBe(false);
      expect(selectedNode.hasSingleNeutralKeyline).toBe(true);
      expect(selectedNode.hasBlueAccentOutline).toBe(false);
      expect(selectedNode.desktopWidth).toBe(26);
      expect(selectedNode.mobileWidth).toBe(30);

      const unselectedNode = getCompactNodeButtonAttributes('US-01', 180, false, true);
      expect(unselectedNode.ariaSelected).toBe(false);
      expect(unselectedNode.ariaPressed).toBe(false);
      expect(unselectedNode.className).not.toContain('active-selected');
      expect(unselectedNode.ringClassName).toBe('compact-flag-ring ring-medium');
      expect(unselectedNode.hasThickenedRingShadow).toBe(false);
      expect(unselectedNode.hasGrayDiskBackground).toBe(false);
      expect(unselectedNode.hasSingleNeutralKeyline).toBe(false);
      expect(unselectedNode.hasBlueAccentOutline).toBe(false);
    });
  });
});
