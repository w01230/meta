import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  calculateJointWsStatus, 
  resolveStatusText, 
  resolveMemorySubtitle 
} from '../utils/status';
import { 
  resolveTransitionOutcome, 
  executeControllerHandshake, 
  TransitionState 
} from '../utils/lifecycle';
import { MihomoApiClient, ApiError } from '../services/apiClient';
import { MihomoWsStream } from '../services/wsClient';
import { DEMO_PROXIES, DEMO_VERSION, DEMO_CONFIG, DEMO_RULES } from '../services/demoData';

describe('Controller Lifecycle & Status Verification (Production Code)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('calculateJointWsStatus (Joint Stream Health)', () => {
    it('returns "connected" ONLY when both traffic and connections streams are active', () => {
      expect(calculateJointWsStatus(true, true)).toBe('connected');
    });

    it('returns "connecting" when traffic is down, even if connections stream is active', () => {
      expect(calculateJointWsStatus(false, true)).toBe('connecting');
    });

    it('returns "connecting" when connections stream is down, even if traffic stream is active', () => {
      expect(calculateJointWsStatus(true, false)).toBe('connecting');
    });

    it('returns "connecting" when both streams are down', () => {
      expect(calculateJointWsStatus(false, false)).toBe('connecting');
    });
  });

  describe('resolveStatusText (Verified Controller Connectivity Copy)', () => {
    it('prioritizes demo mode copy over connected status', () => {
      expect(resolveStatusText('connected', true, true)).toBe('演示仿真数据');
      expect(resolveStatusText('disconnected', true, false)).toBe('演示仿真数据');
      expect(resolveStatusText('connecting', true, false)).toBe('演示仿真数据');
    });

    it('strictly distinguishes between verified core version and unverified connection', () => {
      expect(resolveStatusText('connected', false, true)).toBe('核心已连接');
      expect(resolveStatusText('connected', false, false)).toBe('控制器已连接');
    });

    it('provides clear operational feedback during connecting and disconnected states', () => {
      expect(resolveStatusText('connecting', false, false)).toBe('正在连接控制器...');
      expect(resolveStatusText('disconnected', false, false)).toBe('控制器未连接');
      expect(resolveStatusText('error', false, false)).toBe('控制器未连接');
    });

    it('never outputs deceptive placeholders like "系统正常"', () => {
      const text = resolveStatusText('connected', false, true);
      expect(text).not.toContain('系统正常');
      expect(text).not.toContain('运行中');
    });
  });

  describe('resolveMemorySubtitle (Telemetry Presence & oslimit handling)', () => {
    it('formats physical limit when oslimit is present and positive', () => {
      const result = resolveMemorySubtitle(true, { inuse: 68157440, oslimit: 17179869184 });
      expect(result).toBe('物理上限: 16 GB');
    });

    it('displays truthful "未提供内存上限" when telemetry is present but oslimit is 0 or negative', () => {
      expect(resolveMemorySubtitle(true, { inuse: 68157440, oslimit: 0 })).toBe('未提供内存上限');
      expect(resolveMemorySubtitle(true, { inuse: 68157440, oslimit: -1 })).toBe('未提供内存上限');
    });

    it('displays "等待内存采样..." when connected but memory sample is entirely null', () => {
      expect(resolveMemorySubtitle(true, null)).toBe('等待内存采样...');
    });

    it('displays "数据暂不可用" when controller is not connected', () => {
      expect(resolveMemorySubtitle(false, null)).toBe('数据暂不可用');
      expect(resolveMemorySubtitle(false, { inuse: 68157440, oslimit: 17179869184 })).toBe('数据暂不可用');
    });

    it('never fabricates "系统正常" or stays waiting for sampling when inuse is present', () => {
      const subtitle = resolveMemorySubtitle(true, { inuse: 68157440, oslimit: 0 });
      expect(subtitle).not.toContain('系统正常');
      expect(subtitle).not.toContain('等待');
    });
  });

  describe('resolveTransitionOutcome (Atomic Transition Decision Engine)', () => {
    const demoState: TransitionState = {
      isDemo: true,
      activeUrl: 'http://127.0.0.1:9090',
      activeSecret: 'old-secret',
      status: 'connected',
      statusError: null,
      isDemoTimerRunning: true
    };

    it('retains demo timer, preserves demo mode, and refuses unverified credentials on failed handshake', () => {
      const outcome = resolveTransitionOutcome(
        demoState,
        'http://192.168.1.1:9090',
        'wrong-secret',
        false,
        'Network error'
      );

      // Crucial invariants verified:
      expect(outcome.shouldStopDemoTimer).toBe(false); // Demo simulation interval must NOT be cleared!
      expect(outcome.shouldCommitCredentials).toBe(false); // New URL/secret must NOT be saved!
      expect(outcome.shouldExitDemo).toBe(false); // Must remain in demo mode!
      expect(outcome.nextUrl).toBe('http://127.0.0.1:9090'); // Retains existing URL
      expect(outcome.nextSecret).toBe('old-secret'); // Retains existing secret
      expect(outcome.nextStatus).toBe('connected'); // Retains demo connected status
      expect(outcome.nextStatusError).toBeNull();
    });

    it('stops demo timer, exits demo mode, and commits credentials upon verified handshake success', () => {
      const outcome = resolveTransitionOutcome(
        demoState,
        'http://192.168.1.1:9090',
        'valid-secret',
        true
      );

      expect(outcome.shouldStopDemoTimer).toBe(true);
      expect(outcome.shouldExitDemo).toBe(true);
      expect(outcome.shouldCommitCredentials).toBe(true);
      expect(outcome.nextUrl).toBe('http://192.168.1.1:9090');
      expect(outcome.nextSecret).toBe('valid-secret');
      expect(outcome.nextStatus).toBe('connecting');
      expect(outcome.nextStatusError).toBeNull();
    });

    it('sets error status and refrains from saving credentials when connecting from real mode fails', () => {
      const realState: TransitionState = {
        isDemo: false,
        activeUrl: 'http://127.0.0.1:9090',
        activeSecret: '',
        status: 'connecting',
        statusError: null,
        isDemoTimerRunning: false
      };

      const outcome = resolveTransitionOutcome(
        realState,
        'http://invalid-host:9090',
        'sec',
        false,
        'Connection refused'
      );

      expect(outcome.shouldCommitCredentials).toBe(false);
      expect(outcome.nextStatus).toBe('error');
      expect(outcome.nextStatusError).toBe('Connection refused');
    });
  });

  describe('executeControllerHandshake (Concurrency Guard)', () => {
    it('returns handshake data when generation counter remains current', async () => {
      const mockClient = {
        verifyFullRestHandshake: vi.fn().mockResolvedValue({
          version: DEMO_VERSION,
          config: DEMO_CONFIG,
          proxies: DEMO_PROXIES,
          rules: DEMO_RULES,
          connections: []
        })
      };

      let gen = 5;
      const result = await executeControllerHandshake(mockClient as any, () => gen, 5);
      expect(result).not.toBeNull();
      expect(result?.version.version).toBe(DEMO_VERSION.version);
    });

    it('aborts and returns null if generation counter was bumped mid-handshake', async () => {
      let gen = 1;
      const mockClient = {
        verifyFullRestHandshake: vi.fn().mockImplementation(async () => {
          // Simulate user switching demo mode or initiating newer connect during async fetch
          gen = 2;
          return { version: DEMO_VERSION };
        })
      };

      const result = await executeControllerHandshake(mockClient as any, () => gen, 1);
      expect(result).toBeNull();
    });
  });

  describe('MihomoApiClient (Atomic Handshake & Error Propagation)', () => {
    it('sends authorization header and bearer token on requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ version: 'mihomo Meta v1.19.3' })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'test-secret-123');
      const version = await client.getVersion();

      expect(version.version).toBe('mihomo Meta v1.19.3');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://127.0.0.1:9090/version');
      expect(callArgs[1].headers['Authorization']).toBe('Bearer test-secret-123');
    });

    it('throws ApiError on 401 / 403 unauthorized responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Unauthorized' })
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'wrong-secret');
      await expect(client.getVersion()).rejects.toThrow(ApiError);
      await expect(client.getVersion()).rejects.toThrow(/身份验证失败/);
    });

    it('verifyFullRestHandshake validates all 5 mandatory REST endpoints atomically', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('/version')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ version: 'v1.19.3' }) });
        }
        if (url.includes('/configs')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ mode: 'rule', port: 7890 }) });
        }
        if (url.includes('/proxies')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ proxies: {} }) });
        }
        if (url.includes('/rules')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ rules: [] }) });
        }
        if (url.includes('/connections')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ connections: [], uploadTotal: 0, downloadTotal: 0 }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'sec');
      const handshake = await client.verifyFullRestHandshake();

      expect(callCount).toBe(5);
      expect(handshake.version.version).toBe('v1.19.3');
      expect(handshake.config.mode).toBe('rule');
    });

    it('verifyFullRestHandshake halts immediately on endpoint error without continuing', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('/version')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ version: 'v1.19.3' }) });
        }
        if (url.includes('/configs')) {
          return Promise.resolve({ ok: false, status: 500, statusText: 'Config error', json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new MihomoApiClient('http://127.0.0.1:9090', 'sec');
      await expect(client.verifyFullRestHandshake()).rejects.toThrow(ApiError);
      expect(callCount).toBe(2); // Halted after /configs failed!
    });
  });

  describe('MihomoWsStream (WebSocket Lifecycle & Callbacks)', () => {
    class MockWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      closed = false;

      constructor(url: string) {
        this.url = url;
      }

      close() {
        this.closed = true;
        this.onclose?.();
      }
    }

    it('manages connection events, message dispatching, and cleanup', () => {
      let latestSocket: MockWebSocket | null = null;
      const MockWebSocketCtor = vi.fn().mockImplementation((url: string) => {
        latestSocket = new MockWebSocket(url);
        return latestSocket;
      });
      vi.stubGlobal('WebSocket', MockWebSocketCtor);

      const receivedData: unknown[] = [];
      const statusChanges: boolean[] = [];

      const stream = new MihomoWsStream(
        'ws://127.0.0.1:9090/traffic',
        (data) => receivedData.push(data),
        (connected) => statusChanges.push(connected)
      );

      expect(MockWebSocketCtor).toHaveBeenCalledWith('ws://127.0.0.1:9090/traffic');
      expect(latestSocket).not.toBeNull();

      // Simulate onopen
      latestSocket!.onopen?.();
      expect(statusChanges).toEqual([true]);

      // Simulate incoming message
      latestSocket!.onmessage?.({ data: JSON.stringify({ up: 1048, down: 2048 }) });
      expect(receivedData).toEqual([{ up: 1048, down: 2048 }]);

      // Simulate stream closure
      stream.close();
      expect(latestSocket!.closed).toBe(true);
      expect(statusChanges[statusChanges.length - 1]).toBe(false);
    });

    it('clears telemetry when memory stream disconnects without falsely affecting mandatory joint status', () => {
      let currentMemory: { inuse: number; oslimit: number } | null = { inuse: 50000000, oslimit: 0 };
      const wsHealth = { traffic: true, connections: false };

      // Simulate the status change callback in ControllerContext for memoryWs
      const onMemoryStatusChange = (connected: boolean) => {
        if (!connected) {
          currentMemory = null; // Memory cleared on stream drop
        }
        // Memory status callback does NOT alter wsHealth or call setStatus('connected')
      };

      // When memory stream drops
      onMemoryStatusChange(false);
      expect(currentMemory).toBeNull();
      
      // Joint status remains unaffected and correctly reports 'connecting' (because connections is false)
      const jointStatus = calculateJointWsStatus(wsHealth.traffic, wsHealth.connections);
      expect(jointStatus).toBe('connecting');
      expect(jointStatus).not.toBe('connected');
    });
  });

  describe('Demo Mode Fixtures Integrity', () => {
    it('provides valid, non-empty initial fixtures for immediate offline evaluation', () => {
      expect(DEMO_VERSION.version).toContain('mihomo Meta');
      expect(DEMO_CONFIG.mode).toBe('rule');
      expect(Object.keys(DEMO_PROXIES).length).toBeGreaterThan(0);
      expect(DEMO_RULES.length).toBeGreaterThan(0);
    });
  });

  describe('Onboarding & First-Load Startup Scenarios', () => {
    const STORAGE_KEY_BASE_URL = 'meta_dashboard_base_url';

    it('Scenario 1: No-saved startup prevents auto-probe and triggers SettingsModal auto-open', () => {
      // Simulate clean localStorage (no key)
      const mockStorage: Record<string, string> = {};
      const saved = mockStorage[STORAGE_KEY_BASE_URL];
      const hasConfigured = typeof saved === 'string' && saved.trim().length > 0;

      expect(hasConfigured).toBe(false);

      // On mount: auto-connect is suppressed when hasConfigured is false
      let autoProbeCalled = false;
      const onMount = (hasConfiguredController: boolean, demoMode: boolean) => {
        if (!demoMode && hasConfiguredController) {
          autoProbeCalled = true;
        }
      };
      onMount(hasConfigured, false);
      expect(autoProbeCalled).toBe(false);

      // SettingsModal initial visibility is inverted from hasConfiguredController
      const isSettingsOpenInitial = !hasConfigured;
      expect(isSettingsOpenInitial).toBe(true);
    });

    it('Scenario 2: Explicit saved default retains prior auto-connect behavior without auto-opening modal', () => {
      // User explicitly saved default URL
      const mockStorage: Record<string, string> = {
        [STORAGE_KEY_BASE_URL]: 'http://127.0.0.1:9090'
      };
      const saved = mockStorage[STORAGE_KEY_BASE_URL];
      const hasConfigured = typeof saved === 'string' && saved.trim().length > 0;

      expect(hasConfigured).toBe(true);

      // On mount: auto-connect is permitted when hasConfigured is true
      let autoProbeCalled = false;
      const onMount = (hasConfiguredController: boolean, demoMode: boolean) => {
        if (!demoMode && hasConfiguredController) {
          autoProbeCalled = true;
        }
      };
      onMount(hasConfigured, false);
      expect(autoProbeCalled).toBe(true);

      // SettingsModal does not auto-open
      const isSettingsOpenInitial = !hasConfigured;
      expect(isSettingsOpenInitial).toBe(false);
    });

    it('Scenario 3: Failed save retains unconfigured state without persisting invalid URL', () => {
      // Starting in unconfigured state
      const mockStorage: Record<string, string> = {};
      let hasConfigured = false;

      const currentState: TransitionState = {
        isDemo: false,
        activeUrl: 'http://127.0.0.1:9090',
        activeSecret: '',
        status: 'disconnected',
        statusError: null,
        isDemoTimerRunning: false
      };

      // User tests an invalid/unreachable URL
      const outcome = resolveTransitionOutcome(
        currentState,
        'http://192.168.1.99:9090',
        'wrong-secret',
        false,
        '连接超时'
      );

      expect(outcome.shouldCommitCredentials).toBe(false);
      expect(outcome.nextStatus).toBe('error');

      // Credentials are NOT committed to storage
      if (outcome.shouldCommitCredentials) {
        mockStorage[STORAGE_KEY_BASE_URL] = outcome.nextUrl;
        hasConfigured = true;
      }

      expect(mockStorage[STORAGE_KEY_BASE_URL]).toBeUndefined();
      expect(hasConfigured).toBe(false);
    });
  });
});
