import { ProxyItem } from '../types/api';

export const STORAGE_KEY_HIDE_GLOBAL = 'meta_dashboard_hide_global';

/**
 * Checks if a string contains any of the given tokens as a bounded token.
 * A bounded token is NOT immediately surrounded by ASCII alphanumeric characters [a-zA-Z0-9].
 * This avoids false positives like 'HK' matching inside 'SHARK' or 'CHECK',
 * 'US' matching inside 'USING' or 'BUSINESS', or 'LAX' matching inside 'RELAX'.
 */
export function containsBoundedToken(text: string, tokens: string[]): boolean {
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
    if (regex.test(text)) {
      return true;
    }
  }
  return false;
}

export const SUPPORTED_REGION_CODES = new Set([
  'hk',
  'sg',
  'us',
  'jp',
  'tw',
  'kr',
  'gb',
  'de',
  'ca',
  'au'
]);

export const REGION_CODE_TO_EMOJI: Record<string, string> = {
  hk: '🇭🇰',
  sg: '🇸🇬',
  us: '🇺🇸',
  jp: '🇯🇵',
  tw: '🇹🇼',
  kr: '🇰🇷',
  gb: '🇬🇧',
  de: '🇩🇪',
  ca: '🇨🇦',
  au: '🇦🇺'
};

export const REGION_CODE_TO_LABEL: Record<string, string> = {
  hk: '香港',
  sg: '新加坡',
  us: '美国',
  jp: '日本',
  tw: '台湾',
  kr: '韩国',
  gb: '英国',
  de: '德国',
  ca: '加拿大',
  au: '澳大利亚'
};

/**
 * Extracts a 2-letter lowercase ISO country code from an explicit regional indicator emoji
 * (e.g. '🇭🇰' -> 'hk'). Returns null if the emoji is not composed of 2 regional indicator symbols.
 */
export function emojiToRegionCode(emoji?: string): string | null {
  if (!emoji) return null;
  const chars = [...emoji];
  if (chars.length !== 2) return null;
  const c1 = chars[0].codePointAt(0);
  const c2 = chars[1].codePointAt(0);
  if (c1 && c2 && c1 >= 0x1f1e6 && c1 <= 0x1f1ff && c2 >= 0x1f1e6 && c2 <= 0x1f1ff) {
    return (String.fromCharCode(c1 - 0x1f1e6 + 65) + String.fromCharCode(c2 - 0x1f1e6 + 65)).toLowerCase();
  }
  return null;
}

/**
 * Infers a 2-letter lowercase region code ('hk', 'sg', 'us', etc.) from a proxy group or node name.
 * Checks explicit flag emojis, localized Chinese keywords, and bounded token identifiers.
 * Returns null if the region is not recognized or not in the supported circular flag set.
 */
export function matchRegionCode(name?: string): string | null {
  if (!name) return null;

  // 1. Explicit regional flag emoji in name
  const emojiMatch = name.match(/\p{Regional_Indicator}{2}/u);
  if (emojiMatch) {
    const code = emojiToRegionCode(emojiMatch[0]);
    if (code && SUPPORTED_REGION_CODES.has(code)) {
      return code;
    }
  }

  const lower = name.toLowerCase();

  // 2. Hong Kong (HKG / HK) => hk
  if (
    lower.includes('香港') ||
    lower.includes('hong kong') ||
    lower.includes('hongkong') ||
    containsBoundedToken(name, ['HK', 'HKG', 'HKT', 'HKBN'])
  ) {
    return 'hk';
  }

  // 3. Singapore (SG / SIN) => sg
  if (
    lower.includes('新加坡') ||
    lower.includes('狮城') ||
    lower.includes('singapore') ||
    containsBoundedToken(name, ['SG', 'SIN', 'SGP'])
  ) {
    return 'sg';
  }

  // 4. United States (LAX / US / USA) => us
  if (
    lower.includes('美国') ||
    lower.includes('united states') ||
    lower.includes('america') ||
    lower.includes('洛杉矶') ||
    lower.includes('圣何塞') ||
    lower.includes('旧金山') ||
    lower.includes('西雅图') ||
    lower.includes('纽约') ||
    lower.includes('芝加哥') ||
    containsBoundedToken(name, ['US', 'USA', 'LAX', 'SFO', 'JFK', 'ORD', 'IAD'])
  ) {
    return 'us';
  }

  // 5. Japan (JP / JPN / TYO) => jp
  if (
    lower.includes('日本') ||
    lower.includes('japan') ||
    lower.includes('东京') ||
    lower.includes('大阪') ||
    containsBoundedToken(name, ['JP', 'JPN', 'TYO', 'OSA', 'HND', 'NRT'])
  ) {
    return 'jp';
  }

  // 6. Taiwan (TW / TWN) => tw
  if (
    lower.includes('台湾') ||
    lower.includes('taiwan') ||
    lower.includes('台北') ||
    containsBoundedToken(name, ['TW', 'TWN', 'TPE'])
  ) {
    return 'tw';
  }

  // 7. Korea (KR / KOR / SEL) => kr
  if (
    lower.includes('韩国') ||
    lower.includes('korea') ||
    lower.includes('首尔') ||
    containsBoundedToken(name, ['KR', 'KOR', 'ICN', 'SEL'])
  ) {
    return 'kr';
  }

  // 8. United Kingdom (UK / GB) => gb
  if (
    lower.includes('英国') ||
    lower.includes('united kingdom') ||
    lower.includes('britain') ||
    lower.includes('伦敦') ||
    lower.includes('london') ||
    containsBoundedToken(name, ['UK', 'GB', 'GBR', 'LON', 'LHR'])
  ) {
    return 'gb';
  }

  // 9. Germany (DE / DEU / FRA) => de
  if (
    lower.includes('德国') ||
    lower.includes('germany') ||
    lower.includes('法兰克福') ||
    lower.includes('frankfurt') ||
    containsBoundedToken(name, ['DE', 'DEU', 'FRA', 'BER'])
  ) {
    return 'de';
  }

  // 10. Canada (CA / CAN) => ca
  if (
    lower.includes('加拿大') ||
    lower.includes('canada') ||
    lower.includes('温哥华') ||
    lower.includes('多伦多') ||
    containsBoundedToken(name, ['CA', 'CAN', 'YVR', 'YYZ'])
  ) {
    return 'ca';
  }

  // 11. Australia (AU / AUS / SYD) => au
  if (
    lower.includes('澳大利亚') ||
    lower.includes('澳洲') ||
    lower.includes('australia') ||
    lower.includes('悉尼') ||
    lower.includes('墨尔本') ||
    containsBoundedToken(name, ['AU', 'AUS', 'SYD', 'MEL'])
  ) {
    return 'au';
  }

  return null;
}

/**
 * Heuristically infers a country/region flag emoji from a proxy group or node name.
 * Strictly checks bounded tokens to avoid partial false positives.
 * Unknown names return the neutral globe emoji '🌐' without guessing a misleading country.
 * Real identifiers are never mutated.
 */
export function matchRegionFlag(name?: string): string {
  if (!name) return '🌐';

  // 1. If an explicit regional flag emoji is already present, return it
  const emojiMatch = name.match(/\p{Regional_Indicator}{2}/u);
  if (emojiMatch) {
    return emojiMatch[0];
  }

  const code = matchRegionCode(name);
  if (code && REGION_CODE_TO_EMOJI[code]) {
    return REGION_CODE_TO_EMOJI[code];
  }

  // Neutral fallback: unknown => neutral Globe
  return '🌐';
}

/**
 * Strips leading or embedded regional flag emoji from the visual display text of a group or node,
 * preventing redundant emoji display when a CircularFlag component is rendered next to it.
 * When the input consists solely of a regional flag emoji (e.g. '🇭🇰'), it returns a meaningful
 * localized region label or short code (e.g. '香港' or 'HK') instead of a raw wavy emoji.
 * Original names used in API requests, selections, and keys are NEVER altered.
 */
export function sanitizeDisplayName(name?: string): string {
  if (!name) return '';
  const cleaned = name
    .replace(/\p{Regional_Indicator}{2}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) {
    return cleaned;
  }

  // Name consisted only of flag emoji: map to localized label or short code
  const code = matchRegionCode(name) || emojiToRegionCode(name);
  if (code) {
    return REGION_CODE_TO_LABEL[code] || code.toUpperCase();
  }

  return name;
}

/**
 * Sorts proxy groups using a child-before-parent dependency topological ordering:
 * 1. Referenced groups (groups whose own name appears in another known group's .all list)
 *    are collectively prioritized before unreferenced root groups.
 * 2. Within referenced groups, if parent.all includes a child group's name, that child
 *    group is rendered before the parent, transitively (child-before-parent dependency).
 * 3. Stable original order is strictly preserved when there is no dependency.
 * 4. Self-references and non-group leaf nodes (items in .all that are not in the input
 *    groups array) are ignored.
 * 5. Cycles (e.g. A includes B and B includes A) cannot satisfy strict child-before-parent
 *    ordering simultaneously; such cycles are broken deterministically by falling back
 *    to original relative order without infinite loops.
 */
export function sortProxyGroups(groups: ProxyItem[]): ProxyItem[] {
  if (!groups || groups.length <= 1) return groups || [];

  // Map known group names to their original index
  const groupIndexMap = new Map<string, number>();
  for (let i = 0; i < groups.length; i++) {
    if (groups[i]?.name && !groupIndexMap.has(groups[i].name)) {
      groupIndexMap.set(groups[i].name, i);
    }
  }

  // Identify all valid child group references for each group:
  // - Must be in groups array (known group, not leaf proxy node)
  // - Must not be self-reference
  const childrenMap = new Map<string, Set<string>>();
  const referencedGroupNames = new Set<string>();

  for (const group of groups) {
    if (!group?.name) continue;
    const validChildren = new Set<string>();
    if (Array.isArray(group.all)) {
      for (const item of group.all) {
        if (typeof item === 'string' && item !== group.name && groupIndexMap.has(item)) {
          validChildren.add(item);
          referencedGroupNames.add(item);
        }
      }
    }
    childrenMap.set(group.name, validChildren);
  }

  // Partition into referenced (Partition 1) and unreferenced (Partition 2)
  const referencedGroups: ProxyItem[] = [];
  const unreferencedGroups: ProxyItem[] = [];

  for (const group of groups) {
    if (!group?.name) continue;
    if (referencedGroupNames.has(group.name)) {
      referencedGroups.push(group);
    } else {
      unreferencedGroups.push(group);
    }
  }

  // If there are no referenced groups, original order is already preserved
  if (referencedGroups.length === 0) {
    return groups;
  }

  // Topological sort on referencedGroups:
  // A group P depends on its children C (C must appear before P).
  // Therefore, a group P can only be emitted once all of its children in referencedGroups
  // have been emitted.
  const refNamesSet = new Set(referencedGroups.map((g) => g.name));

  // prerequisitesCount[g] = number of children of g in referencedGroups that have not been emitted yet
  const prerequisitesCount = new Map<string, number>();
  // parentsMap[c] = set of parents in referencedGroups that include c
  const parentsMap = new Map<string, Set<string>>();

  for (const group of referencedGroups) {
    parentsMap.set(group.name, new Set<string>());
  }

  for (const group of referencedGroups) {
    const children = childrenMap.get(group.name) || new Set<string>();
    let count = 0;
    for (const child of children) {
      if (refNamesSet.has(child)) {
        count++;
        parentsMap.get(child)!.add(group.name);
      }
    }
    prerequisitesCount.set(group.name, count);
  }

  // Nodes with 0 unemitted children are ready to be emitted
  const ready: string[] = [];
  for (const group of referencedGroups) {
    if (prerequisitesCount.get(group.name) === 0) {
      ready.push(group.name);
    }
  }

  // Sort ready by original index to ensure stable tie-breaking
  ready.sort((a, b) => groupIndexMap.get(a)! - groupIndexMap.get(b)!);

  const sortedReferenced: ProxyItem[] = [];
  const emitted = new Set<string>();

  while (emitted.size < referencedGroups.length) {
    let nextName: string;

    if (ready.length > 0) {
      // Pick ready node with smallest original index
      nextName = ready.shift()!;
    } else {
      // Cycle detected among remaining unemitted nodes:
      // Pick the unemitted node with the smallest original index to deterministically break cycle.
      // (Note: In a cyclic graph A -> B -> A, it is mathematically impossible to have both
      // child-before-parent constraints satisfied; falling back to original order guarantees
      // deterministic, termination-safe behavior).
      let bestName = '';
      let bestIndex = Infinity;
      for (const group of referencedGroups) {
        if (!emitted.has(group.name)) {
          const idx = groupIndexMap.get(group.name)!;
          if (idx < bestIndex) {
            bestIndex = idx;
            bestName = group.name;
          }
        }
      }
      nextName = bestName;
    }

    emitted.add(nextName);
    sortedReferenced.push(groups[groupIndexMap.get(nextName)!]);

    // For all parents that depended on nextName, decrement their unemitted children count
    const parents = parentsMap.get(nextName) || new Set<string>();
    for (const parent of parents) {
      if (!emitted.has(parent)) {
        const remaining = prerequisitesCount.get(parent)! - 1;
        prerequisitesCount.set(parent, remaining);
        if (remaining === 0) {
          // Parent is now ready
          ready.push(parent);
          ready.sort((a, b) => groupIndexMap.get(a)! - groupIndexMap.get(b)!);
        }
      }
    }
  }

  return [...sortedReferenced, ...unreferencedGroups];
}

/** Returns the most recently reported delay for a proxy, if it has history. */
export function getLatestProxyDelay(proxy?: ProxyItem): number | undefined {
  const history = proxy?.history;
  return history?.length ? history[history.length - 1].delay : undefined;
}

/** Sorts nodes by successful positive delay, keeping timed-out/invalid results last and ties stable. */
export function sortProxyNodesByDelay(
  nodes: string[],
  proxies: Record<string, ProxyItem>
): string[] {
  return nodes
    .map((name, index) => ({ name, index, delay: getLatestProxyDelay(proxies[name]) }))
    .sort((a, b) => {
      const aValid = typeof a.delay === 'number' && Number.isFinite(a.delay) && a.delay > 0;
      const bValid = typeof b.delay === 'number' && Number.isFinite(b.delay) && b.delay > 0;
      if (aValid && bValid) return a.delay! - b.delay! || a.index - b.index;
      if (aValid) return -1;
      if (bValid) return 1;
      return a.index - b.index;
    })
    .map(({ name }) => name);
}

export interface FilterProxyGroupsOptions {
  hideGlobal?: boolean;
  search?: string;
}

/**
 * Filters proxy groups based on hideGlobal and search keyword.
 */
export function filterProxyGroups(
  groups: ProxyItem[],
  options: FilterProxyGroupsOptions = {}
): ProxyItem[] {
  const { hideGlobal = false, search = '' } = options;
  const q = search.trim().toLowerCase();

  return groups.filter((group) => {
    // 1. Hide GLOBAL if requested
    if (hideGlobal && group.name === 'GLOBAL') {
      return false;
    }

    // 2. Filter by search query if non-empty
    if (q) {
      const matchGroupName = group.name.toLowerCase().includes(q);
      const matchChildNode = group.all?.some((node) => node.toLowerCase().includes(q));
      if (!matchGroupName && !matchChildNode) {
        return false;
      }
    }

    return true;
  });
}

export function getStoredHideGlobal(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_HIDE_GLOBAL) === 'true';
  } catch {
    return false;
  }
}

export function setStoredHideGlobal(val: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_HIDE_GLOBAL, String(val));
  } catch {
    // ignore storage quota errors
  }
}
