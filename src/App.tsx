import React, { useState, useEffect, useRef } from 'react';
import {
  ControllerProvider,
  useController,
  isProxyPollingEligible,
  startProxyPolling
} from './context/ControllerContext';
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
import { ConnectionStatus } from './types/connection';

export const PRIMARY_TABS = ['overview', 'proxies', 'connections', 'rules', 'logs'];

export function shouldAutoOpenSettings(
  hasConfiguredController: boolean,
  status: ConnectionStatus,
  demoMode: boolean = false,
  errorDismissed: boolean = false
): boolean {
  if (!hasConfiguredController) return true;
  return !demoMode && status === 'error' && !errorDismissed;
}

export const AppContent: React.FC = () => {
  const { hasConfiguredController, status, version, demoMode, pollProxies } = useController();

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

  const errorDismissedRef = useRef<boolean>(false);

  // Auto-open settings modal if controller is not configured
  useEffect(() => {
    if (!hasConfiguredController) {
      setIsSettingsOpen(true);
    }
  }, [hasConfiguredController]);

  // Auto-open settings modal on terminal controller error; reset latch on retry or success
  useEffect(() => {
    if (status === 'connecting' || status === 'connected') {
      errorDismissedRef.current = false;
    } else if (hasConfiguredController && shouldAutoOpenSettings(true, status, demoMode, errorDismissedRef.current)) {
      setIsSettingsOpen(true);
    }
  }, [status, hasConfiguredController, demoMode]);

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

  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Periodic polling of GET /proxies every 30s only while current view is overview or proxies,
  // document is visible, and connected to active REST-verified real controller.
  useEffect(() => {
    let active = true;
    const isEligible = () =>
      active && isProxyPollingEligible(currentTab, isDocumentVisible, demoMode, version, status);

    const handle = startProxyPolling(isEligible, () => pollProxies(isEligible));

    return () => {
      active = false;
      handle.stop();
    };
  }, [currentTab, isDocumentVisible, demoMode, version, status, pollProxies]);

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
    if (status === 'error') {
      errorDismissedRef.current = true;
    }
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
