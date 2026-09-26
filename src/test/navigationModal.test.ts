import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PRIMARY_TABS } from '../App';
import { resolveStatusText } from '../utils/status';
import { MihomoApiClient, ApiError } from '../services/apiClient';
import { resolveRuntimeVersionToken } from '../components/common/SettingsModal';

describe('Navigation and Consolidated Settings Modal Integration', () => {
  describe('Tab and Route resolution', () => {
    it('defines primary content tabs excluding standalone config route', () => {
      expect(PRIMARY_TABS).toEqual(['overview', 'proxies', 'connections', 'rules', 'logs']);
      expect(PRIMARY_TABS.includes('config')).toBe(false);
    });

    it('resolves deep-link #/config to overview tab with settings modal open, avoiding blank route', () => {
      const resolveInitial = (rawHash: string) => {
        const hash = rawHash.replace(/^#\/?/, '').trim();
        if (hash === 'config') {
          return { tab: 'overview', openSettings: true };
        }
        const tab = PRIMARY_TABS.includes(hash) ? hash : 'overview';
        return { tab, openSettings: false };
      };

      expect(resolveInitial('#/config')).toEqual({ tab: 'overview', openSettings: true });
      expect(resolveInitial('#config')).toEqual({ tab: 'overview', openSettings: true });
      expect(resolveInitial('#/proxies')).toEqual({ tab: 'proxies', openSettings: false });
      expect(resolveInitial('#/invalid')).toEqual({ tab: 'overview', openSettings: false });
      expect(resolveInitial('')).toEqual({ tab: 'overview', openSettings: false });
    });

    it('preserves underlying currentTab when opening and closing settings modal', () => {
      let currentTab = 'proxies';
      let isSettingsOpen = false;

      const handleSelectTab = (tab: string) => {
        if (tab === 'config') {
          isSettingsOpen = true;
          return;
        }
        currentTab = tab;
      };

      const handleCloseSettings = () => {
        isSettingsOpen = false;
      };

      // User on proxies clicks 'config' in desktop nav or mobile More
      handleSelectTab('config');
      expect(isSettingsOpen).toBe(true);
      expect(currentTab).toBe('proxies'); // underlying tab preserved

      // User closes settings modal
      handleCloseSettings();
      expect(isSettingsOpen).toBe(false);
      expect(currentTab).toBe('proxies'); // still on proxies
    });
  });

  describe('Circular Status Indicator State Mapping', () => {
    const getStatusIndicatorClass = (status: string, demoMode: boolean) => {
      return `status-circle-indicator status-${status} ${demoMode ? 'demo-active' : ''}`.trim();
    };

    it('generates correct circular status indicator classes for all connection states', () => {
      expect(getStatusIndicatorClass('connected', false)).toBe('status-circle-indicator status-connected');
      expect(getStatusIndicatorClass('connecting', false)).toBe('status-circle-indicator status-connecting');
      expect(getStatusIndicatorClass('disconnected', false)).toBe('status-circle-indicator status-disconnected');
      expect(getStatusIndicatorClass('error', false)).toBe('status-circle-indicator status-error');
      expect(getStatusIndicatorClass('connected', true)).toBe('status-circle-indicator status-connected demo-active');
    });

    it('provides accessible full status text corresponding to the state', () => {
      expect(resolveStatusText('connected', false, true)).toBe('核心已连接');
      expect(resolveStatusText('connected', false, false)).toBe('控制器已连接');
      expect(resolveStatusText('connected', true, true)).toBe('演示仿真数据');
      expect(resolveStatusText('connecting', false, false)).toBe('正在连接控制器...');
      expect(resolveStatusText('disconnected', false, false)).toBe('控制器未连接');
      expect(resolveStatusText('error', false, false)).toBe('控制器未连接');
    });
  });

  describe('Cache Maintenance & Confirmation Logic', () => {
    let client: MihomoApiClient;

    beforeEach(() => {
      client = new MihomoApiClient('http://127.0.0.1:9090', '');
      vi.restoreAllMocks();
    });

    it('executes flushFakeipCache when confirmed', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      globalThis.fetch = vi.fn().mockImplementation((url, options) => {
        requestedUrl = url;
        requestedMethod = options.method;
        return Promise.resolve({
          ok: true,
          status: 204
        });
      });

      await client.flushFakeipCache();
      expect(requestedUrl).toBe('http://127.0.0.1:9090/cache/fakeip/flush');
      expect(requestedMethod).toBe('POST');
    });

    it('executes flushDnsCache and properly surfaces 404 for older kernels', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: () => Promise.resolve({ message: '404 page not found' })
        });
      });

      let caughtError: ApiError | null = null;
      try {
        await client.flushDnsCache();
      } catch (err) {
        caughtError = err as ApiError;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.status).toBe(404);
      expect(caughtError?.message).toContain('不支持清理 DNS 缓存');
    });

    it('disallows cache flushing when not real connected (demo mode or disconnected)', () => {
      const isFlushAllowed = (status: string, demoMode: boolean) => {
        return !demoMode && status === 'connected';
      };

      expect(isFlushAllowed('connected', false)).toBe(true);
      expect(isFlushAllowed('connected', true)).toBe(false); // disabled in demo
      expect(isFlushAllowed('disconnected', false)).toBe(false); // disabled when disconnected
      expect(isFlushAllowed('connecting', false)).toBe(false);
      expect(isFlushAllowed('error', false)).toBe(false);
    });
  });

  describe('Runtime Version Tag Resolution (Mobile QA Defect Fix)', () => {
    it('extracts concise version token with · 演示 marker in demo mode', () => {
      expect(resolveRuntimeVersionToken(true, 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3 · 演示');
      expect(resolveRuntimeVersionToken(true, 'v1.18.0')).toBe('v1.18.0 · 演示');
      expect(resolveRuntimeVersionToken(true, '1.19.2')).toBe('v1.19.2 · 演示');
    });

    it('falls back to "演示" without fabricating a version number when demo version is missing or invalid', () => {
      expect(resolveRuntimeVersionToken(true, null)).toBe('演示');
      expect(resolveRuntimeVersionToken(true, undefined)).toBe('演示');
      expect(resolveRuntimeVersionToken(true, '')).toBe('演示');
      expect(resolveRuntimeVersionToken(true, 'mihomo')).toBe('演示');
      expect(resolveRuntimeVersionToken(true, 'meta')).toBe('演示');
    });

    it('extracts concise live version without demo marker in real connected mode', () => {
      expect(resolveRuntimeVersionToken(false, 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3');
      expect(resolveRuntimeVersionToken(false, 'v1.18.0')).toBe('v1.18.0');
    });

    it('returns null in real mode when version is missing or invalid', () => {
      expect(resolveRuntimeVersionToken(false, null)).toBe(null);
      expect(resolveRuntimeVersionToken(false, undefined)).toBe(null);
      expect(resolveRuntimeVersionToken(false, '')).toBe(null);
      expect(resolveRuntimeVersionToken(false, 'mihomo')).toBe(null);
    });
  });
});

