import type { ConnectionItem } from '../types/api';

export type RuleFlowKind = 'rule' | 'group' | 'proxy' | 'direct' | 'reject';

export interface RuleFlowNode {
  id: string;
  label: string;
  kind: RuleFlowKind;
  layer: number;
  download: number;
  upload: number;
  ids: string[];
}

export interface RuleFlowEdge {
  id: string;
  source: string;
  target: string;
  kind: RuleFlowKind;
  download: number;
  upload: number;
  ids: string[];
}

export interface RuleFlow {
  nodes: RuleFlowNode[];
  edges: RuleFlowEdge[];
}

export interface RecentRouteSelection {
  /** Number of source connections included in the recent sample, before route validation. */
  sampledCount: number;
  /** Original connection objects belonging to the most frequently observed valid route. */
  connections: ConnectionItem[];
  frequency: number;
  /** JSON tuple of rule, rule payload, and reversed chains for the selected route. */
  key: string | null;
}

/** Select the most common exact route within the latest active-connection sample. */
export function selectMostFrequentRecentRoute(
  connections: ConnectionItem[],
  limit = 32,
): RecentRouteSelection {
  const sampleLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 32;
  const sampled = connections
    .map((connection, sourceIndex) => {
      const parsedStart = typeof connection?.start === 'string' ? Date.parse(connection.start) : Number.NaN;
      return {
        connection,
        sourceIndex,
        startTime: Number.isFinite(parsedStart) ? parsedStart : null,
      };
    })
    .sort((a, b) => {
      if (a.startTime !== null && b.startTime !== null) return b.startTime - a.startTime || a.sourceIndex - b.sourceIndex;
      if (a.startTime !== null) return -1;
      if (b.startTime !== null) return 1;
      return a.sourceIndex - b.sourceIndex;
    })
    .slice(0, sampleLimit);

  interface RouteCount {
    key: string;
    connections: ConnectionItem[];
    recentRank: number;
    firstSourceIndex: number;
  }
  const routes = new Map<string, RouteCount>();

  sampled.forEach(({ connection, sourceIndex }, recentRank) => {
    if (!connection || typeof connection.rule !== 'string' || typeof connection.rulePayload !== 'string') return;
    if (!Array.isArray(connection.chains) || connection.chains.length === 0) return;
    if (connection.chains.some((chain) => typeof chain !== 'string' || chain.length === 0)) return;

    // Mihomo stores the exit first; copy and reverse to match buildRuleFlow's route direction.
    const key = JSON.stringify([connection.rule, connection.rulePayload, [...connection.chains].reverse()]);
    let route = routes.get(key);
    if (!route) {
      route = { key, connections: [], recentRank, firstSourceIndex: sourceIndex };
      routes.set(key, route);
    }
    route.connections.push(connection);
  });

  const winner = [...routes.values()].sort((a, b) =>
    b.connections.length - a.connections.length ||
    a.recentRank - b.recentRank ||
    a.firstSourceIndex - b.firstSourceIndex ||
    a.key.localeCompare(b.key),
  )[0];

  return {
    sampledCount: sampled.length,
    connections: winner?.connections ?? [],
    frequency: winner?.connections.length ?? 0,
    key: winner?.key ?? null,
  };
}

export function buildRuleFlow(connections: ConnectionItem[]): RuleFlow {
  const nodes = new Map<string, RuleFlowNode>();
  const edges = new Map<string, RuleFlowEdge>();
  const validChains = connections.map((connection) =>
    Array.isArray(connection?.chains)
      ? connection.chains.filter((chain): chain is string => typeof chain === 'string' && chain.length > 0).reverse()
      : [],
  );
  const maxLayer = Math.max(2, ...validChains.map((chain) => chain.length));

  connections.forEach((connection, index) => {
    const route = validChains[index];
    if (!route.length) return;

    const connectionId = typeof connection.id === 'string' ? connection.id : '';
    const download = Number.isFinite(connection.download) ? connection.download : 0;
    const upload = Number.isFinite(connection.upload) ? connection.upload : 0;
    const rule = typeof connection.rule === 'string' ? connection.rule : '';
    const rulePayload = typeof connection.rulePayload === 'string' ? connection.rulePayload : '';
    const list: Pick<RuleFlowNode, 'id' | 'label' | 'kind' | 'layer'>[] = [
      {
        id: JSON.stringify(['rule', rule, rulePayload]),
        label: `${rule}${rulePayload ? `: ${rulePayload}` : ''}`,
        kind: 'rule',
        layer: 0,
      },
      ...route.map((label, routeIndex) => {
        const last = routeIndex === route.length - 1;
        const kind: RuleFlowKind = last
          ? label === 'DIRECT'
            ? 'direct'
            : label === 'REJECT' || label === 'REJECT-DROP'
              ? 'reject'
              : 'proxy'
          : 'group';
        const layer = last ? maxLayer : routeIndex + 1;
        return { id: JSON.stringify([kind, layer, label]), label, kind, layer };
      }),
    ];

    for (const item of list) {
      let node = nodes.get(item.id);
      if (!node) {
        node = { ...item, download: 0, upload: 0, ids: [] };
        nodes.set(node.id, node);
      }
      if (!node.ids.includes(connectionId)) {
        node.ids.push(connectionId);
        node.download += download;
        node.upload += upload;
      }
    }

    for (let i = 1; i < list.length; i++) {
      const source = list[i - 1];
      const target = list[i];
      const id = JSON.stringify([source.id, target.id]);
      let edge = edges.get(id);
      if (!edge) {
        edge = {
          id,
          source: source.id,
          target: target.id,
          kind: target.kind,
          ids: [],
          download: 0,
          upload: 0,
        };
        edges.set(id, edge);
      }
      if (!edge.ids.includes(connectionId)) {
        edge.ids.push(connectionId);
        edge.download += download;
        edge.upload += upload;
      }
    }
  });

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
