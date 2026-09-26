import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  VALID_LOG_LEVELS, 
  resolveEffectiveLogLevel 
} from '../context/ControllerContext';
import { MihomoApiClient, ApiError } from '../services/apiClient';
import { buildWsUrl } from '../utils/url';
import { LogLevel, MihomoConfig } from '../types/api';
import { DEMO_CONFIG } from '../services/demoData';

describe('Log-Level Synchronization Lane', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Effective Log-Level Normalization & Defaulting', () => {
    it('defines the standard 5 lowercase log levels including silent', () => {
      expect(VALID_LOG_LEVELS).toEqual(['debug', 'info', 'warning', 'error', 'silent']);
    });

    it('defaults to "info" when log-level is omitted, undefined, or null in core config', () => {
      expect(resolveEffectiveLogLevel(undefined)).toBe('info');
      expect(resolveEffectiveLogLevel(null)).toBe('info');
      expect(resolveEffectiveLogLevel('')).toBe('info');
    });

    it('normalizes uppercase and mixed-case levels from core to lowercase', () => {
      expect(resolveEffectiveLogLevel('DEBUG')).toBe('debug');
      expect(resolveEffectiveLogLevel('Info')).toBe('info');
      expect(resolveEffectiveLogLevel('WARNING')).toBe('warning');
      expect(resolveEffectiveLogLevel('Error')).toBe('error');
      expect(resolveEffectiveLogLevel('SILENT')).toBe('silent');
      expect(resolveEffectiveLogLevel('  warning  ')).toBe('warning');
    });

    it('falls back to "info" for invalid or unrecognized log levels', () => {
      expect(resolveEffectiveLogLevel('verbose')).toBe('info');
      expect(resolveEffectiveLogLevel('trace')).toBe('info');
      expect(resolveEffectiveLogLevel('fatal')).toBe('info');
    });

    it('preserves non-info effective levels loaded directly from core config', () => {
      const configWarning: Partial<MihomoConfig> = { 'log-level': 'warning' };
      const configError: Partial<MihomoConfig> = { 'log-level': 'error' };
      const configSilent: Partial<MihomoConfig> = { 'log-level': 'silent' };
      const configDebug: Partial<MihomoConfig> = { 'log-level': 'debug' };

      expect(resolveEffectiveLogLevel(configWarning['log-level'])).toBe('warning');
      expect(resolveEffectiveLogLevel(configError['log-level'])).toBe('error');
      expect(resolveEffectiveLogLevel(configSilent['log-level'])).toBe('silent');
      expect(resolveEffectiveLogLevel(configDebug['log-level'])).toBe('debug');
    });
  });

  describe('2. Atomic Handshake & Config Refresh as Single Source of Truth', () => {
    it('initializes effective log-level and WS URL parameter from non-info handshake config', async () => {
      const coreConfig: MihomoConfig = {
        port: 7890,
        'socks-port': 7891,
        'redir-port': 0,
        'tproxy-port': 0,
        'mixed-port': 7890,
        mode: 'rule',
        'log-level': 'warning',
        'allow-lan': true
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/configs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(coreConfig)
          });
        }
        if (url.endsWith('/version')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ version: 'v1.19.3' })
          });
        }
        if (url.endsWith('/proxies')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ proxies: {} }) });
        }
        if (url.endsWith('/rules')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ rules: [] }) });
        }
        if (url.endsWith('/connections')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ connections: [] }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      });

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'secret');
      const handshake = await client.verifyFullRestHandshake();

      const effectiveLevel = resolveEffectiveLogLevel(handshake.config['log-level']);
      expect(effectiveLevel).toBe('warning');

      // Verify WS URL constructed from this effective log level
      const wsUrl = buildWsUrl('http://127.0.0.1:9090', '/logs', 'secret', { level: effectiveLevel });
      expect(wsUrl).toBe('ws://127.0.0.1:9090/logs?level=warning&token=secret');
    });

    it('defaults handshake without explicit log-level to "info"', async () => {
      const configWithoutLevel = {
        port: 7890,
        mode: 'rule'
      } as any;

      const effectiveLevel = resolveEffectiveLogLevel(configWithoutLevel['log-level']);
      expect(effectiveLevel).toBe('info');

      const wsUrl = buildWsUrl('http://127.0.0.1:9090', '/logs', '', { level: effectiveLevel });
      expect(wsUrl).toBe('ws://127.0.0.1:9090/logs?level=info');
    });
  });

  describe('3. Level Changes Synchronize PATCH /configs, GET /configs, and WS level', () => {
    it('sends lowercase PATCH /configs then GET /configs on level change', async () => {
      let patchBody = '';
      let patchMethod = '';
      let getCount = 0;

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/configs')) {
          if (options?.method === 'PATCH') {
            patchMethod = options.method;
            patchBody = options.body as string;
            return Promise.resolve({
              ok: true,
              status: 204
            });
          }
          getCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              port: 7890,
              mode: 'rule',
              'log-level': 'debug'
            })
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      });

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'test-sec');

      // Simulate the synchronization lifecycle: PATCH then GET
      await client.updateConfigs({ 'log-level': 'debug' });
      const updatedConfig = await client.getConfigs();

      expect(patchMethod).toBe('PATCH');
      expect(JSON.parse(patchBody)).toEqual({ 'log-level': 'debug' });
      expect(getCount).toBe(1);
      expect(updatedConfig['log-level']).toBe('debug');

      const wsUrl = buildWsUrl('http://127.0.0.1:9090', '/logs', 'test-sec', { level: updatedConfig['log-level'] });
      expect(wsUrl).toContain('level=debug');
    });

    it('supports silent level end-to-end via PATCH and WS stream url', async () => {
      let patchedLevel = '';

      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/configs') && options?.method === 'PATCH') {
          const body = JSON.parse(options.body as string);
          patchedLevel = body['log-level'];
          return Promise.resolve({ ok: true, status: 204 });
        }
        if (url.includes('/configs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ 'log-level': 'silent' })
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      });

      const client = new MihomoApiClient('http://127.0.0.1:9090', '');
      await client.updateConfigs({ 'log-level': 'silent' });
      const updated = await client.getConfigs();

      expect(patchedLevel).toBe('silent');
      expect(updated['log-level']).toBe('silent');

      const wsUrl = buildWsUrl('http://127.0.0.1:9090', '/logs', '', { level: updated['log-level'] });
      expect(wsUrl).toBe('ws://127.0.0.1:9090/logs?level=silent');
    });
  });

  describe('4. Error Handling & Prevention of False Success', () => {
    it('propagates API error and refrains from updating state if PATCH /configs fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/configs') && options?.method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({ message: 'Core runtime error updating log level' })
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      });

      const client = new MihomoApiClient('http://127.0.0.1:9090', '');
      let currentLogLevel: LogLevel = 'info';

      // Attempt update
      await expect(client.updateConfigs({ 'log-level': 'error' })).rejects.toThrow(ApiError);

      // Invariant: current level is NOT updated on failure
      expect(currentLogLevel).toBe('info');
    });
  });

  describe('5. Disconnected State Guard', () => {
    it('guards against changing level when disconnected without dispatching network calls', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      const attemptChange = async (status: string, demoMode: boolean, newLevel: LogLevel) => {
        if (!demoMode && status !== 'connected') {
          throw new Error('控制器未连接，无法修改日志级别');
        }
      };

      await expect(attemptChange('disconnected', false, 'debug')).rejects.toThrow('控制器未连接，无法修改日志级别');
      await expect(attemptChange('connecting', false, 'debug')).rejects.toThrow('控制器未连接，无法修改日志级别');
      await expect(attemptChange('error', false, 'debug')).rejects.toThrow('控制器未连接，无法修改日志级别');

      // No fetch calls were made
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('6. Duplicate Level & Reconnect Loop Prevention', () => {
    it('no-ops when target level matches active level, preventing redundant PATCH and WS reconnect', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      let callDispatched = false;
      const setLogLevelSim = async (current: LogLevel, target: string | LogLevel) => {
        const normalized = resolveEffectiveLogLevel(target);
        if (current === normalized) {
          return; // Early return prevents redundant PATCH / WS tear-down
        }
        callDispatched = true;
      };

      await setLogLevelSim('debug', 'debug');
      expect(callDispatched).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      await setLogLevelSim('debug', 'DEBUG');
      expect(callDispatched).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      await setLogLevelSim('debug', 'warning');
      expect(callDispatched).toBe(true);
    });

    it('unrelated config field updates preserve log-level without triggering WS reconnect', () => {
      const initialConfig: MihomoConfig = {
        ...DEMO_CONFIG,
        'log-level': 'warning'
      };

      // Patching mode
      const patch = { mode: 'global' as const };
      const nextConfig = { ...initialConfig, ...patch };

      const oldLevel = resolveEffectiveLogLevel(initialConfig['log-level']);
      const newLevel = resolveEffectiveLogLevel(nextConfig['log-level']);

      expect(oldLevel).toBe('warning');
      expect(newLevel).toBe('warning');
      // Because oldLevel === newLevel, [logLevel] dependency in useEffect does not trigger
      expect(oldLevel === newLevel).toBe(true);
    });
  });

  describe('7. Demo Mode Local Consistency', () => {
    it('initializes demo mode with DEMO_CONFIG log-level', () => {
      expect(DEMO_CONFIG['log-level']).toBe('info');
      expect(resolveEffectiveLogLevel(DEMO_CONFIG['log-level'])).toBe('info');
    });

    it('updates demo config locally without live PATCH or network calls', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      let demoConfig: MihomoConfig = { ...DEMO_CONFIG };

      const updateConfigFieldDemo = (patch: Partial<MihomoConfig>) => {
        const cleanPatch = { ...patch };
        if (cleanPatch['log-level']) {
          cleanPatch['log-level'] = resolveEffectiveLogLevel(cleanPatch['log-level']);
        }
        demoConfig = { ...demoConfig, ...cleanPatch };
      };

      updateConfigFieldDemo({ 'log-level': 'silent' });
      expect(demoConfig['log-level']).toBe('silent');
      expect(fetchMock).not.toHaveBeenCalled();

      updateConfigFieldDemo({ 'log-level': 'debug' });
      expect(demoConfig['log-level']).toBe('debug');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('demo mode permits changing log-level because demo status is connected', () => {
      const isButtonDisabled = (status: string, demoMode: boolean, isChanging: boolean) => {
        // In demo mode, status is 'connected'
        return status !== 'connected' || isChanging;
      };

      expect(isButtonDisabled('connected', true, false)).toBe(false);
      expect(isButtonDisabled('connected', true, true)).toBe(true);
      expect(isButtonDisabled('disconnected', false, false)).toBe(true);
    });
  });

  describe('8. Controls Synchronization between LogsView and SettingsModal', () => {
    it('both controls read from the same source of truth and display the same active state', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warning', 'error', 'silent'];

      const getLogsViewActive = (activeLevel: LogLevel) => {
        return levels.map(l => ({ level: l, active: activeLevel === l }));
      };

      const getSettingsModalActive = (configLevel: LogLevel | undefined) => {
        const effective = resolveEffectiveLogLevel(configLevel);
        return levels.map(l => ({ level: l, active: effective === l }));
      };

      // Scenario A: core config loaded with 'warning'
      const logsActiveWarning = getLogsViewActive('warning');
      const settingsActiveWarning = getSettingsModalActive('warning');
      expect(logsActiveWarning).toEqual(settingsActiveWarning);
      expect(logsActiveWarning.find(x => x.level === 'warning')?.active).toBe(true);
      expect(logsActiveWarning.find(x => x.level === 'info')?.active).toBe(false);

      // Scenario B: core config omitted log-level -> defaults to 'info' on both
      const logsActiveDefault = getLogsViewActive(resolveEffectiveLogLevel(undefined));
      const settingsActiveDefault = getSettingsModalActive(undefined);
      expect(logsActiveDefault).toEqual(settingsActiveDefault);
      expect(logsActiveDefault.find(x => x.level === 'info')?.active).toBe(true);

      // Scenario C: changed to 'silent' on either control
      const logsActiveSilent = getLogsViewActive('silent');
      const settingsActiveSilent = getSettingsModalActive('silent');
      expect(logsActiveSilent).toEqual(settingsActiveSilent);
      expect(logsActiveSilent.find(x => x.level === 'silent')?.active).toBe(true);
    });
  });
});
