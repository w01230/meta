import React, { useState } from 'react';
import { isActionCancelledError, useController } from '../../context/ControllerContext';
import { useToast } from './Toast';
import { RefreshCw, Settings, Activity, SlidersHorizontal, Globe2, Zap } from 'lucide-react';
import { RunMode } from '../../types/api';
import { ConnectionStatus } from '../../types/connection';
import { resolveStatusText } from '../../utils/status';
import { extractVersionToken } from '../../utils/format';

export function resolveNavbarVersion(
  status: ConnectionStatus,
  demoMode: boolean,
  rawVersion?: string | null
): string | null {
  if (demoMode) {
    const parsed = rawVersion ? extractVersionToken(rawVersion) : null;
    return parsed ? `${parsed} · 演示` : '演示';
  }

  if (status === 'connected' && rawVersion) {
    return extractVersionToken(rawVersion);
  }

  return null;
}

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenSettings: () => void;
}

const NAV_TABS = [
  { id: 'overview', label: '总览' },
  { id: 'proxies', label: '代理' },
  { id: 'connections', label: '连接' },
  { id: 'rules', label: '规则' },
  { id: 'logs', label: '日志' }
];

export function resolveSettingsButtonClass(status: ConnectionStatus, demoMode: boolean): string {
  return `nav-settings-btn status-${status}${demoMode ? ' demo-active' : ''}`;
}

export function resolveRunModeLabel(mode: RunMode): string {
  return ({ rule: '规则模式', global: '全局模式', direct: '直连模式' })[mode];
}

const RUN_MODE_OPTIONS = [
  { mode: 'rule', Icon: SlidersHorizontal },
  { mode: 'global', Icon: Globe2 },
  { mode: 'direct', Icon: Zap }
] as const;

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  onOpenSettings
}) => {
  const {
    status,
    version,
    demoMode,
    config,
    updateConfigMode,
    refreshAll,
    baseUrl
  } = useController();

  const { showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [pendingMode, setPendingMode] = useState<RunMode | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAll();
      showToast('数据已刷新', 'info');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast('刷新失败', 'error');
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleModeChange = async (mode: RunMode) => {
    if (pendingMode !== null) return;
    setPendingMode(mode);
    try {
      await updateConfigMode(mode);
      showToast(`已切换至 ${resolveRunModeLabel(mode)}`, 'success');
    } catch (err: unknown) {
      if (!isActionCancelledError(err)) {
        showToast(`切换模式失败: ${(err as Error)?.message}`, 'error');
      }
    } finally {
      setPendingMode(null);
    }
  };

  const fullStatusText = resolveStatusText(status, demoMode, !!version?.version);
  const controllerStatusLabel = `当前控制器: ${baseUrl} (${fullStatusText})`;

  const versionToken = resolveNavbarVersion(status, demoMode, version?.version);

  const versionTooltip = demoMode
    ? (version?.version ? `演示模式 · 核心版本: ${version.version}` : '演示模式')
    : (version?.version ? `核心版本: ${version.version}` : (versionToken ? `核心版本: ${versionToken}` : undefined));

  return (
    <header className="top-horizontal-bar">

      <div className="top-bar-inner">
        {/* Left: Brand Identity */}
        <div 
          className="nav-brand" 
          onClick={() => onSelectTab('overview')} 
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectTab('overview');
            }
          }}
          role="button" 
          tabIndex={0}
          data-tooltip="返回总览"
          aria-label="Meta 返回总览"
        >
          <div className="brand-logo-ring">
            {!logoFailed ? (
              <img
                src={`${import.meta.env.BASE_URL}meta-logo.png`}
                alt="META"
                className="brand-logo-img"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="brand-logo-vector">
                <Activity size={16} color="var(--accent-blue-solid)" />
              </div>
            )}
          </div>
          <span className="sr-only">Meta</span>
          {versionToken && (
            <span 
              className={`brand-version-badge ${demoMode ? 'is-demo' : 'is-live'}`} 
              data-tooltip={versionTooltip}
            >
              <span 
                className={`brand-version-accent-dot ${demoMode ? 'status-demo' : 'status-live'}`} 
                aria-hidden="true" 
              />
              <span className="brand-version-text">{versionToken}</span>
            </span>
          )}
        </div>

        {/* Center: Horizontal Navigation Tabs */}
        <nav className="nav-tab-group" aria-label="主要页面导航">
          {NAV_TABS.map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`nav-tab-item ${isActive ? 'active-pill' : ''}`}
                onClick={() => onSelectTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Utility Actions */}
        <div className="nav-utility-actions">
          {/* Run Mode Segmented Capsule (Desktop only; on mobile accessible in overview & settings) */}
          <div
            className="mode-segmented-capsule nav-mode-capsule nav-desktop-only"
            role="group"
            aria-label="运行模式切换"
            aria-busy={pendingMode !== null}
          >
            {RUN_MODE_OPTIONS.map(({ mode, Icon }) => {
              const isActive = config?.mode === mode;
              const modeLabel = resolveRunModeLabel(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  className={`mode-capsule-item ${isActive ? 'active' : ''}`}
                  onClick={() => void handleModeChange(mode)}
                  disabled={status !== 'connected' || pendingMode !== null}
                  aria-pressed={isActive}
                  aria-label={`切换至${modeLabel}`}
                  data-tooltip={`切换至${modeLabel}`}
                >
                  <Icon size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>

          {/* Refresh Button: Pure White Circular */}
          <button
            type="button"
            className="btn-circle-action size-md"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="刷新数据"
            data-tooltip="刷新数据"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin-animation' : ''} />
          </button>

          {/* Settings Button: Pure White Circular */}
          <button
            type="button"
            className={`btn-circle-action size-md ${resolveSettingsButtonClass(status, demoMode)}`}
            onClick={onOpenSettings}
            aria-label={`打开控制器与参数设置。${controllerStatusLabel}`}
            data-tooltip={controllerStatusLabel}
          >
            <Settings size={15} />
            <span className="nav-settings-status-dot" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};
