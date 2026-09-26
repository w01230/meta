import React, { useState } from 'react';
import { useController } from '../../context/ControllerContext';
import { useToast } from './Toast';
import { RefreshCw, Settings, Activity } from 'lucide-react';
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
  { id: 'logs', label: '日志' },
  { id: 'config', label: '配置' }
];

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  onOpenSettings
}) => {
  const {
    status,
    statusError,
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAll();
      showToast('数据已刷新', 'info');
    } catch {
      showToast('刷新失败', 'error');
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleModeChange = async (mode: RunMode) => {
    try {
      await updateConfigMode(mode);
      const modeNames = { rule: '规则模式', global: '全局模式', direct: '直连模式' };
      showToast(`已切换至 ${modeNames[mode]}`, 'success');
    } catch (err: unknown) {
      showToast(`切换模式失败: ${(err as Error)?.message}`, 'error');
    }
  };

  // Derive endpoint initial for circular avatar
  const endpointHost = (() => {
    try {
      const parsed = new URL(baseUrl);
      return parsed.hostname;
    } catch {
      return 'M';
    }
  })();
  const avatarLetter = endpointHost === '127.0.0.1' || endpointHost === 'localhost' ? 'L' : endpointHost.charAt(0).toUpperCase();

  const fullStatusText = resolveStatusText(status, demoMode, !!version?.version);

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
                src="/meta-logo.png"
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
                onClick={() => tab.id === 'config' ? onOpenSettings() : onSelectTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right: Utility Actions & Avatar */}
        <div className="nav-utility-actions">
          {/* Run Mode Segmented Capsule (Desktop only; on mobile accessible in overview & settings) */}
          <div className="mode-segmented-capsule nav-desktop-only" role="group" aria-label="运行模式切换">
            {(['rule', 'global', 'direct'] as RunMode[]).map((m) => {
              const label = m === 'rule' ? '规则' : m === 'global' ? '全局' : '直连';
              const isActive = config?.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={`mode-capsule-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleModeChange(m)}
                  disabled={status !== 'connected'}
                  data-tooltip={`切换至${label}模式`}
                >
                  {label}
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
            className="btn-circle-action size-md"
            onClick={onOpenSettings}
            aria-label="外部控制器与参数设置"
            data-tooltip="控制器设置"
          >
            <Settings size={15} />
          </button>

          {/* Combined Controller Status & Endpoint Avatar Action (Far-Right) */}
          <button
            type="button"
            className={`btn-circle-action size-md controller-status-btn status-${status} ${demoMode ? 'demo-active' : ''}`}
            onClick={onOpenSettings}
            aria-label={`当前控制器: ${baseUrl} (${fullStatusText})`}
            data-tooltip={`${baseUrl} (${fullStatusText})`}
          >
            <span className="avatar-initial">{avatarLetter}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
