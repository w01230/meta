import { describe, expect, it } from 'vitest';
import type { ConnectionItem } from '../types/api';
import { buildRuleFlow, selectMostFrequentRecentRoute } from '../utils/ruleFlow';
import { createInitialDemoConnections } from '../services/demoData';

const connection = (overrides: Partial<ConnectionItem> = {}): ConnectionItem => ({
  id: 'c1',
  metadata: {
    network: 'tcp', type: 'HTTP', sourceIP: '1.1.1.1', destinationIP: '2.2.2.2',
    sourcePort: '123', destinationPort: '443', host: 'example.com',
  },
  upload: 10,
  download: 20,
  start: 'now',
  chains: ['exit', 'group'],
  rule: 'DOMAIN',
  rulePayload: 'example.com',
  ...overrides,
});

describe('buildRuleFlow', () => {
  it('builds demo routes from exit-first fixtures without mutating their chains', () => {
    const connections = createInitialDemoConnections();
    const originalChains = connections.map(({ chains }) => [...chains]);
    const flow = buildRuleFlow(connections);

    const group = flow.nodes.find((node) => node.label === '国外媒体');
    const exit = flow.nodes.find((node) => node.label === '🇭🇰 香港 01 [IEPL 专线]');
    expect(flow.edges).toContainEqual(expect.objectContaining({ source: group?.id, target: exit?.id }));
    expect(connections.map(({ chains }) => chains)).toEqual(originalChains);
  });

  it('aggregates shared paths and emits rule-to-exit direction', () => {
    const flow = buildRuleFlow([
      connection({ id: 'a' }),
      connection({ id: 'b', upload: 3, download: 4 }),
    ]);
    const rule = flow.nodes.find((node) => node.kind === 'rule');
    const group = flow.nodes.find((node) => node.label === 'group');
    const exit = flow.nodes.find((node) => node.label === 'exit');

    expect(rule?.label).toBe('DOMAIN: example.com');
    expect(rule?.ids).toEqual(['a', 'b']);
    expect(rule?.download).toBe(24);
    expect(group?.kind).toBe('group');
    expect(exit?.kind).toBe('proxy');
    expect(flow.edges.map(({ source, target }) => [source, target])).toEqual([
      [rule?.id, group?.id], [group?.id, exit?.id],
    ]);
    expect(flow.edges[0]).toMatchObject({ download: 24, upload: 13, ids: ['a', 'b'] });
  });

  it('supports differing chain depths while aligning exits', () => {
    const flow = buildRuleFlow([
      connection({ id: 'short', chains: ['DIRECT'] }),
      connection({ id: 'long', chains: ['leaf', 'inner', 'outer'] }),
    ]);
    const shortExit = flow.nodes.find((node) => node.label === 'DIRECT');
    const longExit = flow.nodes.find((node) => node.label === 'leaf');
    expect(shortExit?.layer).toBe(3);
    expect(longExit?.layer).toBe(3);
  });

  it.each([
    ['DIRECT', 'direct'],
    ['REJECT', 'reject'],
    ['REJECT-DROP', 'reject'],
  ] as const)('classifies %s as an exit', (label, kind) => {
    const flow = buildRuleFlow([connection({ chains: [label] })]);
    expect(flow.nodes.find((node) => node.label === label)?.kind).toBe(kind);
  });

  it('does not mutate chains and creates no paths for empty chains', () => {
    const chains = ['exit', 'group'];
    const flow = buildRuleFlow([connection({ chains }), connection({ id: 'empty', chains: [] })]);
    expect(chains).toEqual(['exit', 'group']);
    expect(flow.edges).toHaveLength(2);
    expect(flow.nodes.some((node) => node.ids.includes('empty'))).toBe(false);
  });

  it('deduplicates repeated connection ids when aggregating', () => {
    const flow = buildRuleFlow([
      connection({ id: 'same', download: 20, upload: 10 }),
      connection({ id: 'same', download: 90, upload: 80 }),
    ]);
    expect(flow.nodes.find((node) => node.kind === 'rule')).toMatchObject({
      ids: ['same'], download: 20, upload: 10,
    });
    expect(flow.edges[0]).toMatchObject({ ids: ['same'], download: 20, upload: 10 });
  });

  it('handles missing runtime fields without inventing routes', () => {
    const incomplete = { id: 'missing', chains: null } as unknown as ConnectionItem;
    expect(buildRuleFlow([incomplete])).toEqual({ nodes: [], edges: [] });
  });
});

describe('selectMostFrequentRecentRoute', () => {
  const dated = (id: string, start: string, overrides: Partial<ConnectionItem> = {}) =>
    connection({ id, start, ...overrides });

  it('caps the sample at the latest 32 connections and retains original references', () => {
    const connections = Array.from({ length: 34 }, (_, index) =>
      dated(`c${index}`, new Date(index * 1000).toISOString(), {
        chains: index >= 2 ? ['exit', 'group'] : ['old-exit', 'old-group'],
      }),
    );
    const result = selectMostFrequentRecentRoute(connections);
    expect(result.sampledCount).toBe(32);
    expect(result.frequency).toBe(32);
    expect(result.connections).toEqual(connections.slice(2).reverse());
    expect(result.connections[0]).toBe(connections[33]);
    expect(result.connections).toContain(connections[2]);
    expect(result.connections).not.toContain(connections[1]);
  });

  it('uses complete route identity rather than only the leaf or shared groups', () => {
    const same = [
      dated('a', '2026-01-01T00:00:03Z', { chains: ['leaf', 'shared'], rule: 'DOMAIN', rulePayload: 'x' }),
      dated('b', '2026-01-01T00:00:02Z', { chains: ['leaf', 'shared'], rule: 'DOMAIN', rulePayload: 'x' }),
      dated('c', '2026-01-01T00:00:01Z', { chains: ['leaf', 'shared'], rule: 'MATCH', rulePayload: '' }),
      dated('d', '2025-12-31T23:59:59Z', { chains: ['leaf', 'other'], rule: 'DOMAIN', rulePayload: 'x' }),
    ];
    const result = selectMostFrequentRecentRoute(same);
    expect(result.connections.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result.frequency).toBe(2);
    expect(result.key).toBe(JSON.stringify(['DOMAIN', 'x', ['shared', 'leaf']]));
  });

  it('breaks equal-frequency ties by most recent participant, then source order', () => {
    const result = selectMostFrequentRecentRoute([
      dated('older-first', '2026-01-01T00:00:02Z', { chains: ['a'] }),
      dated('newer-first', '2026-01-01T00:00:03Z', { chains: ['b'] }),
    ]);
    expect(result.connections.map(({ id }) => id)).toEqual(['newer-first']);

    const equalTime = selectMostFrequentRecentRoute([
      dated('source-first', '2026-01-01T00:00:03Z', { chains: ['z'] }),
      dated('source-second', '2026-01-01T00:00:03Z', { chains: ['a'] }),
    ]);
    expect(equalTime.connections.map(({ id }) => id)).toEqual(['source-first']);
  });

  it('samples before skipping malformed routes and handles an all-invalid sample', () => {
    const result = selectMostFrequentRecentRoute([
      dated('valid', '2026-01-01T00:00:03Z', { chains: ['exit'] }),
      dated('null', '2026-01-01T00:00:02Z', { chains: null as unknown as string[] }),
      dated('empty', '2026-01-01T00:00:01Z', { chains: [] }),
      dated('bad-item', '2025-12-31T23:59:59Z', { chains: ['exit', 3 as unknown as string] }),
    ]);
    expect(result.sampledCount).toBe(4);
    expect(result.connections.map(({ id }) => id)).toEqual(['valid']);
    expect(selectMostFrequentRecentRoute([dated('empty', 'bad date', { chains: [] })])).toMatchObject({
      sampledCount: 1, connections: [], frequency: 0, key: null,
    });
  });

  it('does not mutate input, and falls back to source order for invalid timestamps', () => {
    const connections = [
      dated('invalid-first', 'not a timestamp', { chains: ['x'] }),
      dated('invalid-second', 'also invalid', { chains: ['x'] }),
      dated('dated', '2026-01-01T00:00:00Z', { chains: ['y'] }),
    ];
    const originalOrder = [...connections];
    const result = selectMostFrequentRecentRoute(connections, 2);
    expect(connections).toEqual(originalOrder);
    expect(result.connections.map(({ id }) => id)).toEqual(['dated']);

    const invalidOnly = selectMostFrequentRecentRoute(connections.slice(0, 2));
    expect(invalidOnly.connections.map(({ id }) => id)).toEqual(['invalid-first', 'invalid-second']);
  });
});
