import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  MihomoVersion, 
  MihomoConfig, 
  ProxyItem, 
  RuleItem, 
  ConnectionItem, 
  ConnectionsResponse, 
  TrafficTick, 
  MemoryTick, 
  LogTick, 
  RunMode,
  LogLevel 
} from '../types/api';

export const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warning', 'error', 'silent'] as const;

export function resolveEffectiveLogLevel(rawLevel?: string | null): LogLevel {
  if (typeof rawLevel === 'string') {
    const normalized = rawLevel.trim().toLowerCase();
    if ((VALID_LOG_LEVELS as readonly string[]).includes(normalized)) {
      return normalized as LogLevel;
    }
  }
  return 'info';
}
import { ConnectionStatus } from '../types/connection';
import { MihomoApiClient } from '../services/apiClient';
import { 
  subscribeTraffic, 
  subscribeMemory, 
  subscribeConnections, 
  subscribeLogs, 
  MihomoWsStream 
} from '../services/wsClient';
import { normalizeBaseUrl } from '../utils/url';
import { calculateJointWsStatus } from '../utils/status';
import { resolveTransitionOutcome, TransitionState } from '../utils/lifecycle';
import { getStoredHideGlobal, setStoredHideGlobal } from '../utils/proxy';
import { 
  DEMO_VERSION, 
  DEMO_CONFIG, 
  DEMO_PROXIES, 
  DEMO_RULES, 
  createInitialDemoConnections, 
  INITIAL_DEMO_LOGS 
} from '../services/demoData';

interface ControllerContextType {
  // Config & State
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  secret: string;
  setSecret: (sec: string) => void;
  hasConfiguredController: boolean;
  hideGlobal: boolean;
  setHideGlobal: (hide: boolean) => void;
  demoMode: boolean;
  setDemoMode: (demo: boolean, credentials?: { url?: string; secret?: string }) => Promise<boolean>;
  status: ConnectionStatus;
  statusError: string | null;
  version: MihomoVersion | null;
  config: MihomoConfig | null;

  // Real-time Traffic & Memory (null until first genuine sample)
  currentTraffic: TrafficTick | null;
  trafficHistory: TrafficTick[];
  currentMemory: MemoryTick | null;
  memoryHistory: MemoryTick[];
  trafficTotal: { upTotal: number; downTotal: number };

  // Data Collections
  proxies: Record<string, ProxyItem>;
  rules: RuleItem[];
  connections: ConnectionItem[];
  logs: LogTick[];
  unreadLogCount: number;
  isLogPaused: boolean;
  setIsLogPaused: (paused: boolean) => void;
  logLevel: LogLevel;
  setLogLevel: (lvl: LogLevel) => Promise<void>;

  // Actions
  connectController: (url?: string, secret?: string) => Promise<boolean>;
  refreshAll: () => Promise<void>;
  switchProxy: (groupName: string, selectedNode: string) => Promise<void>;
  unfixProxy: (groupName: string) => Promise<void>;
  testProxyDelay: (nodeName: string) => Promise<number>;
  updateConfigMode: (mode: RunMode) => Promise<void>;
  updateConfigField: (patch: Partial<MihomoConfig>) => Promise<void>;
  closeConnection: (id: string) => Promise<void>;
  closeAllConnections: () => Promise<void>;
  clearLogs: () => void;
  apiClient: MihomoApiClient;
}

const ControllerContext = createContext<ControllerContextType | null>(null);

const STORAGE_KEY_BASE_URL = 'meta_dashboard_base_url';
const SESSION_KEY_SECRET = 'meta_dashboard_secret';
const MAX_TRAFFIC_CHART_POINTS = 900;
const MAX_MEMORY_CHART_POINTS = 30;
const MAX_LOG_COUNT = 300;

export const ControllerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Base URL stored in localStorage, secret strictly in sessionStorage or memory
  const [baseUrl, setBaseUrlState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_BASE_URL) || 'http://127.0.0.1:9090';
  });

  // Check if controller URL was explicitly saved in localStorage (non-empty)
  const [hasConfiguredController, setHasConfiguredController] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BASE_URL);
    return typeof saved === 'string' && saved.trim().length > 0;
  });

  const [hideGlobal, setHideGlobalState] = useState<boolean>(() => {
    return getStoredHideGlobal();
  });

  const setHideGlobal = (val: boolean) => {
    setHideGlobalState(val);
    setStoredHideGlobal(val);
  };

  const [secret, setSecretState] = useState<string>(() => {
    return sessionStorage.getItem(SESSION_KEY_SECRET) || '';
  });

  const [demoMode, setDemoModeState] = useState<boolean>(false);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [version, setVersion] = useState<MihomoVersion | null>(null);
  const [config, setConfig] = useState<MihomoConfig | null>(null);

  // Streaming metrics: initialized to null to avoid misrepresenting unmeasured values as live zero
  const [currentTraffic, setCurrentTraffic] = useState<TrafficTick | null>(null);
  const [trafficHistory, setTrafficHistory] = useState<TrafficTick[]>([]);
  const [currentMemory, setCurrentMemory] = useState<MemoryTick | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<MemoryTick[]>([]);
  const [trafficTotal, setTrafficTotal] = useState<{ upTotal: number; downTotal: number }>({ upTotal: 0, downTotal: 0 });

  // Collections
  const [proxies, setProxies] = useState<Record<string, ProxyItem>>({});
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [logs, setLogs] = useState<LogTick[]>([]);
  const [isLogPaused, setIsLogPaused] = useState<boolean>(false);
  const [unreadLogCount, setUnreadLogCount] = useState<number>(0);

  // Derive effective logLevel directly from config (single source of truth)
  const logLevel: LogLevel = useMemo(() => {
    return resolveEffectiveLogLevel(config?.['log-level']);
  }, [config]);

  // Refs for state that async callbacks need to access without closing over stale state
  const isLogPausedRef = useRef(isLogPaused);
  isLogPausedRef.current = isLogPaused;

  const demoModeRef = useRef(demoMode);
  demoModeRef.current = demoMode;

  const logLevelRef = useRef(logLevel);
  logLevelRef.current = logLevel;

  const connectGenRef = useRef(0);
  const wsHealthRef = useRef<{ traffic: boolean; connections: boolean }>({ traffic: false, connections: false });

  // API Client ref
  const apiClientRef = useRef<MihomoApiClient>(new MihomoApiClient(baseUrl, secret));

  // WebSocket streams refs
  const trafficWsRef = useRef<MihomoWsStream<TrafficTick> | null>(null);
  const memoryWsRef = useRef<MihomoWsStream<MemoryTick> | null>(null);
  const connWsRef = useRef<MihomoWsStream<ConnectionsResponse> | null>(null);
  const logsWsRef = useRef<MihomoWsStream<LogTick> | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setBaseUrl = (url: string) => {
    const normalized = normalizeBaseUrl(url);
    setBaseUrlState(normalized);
    localStorage.setItem(STORAGE_KEY_BASE_URL, normalized);
    apiClientRef.current.updateConfig(normalized, secret);
  };

  const setSecret = (sec: string) => {
    setSecretState(sec);
    sessionStorage.setItem(SESSION_KEY_SECRET, sec);
    apiClientRef.current.updateConfig(baseUrl, sec);
  };

  const cleanupWebSockets = useCallback(() => {
    wsHealthRef.current = { traffic: false, connections: false };
    if (trafficWsRef.current) {
      trafficWsRef.current.close();
      trafficWsRef.current = null;
    }
    if (memoryWsRef.current) {
      memoryWsRef.current.close();
      memoryWsRef.current = null;
    }
    if (connWsRef.current) {
      connWsRef.current.close();
      connWsRef.current = null;
    }
    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }
  }, []);

  const stopDemoSimulation = useCallback(() => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  }, []);

  const cleanupStreams = useCallback(() => {
    cleanupWebSockets();
    stopDemoSimulation();
  }, [cleanupWebSockets, stopDemoSimulation]);

  const resetMetricsAndData = useCallback(() => {
    setCurrentTraffic(null);
    setTrafficHistory([]);
    setCurrentMemory(null);
    setMemoryHistory([]);
    setTrafficTotal({ upTotal: 0, downTotal: 0 });
    setProxies({});
    setRules([]);
    setConnections([]);
    setVersion(null);
    setConfig(null);
  }, []);

  // Real connection initializer with request generation counter and atomic demo exit
  const connectController = useCallback(async (targetUrl?: string, targetSecret?: string): Promise<boolean> => {
    const gen = ++connectGenRef.current;
    const url = targetUrl !== undefined ? normalizeBaseUrl(targetUrl) : baseUrl;
    const sec = targetSecret !== undefined ? targetSecret : secret;

    // Clean up real WebSockets before attempting new handshake
    cleanupWebSockets();

    // If not in demo mode, show connecting status and clear metrics
    if (!demoModeRef.current) {
      resetMetricsAndData();
      setStatus('connecting');
      setStatusError(null);
    }

    const client = new MihomoApiClient(url, sec);

    try {
      // Complete full atomic 5-endpoint REST reachability check
      const handshake = await client.verifyFullRestHandshake();
      if (gen !== connectGenRef.current) return false;

      const currentState: TransitionState = {
        isDemo: demoModeRef.current,
        activeUrl: baseUrl,
        activeSecret: secret,
        status,
        statusError,
        isDemoTimerRunning: !!demoIntervalRef.current
      };

      const outcome = resolveTransitionOutcome(currentState, url, sec, true);

      // Stop demo simulation only upon confirmed REST handshake success
      if (outcome.shouldStopDemoTimer) {
        stopDemoSimulation();
      }

      // Exit demo mode only upon confirmed success
      if (outcome.shouldExitDemo) {
        setDemoModeState(false);
        demoModeRef.current = false;
      }

      // Commit validated credentials to active state and storage
      if (outcome.shouldCommitCredentials) {
        setBaseUrlState(url);
        localStorage.setItem(STORAGE_KEY_BASE_URL, url);
        setSecretState(sec);
        sessionStorage.setItem(SESSION_KEY_SECRET, sec);
        apiClientRef.current = client;
        setHasConfiguredController(true);
      }

      setVersion(handshake.version);
      const effectiveLogLevel = resolveEffectiveLogLevel(handshake.config?.['log-level']);
      setConfig({ ...handshake.config, 'log-level': effectiveLogLevel });
      setProxies(handshake.proxies.proxies || {});
      setRules(handshake.rules.rules || []);
      setConnections(handshake.connections.connections || []);
      setTrafficTotal({
        upTotal: handshake.connections.uploadTotal || 0,
        downTotal: handshake.connections.downloadTotal || 0
      });
      setStatus(outcome.nextStatus);

      // Initialize real WebSockets with JOINT mandatory status tracking
      trafficWsRef.current = subscribeTraffic(
        url,
        sec,
        (data) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          const tick: TrafficTick = { up: data.up || 0, down: data.down || 0, time: Date.now() };
          setCurrentTraffic(tick);
          setTrafficHistory((prev) => [...prev, tick].slice(-MAX_TRAFFIC_CHART_POINTS));
        },
        (connected) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          wsHealthRef.current.traffic = connected;
          if (!connected) {
            setCurrentTraffic(null);
          }
          const joint = calculateJointWsStatus(wsHealthRef.current.traffic, wsHealthRef.current.connections);
          setStatus(joint);
        }
      );

      memoryWsRef.current = subscribeMemory(
        url,
        sec,
        (data) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          const tick: MemoryTick = { inuse: data.inuse || 0, oslimit: data.oslimit || 0, time: Date.now() };
          setCurrentMemory(tick);
          setMemoryHistory((prev) => [...prev, tick].slice(-MAX_MEMORY_CHART_POINTS));
        },
        (connected) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          // Clear stale memory when memory WS disconnects without falsely affecting joint status
          if (!connected) {
            setCurrentMemory(null);
          }
        }
      );

      connWsRef.current = subscribeConnections(
        url,
        sec,
        1000,
        (res) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          if (res && Array.isArray(res.connections)) {
            setConnections(res.connections);
            // Snapshot totals from real mihomo counters
            setTrafficTotal({ upTotal: res.uploadTotal || 0, downTotal: res.downloadTotal || 0 });
          }
        },
        (connected) => {
          if (gen !== connectGenRef.current || demoModeRef.current) return;
          wsHealthRef.current.connections = connected;
          if (!connected) {
            setConnections([]);
          }
          const joint = calculateJointWsStatus(wsHealthRef.current.traffic, wsHealthRef.current.connections);
          setStatus(joint);
        }
      );

      return true;
    } catch (err: unknown) {
      if (gen !== connectGenRef.current) return false;
      const msg = (err as Error)?.message || '无法连接到外部控制器';

      const currentState: TransitionState = {
        isDemo: demoModeRef.current,
        activeUrl: baseUrl,
        activeSecret: secret,
        status,
        statusError,
        isDemoTimerRunning: !!demoIntervalRef.current
      };

      const outcome = resolveTransitionOutcome(currentState, url, sec, false, msg);

      // If in demo mode, demo simulation remains alive and credentials are NOT committed
      if (!currentState.isDemo) {
        setStatus(outcome.nextStatus);
        setStatusError(outcome.nextStatusError);
      }
      return false;
    }
  }, [baseUrl, secret, status, statusError, cleanupWebSockets, stopDemoSimulation, resetMetricsAndData]);

  // Separate effect for live log WS stream so logLevel changes properly reconnect WS
  useEffect(() => {
    if (demoMode || status !== 'connected') {
      if (logsWsRef.current) {
        logsWsRef.current.close();
        logsWsRef.current = null;
      }
      return;
    }

    if (logsWsRef.current) {
      logsWsRef.current.close();
      logsWsRef.current = null;
    }

    logsWsRef.current = subscribeLogs(baseUrl, secret, logLevel, (logItem) => {
      if (demoModeRef.current) return;
      const item: LogTick = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: logItem.type,
        payload: logItem.payload,
        time: new Date().toLocaleTimeString()
      };

      if (isLogPausedRef.current) {
        setUnreadLogCount((c) => c + 1);
      } else {
        setLogs((prev) => [...prev.slice(-(MAX_LOG_COUNT - 1)), item]);
      }
    });

    return () => {
      if (logsWsRef.current) {
        logsWsRef.current.close();
        logsWsRef.current = null;
      }
    };
  }, [baseUrl, secret, logLevel, status, demoMode]);

  // Handle demoMode toggle: clean transitions both ON and OFF with optional explicit credentials
  const setDemoMode = useCallback(async (demo: boolean, credentials?: { url?: string; secret?: string }): Promise<boolean> => {
    if (demo) {
      // Invalidate any in-flight real connection attempt
      ++connectGenRef.current;
      cleanupStreams();
      setDemoModeState(true);
      demoModeRef.current = true;
      setStatus('connected');
      setStatusError(null);
      setVersion(DEMO_VERSION);
      setConfig(DEMO_CONFIG);
      setProxies({ ...DEMO_PROXIES });
      setRules([...DEMO_RULES]);
      setConnections(createInitialDemoConnections());
      setLogs([...INITIAL_DEMO_LOGS]);
      setCurrentTraffic({ up: 120000, down: 1850000 });
      setCurrentMemory({ inuse: 68157440, oslimit: 17179869184 });
      setTrafficTotal({ upTotal: 104857600, downTotal: 1073741824 });
      return true;
    } else {
      // Transitioning from demo mode to real core:
      // Connect using explicit credentials if passed, otherwise current baseUrl and secret
      const targetUrl = credentials?.url !== undefined ? credentials.url : baseUrl;
      const targetSec = credentials?.secret !== undefined ? credentials.secret : secret;
      return connectController(targetUrl, targetSec);
    }
  }, [baseUrl, secret, cleanupStreams, connectController]);

  // Demo mode mock loop - does NOT depend on isLogPaused, preserving fixture lifecycle
  useEffect(() => {
    if (!demoMode) return;

    let step = 0;
    demoIntervalRef.current = setInterval(() => {
      step++;
      // Simulate traffic waveform
      const baseDown = 2500000;
      const baseUp = 320000;
      const wave = Math.sin(step * 0.4) * 0.5 + 0.5;
      const jitter = (Math.random() - 0.5) * 0.3;
      const down = Math.max(50000, Math.round(baseDown * (wave + jitter)));
      const up = Math.max(10000, Math.round(baseUp * (wave + jitter)));

      const tick: TrafficTick = { up, down, time: Date.now() };
      setCurrentTraffic(tick);
      setTrafficHistory((prev) => [...prev.slice(-(MAX_TRAFFIC_CHART_POINTS - 1)), tick]);
      setTrafficTotal((prev) => ({
        upTotal: prev.upTotal + up,
        downTotal: prev.downTotal + down
      }));

      // Simulate memory
      const memInuse = 68000000 + Math.round(Math.sin(step * 0.2) * 4000000);
      const memTick: MemoryTick = { inuse: memInuse, oslimit: 17179869184, time: Date.now() };
      setCurrentMemory(memTick);
      setMemoryHistory((prev) => [...prev.slice(-(MAX_MEMORY_CHART_POINTS - 1)), memTick]);

      // Slowly increment connection bytes in demo
      setConnections((prev) =>
        prev.map((c, idx) => {
          if (idx === 0) {
            return { ...c, download: c.download + down, upload: c.upload + Math.round(up * 0.1) };
          }
          return c;
        })
      );

      // Occasionally add a demo log, reading isLogPausedRef without restarting fixtures
      if (step % 5 === 0) {
        if (logLevelRef.current === 'silent') {
          return;
        }
        const demoLogTypes: LogLevel[] = ['info', 'info', 'warning'];
        const sampleLog: LogTick = {
          id: `demo-${Date.now()}`,
          type: demoLogTypes[Math.floor(Math.random() * demoLogTypes.length)],
          payload: `[TCP] 192.168.1.102:${54200 + step} --> cdn.cloudflare.net:443 match DomainSuffix(cloudflare.net) using 节点选择[🇭🇰 香港 01 [IEPL 专线]]`,
          time: new Date().toLocaleTimeString()
        };
        if (!isLogPausedRef.current) {
          setLogs((prev) => [...prev.slice(-(MAX_LOG_COUNT - 1)), sampleLog]);
        } else {
          setUnreadLogCount((c) => c + 1);
        }
      }
    }, 1000);

    return () => {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
    };
  }, [demoMode]); // Note: isLogPaused is intentionally excluded, uses isLogPausedRef

  // Initial connect attempt on mount if not in demo mode AND controller is explicitly configured
  useEffect(() => {
    if (!demoMode && hasConfiguredController) {
      connectController();
    }
    return () => cleanupStreams();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh All: propagate errors so caller can report failure instead of claiming success
  const refreshAll = async () => {
    if (demoMode) {
      setProxies({ ...DEMO_PROXIES });
      setRules([...DEMO_RULES]);
      return;
    }
    if (status === 'connected') {
      try {
        const [p, r, c, cfg] = await Promise.all([
          apiClientRef.current.getProxies(),
          apiClientRef.current.getRules(),
          apiClientRef.current.getConnections(),
          apiClientRef.current.getConfigs()
        ]);
        setProxies(p.proxies || {});
        setRules(r.rules || []);
        setConnections(c.connections || []);
        setTrafficTotal({ upTotal: c.uploadTotal || 0, downTotal: c.downloadTotal || 0 });
        if (cfg) {
          const effectiveLogLevel = resolveEffectiveLogLevel(cfg?.['log-level']);
          setConfig({ ...cfg, 'log-level': effectiveLogLevel });
        }
      } catch (err: unknown) {
        const msg = (err as Error)?.message || '刷新数据失败';
        setStatusError(msg);
        throw err; // Re-throw so Navbar knows refresh failed!
      }
    } else {
      throw new Error('控制器未连接，无法刷新数据');
    }
  };

  const switchProxy = async (groupName: string, selectedNode: string) => {
    if (demoMode) {
      setProxies((prev) => {
        const currentGroup = prev[groupName];
        if (!currentGroup) return prev;
        const isUrlTest = currentGroup.type === 'URLTest';
        return {
          ...prev,
          [groupName]: {
            ...currentGroup,
            now: selectedNode,
            ...(isUrlTest ? { fixed: selectedNode } : {})
          }
        };
      });
      return;
    }

    await apiClientRef.current.switchProxy(groupName, selectedNode);
    // Refresh proxies after switch
    const p = await apiClientRef.current.getProxies();
    setProxies(p.proxies || {});
  };

  const unfixProxy = async (groupName: string) => {
    if (demoMode) {
      setProxies((prev) => {
        const currentGroup = prev[groupName];
        if (!currentGroup) return prev;
        const updated = { ...currentGroup };
        delete updated.fixed;
        // Restore the fixture's automatic selection, preserving a safe current
        // selection if this group has no corresponding demo fixture.
        updated.now = DEMO_PROXIES[groupName]?.now || currentGroup.now || currentGroup.all?.[0];
        return {
          ...prev,
          [groupName]: updated
        };
      });
      return;
    }

    await apiClientRef.current.unfixProxy(groupName);
    const p = await apiClientRef.current.getProxies();
    setProxies(p.proxies || {});
  };

  const testProxyDelay = async (nodeName: string): Promise<number> => {
    if (demoMode) {
      // Simulate test delay with realistic jitter
      await new Promise((res) => setTimeout(res, 300));
      const simulatedDelay = Math.floor(30 + Math.random() * 90);
      setProxies((prev) => {
        const node = prev[nodeName];
        if (!node) return prev;
        const history = [{ time: new Date().toISOString(), delay: simulatedDelay }, ...(node.history || [])];
        return {
          ...prev,
          [nodeName]: {
            ...node,
            history
          }
        };
      });
      return simulatedDelay;
    }

    const delay = await apiClientRef.current.testProxyDelay(nodeName);
    // Update local state for immediate feedback
    setProxies((prev) => {
      const node = prev[nodeName];
      if (!node) return prev;
      const history = [{ time: new Date().toISOString(), delay }, ...(node.history || [])];
      return {
        ...prev,
        [nodeName]: {
          ...node,
          history
        }
      };
    });
    return delay;
  };

  const updateConfigMode = async (mode: RunMode) => {
    if (demoMode) {
      setConfig((prev) => (prev ? { ...prev, mode } : prev));
      return;
    }
    await apiClientRef.current.updateConfigs({ mode });
    setConfig((prev) => (prev ? { ...prev, mode } : prev));
  };

  const updateConfigField = useCallback(async (patch: Partial<MihomoConfig>) => {
    const cleanPatch = { ...patch };
    if (cleanPatch['log-level']) {
      cleanPatch['log-level'] = resolveEffectiveLogLevel(cleanPatch['log-level']);
    }
    if (demoMode) {
      setConfig((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...cleanPatch };
        if (next['log-level']) {
          next['log-level'] = resolveEffectiveLogLevel(next['log-level']);
        }
        return next;
      });
      return;
    }
    await apiClientRef.current.updateConfigs(cleanPatch);
    const updated = await apiClientRef.current.getConfigs();
    const effectiveLogLevel = resolveEffectiveLogLevel(updated?.['log-level']);
    setConfig({ ...updated, 'log-level': effectiveLogLevel });
  }, [demoMode]);

  const setLogLevel = useCallback(async (lvl: LogLevel): Promise<void> => {
    const targetLevel = resolveEffectiveLogLevel(lvl);
    if (logLevel === targetLevel) {
      return;
    }
    if (!demoMode && status !== 'connected') {
      throw new Error('控制器未连接，无法修改日志级别');
    }
    await updateConfigField({ 'log-level': targetLevel });
  }, [logLevel, demoMode, status, updateConfigField]);

  const closeConnection = async (id: string) => {
    if (demoMode) {
      setConnections((prev) => prev.filter((c) => c.id !== id));
      return;
    }
    await apiClientRef.current.closeConnection(id);
    setConnections((prev) => prev.filter((c) => c.id !== id));
  };

  const closeAllConnections = async () => {
    if (demoMode) {
      setConnections([]);
      return;
    }
    await apiClientRef.current.closeAllConnections();
    setConnections([]);
  };

  const clearLogs = () => {
    setLogs([]);
    setUnreadLogCount(0);
  };

  return (
    <ControllerContext.Provider
      value={{
        baseUrl,
        setBaseUrl,
        secret,
        setSecret,
        hasConfiguredController,
        hideGlobal,
        setHideGlobal,
        demoMode,
        setDemoMode,
        status,
        statusError,
        version,
        config,
        currentTraffic,
        trafficHistory,
        currentMemory,
        memoryHistory,
        trafficTotal,
        proxies,
        rules,
        connections,
        logs,
        unreadLogCount,
        isLogPaused,
        setIsLogPaused: (paused) => {
          setIsLogPaused(paused);
          isLogPausedRef.current = paused;
          if (!paused) setUnreadLogCount(0);
        },
        logLevel,
        setLogLevel,
        connectController,
        refreshAll,
        switchProxy,
        unfixProxy,
        testProxyDelay,
        updateConfigMode,
        updateConfigField,
        closeConnection,
        closeAllConnections,
        clearLogs,
        apiClient: apiClientRef.current
      }}
    >
      {children}
    </ControllerContext.Provider>
  );
};

export const useController = () => {
  const context = useContext(ControllerContext);
  if (!context) {
    throw new Error('useController must be used within a ControllerProvider');
  }
  return context;
};
