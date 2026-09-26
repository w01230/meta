import React, { useEffect, useMemo, useState } from 'react';
import {
  Background, ControlButton, Controls, Handle, Position, ReactFlow,
  ReactFlowProvider, getStraightPath, useNodesInitialized, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Layers, Maximize2, Minimize2, Server, Workflow } from 'lucide-react';
import { buildRuleFlow, selectMostFrequentRecentRoute, type RuleFlowKind, type RuleFlowNode } from '../../utils/ruleFlow';
import { formatBytes } from '../../utils/format';
import type { ConnectionItem } from '../../types/api';

type FlowNodeData = RuleFlowNode & Record<string, unknown>;
type FlowEdgeData = { kind: RuleFlowKind; traffic: number } & Record<string, unknown>;
type FlowNode = Node<FlowNodeData, 'chain'>;
type FlowEdge = Edge<FlowEdgeData, 'traffic'>;

function ChainNode({ data }: NodeProps<FlowNode>) {
  const isExit = ['proxy', 'direct', 'reject'].includes(data.kind);
  const Icon = data.kind === 'rule' ? Workflow : data.kind === 'group' ? Layers : Server;
  const countLabel = data.ids.length >= 1000 ? `${(data.ids.length / 1000).toFixed(1)}K` : data.ids.length.toLocaleString();
  return <div className={`overview-chain-node ${data.kind}`} data-tooltip={data.label} aria-label={`${data.label}, ${data.ids.length} 条连接，下载 ${formatBytes(data.download)}，上传 ${formatBytes(data.upload)}`}>
    {data.kind !== 'rule' && <Handle type="target" position={Position.Left} />}
    <div className="overview-chain-title"><span className="overview-chain-icon"><Icon size={16} /></span><strong>{data.label}</strong></div>
    <div className="overview-chain-metrics"><span>↓ {formatBytes(data.download)}</span><span>↑ {formatBytes(data.upload)}</span></div>
    {data.kind === 'rule' && <span className="overview-chain-count" data-tooltip={`${data.ids.length} 条连接`}>{countLabel}</span>}
    {isExit && <span className={`overview-chain-exit ${data.kind}`}>{data.kind.toUpperCase()}</span>}
    {!isExit && <Handle type="source" position={Position.Right} />}
  </div>;
}

function TrafficEdge(props: EdgeProps<FlowEdge>) {
  const [path] = getStraightPath(props);
  const { kind, traffic } = props.data || { kind: 'group' as RuleFlowKind, traffic: 0 };
  const color = !traffic ? '#64748B' : kind === 'proxy' ? '#34D399' : kind === 'direct' ? '#FB923C' : kind === 'reject' ? '#F87171' : '#A5B4FC';
  return <g className="overview-traffic-edge">
    <path d={path} fill="none" stroke={color} strokeWidth={10} strokeOpacity={0.12} strokeLinecap="round" />
    <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.35} />
    {!!traffic && [0, 1, 2].map((i) => <circle key={i} r={[3.5, 2.5, 1.5][i]} fill={color} opacity={[0.9, 0.5, 0.25][i]} className="overview-flow-particle">
      <animateMotion dur="2s" begin={`${i * 0.66}s`} repeatCount="indefinite" path={path} />
    </circle>)}
    <path d={path} fill="none" stroke="transparent" strokeWidth={24} className="react-flow__edge-interaction" />
  </g>;
}

const nodeTypes = { chain: ChainNode };
const edgeTypes = { traffic: TrafficEdge };

function FlowCanvas({ connections, isConnected, demoMode }: { connections: ConnectionItem[]; isConnected: boolean; demoMode: boolean }) {
  const recentRoute = useMemo(() => selectMostFrequentRecentRoute(connections), [connections]);
  const flow = useMemo(() => buildRuleFlow(recentRoute.connections), [recentRoute]);
  const [fullscreen, setFullscreen] = useState(false);
  const { fitView, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [compactViewport, setCompactViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setCompactViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const rows: Record<number, number> = {};
  const nodes: FlowNode[] = flow.nodes.map((node) => ({
    id: node.id,
    type: 'chain',
    measured: measured[node.id],
    position: { x: node.layer * 310, y: (rows[node.layer] = (rows[node.layer] ?? -1) + 1) * 126 },
    data: { ...node },
  }));
  const shown = new Set(nodes.map((node) => node.id));
  const edges: FlowEdge[] = flow.edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target)).map((edge) => ({
    ...edge,
    type: 'traffic',
    data: {
      kind: edge.kind,
      traffic: edge.download + edge.upload,
    },
  }));

  const topology = nodes.map((node) => node.id).join('|');
  useEffect(() => {
    if (!nodesInitialized || compactViewport) return;
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.08, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, compactViewport, topology, fullscreen, fitView]);

  // Mobile starts on the first rule at a readable scale. Live metric updates
  // intentionally do not refit or reset a user's manual pan/zoom.
  useEffect(() => {
    if (!nodesInitialized || !compactViewport) return;
    void setViewport({ x: 24, y: 34, zoom: 0.76 });
  }, [nodesInitialized, compactViewport, topology, fullscreen, setViewport]);

  useEffect(() => {
    if (!fullscreen) return;
    const before = document.body.style.overflow;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = before; window.removeEventListener('keydown', escape); };
  }, [fullscreen]);

  const online = isConnected || demoMode;
  const hasSnapshot = online && connections.length > 0;
  const hasFlow = hasSnapshot && recentRoute.frequency > 0 && flow.nodes.length > 0 && flow.edges.length > 0;

  return <div className={fullscreen ? 'overview-flow-fullscreen' : ''}>
    <section className="overview-full-card overview-rule-flow-card" aria-labelledby="overview-rule-flow-title">
      <div className="panel-header-bar overview-flow-header">
        <div className="panel-header-left">
          <Workflow size={19} className="panel-header-icon" aria-hidden="true" />
          <h2 id="overview-rule-flow-title" className="panel-heading-title">规则链路</h2>
          {demoMode && <span className="demo-tag-pill">【仿真】</span>}
        </div>
        {hasSnapshot && <span className="overview-flow-observed">最近 {recentRoute.sampledCount} 条活动连接中，该链路出现 {recentRoute.frequency} 次</span>}
      </div>
      {hasFlow ? <div className="overview-flow-canvas">
        <span className="overview-flow-pan-hint" aria-hidden="true">拖动查看链路 · 滚轮缩放</span>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false}
          onNodesChange={(changes) => {
            const dimensions = changes.flatMap((change) => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : []);
            if (!dimensions.length) return;
            setMeasured((previous) => {
              if (dimensions.every(([id, size]) => previous[id]?.width === size.width && previous[id]?.height === size.height)) return previous;
              return { ...previous, ...Object.fromEntries(dimensions) };
            });
          }}
          aria-label="观察到的规则链路图，可拖动平移并缩放"
        >
          <Background color="#dadbe7" gap={22} size={1} />
          <Controls showInteractive={false}>
            <ControlButton title={fullscreen ? '退出全屏' : '全屏展示'} aria-label={fullscreen ? '退出全屏' : '全屏展示'} onClick={() => setFullscreen((value) => !value)}>
              {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </ControlButton>
          </Controls>
        </ReactFlow>
        <ul className="sr-only" aria-label="观察到的规则链路摘要">{flow.edges.map((edge) => {
          const source = flow.nodes.find((node) => node.id === edge.source);
          const target = flow.nodes.find((node) => node.id === edge.target);
          return source && target ? <li key={edge.id}>{source.label} → {target.label}，{edge.ids.length} 条连接，下载 {formatBytes(edge.download)}，上传 {formatBytes(edge.upload)}</li> : null;
        })}</ul>
      </div> : <div className="overview-flow-empty" role="status">
        {!online
          ? '控制器未连接，暂无当前活动连接链路。'
          : !connections.length
            ? '暂无活动连接，等待当前活动快照。'
            : !recentRoute.frequency
              ? `最近 ${recentRoute.sampledCount} 条活动连接中没有包含完整 chains 的可展示链路。`
              : '最近活动连接中没有可展示的完整链路。'}
      </div>}
    </section>
  </div>;
}

export const RuleFlowPanel: React.FC<{ connections: ConnectionItem[]; isConnected: boolean; demoMode: boolean }> = (props) => (
  <ReactFlowProvider><FlowCanvas {...props} /></ReactFlowProvider>
);
