import React, { useMemo, useState } from 'react';
import { isActionCancelledError, useController } from '../../context/ControllerContext';
import { formatBytes, getLatencyInfo } from '../../utils/format';
import { sortProxyGroups, sanitizeDisplayName, getActiveProxyDelay, getActiveProxyLeaf } from '../../utils/proxy';
import { CircularFlag } from '../common/CircularFlag';
import { TrafficRateChart } from './TrafficRateChart';
import { RuleFlowPanel } from './RuleFlowPanel';

import { 
  ArrowUpRight,
  X,
  Zap,
  ArrowLeftRight,
  ShieldCheck,
  Radio,
  Activity,
  Waypoints,
  Check,
  Sliders,
  RadioTower,
  Globe,
  Server,
  Monitor,
  Database,
} from 'lucide-react';
import { useToast } from '../common/Toast';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { RunMode, ConnectionItem, ProxyItem } from '../../types/api';

interface ConnectionRankEntry {
  key: string;
  download: number;
  upload: number;
  count: number;
  share: number;
}

function rankConnections(
  connections: ConnectionItem[],
  getKey: (connection: ConnectionItem) => string,
): ConnectionRankEntry[] {
  const groups = new Map<string, Omit<ConnectionRankEntry, 'share'>>();
  for (const connection of connections) {
    const key = getKey(connection);
    const current = groups.get(key) || { key, download: 0, upload: 0, count: 0 };
    current.download += Number.isFinite(connection.download) ? Math.max(0, connection.download) : 0;
    current.upload += Number.isFinite(connection.upload) ? Math.max(0, connection.upload) : 0;
    current.count += 1;
    groups.set(key, current);
  }
  const all = [...groups.values()].sort((a, b) => b.download + b.upload - a.download - a.upload);
  const total = all.reduce((sum, item) => sum + item.download + item.upload, 0);
  return all.slice(0, 3).map((item) => ({
    ...item,
    share: total > 0 ? ((item.download + item.upload) / total) * 100 : 0,
  }));
}

interface OverviewViewProps {
  onNavigateTab: (tab: string) => void;
  onOpenSettings?: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  onNavigateTab,
  onOpenSettings
}) => {
  const {
    status,
    demoMode,
    baseUrl,
    config,
    updateConfigMode,
    connectController,
    refreshAll,
    currentTraffic,
    trafficHistory,
    trafficTotal,
    currentMemory,
    proxies,
    connections,
    rules,
    switchProxy,
    testProxyDelay,
    closeAllConnections
  } = useController();

  const { showToast } = useToast();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [testingNodes, setTestingNodes] = useState<Record<string, boolean>>({});
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [selectedGroupForSwitch, setSelectedGroupForSwitch] = useState<ProxyItem | null>(null);

  const isConnected = status === 'connected';

  const activeConnections = connections;
  const canShowConnectionStats = isConnected || demoMode;
  const rankingCards = useMemo(() => {
    const outboundFor = (connection: ConnectionItem) => {
      const chain = connection.chains || [];
      return (Array.isArray(chain) && typeof chain[0] === 'string' && chain[0]) || '未知出站';
    };
    const metadataFor = (connection: ConnectionItem): ConnectionItem['metadata'] =>
      connection.metadata && typeof connection.metadata === 'object'
        ? connection.metadata
        : {} as ConnectionItem['metadata'];
    return [
      { id: 'domains', title: '活跃域名', Icon: Globe, getKey: (connection: ConnectionItem) => {
        const metadata = metadataFor(connection);
        return (typeof metadata.host === 'string' && metadata.host) ||
          (typeof metadata.destinationIP === 'string' && metadata.destinationIP) || '未知目标';
      } },
      { id: 'outbounds', title: '活跃出站', Icon: Server, getKey: outboundFor },
      { id: 'sources', title: '活跃来源', Icon: Monitor, getKey: (connection: ConnectionItem) => {
        const sourceIP = metadataFor(connection).sourceIP;
        return (typeof sourceIP === 'string' && sourceIP) || '未知来源';
      } },
    ].map((card) => ({ ...card, rows: rankConnections(canShowConnectionStats ? activeConnections : [], card.getKey) }));
  }, [activeConnections, canShowConnectionStats]);

  const modeDisplayMap: Record<RunMode, { short: string; long: string }> = {
    rule: { short: '规则模式', long: '规则分流 (Rule)' },
    global: { short: '全局模式', long: '全局代理 (Global)' },
    direct: { short: '直连模式', long: '直接连接 (Direct)' },
  };
  const modeMeta = modeDisplayMap[config?.mode || 'rule'];
  const mixedPort = config?.['mixed-port'] || config?.port || '—';
  const hasMemorySample = canShowConnectionStats && currentMemory !== null &&
    Number.isFinite(currentMemory.inuse) && currentMemory.inuse >= 0;
  const memoryLimit = currentMemory && Number.isFinite(currentMemory.oslimit) && currentMemory.oslimit > 0
    ? currentMemory.oslimit
    : null;

  // Extract primary proxy groups (Selector, URLTest, Fallback) excluding GLOBAL with consistent partition sorting
  const proxyGroups = useMemo(() => {
    const rawProxyGroups = Object.values(proxies).filter(
      (p) => p.all && p.all.length > 0 && p.name !== 'GLOBAL'
    );
    return sortProxyGroups(rawProxyGroups)
      .sort((a, b) => Number(b.type === 'Selector') - Number(a.type === 'Selector'))
      .slice(0, 3);
  }, [proxies]);

  // Reconnect action (genuine controller handshake)
  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      const ok = await connectController();
      if (ok) {
        await refreshAll();
        showToast('已重新连接控制器并同步数据', 'success');
      } else {
        showToast('重新连接失败：无法访问外部控制器', 'error');
      }
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast('重新连接失败', 'error');
      }
    } finally {
      setTimeout(() => setIsReconnecting(false), 600);
    }
  };

  const handleCycleMode = async () => {
    const modes: RunMode[] = ['rule', 'global', 'direct'];
    const current = config?.mode || 'rule';
    const nextMode = modes[(modes.indexOf(current) + 1) % modes.length];
    try {
      await updateConfigMode(nextMode);
      showToast(`已切换至: ${modeDisplayMap[nextMode].long.split(' (')[0]}`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`切换模式失败: ${(err as Error)?.message}`, 'error');
      }
    }
  };

  // Test single node delay with visual spinner
  const handleTestDelay = async (e: React.MouseEvent, nodeName: string) => {
    e.stopPropagation();
    if (testingNodes[nodeName]) return;
    setTestingNodes((prev) => ({ ...prev, [nodeName]: true }));
    try {
      const delay = await testProxyDelay(nodeName);
      showToast(`${nodeName} 测速完成: ${delay}ms`, 'info');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`${nodeName} 测速超时`, 'error');
      }
    } finally {
      setTestingNodes((prev) => ({ ...prev, [nodeName]: false }));
    }
  };

  // Switch proxy node in selector group
  const handleSelectNode = async (groupName: string, targetNode: string) => {
    try {
      await switchProxy(groupName, targetNode);
      showToast(`已将 [${groupName}] 切换至: ${targetNode}`, 'success');
      setSelectedGroupForSwitch(null);
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`切换失败: ${(err as Error)?.message}`, 'error');
      }
    }
  };

  // Close all connections
  const handleConfirmCloseAll = async () => {
    try {
      await closeAllConnections();
      showToast('已关闭所有活动连接', 'info');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast('关闭全部连接失败', 'error');
      }
    } finally {
      setShowCloseAllConfirm(false);
    }
  };

  return (
    <div className="overview-container">
      {/* Demo Mode Notice Banner */}
      {demoMode && (
        <div className="demo-notice-banner" role="status">
          <span className="demo-notice-badge">✨ 仿真预览中</span>
          <span className="demo-notice-text">
            【仿真预览】当前正在使用内置模拟数据展示界面排版与交互体验。所有策略切换、测速探测、连接断开均为仿真动作。
          </span>
        </div>
      )}

      {/* Connecting Notice Banner */}
      {!demoMode && status === 'connecting' && (
        <div className="connecting-notice-banner" role="status">
          <span className="connecting-notice-badge">🔄 正在连接...</span>
          <span className="connecting-notice-text">
            正在与 META 核心控制器 ({baseUrl}) 建立通信并同步配置数据...
          </span>
        </div>
      )}

      {/* Disconnected Alert Banner */}
      {!demoMode && (status === 'disconnected' || status === 'error') && (
        <div className="disconnected-notice-banner" role="alert">
          <span className="disconnected-notice-badge">⚠️ 核心未连接</span>
          <span className="disconnected-notice-text">
            无法连接到 META 核心 ({baseUrl})。请检查控制器是否已启动、端口与密钥设置是否正确。
          </span>
          <div className="disconnected-actions">
            {onOpenSettings && (
              <button
                type="button"
                className="pill-btn"
                onClick={onOpenSettings}
              >
                前往配置
              </button>
            )}
            <button
              type="button"
              className="pill-btn primary"
              onClick={handleReconnect}
              disabled={isReconnecting}
            >
              {isReconnecting ? '正在重试...' : '重试连接'}
            </button>
          </div>
        </div>
      )}
      <section className="panel-right-system-style overview-services-panel" aria-labelledby="overview-services-title">
        <div className="panel-header-bar">
          <div className="panel-header-left">
            <Sliders size={19} className="panel-header-icon" aria-hidden="true" />
            <h2 id="overview-services-title" className="panel-heading-title">服务状态</h2>
          </div>
        </div>

        <div className="service-integration-grid" role="region" aria-label="核心服务状态网格">
          <div
            className="service-card clickable-card"
            onClick={() => void handleCycleMode()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void handleCycleMode();
              }
            }}
            data-tooltip="点击切换运行模式"
            role="button"
            tabIndex={0}
            aria-label={`当前运行模式：${modeMeta.long}；激活以切换`}
          >
            <div className="service-card-badge">{modeMeta.short}</div>
            <div className="service-card-icon-wrap icon-mode"><Sliders size={20} /></div>
            <div className="service-card-title">运行分流模式</div>
            <div className="service-card-sub">Rule / Global / Direct</div>
          </div>

          <div className="service-card" data-tooltip="内核混合代理监听端口">
            <div className="service-card-badge tabular-nums">{mixedPort}</div>
            <div className="service-card-icon-wrap icon-port"><Radio size={20} /></div>
            <div className="service-card-title">混合监听端口</div>
            <div className="service-card-sub">Socks5 &amp; HTTP 监听</div>
          </div>

          <div
            className="service-card clickable-card"
            onClick={() => onNavigateTab('rules')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onNavigateTab('rules');
              }
            }}
            data-tooltip="查看所有生效分流规则"
            role="button"
            tabIndex={0}
            aria-label="查看生效分流规则"
          >
            <div className="service-card-badge tabular-nums">{canShowConnectionStats ? rules.length.toLocaleString() : '—'}</div>
            <div className="service-card-icon-wrap icon-rules"><ShieldCheck size={20} /></div>
            <div className="service-card-title">生效分流规则</div>
            <div className="service-card-sub">GEOIP · 域名匹配</div>
          </div>

          <div
            className="service-card clickable-card"
            onClick={() => onNavigateTab('connections')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onNavigateTab('connections');
              }
            }}
            data-tooltip="查看全部活动连接"
            role="button"
            tabIndex={0}
            aria-label="查看全部活动连接"
          >
            <div className="service-card-badge tabular-nums">{canShowConnectionStats ? activeConnections.length : '—'}</div>
            <div className="service-card-icon-wrap icon-conn"><Activity size={20} /></div>
            <div className="service-card-title">当前活跃连接</div>
            <div className="service-card-sub">实时 WS 会话追踪</div>
          </div>

          <div
            className="service-card service-card-memory"
            data-tooltip={hasMemorySample ? '内核 /memory 报告的当前 inuse 值' : '连接控制器并收到有效内存采样后显示'}
            aria-label={hasMemorySample
              ? `内核 RAM 占用 ${formatBytes(currentMemory!.inuse)}${memoryLimit ? `，OS 限制 ${formatBytes(memoryLimit)}` : ''}`
              : '内核 RAM 占用暂无有效采样'}
          >
            <div className="service-card-badge tabular-nums">
              {hasMemorySample ? formatBytes(currentMemory!.inuse) : '—'}
            </div>
            <div className="service-card-icon-wrap icon-memory"><Database size={20} /></div>
            <div className="service-card-title">内核 RAM 占用</div>
            <div className="service-card-sub">
              {hasMemorySample
                ? memoryLimit
                  ? `OS 限制 ${formatBytes(memoryLimit)}`
                  : '实时 /memory 采样'
                : '等待有效采样'}
            </div>
          </div>
        </div>
      </section>

      {/* Real-time Traffic Rate History Chart */}
      <TrafficRateChart
        samples={trafficHistory}
        currentTraffic={currentTraffic}
        trafficTotal={trafficTotal}
        isConnected={isConnected}
        demoMode={demoMode}
      />

      <RuleFlowPanel
        connections={activeConnections}
        isConnected={isConnected}
        demoMode={demoMode}
      />

      {/* Slim Divider Line */}
      <div className="slim-divider-line" />

      {/* Strategy groups remain below the traffic and observed-route panels. */}
      <section className="dashboard-asymmetric-grid">
        {/*常用策略组：前三个可用策略组以三列并排呈现*/}
        <div className="panel-left-deal-style">
          <div className="panel-header-bar">
            <div className="panel-header-left">
              <Waypoints size={19} className="panel-header-icon" aria-hidden="true" />
              <h2 className="panel-heading-title">策略组分流</h2>
            </div>

            <div className="panel-header-actions">
              <button
                type="button"
                className="btn-circle-action size-md"
                onClick={() => onNavigateTab('proxies')}
                data-tooltip="跳转完整代理节点管理页面"
                aria-label="完整代理页面"
              >
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>

          {/* Deal Rows Container */}
          <div className="deal-rows-container">
            {proxyGroups.length === 0 ? (
              <div className="deal-empty-state">
                {isConnected || demoMode ? '暂无可用策略组' : '未连接到核心控制器，暂无代理数据'}
              </div>
            ) : (
              proxyGroups.map((group) => {
                const isSelector = group.type === 'Selector';
                const currentNode = group.now || '';
                const nodeItem = proxies[currentNode];
                const latestDelay = getActiveProxyDelay(group, proxies);
                const latency = getLatencyInfo(latestDelay);
                const testTarget = getActiveProxyLeaf(group, proxies)?.name;
                const isTesting = !!(testTarget && testingNodes[testTarget]);

                // Real node protocol from nodeItem.type (no fake multiplier!)
                const nodeProto = nodeItem?.type || (currentNode === 'DIRECT' ? 'Direct' : 'Proxy');

                return (
                  <div key={group.name} className="deal-row-card">
                    {/* Strategy group identity and per-group details navigation */}
                    <div className="deal-card-left">
                      <div className="deal-group-title" data-tooltip={group.name}>
                        <CircularFlag name={group.name} size={18} className="group-flag-inline" />
                        <span className="deal-group-name">{sanitizeDisplayName(group.name)}</span>
                      </div>

                      <div className="deal-meta-text">
                        类型: {group.type} · 包含 {(group.all || []).length} 个节点 · 实时
                      </div>
                    </div>

                    {/* Right Half: Flag Avatar + Selected Node Info + Circular Actions */}
                    <div className="deal-card-right">
                      <div className="deal-flag-avatar" data-tooltip={`节点所属地区/类型: ${currentNode}`}>
                        <CircularFlag name={currentNode} size={24} />
                      </div>

                      <div className="deal-node-info">
                        <div className="deal-node-name" data-tooltip={currentNode || '未选定'}>
                          {sanitizeDisplayName(currentNode) || '未选定'}
                        </div>
                        <div className="deal-node-proto">
                          {nodeProto}
                        </div>
                      </div>


                      <div className="deal-actions-group">
                        <span
                          className={`node-latency-tag ${latency.className}`}
                          data-tooltip={`当前选定「${currentNode || '未指定'}」延迟: ${latency.text}`}
                          aria-label={`当前选定「${currentNode || '未指定'}」延迟: ${latency.text}`}
                        >
                          {latency.text}
                        </span>
                        {/* Test delay circular button */}
                        <button
                          type="button"
                          className="btn-circle-action size-md"
                          onClick={(e) => { if (testTarget) void handleTestDelay(e, testTarget); }}
                          disabled={!currentNode || !testTarget || isTesting}
                          data-tooltip={testTarget ? `测速 ${testTarget}` : '当前路由无法测速'}
                          aria-label={testTarget ? `测速 ${testTarget}` : '当前路由无法测速'}
                        >
                          <Zap size={14} className={isTesting ? 'spin-animation' : ''} />
                        </button>

                        {/* Switch node circular button */}
                        <button
                          type="button"
                          className="btn-circle-action size-md"
                          onClick={() => isSelector && setSelectedGroupForSwitch(group)}
                          disabled={!isSelector}
                          data-tooltip={isSelector ? `切换 [${group.name}] 节点` : `${group.type} 策略自动调度，不可手动切换`}
                          aria-label={`切换 ${group.name} 节点`}
                        >
                          <ArrowLeftRight size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </section>

      <section className="overview-full-card overview-rankings-panel" aria-labelledby="overview-rankings-title">
        <div className="panel-header-bar overview-activity-header">
          <div className="panel-header-left">
            <RadioTower size={19} className="panel-header-icon" aria-hidden="true" />
            <h2 id="overview-rankings-title" className="panel-heading-title">活动连接</h2>
          </div>
          <div className="panel-header-actions">
            <button
              type="button"
              className="btn-circle-action size-md"
              onClick={() => setShowCloseAllConfirm(true)}
              disabled={!canShowConnectionStats || activeConnections.length === 0}
              data-tooltip="一键断开全部活动连接"
              aria-label="一键断开全部连接"
            >
              <X size={15} />
            </button>
            <button type="button" className="btn-circle-action size-md" onClick={() => onNavigateTab('connections')} data-tooltip="进入完整连接追踪页面" aria-label="完整连接页面">
              <ArrowUpRight size={15} />
            </button>
          </div>
        </div>

        <div className="overview-rankings" aria-label="当前活动连接快照流量排行">
          {rankingCards.map(({ id, title, Icon, rows }) => (
            <section className="overview-ranking-card" key={id} aria-labelledby={`overview-ranking-${id}`}>
              <div className="overview-ranking-title">
                <Icon size={17} aria-hidden="true" />
                <h3 id={`overview-ranking-${id}`}>{title}</h3>
              </div>
              {rows.length > 0 ? (
                <ol className="overview-rank-list">
                  {rows.map((row, index) => {
                    const share = Math.max(0, Math.min(100, row.share));
                    return (
                      <li className="overview-rank-row" key={row.key}>
                        <div className="overview-rank-main">
                          <span className="overview-rank-index">{index + 1}</span>
                          <strong data-tooltip={row.key}>{row.key}</strong>
                          <b>{formatBytes(row.download + row.upload)}</b>
                        </div>
                        <div className="overview-rank-track" role="progressbar" aria-label={`${row.key} 流量占比`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(share.toFixed(1))}>
                          <span style={{ width: `${share}%` }} />
                        </div>
                        <div className="overview-rank-meta">
                          <span className="download">↓ {formatBytes(row.download)}</span>
                          <span className="upload">↑ {formatBytes(row.upload)}</span>
                          <span>{row.count} 条</span>
                          <span>{share.toFixed(1)}%</span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="overview-ranking-empty" role="status">
                  {canShowConnectionStats
                    ? '暂无活动连接数据'
                    : status === 'connecting'
                      ? '正在同步活动连接数据'
                      : '控制器未连接，暂无活动统计'}
                </div>
              )}
            </section>
          ))}
        </div>
      </section>

      {/* =========================================================================
          5. Modals & Dialogs
          ========================================================================= */}
      {/* Node Switch Modal */}
      {selectedGroupForSwitch && (
        <Modal
          isOpen={!!selectedGroupForSwitch}
          onClose={() => setSelectedGroupForSwitch(null)}
          title={`切换策略组节点: ${selectedGroupForSwitch.name}`}
          maxWidth="560px"
        >
          <div className="node-switch-modal-body">
            <p className="node-switch-tip">请选择要接入的目标节点（立即生效）：</p>
            <div className="node-switch-list">
              {(selectedGroupForSwitch.all || []).map((nodeName) => {
                const isSelected = selectedGroupForSwitch.now === nodeName;
                const nodeItem = proxies[nodeName];
                const delay = getActiveProxyDelay(nodeItem, proxies);

                return (
                  <button
                    key={nodeName}
                    type="button"
                    className={`node-switch-item ${isSelected ? 'active' : ''}`}
                    onClick={() => handleSelectNode(selectedGroupForSwitch.name, nodeName)}
                  >
                    <div className="node-switch-item-left">
                      <CircularFlag name={nodeName} size={20} className="node-switch-flag" />
                      <span className="node-switch-name">{sanitizeDisplayName(nodeName)}</span>
                    </div>


                    <div className="node-switch-item-right">
                      {delay !== undefined && delay > 0 && (
                        <span className="node-switch-delay tabular-nums">⚡ {delay}ms</span>
                      )}
                      {isSelected && <Check size={16} className="node-switch-check" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Close All Connections Dialog */}
      <ConfirmDialog
        isOpen={showCloseAllConfirm}
        onClose={() => setShowCloseAllConfirm(false)}
        onConfirm={handleConfirmCloseAll}
        title="确认断开全部活动连接？"
        message={`即将断开当前所有的 ${activeConnections.length} 条活动网络连接。此操作可能会中断正在进行的下载或网络会话。`}
        confirmText="确认断开全部"
        cancelText="取消"
        isDestructive={true}
      />

    </div>
  );
};
