import React, { useState, useEffect } from 'react';
import { useController } from '../../context/ControllerContext';
import { formatBytes, formatSpeed, formatTime, extractVersionToken } from '../../utils/format';
import {
  calculateOutboundDistribution,
  calculateProtocolDistribution,
  matchFlagForNodeName,
  stripLeadingFlag,
  formatMicroTimestamp
} from '../../utils/allocation';
import { sortProxyGroups, matchRegionFlag, sanitizeDisplayName } from '../../utils/proxy';
import { CircularFlag } from '../common/CircularFlag';

import { 
  RotateCcw,
  ExternalLink,
  MoreHorizontal,
  ArrowUpRight,
  X,
  Zap,
  ArrowLeftRight,
  ShieldCheck,
  Radio,
  Activity,
  Sliders,
  Check,
  Globe
} from 'lucide-react';
import { useToast } from '../common/Toast';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { RunMode, ProxyItem } from '../../types/api';

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
    version,
    config,
    updateConfigMode,
    connectController,
    refreshAll,
    currentTraffic,
    trafficTotal,
    currentMemory,
    proxies,
    connections,
    rules,
    switchProxy,
    testProxyDelay,
    closeConnection,
    closeAllConnections
  } = useController();

  const { showToast } = useToast();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [testingNodes, setTestingNodes] = useState<Record<string, boolean>>({});
  const [connToClose, setConnToClose] = useState<{ id: string; host: string } | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [selectedGroupForSwitch, setSelectedGroupForSwitch] = useState<ProxyItem | null>(null);
  const [optimisticClosedIds, setOptimisticClosedIds] = useState<Record<string, boolean>>({});
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  const isConnected = status === 'connected';

  // Clock ticker for micro-typography (updates every second)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter out optimistic closed connections
  const activeConnections = connections.filter((c) => !optimisticClosedIds[c.id]);

  // Outbound & Protocol Distributions
  const outboundSegments = calculateOutboundDistribution(activeConnections, demoMode);
  const protocolSegments = calculateProtocolDistribution(activeConnections, demoMode);

  // Extract primary proxy groups (Selector, URLTest, Fallback) excluding GLOBAL with consistent partition sorting
  const rawProxyGroups = Object.values(proxies).filter(
    (p) => p.all && p.all.length > 0 && p.name !== 'GLOBAL'
  );
  const proxyGroups = sortProxyGroups(rawProxyGroups);

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
    } catch {
      showToast('重新连接失败', 'error');
    } finally {
      setTimeout(() => setIsReconnecting(false), 600);
    }
  };

  // Mode cycle toggle from 4-grid card
  const handleCycleMode = async () => {
    const modes: RunMode[] = ['rule', 'global', 'direct'];
    const current = config?.mode || 'rule';
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    const nextMode = modes[nextIdx];
    try {
      await updateConfigMode(nextMode);
      const names: Record<RunMode, string> = { rule: '规则分流', global: '全局代理', direct: '直接连接' };
      showToast(`已切换至: ${names[nextMode]}`, 'success');
    } catch (err: unknown) {
      showToast(`切换模式失败: ${(err as Error)?.message}`, 'error');
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
    } catch {
      showToast(`${nodeName} 测速超时`, 'error');
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
      showToast(`切换失败: ${(err as Error)?.message}`, 'error');
    }
  };

  // Optimistic close single connection
  const handleCloseSingleConnection = async (id: string, host: string) => {
    setOptimisticClosedIds((prev) => ({ ...prev, [id]: true }));
    try {
      await closeConnection(id);
      showToast(`已断开连接: ${host}`, 'info');
    } catch {
      // Revert optimistic removal
      setOptimisticClosedIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      showToast(`断开连接失败: ${host}`, 'error');
    }
  };

  // Close all connections
  const handleConfirmCloseAll = async () => {
    try {
      await closeAllConnections();
      showToast('已关闭所有活动连接', 'info');
    } catch {
      showToast('关闭全部连接失败', 'error');
    } finally {
      setShowCloseAllConfirm(false);
    }
  };

  // Parse endpoint host:port from baseUrl
  const endpointDisplay = (() => {
    try {
      const u = new URL(baseUrl);
      return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
    } catch {
      return baseUrl.replace(/^https?:\/\//, '');
    }
  })();

  // Mode display names
  const modeDisplayMap: Record<RunMode, { short: string; long: string }> = {
    rule: { short: '规则模式', long: '规则分流 (Rule)' },
    global: { short: '全局模式', long: '全局代理 (Global)' },
    direct: { short: '直连模式', long: '直接连接 (Direct)' }
  };
  const activeMode = config?.mode || 'rule';
  const modeMeta = modeDisplayMap[activeMode];

  // Core version display (Strict API truth, no fabricated OS or Go runtime)
  const coreVersionDisplay = demoMode
    ? 'Demo'
    : status === 'connected' && version?.version
    ? extractVersionToken(version.version) || 'META'
    : status === 'connecting'
    ? '连接中...'
    : isConnected
    ? 'META'
    : '—';

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


      {/* =========================================================================
          1. Core Hero Section (Big Core Identity & Aligned Small Metadata)
          ========================================================================= */}
      <section className="core-hero-section">
        {/* Left: Reconnect Button + Main Title + Version/Mode Capsule */}
        <div className="hero-title-group">
          <button
            type="button"
            className="btn-circle-action size-lg hero-reconnect-btn"
            onClick={handleReconnect}
            disabled={isReconnecting}
            data-tooltip="重新连接控制器并同步数据"
            aria-label="重新连接控制器"
          >
            <RotateCcw size={16} className={isReconnecting ? 'spin-animation' : ''} />
          </button>

          <div className="hero-heading-block">
            <div className="hero-title-row">
              <h1 className="hero-core-title">META Core</h1>
              <span className="hero-version-capsule">
                {coreVersionDisplay} · {modeMeta.short}
              </span>
            </div>
          </div>
        </div>

        {/* Center: 5 Columns of Aligned Real Metadata (2x2 + secondary strip on mobile) */}
        <div className="hero-inline-metadata" aria-label="核心运行时参数概览">
          <div className="hero-metadata-grid-2x2">
            <div className="hero-metadata-cell">
              <span className="metadata-cell-label">核心版本</span>
              <span className="metadata-cell-value tabular-nums">{coreVersionDisplay}</span>
            </div>

            <div 
              className="hero-metadata-cell clickable-meta-cell" 
              onClick={handleCycleMode} 
              data-tooltip="点击切换运行模式"
              role="button"
              tabIndex={0}
            >
              <span className="metadata-cell-label">运行模式</span>
              <span className="metadata-cell-value">{modeMeta.long}</span>
            </div>

            <div className="hero-metadata-cell">
              <span className="metadata-cell-label">控制端点</span>
              <span className="metadata-cell-value tabular-nums">{endpointDisplay}</span>
            </div>

            <div className="hero-metadata-cell">
              <span className="metadata-cell-label">混合端口</span>
              <span className="metadata-cell-value tabular-nums">
                {config ? `${config['mixed-port'] || config.port || 7890} (Mixed)` : isConnected ? '7890' : '—'}
              </span>
            </div>
          </div>

          <div 
            className="hero-metadata-secondary-strip"
            onClick={() => onNavigateTab('rules')}
            role="button"
            tabIndex={0}
            data-tooltip="查看生效规则明细"
          >
            <span className="metadata-cell-label">生效规则</span>
            <span className="metadata-cell-value tabular-nums">
              {isConnected || demoMode ? `${rules.length.toLocaleString()} 条` : '—'}
            </span>
          </div>
        </div>


        {/* Right: Quick Action Buttons */}
        <div className="hero-quick-actions">
          <button
            type="button"
            className="btn-circle-action size-lg"
            onClick={onOpenSettings}
            data-tooltip="控制中心菜单与设置"
            aria-label="控制中心设置"
          >
            <MoreHorizontal size={17} />
          </button>

          <a
            href="https://metacubex.github.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-circle-action size-lg"
            data-tooltip="在新标签页中打开官方文档"
            aria-label="查看官方文档"
          >
            <ArrowUpRight size={17} />
          </a>
        </div>
      </section>

      {/* =========================================================================
          2. Allocation Ribbons Section (Dual Segmented Colored & Patterned Bars)
          ========================================================================= */}
      <section className="allocation-ribbons-section">
        {/* Left Card: Outbound Allocation & Downstream Throughput */}
        <div className="ribbon-card">
          {/* Header Segment Labels */}
          <div className="ribbon-header-row">
            <div className="ribbon-header-labels">
              {demoMode && <span className="demo-tag-pill">【仿真】</span>}
              {outboundSegments.length === 0 ? (
                <span className="ribbon-empty-text">当前无活动出站连接</span>
              ) : (
                outboundSegments.map((seg) => (
                  <span key={seg.name} className="ribbon-label-item">
                    <span className={`ribbon-color-dot ${seg.colorClass}`} />
                    <span className="ribbon-label-name">{seg.name}</span>
                    <span className="ribbon-label-pct tabular-nums">{seg.percentage}%</span>
                  </span>
                ))
              )}
            </div>

            <button
              type="button"
              className="btn-circle-action size-sm ribbon-corner-btn"
              onClick={() => onNavigateTab('connections')}
              data-tooltip="查看连接追踪明细"
              aria-label="查看连接明细"
            >
              <ArrowUpRight size={14} />
            </button>
          </div>

          {/* Segmented Ribbon Bar (Multi-color or Honest Empty Track) */}
          <div className="segmented-ribbon-bar" role="progressbar" aria-label="出站链路分流配比条带">
            {outboundSegments.length === 0 ? (
              <div className="ribbon-segment pattern-empty-track full-track">
                <span>当前无活动连接 / 空载</span>
              </div>
            ) : (
              outboundSegments.map((seg) => (
                <div
                  key={seg.name}
                  className={`ribbon-segment ${seg.colorClass}`}
                  style={{ width: `${seg.percentage}%` }}
                  data-tooltip={`出站链路 [${seg.name}]: ${seg.count} 条连接 (占比 ${seg.percentage}%)`}
                >
                  {seg.percentage >= 14 && (
                    <span className="segment-inner-pct tabular-nums">{seg.percentage}%</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Metric Footer: Big Value + Subtitle + Micro Date Timestamp */}
          <div className="ribbon-metric-footer">
            <div className="metric-footer-left">
              <div className="ribbon-big-value tabular-nums">
                ↓ {isConnected || demoMode ? (currentTraffic ? formatSpeed(currentTraffic.down) : '0 B/s') : '— B/s'}
              </div>
              <div className="ribbon-sub-label">
                实时下行速率 · 累计会话下载 {formatBytes(trafficTotal.downTotal)}
              </div>
            </div>

            <div className="metric-footer-right">
              <div className="ribbon-micro-time tabular-nums">
                {formatMicroTimestamp(currentTime)}
              </div>
              <div className="ribbon-micro-sub">采样周期 1s</div>
            </div>
          </div>
        </div>

        {/* Right Card: Network Protocol & Core Memory */}
        <div className="ribbon-card">
          {/* Header Segment Labels */}
          <div className="ribbon-header-row">
            <div className="ribbon-header-labels">
              {demoMode && <span className="demo-tag-pill">【仿真】</span>}
              {protocolSegments.length === 0 ? (
                <span className="ribbon-empty-text">当前无活动传输协议</span>
              ) : (
                protocolSegments.map((seg) => (
                  <span key={seg.name} className="ribbon-label-item">
                    <span className={`ribbon-color-dot ${seg.patternClass}`} />
                    <span className="ribbon-label-name">{seg.name}</span>
                    <span className="ribbon-label-pct tabular-nums">{seg.percentage}%</span>
                  </span>
                ))
              )}
            </div>

            <button
              type="button"
              className="btn-circle-action size-sm ribbon-corner-btn"
              onClick={() => setShowCloseAllConfirm(true)}
              disabled={activeConnections.length === 0}
              data-tooltip="一键断开全部活动连接"
              aria-label="一键断开全部连接"
            >
              <X size={13} />
            </button>
          </div>

          {/* Segmented Ribbon Bar (Patterned: Dark dots & Gray stripes, or Empty Track) */}
          <div className="segmented-ribbon-bar" role="progressbar" aria-label="传输协议配比条带">
            {protocolSegments.length === 0 ? (
              <div className="ribbon-segment pattern-empty-track full-track">
                <span>当前无活动传输协议 / 空载</span>
              </div>
            ) : (
              protocolSegments.map((seg) => (
                <div
                  key={seg.name}
                  className={`ribbon-segment ${seg.patternClass}`}
                  style={{ width: `${seg.percentage}%` }}
                  data-tooltip={`传输协议 [${seg.name}]: ${seg.count} 条连接 (占比 ${seg.percentage}%)`}
                >
                  {seg.percentage >= 14 && (
                    <span className="segment-inner-pct tabular-nums">{seg.percentage}%</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Metric Footer: Big Memory Value + Subtitle + Micro Source */}
          <div className="ribbon-metric-footer">
            <div className="metric-footer-left">
              <div className="ribbon-big-value tabular-nums">
                {isConnected || demoMode ? (currentMemory && currentMemory.inuse > 0 ? formatBytes(currentMemory.inuse) : '0 B') : '— MB'}
              </div>
              <div className="ribbon-sub-label">
                系统内存占用 {currentMemory?.oslimit && currentMemory.oslimit > 0 ? `· 系统限制 ${formatBytes(currentMemory.oslimit)}` : ''}
              </div>
            </div>

            <div className="metric-footer-right">
              <div className="ribbon-micro-time tabular-nums">
                {formatMicroTimestamp(currentTime)}
              </div>
              <div className="ribbon-micro-sub">来源 WS /memory</div>
            </div>

          </div>
        </div>
      </section>

      {/* =========================================================================
          3. Slim Divider Line
          ========================================================================= */}
      <div className="slim-divider-line" />

      {/* =========================================================================
          4. Lower Asymmetric Split (42% Deal History Proxies : 58% Services & Conn)
          ========================================================================= */}
      <section className="dashboard-asymmetric-grid">
        {/* Left Column (42%): Deal History Style Proxy Rows */}
        <div className="panel-left-deal-style">
          <div className="panel-header-bar">
            <div className="panel-header-left">
              <h2 className="panel-heading-title">策略组分流</h2>
              <span className="panel-dots-subtle">···</span>
            </div>

            <div className="panel-header-actions">
              <button
                type="button"
                className="btn-circle-action size-md"
                onClick={() => onNavigateTab('proxies')}
                data-tooltip="代理策略组视图"
                aria-label="筛选代理策略"
              >
                <MoreHorizontal size={15} />
              </button>
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
              proxyGroups.slice(0, 4).map((group) => {
                const isSelector = group.type === 'Selector';
                const currentNode = group.now || '';
                const nodeItem = proxies[currentNode];
                const latestDelay = nodeItem?.history?.[0]?.delay;
                const flagEmoji = matchFlagForNodeName(currentNode);
                const isTesting = testingNodes[currentNode];

                // Deal pill text & tone
                const delayText = latestDelay !== undefined && latestDelay > 0 ? `⚡ ${latestDelay} ms` : '⚡ — ms';
                const pillToneClass = latestDelay !== undefined && latestDelay > 0
                  ? latestDelay < 150
                    ? 'pill-tone-cream'
                    : latestDelay < 350
                    ? 'pill-tone-blue'
                    : 'pill-tone-amber'
                  : 'pill-tone-neutral';

                // Real node protocol from nodeItem.type (no fake multiplier!)
                const nodeProto = nodeItem?.type || (currentNode === 'DIRECT' ? 'Direct' : 'Proxy');

                return (
                  <div key={group.name} className="deal-row-card">
                    {/* Left Half: Large Colored Pill + Group Title + Metadata */}
                    <div className="deal-card-left">
                      <div className={`deal-pill-badge ${pillToneClass}`}>
                        <span className="deal-pill-text tabular-nums">{delayText}</span>
                        <button
                          type="button"
                          className="deal-pill-arrow-btn"
                          onClick={() => onNavigateTab('proxies')}
                          data-tooltip={`查看 [${group.name}] 所有节点`}
                          aria-label={`查看 ${group.name} 详情`}
                        >
                          <ArrowUpRight size={11} />
                        </button>
                      </div>

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
                        {/* Test delay circular button */}
                        <button
                          type="button"
                          className="btn-circle-action size-md"
                          onClick={(e) => handleTestDelay(e, currentNode)}
                          disabled={!currentNode || isTesting}
                          data-tooltip={`测速 ${currentNode}`}
                          aria-label={`测速 ${currentNode}`}
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

        {/* Right Column (58%): 4-Grid System Tiles & Dense Connections Table */}
        <div className="panel-right-system-style">
          <div className="panel-header-bar">
            <div className="panel-header-left">
              <h2 className="panel-heading-title">活动连接与服务</h2>
              <span className="panel-dots-subtle">···</span>
            </div>

            <div className="panel-header-actions">
              <button
                type="button"
                className="btn-circle-action size-md"
                onClick={() => setShowCloseAllConfirm(true)}
                disabled={activeConnections.length === 0}
                data-tooltip="一键断开全部活动连接"
                aria-label="一键断开全部连接"
              >
                <X size={15} />
              </button>
              <button
                type="button"
                className="btn-circle-action size-md"
                onClick={() => onNavigateTab('connections')}
                data-tooltip="连接配置与排序"
                aria-label="连接配置"
              >
                <MoreHorizontal size={15} />
              </button>
              <button
                type="button"
                className="btn-circle-action size-md"
                onClick={() => onNavigateTab('connections')}
                data-tooltip="进入完整连接追踪页面"
                aria-label="完整连接页面"
              >
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>

          {/* 4-Grid Core System Status Cards (Real API-Backed, NO Fake DNS/TUN States) */}
          <div className="service-integration-grid" role="region" aria-label="核心服务状态网格">
            {/* Tile 1: Run Mode */}
            <div 
              className="service-card clickable-card" 
              onClick={handleCycleMode}
              data-tooltip="点击切换运行模式"
              role="button"
              tabIndex={0}
            >
              <div className="service-card-badge">{modeMeta.short}</div>
              <div className="service-card-icon-wrap icon-mode">
                <Sliders size={20} />
              </div>
              <div className="service-card-title">运行分流模式</div>
              <div className="service-card-sub">Rule / Global / Direct</div>
            </div>

            {/* Tile 2: Listening Port */}
            <div className="service-card" data-tooltip="内核混合代理监听端口">
              <div className="service-card-badge tabular-nums">
                {config ? config['mixed-port'] || config.port || 7890 : isConnected ? '7890' : '—'}
              </div>
              <div className="service-card-icon-wrap icon-port">
                <Radio size={20} />
              </div>
              <div className="service-card-title">混合监听端口</div>
              <div className="service-card-sub">Socks5 & HTTP 监听</div>
            </div>

            {/* Tile 3: Active Rules */}
            <div 
              className="service-card clickable-card" 
              onClick={() => onNavigateTab('rules')}
              data-tooltip="查看所有生效分流规则"
              role="button"
              tabIndex={0}
            >
              <div className="service-card-badge tabular-nums">
                {isConnected || demoMode ? rules.length.toLocaleString() : '—'}
              </div>
              <div className="service-card-icon-wrap icon-rules">
                <ShieldCheck size={20} />
              </div>
              <div className="service-card-title">生效分流规则</div>
              <div className="service-card-sub">GEOIP · 域名匹配</div>
            </div>

            {/* Tile 4: Active Connections */}
            <div 
              className="service-card clickable-card" 
              onClick={() => onNavigateTab('connections')}
              data-tooltip="查看全部活动连接"
              role="button"
              tabIndex={0}
            >
              <div className="service-card-badge tabular-nums">
                {activeConnections.length}
              </div>
              <div className="service-card-icon-wrap icon-conn">
                <Activity size={20} />
              </div>
              <div className="service-card-title">当前活跃连接</div>
              <div className="service-card-sub">实时 WS 会话追踪</div>
            </div>
          </div>

          {/* Dense Connections Table (Blue Link Style) */}
          <div className="connections-dense-table-wrapper">
            <table className="connections-dense-table">
              <thead>
                <tr className="table-header-row">
                  <th style={{ width: '4%' }} aria-label="状态指示点" />
                  <th style={{ width: '36%' }}>目标主机 (Host)</th>
                  <th style={{ width: '32%' }}>关联进程与链路</th>
                  <th style={{ width: '16%' }}>建立时间</th>
                  <th style={{ width: '12%', textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {activeConnections.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table-empty-td">
                      {isConnected || demoMode ? '当前无活动网络连接' : '未连接到控制器，暂无连接数据'}
                    </td>
                  </tr>
                ) : (
                  activeConnections.slice(0, 5).map((conn) => {
                    const host = conn.metadata.host || conn.metadata.destinationIP || '未知主机';
                    const process = conn.metadata.process || conn.metadata.network.toUpperCase();
                    const chainText = (conn.chains || []).map(stripLeadingFlag).join(' → ') || '直连';

                    return (
                      <tr key={conn.id} className="conn-table-row">
                        {/* Dot indicator */}
                        <td className="conn-dot-cell">
                          <span className="conn-active-dot" />
                        </td>

                        {/* Blue Link Host */}
                        <td className="conn-host-cell">
                          <span
                            className="conn-host-link"
                            data-tooltip={`点击跳转查看详情: ${host}`}
                            onClick={() => onNavigateTab('connections')}
                            role="button"
                            tabIndex={0}
                          >
                            {host}
                          </span>
                        </td>

                        {/* Process & Chain */}
                        <td className="conn-process-cell">
                          <span className="conn-process-text" data-tooltip={`${process} · ${chainText}`}>
                            {process} · {chainText}
                          </span>
                        </td>

                        {/* Time */}
                        <td className="conn-time-cell tabular-nums">
                          {formatTime(conn.start)}
                        </td>

                        {/* Action: Status pill + Optimistic Close Button */}
                        <td className="conn-action-cell">
                          <span className="conn-status-pill">活跃</span>
                          <button
                            type="button"
                            className="btn-circle-action size-xs danger conn-close-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseSingleConnection(conn.id, host);
                            }}
                            data-tooltip={`断开连接: ${host}`}
                            aria-label={`断开连接 ${host}`}
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
                const delay = nodeItem?.history?.[0]?.delay;

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

      {/* Confirm Close Single Connection Dialog */}
      <ConfirmDialog
        isOpen={!!connToClose}
        onClose={() => setConnToClose(null)}
        onConfirm={() => {
          if (connToClose) {
            handleCloseSingleConnection(connToClose.id, connToClose.host);
            setConnToClose(null);
          }
        }}
        title="确认断开该连接？"
        message={`即将断开与 ${connToClose?.host} 的活动会话。`}
        confirmText="确认断开"
        cancelText="取消"
        isDestructive={true}
      />
    </div>
  );
};
