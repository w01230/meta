import React, { useState, useEffect } from 'react';
import { ControllerProvider } from './context/ControllerContext';
import { ToastProvider } from './components/common/Toast';
import { TooltipProvider } from './components/common/TooltipProvider';
import { Navbar } from './components/common/Navbar';
import { MobileNav } from './components/common/MobileNav';
import { SettingsModal } from './components/common/SettingsModal';
import { OverviewView } from './components/overview/OverviewView';
import { ProxiesView } from './components/proxies/ProxiesView';
import { ConnectionsView } from './components/connections/ConnectionsView';
import { RulesView } from './components/rules/RulesView';
import { LogsView } from './components/logs/LogsView';

import { useController } from './context/ControllerContext';

export const PRIMARY_TABS = ['overview', 'proxies', 'connections', 'rules', 'logs'];

export const AppContent: React.FC = () => {
  const { hasConfiguredController } = useController();

  // Helper to determine initial tab and settings modal visibility from URL hash
  const [initial] = useState(() => {
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    if (rawHash === 'config') {
      return { tab: 'overview', openSettings: true };
    }
    const tab = PRIMARY_TABS.includes(rawHash) ? rawHash : 'overview';
    return { tab, openSettings: false };
  });

  const [currentTab, setCurrentTab] = useState<string>(initial.tab);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(
    () => !hasConfiguredController || initial.openSettings
  );

  // Auto-open settings modal if controller is not configured
  useEffect(() => {
    if (!hasConfiguredController) {
      setIsSettingsOpen(true);
    }
  }, [hasConfiguredController]);

  // Handle URL hash changes (deep-links & browser forward/back)
  useEffect(() => {
    const handleHashChange = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
      if (rawHash === 'config') {
        // Open modal while preserving underlying currentTab (avoiding blank route)
        setIsSettingsOpen(true);
      } else if (PRIMARY_TABS.includes(rawHash)) {
        setCurrentTab(rawHash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSelectTab = (tab: string) => {
    if (tab === 'config') {
      setIsSettingsOpen(true);
      return;
    }
    setCurrentTab(tab);
    window.location.hash = `#/${tab}`;
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
    // If the hash is currently config, sync it back to currentTab so re-closing doesn't leave lingering #/config
    const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
    if (rawHash === 'config') {
      window.location.hash = `#/${currentTab}`;
    }
  };

  return (
    <div className="mihomo-viewport">
      {/* 1. Compact Horizontal Top Bar */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 2. Main Viewport Content Area (Preserves underlying view during modal overlay) */}
      <main className="main-viewport-content">
        {currentTab === 'overview' && (
          <OverviewView
            onNavigateTab={handleSelectTab}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}
        {currentTab === 'proxies' && <ProxiesView />}
        {currentTab === 'connections' && <ConnectionsView />}
        {currentTab === 'rules' && <RulesView />}
        {currentTab === 'logs' && <LogsView />}
      </main>

      {/* 3. Bottom Navigation for Mobile Devices (<768px) */}
      <MobileNav 
        currentTab={currentTab} 
        onSelectTab={handleSelectTab} 
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 4. Global Consolidated Controller Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <TooltipProvider>
      <ToastProvider>
        <ControllerProvider>
          <AppContent />
        </ControllerProvider>
      </ToastProvider>
    </TooltipProvider>
  );
};

export default App;
