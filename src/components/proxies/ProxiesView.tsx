import React, { useMemo, useState } from 'react';
import { isActionCancelledError, useController } from '../../context/ControllerContext';
import { getLatencyInfo } from '../../utils/format';
import { Search, Zap, X, Shield, ArrowUpDown, Navigation, ChevronsUpDown, ChevronsDownUp, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useToast } from '../common/Toast';
import { RunMode, ProxyItem } from '../../types/api';
import { sortProxyGroups, sortProxyNodesByDelay, filterProxyGroups, sanitizeDisplayName, getLatestProxyDelay } from '../../utils/proxy';
import { CircularFlag } from '../common/CircularFlag';
import {
  getStoredProxiesIsCompact,
  setStoredProxiesIsCompact,
  getStoredProxiesGroupOverrides,
  setStoredProxiesGroupOverrides
} from '../../utils/proxyPersistence';

export const ProxiesView: React.FC = () => {
  const {
    proxies,
    config,
    hideGlobal,
    updateConfigMode,
    switchProxy,
    unfixProxy,
    testProxyDelay,
    testProxyDelayBatch,
    status
  } = useController();

  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [testingNodes, setTestingNodes] = useState<Record<string, boolean>>({});
  const [isGroupTesting, setIsGroupTesting] = useState<Record<string, boolean>>({});
  const [isUnfixingGroup, setIsUnfixingGroup] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<'default' | 'delay' | 'name'>('default');
  const [isCompact, setIsCompact] = useState<boolean>(() => getStoredProxiesIsCompact());
  const [expandedGroupOverrides, setExpandedGroupOverrides] = useState<Record<string, boolean>>(() => getStoredProxiesGroupOverrides());

  const handleToggleGlobalLayout = () => {
    setIsCompact((prev) => {
      const next = !prev;
      setStoredProxiesIsCompact(next);
      return next;
    });
    setExpandedGroupOverrides({});
    setStoredProxiesGroupOverrides({});
  };

  const toggleGroupExpand = (groupName: string) => {
    setExpandedGroupOverrides((prev) => {
      const next = {
        ...prev,
        [groupName]: !prev[groupName]
      };
      setStoredProxiesGroupOverrides(next);
      return next;
    });
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>, groupName: string) => {
    if (!isCompact) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a, [role="button"]')) {
      return;
    }
    toggleGroupExpand(groupName);
  };

  const isConnected = status === 'connected';

  // 1. Get all proxy groups
  const allGroups = useMemo(
    () => Object.values(proxies).filter((p) => p.all && p.all.length > 0),
    [proxies]
  );

  // 2. Sort groups (referenced child groups appear before unreferenced groups; stable within partitions)
  const sortedGroups = useMemo(() => sortProxyGroups(allGroups), [allGroups]);

  // 3. Filter groups (hide GLOBAL if configured, filter by search term)
  const filteredGroups = filterProxyGroups(sortedGroups, {
    hideGlobal,
    search
  });

  const handleModeChange = async (mode: RunMode) => {
    try {
      await updateConfigMode(mode);
      const modeNames: Record<RunMode, string> = { rule: '规则模式', global: '全局模式', direct: '直连模式' };
      showToast(`已切换至 ${modeNames[mode]}`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`切换模式失败: ${(err as Error)?.message || '请求失败'}`, 'error');
      }
    }
  };

  const handleSwitch = async (groupName: string, nodeName: string) => {
    try {
      await switchProxy(groupName, nodeName);
      showToast(`已将 [${groupName}] 切换为: ${nodeName}`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`切换失败: ${(err as Error)?.message || '请求失败'}`, 'error');
      }
    }
  };

  const handleUnfixGroup = async (groupName: string) => {
    setIsUnfixingGroup((prev) => ({ ...prev, [groupName]: true }));
    try {
      await unfixProxy(groupName);
      showToast(`已恢复 [${groupName}] 自动选择`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`恢复自动选择失败: ${(err as Error)?.message || '请求失败'}`, 'error');
      }
    } finally {
      setIsUnfixingGroup((prev) => ({ ...prev, [groupName]: false }));
    }
  };

  const handleSingleTest = async (e: React.MouseEvent, nodeName: string) => {
    e.stopPropagation();
    setTestingNodes((prev) => ({ ...prev, [nodeName]: true }));
    try {
      const delay = await testProxyDelay(nodeName);
      showToast(`${nodeName} 测速完成: ${delay}ms`, 'info');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`${nodeName} 测速失败/超时`, 'error');
      }
    } finally {
      setTestingNodes((prev) => ({ ...prev, [nodeName]: false }));
    }
  };

  const handleGroupTestAll = async (group: ProxyItem) => {
    if (!group.all || group.all.length === 0) return;
    setIsGroupTesting((prev) => ({ ...prev, [group.name]: true }));
    showToast(`正在批量测速 [${group.name}] 中的节点...`, 'info');

    try {
      await testProxyDelayBatch(group.all);
      showToast(`[${group.name}] 批量测速已完成`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`[${group.name}] 批量测速失败`, 'error');
      }
    } finally {
      setIsGroupTesting((prev) => ({ ...prev, [group.name]: false }));
    }
  };

  const sortNodes = (nodes: string[]) => {
    if (sortBy === 'default') return nodes;

    const copy = [...nodes];
    if (sortBy === 'name') {
      return copy.sort((a, b) => a.localeCompare(b));
    }
    if (sortBy === 'delay') {
      return sortProxyNodesByDelay(copy, proxies);
    }
    return copy;
  };

  return (
    <div className="proxies-view-container">
      {/* Header Toolbar */}
      <div className="proxies-toolbar meta-card">
        <div className="toolbar-left">
          {/* Mode Switcher */}
          <div className="mode-segmented-capsule" role="group" aria-label="分流模式切换">
            {(['rule', 'global', 'direct'] as RunMode[]).map((mode) => {
              const label = mode === 'rule' ? '规则模式' : mode === 'global' ? '全局模式' : '直连模式';
              const isActive = config?.mode === mode;
              return (
                <button
                  key={mode}
                  className={`mode-capsule-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleModeChange(mode)}
                  disabled={!isConnected}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Sort Pill Dropdown / Toggle */}
          <button
            className="pill-btn sort-toggle-btn"
            onClick={() => {
              const order: Array<'default' | 'delay' | 'name'> = ['default', 'delay', 'name'];
              const nextIdx = (order.indexOf(sortBy) + 1) % order.length;
              setSortBy(order[nextIdx]);
            }}
            data-tooltip="切换节点排序方式"
          >
            <ArrowUpDown size={14} />
            <span>
              {sortBy === 'default' ? '默认排序' : sortBy === 'delay' ? '延迟最低' : '名称字母'}
            </span>
          </button>

          {/* Layout Toggle Button (Compact Flag-only vs Expanded Cards) */}
          <button
            type="button"
            className={`btn-circle-action size-md layout-toggle-btn ${isCompact ? 'active' : ''}`}
            onClick={handleToggleGlobalLayout}
            data-tooltip={isCompact ? '全部展开为卡片模式' : '全部收起为紧凑模式'}
            aria-label={isCompact ? '全部展开为卡片模式' : '全部收起为紧凑模式'}
            aria-pressed={isCompact}
          >
            {isCompact ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </button>
        </div>

        <div className="toolbar-right">
          <div className="search-pill-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-mini-input"
              placeholder="搜索代理组或节点..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Group Cards List */}
      <div className="proxies-groups-grid">
        {filteredGroups.length === 0 ? (
          <div className="meta-card empty-card-box">
            <Shield size={32} color="var(--text-muted)" />
            <h4>{isConnected ? '没有匹配的代理组' : '未连接核心'}</h4>
            <p>{isConnected ? '请尝试修改搜索关键词' : '请检查外部控制器连接'}</p>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const isSelectableGroup = group.type === 'Selector' || group.type === 'URLTest';
            const isFixed = group.type === 'URLTest' && !!group.fixed;
            const isTestingGroup = !!isGroupTesting[group.name];
            const isUnfixing = !!isUnfixingGroup[group.name];
            const sortedNodes = sortNodes(group.all || []);
            const isGroupExpanded = !isCompact || !!expandedGroupOverrides[group.name];

            // Latency displayed for the collapsed summary must describe the actual
            // currently active node, not a requested fixed node that may be unhealthy.
            const activeNodeName = group.now;
            const activeNode = activeNodeName ? proxies[activeNodeName] : undefined;
            const activeDelay = getLatestProxyDelay(activeNode);
            const selectedLatency = getLatencyInfo(activeDelay);

            return (
              <div
                key={group.name}
                className={`meta-card proxy-card-item ${isCompact ? 'compact-interactive' : ''} ${!isGroupExpanded ? 'is-collapsed' : 'is-expanded'}`}
                onClick={(e) => handleCardClick(e, group.name)}
              >
                <div className="proxy-card-header">
                  <div className="card-header-row-primary">
                    <div className="card-title-meta">
                      <CircularFlag name={group.name} size={16} className="group-flag-icon" />
                      <h3 className="proxy-card-title" data-tooltip={group.name} aria-label={group.name}>
                        {sanitizeDisplayName(group.name)}
                      </h3>
                      <span className="group-type-badge">{group.type}</span>
                    </div>

                    <div className="card-actions">
                      {isFixed && (
                        <button
                          type="button"
                          className="btn-circle-action size-md group-unfix-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnfixGroup(group.name);
                          }}
                          disabled={isUnfixing}
                          data-tooltip={`恢复「${group.name}」自动选择 (取消固定节点)`}
                          aria-label={`恢复「${group.name}」自动选择 (取消固定节点)`}
                        >
                          <RotateCcw size={13} className={isUnfixing ? 'spin-animation' : ''} aria-hidden="true" />
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-circle-action size-md group-test-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGroupTestAll(group);
                        }}
                        disabled={isTestingGroup}
                        data-tooltip={isTestingGroup ? '正在测速该组全部节点...' : `测速「${group.name}」全部节点`}
                        aria-label={isTestingGroup ? '正在测速该组全部节点' : `测速「${group.name}」全部节点`}
                      >
                        <Zap size={14} className={isTestingGroup ? 'spin-animation' : ''} />
                      </button>

                      {isCompact && (
                        <button
                          type="button"
                          className="btn-circle-action size-md group-collapse-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroupExpand(group.name);
                          }}
                          aria-expanded={isGroupExpanded}
                          data-tooltip={isGroupExpanded ? `收起「${group.name}」节点卡片` : `展开「${group.name}」详细节点`}
                          aria-label={isGroupExpanded ? `收起「${group.name}」节点卡片` : `展开「${group.name}」详细节点`}
                        >
                          {isGroupExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="card-header-row-secondary">
                    {/* Current Active Selection Hint (truthfully conveying fixed vs fallback) */}
                    <div className="current-selection-bar">
                      <div className="selection-target-wrap" aria-label={`当前选定：${group.now || '未指定'}`}>
                        <Navigation size={11} className="selection-pointer-icon" aria-hidden="true" />
                        <span className="sr-only">当前选定：</span>
                        {isFixed ? (
                          <span className="selection-node-name" data-tooltip={`已固定: ${group.fixed}${group.now && group.now !== group.fixed ? ` (当前回退: ${group.now})` : ''}`}>
                            <span className="fixed-pin-label">已固定:</span> {sanitizeDisplayName(group.fixed)}
                            {group.now && group.now !== group.fixed && (
                              <span className="fallback-hint"> (回退: {sanitizeDisplayName(group.now)})</span>
                            )}
                          </span>
                        ) : (
                          <span className="selection-node-name" data-tooltip={group.now || '未指定'}>
                            {sanitizeDisplayName(group.now) || '未指定'}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="child-count tabular-nums">
                      {(group.all || []).length} 个节点
                    </span>
                  </div>
                </div>

                {/* Nodes Display: Compact Flag-only vs Expanded Cards */}
                {!isGroupExpanded ? (
                  <div className="proxy-collapsed-row">
                    <div className="proxy-nodes-compact-strip" role="list">
                      {sortedNodes.map((nodeName) => {
                        const isSelected = isFixed ? group.fixed === nodeName : group.now === nodeName;
                        const node = proxies[nodeName];
                        const latestDelay = getLatestProxyDelay(node);
                        const latency = getLatencyInfo(latestDelay);

                        const tooltipText = isFixed && group.fixed === nodeName
                          ? `${nodeName} (${latency.text}) [已固定选定]${group.now && group.now !== nodeName ? ` (暂由 ${group.now} 回退转发)` : ''}`
                          : isSelected
                          ? `${nodeName} (${latency.text}) [当前已选]`
                          : `${nodeName} (${latency.text})`;

                        const ariaLabelText = `${nodeName}, 延迟: ${latency.text}${
                          isSelected ? (isFixed ? ', 已固定选择' : ', 当前已选择') : ''
                        }`;

                        return (
                          <button
                            key={nodeName}
                            type="button"
                            className={`compact-node-btn ${isSelected ? 'active-selected' : ''} latency-${latency.level} ${!isSelectableGroup ? 'readonly-node' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isSelectableGroup) handleSwitch(group.name, nodeName);
                            }}
                            disabled={!isSelectableGroup}
                            data-tooltip={tooltipText}
                            aria-label={ariaLabelText}
                            aria-selected={isSelected}
                            aria-pressed={isSelectableGroup ? isSelected : undefined}
                          >
                            <span className={`compact-flag-ring ring-${latency.level}`}>
                              <CircularFlag name={nodeName} size={14} className="compact-node-flag" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="collapsed-selected-latency-wrap">
                      <span
                        className={`node-latency-tag ${selectedLatency.className}`}
                        data-tooltip={`当前选定「${group.now || '未指定'}」延迟: ${selectedLatency.text}`}
                        aria-label={`当前选定「${group.now || '未指定'}」延迟: ${selectedLatency.text}`}
                      >
                        {selectedLatency.text}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="proxy-nodes-grid">
                    {sortedNodes.map((nodeName) => {
                      const isSelected = isFixed ? group.fixed === nodeName : group.now === nodeName;
                      const node = proxies[nodeName];
                      const latestDelay = getLatestProxyDelay(node);
                      const latency = getLatencyInfo(latestDelay);
                      const isTesting = !!testingNodes[nodeName];

                      const cardTooltip = isSelectableGroup
                        ? group.type === 'URLTest'
                          ? `点击固定选择 ${nodeName}`
                          : `点击切换至 ${nodeName}`
                        : `${group.type} 策略自动选择，不可手动强制切换`;

                      return (
                        <div
                          key={nodeName}
                          className={`node-grid-item ${isSelected ? 'active-selected' : ''} ${!isSelectableGroup ? 'readonly-node' : ''}`}
                        >
                          <button
                            type="button"
                            className="node-card-select"
                            onClick={() => handleSwitch(group.name, nodeName)}
                            disabled={!isSelectableGroup}
                            aria-pressed={isSelected}
                            data-tooltip={cardTooltip}
                          >
                            <div className="node-item-top">
                              <div className="node-title-wrap">
                                <CircularFlag name={nodeName} size={16} className="node-flag-icon" />
                                <span className="node-title" data-tooltip={nodeName} aria-label={nodeName}>
                                  {sanitizeDisplayName(nodeName)}
                                </span>
                              </div>
                            </div>

                            <div className="node-item-bottom">
                              <span className="node-proto-tag">
                                {node?.type || 'Node'}
                              </span>

                              <span className={`node-latency-tag ${latency.className}`}>
                                {latency.text}
                              </span>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="btn-circle-action size-xs node-mini-zap"
                            onClick={(e) => handleSingleTest(e, nodeName)}
                            data-tooltip={isTesting ? '正在测速...' : `测速 ${nodeName}`}
                            aria-label={isTesting ? '正在测速' : `测速 ${nodeName}`}
                          >
                            <Zap size={10} className={isTesting ? 'spin-animation' : ''} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
