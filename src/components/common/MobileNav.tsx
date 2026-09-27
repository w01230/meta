import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Radio, 
  Activity, 
  Terminal, 
  MoreHorizontal, 
  ShieldCheck, 
  Sliders,
  X 
} from 'lucide-react';

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenSettings?: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onSelectTab, onOpenSettings }) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  const primaryItems = [
    { id: 'overview', label: '总览', icon: LayoutDashboard },
    { id: 'proxies', label: '代理', icon: Radio },
    { id: 'connections', label: '连接', icon: Activity },
    { id: 'logs', label: '日志', icon: Terminal }
  ];

  const moreItems = [
    { id: 'rules', label: '分流规则', icon: ShieldCheck, desc: '查看路由与分流匹配策略' },
    { id: 'config', label: '控制配置', icon: Sliders, desc: '外部控制器与运行时参数' }
  ];

  const isMoreActive = currentTab === 'rules';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowMoreMenu(false);
        moreTriggerRef.current?.focus();
      }
    };
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMoreMenu]);

  return (
    <nav className="mobile-bottom-nav" aria-label="移动端主要导航">
      <div className="mobile-nav-inner">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              className={`mobile-nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                setShowMoreMenu(false);
                onSelectTab(item.id);
              }}
            >
              <Icon size={18} />
              <span className="mobile-nav-label">{item.label}</span>
            </button>
          );
        })}

        {/* 5th Button: 更多 */}
        <button
          ref={moreTriggerRef}
          className={`mobile-nav-item ${isMoreActive ? 'active' : ''}`}
          onClick={() => setShowMoreMenu(!showMoreMenu)}
          aria-expanded={showMoreMenu}
          aria-current={isMoreActive ? 'page' : undefined}
          aria-label="更多导航选项"
        >
          <MoreHorizontal size={18} />
          <span className="mobile-nav-label">更多</span>
        </button>
      </div>

      {/* Disclosure popover for the remaining navigation actions. */}
      {showMoreMenu && (
        <div className="mobile-more-popover" ref={menuRef}>
          <div className="mobile-more-header">
            <span className="mobile-more-title">更多模块</span>
            <button
              type="button"
              className="mobile-more-close"
              onClick={() => setShowMoreMenu(false)}
              aria-label="关闭更多菜单"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mobile-more-list">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  className={`mobile-more-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setShowMoreMenu(false);
                    if (item.id === 'config') {
                      if (onOpenSettings) {
                        onOpenSettings();
                      } else {
                        onSelectTab('config');
                      }
                    } else {
                      onSelectTab(item.id);
                    }
                  }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={18} className="more-item-icon" />
                  <div className="more-item-text">
                    <span className="more-item-label">{item.label}</span>
                    <span className="more-item-desc">{item.desc}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
};
