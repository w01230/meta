import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Radio, 
  Activity, 
  ShieldCheck, 
  Terminal, 
  Sliders, 
  ExternalLink 
} from 'lucide-react';
import { useController } from '../../context/ControllerContext';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenSettings
}) => {
  const { version, status, demoMode } = useController();
  const [logoFailed, setLogoFailed] = useState(false);

  const navItems = [
    { id: 'overview', label: '总览', icon: LayoutDashboard },
    { id: 'proxies', label: '代理', icon: Radio },
    { id: 'connections', label: '连接', icon: Activity },
    { id: 'rules', label: '规则', icon: ShieldCheck },
    { id: 'logs', label: '日志', icon: Terminal },
    { id: 'config', label: '配置', icon: Sliders }
  ];

  const displayVersion = demoMode
    ? 'Demo v1.19.3'
    : version?.version
    ? version.version.split(' ')[0]
    : status === 'connecting'
    ? '连接中...'
    : '未连接';

  return (
    <aside className="app-sidebar">
      {/* Brand Header */}
      <div className="sidebar-brand" onClick={() => onSelectTab('overview')} role="button" tabIndex={0}>
        <div className="brand-logo-box">
          {!logoFailed ? (
            <img
              src="/meta-logo.png"
              alt="META Logo"
              className="brand-logo"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="brand-logo-text-fallback">M</div>
          )}
        </div>
        <div className="brand-titles">
          <span className="brand-name">META</span>
          <span className="brand-subtitle">代理控制台</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(item.id)}
            >
              <Icon size={17} className="nav-item-icon" />
              <span className="nav-item-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="sidebar-footer">
        <div
          className="version-pill"
          onClick={onOpenSettings}
          title="点击配置外部控制器"
          role="button"
          tabIndex={0}
        >
          <span className={`version-dot ${status === 'connected' ? 'connected' : ''}`} />
          <span className="version-text tabular-nums">{displayVersion}</span>
          <ExternalLink size={12} className="version-ext-icon" />
        </div>
      </div>
    </aside>
  );
};
