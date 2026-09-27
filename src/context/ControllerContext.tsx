import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  MihomoVersion, 
  MihomoConfig, 
  ProxyItem, 
  ProxyHistory,
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
  secret: string;
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

  // Credential Persistence (SettingsModal API)
  isRemembered: boolean;
  isCredentialRemembered: (url?: string, secret?: string) => boolean;
  saveAndConnect: (url: string, secret: string, remember: boolean) => Promise<SaveCredentialResult>;
  clearPersistedCredential: () => boolean;
  cancelPendingRemember: () => void;

  // Actions
  connectController: (url?: string, secret?: string) => Promise<boolean>;
  refreshAll: () => Promise<void>;
  switchProxy: (groupName: string, selectedNode: string) => Promise<void>;
  unfixProxy: (groupName: string) => Promise<void>;
  testProxyDelay: (nodeName: string) => Promise<number>;
  testProxyDelayBatch: (nodeNames: string[]) => Promise<void>;
  updateConfigMode: (mode: RunMode) => Promise<void>;
  updateConfigField: (patch: Partial<MihomoConfig>) => Promise<void>;
  closeConnection: (id: string) => Promise<void>;
  closeAllConnections: () => Promise<void>;
  clearLogs: () => void;
  pollProxies: (isStillEligible?: () => boolean) => Promise<boolean>;
  apiClient: MihomoApiClient;
}

const ControllerContext = createContext<ControllerContextType | null>(null);

export const STORAGE_KEY_BASE_URL = 'meta_dashboard_base_url';
export const SESSION_KEY_BOUND_SECRET = 'meta_dashboard_session_bound_secret_v1';
export const STORAGE_KEY_BOUND_SECRET = 'meta_dashboard_bound_secret_v1';
export const STORAGE_KEY_REMEMBERED_SECRET = STORAGE_KEY_BOUND_SECRET;
const MAX_TRAFFIC_CHART_POINTS = 900;
const MAX_MEMORY_CHART_POINTS = 30;
const MAX_LOG_COUNT = 300;

export class ActionCancelledError extends Error {
  public readonly isCancelled = true;

  constructor(message = 'Action cancelled due to controller reconnection or source switch') {
    super(message);
    this.name = 'ActionCancelledError';
    Object.setPrototypeOf(this, ActionCancelledError.prototype);
  }
}

export function isActionCancelledError(err: unknown): err is ActionCancelledError {
  return (
    err instanceof ActionCancelledError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { isCancelled?: boolean }).isCancelled === true &&
      (err as { name?: string }).name === 'ActionCancelledError')
  );
}

export interface BoundSessionRecord {
  normalizedUrl: string;
  secret: string;
}

export interface StorageSnapshot {
  baseUrl: string;
  hasConfiguredController: boolean;
  secret: string;
  isRemembered: boolean;
}

export interface SaveCredentialResult {
  connected: boolean;
  remembered: boolean;
  persistenceError: boolean;
}

function safeGetLocalStorage(key: string): string | null {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      storage.setItem(key, value);
    }
  } catch {
    // Storage quota exceeded or disabled in private browsing
  }
}

function safeGetSessionStorage(key: string): string | null {
  try {
    const storage = typeof window !== 'undefined' ? window.sessionStorage : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetSessionBoundSecret(url: string, secret: string): void {
  try {
    const storage = typeof window !== 'undefined' ? window.sessionStorage : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    if (storage) {
      const record: BoundSessionRecord = {
        normalizedUrl: normalizeBaseUrl(url),
        secret
      };
      storage.setItem(SESSION_KEY_BOUND_SECRET, JSON.stringify(record));
    }
  } catch {
    // Storage quota exceeded or disabled in private browsing
  }
}

export function safeSetPersistentBoundSecret(
  url: string,
  secret: string,
  setStorageItem?: (key: string, value: string) => void
): boolean {
  try {
    const record: BoundSessionRecord = {
      normalizedUrl: normalizeBaseUrl(url),
      secret
    };
    const serialized = JSON.stringify(record);
    if (setStorageItem) {
      setStorageItem(STORAGE_KEY_BOUND_SECRET, serialized);
    } else {
      const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!storage) return false;
      storage.setItem(STORAGE_KEY_BOUND_SECRET, serialized);
    }
    return true;
  } catch {
    return false;
  }
}

export function safeRemovePersistentBoundSecret(
  removeStorageItem?: (key: string) => void
): boolean {
  try {
    if (removeStorageItem) {
      removeStorageItem(STORAGE_KEY_BOUND_SECRET);
    } else {
      const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!storage) return false;
      storage.removeItem(STORAGE_KEY_BOUND_SECRET);
    }
    return true;
  } catch {
    return false;
  }
}

export interface PersistenceCommitResult {
  remembered: boolean;
  persistenceError: boolean;
}

function safeSetLocalStorageItem(key: string, value: string): void {
  const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) {
    throw new Error('localStorage is not available');
  }
  storage.setItem(key, value);
}

/**
 * Commits credentials to persistent storage during checked save.
 * Verifies that persisted BASE_URL actually equals the normalized verified controller URL
 * both before writing the bound secret and after writing it.
 * If URL cannot persist or mismatches due to storage error/race, it avoids corrupting/overwriting
 * unrelated credentials and returns persistenceError: true.
 */
export function commitCheckedSaveCredentials(
  url: string,
  secret: string,
  getStorageItem: (key: string) => string | null = safeGetLocalStorage,
  setStorageItem: (key: string, value: string) => void = safeSetLocalStorageItem
): PersistenceCommitResult {
  const normalizedTarget = normalizeBaseUrl(url);

  // 1. Attempt to persist BASE_URL
  try {
    setStorageItem(STORAGE_KEY_BASE_URL, normalizedTarget);
  } catch {
    return { remembered: false, persistenceError: true };
  }

  // 2. Verify that persisted BASE_URL actually equals normalized verified controller URL
  try {
    const persistedUrl = getStorageItem(STORAGE_KEY_BASE_URL);
    if (!persistedUrl || normalizeBaseUrl(persistedUrl) !== normalizedTarget) {
      // URL could not persist or mismatches due to storage error/race.
      // Do not write bound secret to avoid overwriting or corrupting unrelated credentials.
      return { remembered: false, persistenceError: true };
    }
  } catch {
    return { remembered: false, persistenceError: true };
  }

  // 3. Write bound persistent secret
  try {
    const record: BoundSessionRecord = {
      normalizedUrl: normalizedTarget,
      secret
    };
    setStorageItem(STORAGE_KEY_BOUND_SECRET, JSON.stringify(record));
  } catch {
    return { remembered: false, persistenceError: true };
  }

  // 4. Final verification: ensure BASE_URL still matches (no cross-tab race during secret write)
  try {
    const finalUrl = getStorageItem(STORAGE_KEY_BASE_URL);
    if (!finalUrl || normalizeBaseUrl(finalUrl) !== normalizedTarget) {
      return { remembered: false, persistenceError: true };
    }
  } catch {
    return { remembered: false, persistenceError: true };
  }

  return { remembered: true, persistenceError: false };
}

export function isStoredSecretRemembered(
  url: string | null | undefined,
  secret: string | null | undefined,
  rawPersistentRecord?: string | null | undefined
): boolean {
  if (typeof url !== 'string' || !url.trim() || secret === undefined || secret === null) {
    return false;
  }
  const raw = rawPersistentRecord !== undefined ? rawPersistentRecord : safeGetLocalStorage(STORAGE_KEY_BOUND_SECRET);
  const record = parseBoundSecretRecord(raw);
  if (!record) {
    return false;
  }
  return record.normalizedUrl === normalizeBaseUrl(url) && record.secret === secret;
}

/**
 * Safely parses the raw JSON session record and validates its structure.
 * Returns null if raw is missing, malformed JSON, or missing required string fields.
 */
export function parseBoundSecretRecord(raw: string | null | undefined): BoundSessionRecord | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.normalizedUrl === 'string' &&
      parsed.normalizedUrl.trim().length > 0 &&
      typeof parsed.secret === 'string'
    ) {
      return {
        normalizedUrl: normalizeBaseUrl(parsed.normalizedUrl),
        secret: parsed.secret
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the secret to restore on startup.
 * Matching session record takes precedence even if secret is empty string, then matching persistent.
 * Only restores secret if the parsed JSON record's normalizedUrl matches the persisted localStorage URL.
 * Never restores legacy plain secret or unbound values.
 */
export function resolveRestoredSecret(
  persistedUrl: string | null | undefined,
  rawSessionRecord: string | null | undefined,
  rawPersistentRecord?: string | null | undefined
): string {
  if (typeof persistedUrl !== 'string' || !persistedUrl.trim()) {
    return '';
  }
  const normalizedTarget = normalizeBaseUrl(persistedUrl);

  const sessionRecord = parseBoundSecretRecord(rawSessionRecord);
  if (sessionRecord && sessionRecord.normalizedUrl === normalizedTarget) {
    // Matching session record takes precedence even if secret is empty string
    return sessionRecord.secret;
  }

  const persistentRecord = parseBoundSecretRecord(rawPersistentRecord);
  if (persistentRecord && persistentRecord.normalizedUrl === normalizedTarget) {
    return persistentRecord.secret;
  }

  return '';
}

/**
 * Reads localStorage and sessionStorage once at provider boot to create an atomic snapshot.
 * Prevents cross-tab timing races from pairing an updated URL from read 1 with an old secret from read 2.
 */
export function loadInitialControllerSnapshot(
  getLocalStorageItem: (key: string) => string | null = safeGetLocalStorage,
  getSessionStorageItem: (key: string) => string | null = safeGetSessionStorage
): StorageSnapshot {
  const persistedUrl = getLocalStorageItem(STORAGE_KEY_BASE_URL);
  const rawSessionRecord = getSessionStorageItem(SESSION_KEY_BOUND_SECRET);
  const rawPersistentRecord = getLocalStorageItem(STORAGE_KEY_BOUND_SECRET);

  const hasConfiguredController = typeof persistedUrl === 'string' && persistedUrl.trim().length > 0;
  const baseUrl = hasConfiguredController ? persistedUrl : 'http://127.0.0.1:9090';

  let secret = '';
  let isRemembered = false;

  if (hasConfiguredController) {
    secret = resolveRestoredSecret(persistedUrl, rawSessionRecord, rawPersistentRecord);
    isRemembered = isStoredSecretRemembered(baseUrl, secret, rawPersistentRecord);
  }

  return {
    baseUrl,
    hasConfiguredController,
    secret,
    isRemembered
  };
}

/**
 * Guard that verifies an in-flight async action is still operating on the active
 * connection generation, API client instance, and demo mode.
 * Prevents stale responses from previous controllers or demo modes from overwriting active state.
 */
export function isActionGenerationValid(
  actionGen: number,
  currentGen: number,
  actionClient: unknown,
  currentClient: unknown,
  actionIsDemo: boolean,
  currentIsDemo: boolean
): boolean {
  return (
    actionGen === currentGen &&
    actionClient === currentClient &&
    actionIsDemo === currentIsDemo
  );
}

/**
 * Executes batch proxy delay testing sequentially against an active generation snapshot.
 * Immediately stops before invoking the next node if the generation/client/mode is cancelled,
 * preventing cross-controller node probing races.
 */
export async function executeBatchProxyDelay(
  nodeNames: string[],
  isValid: () => boolean,
  testSingleNode: (nodeName: string) => Promise<number>
): Promise<void> {
  for (const nodeName of nodeNames) {
    if (!isValid()) {
      throw new ActionCancelledError('Batch proxy delay cancelled due to controller reconnection or source switch');
    }

    try {
      await testSingleNode(nodeName);
      if (!isValid()) {
        throw new ActionCancelledError('Batch proxy delay cancelled due to controller reconnection or source switch');
      }
    } catch (err: unknown) {
      if (isActionCancelledError(err) || !isValid()) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      // Non-cancellation error for an individual node (e.g. timeout) - continue if still valid.
    }
  }

  if (!isValid()) {
    throw new ActionCancelledError('Batch proxy delay cancelled due to controller reconnection or source switch');
  }
}

export const PROXY_POLL_INTERVAL_MS = 30000;
export const ELIGIBLE_POLL_TABS: readonly string[] = ['overview', 'proxies'] as const;

export function isEligiblePollTab(tab: string): boolean {
  return (ELIGIBLE_POLL_TABS as readonly string[]).includes(tab);
}

/**
 * Gates polling on a successfully REST-verified active real controller:
 * - Current view must be overview or proxies
 * - Document must be visible (paused when hidden)
 * - Real controller only (!demoMode)
 * - REST-verified: version set after handshake, cleared on reset/disconnect
 * - Avoids polling during terminal error (status 'disconnected' or 'error')
 * - Transient WS stream loss (where status is 'connecting' but version is present) does NOT stop polling
 * - API network errors wait for next 30s without clearing proxies
 */
export function isProxyPollingEligible(
  currentTab: string,
  isDocumentVisible: boolean,
  demoMode: boolean,
  version: MihomoVersion | null,
  status: ConnectionStatus
): boolean {
  if (!isEligiblePollTab(currentTab)) return false;
  if (!isDocumentVisible) return false;
  if (demoMode) return false;
  if (!version) return false;
  if (status === 'disconnected' || status === 'error') return false;
  return true;
}

/**
 * Consistent narrow ordering policy across ALL whole-map proxy reads:
 * - Generation & client identity must be valid.
 * - If user initiated a mutation (e.g. manual testProxyDelay, switch) after this request
 *   was dispatched, drop this older snapshot so it doesn't overwrite valid manual state.
 * - Later dispatched request wins; drop out-of-order stale responses.
 */
export function shouldCommitProxySnapshot(
  reqSeq: number,
  lastCommittedSeq: number,
  reqMutationEpoch: number,
  currentMutationEpoch: number,
  isActionValid: boolean
): boolean {
  if (!isActionValid) return false;
  if (reqMutationEpoch !== currentMutationEpoch) return false;
  if (reqSeq <= lastCommittedSeq) return false;
  return true;
}

export const MAX_PROXY_HISTORY_LENGTH = 20;

export function appendProxyHistory(
  existingHistory: ProxyHistory[] | undefined,
  entry: ProxyHistory,
  maxLen: number = MAX_PROXY_HISTORY_LENGTH
): ProxyHistory[] {
  const list = existingHistory ? [...existingHistory, entry] : [entry];
  return list.slice(-maxLen);
}

export interface ProxyPollingHandle {
  stop: () => void;
}

export function startProxyPolling(
  isEligible: () => boolean,
  poll: () => Promise<unknown>,
  intervalMs: number = PROXY_POLL_INTERVAL_MS
): ProxyPollingHandle {
  if (!isEligible()) {
    return { stop: () => {} };
  }

  let stopped = false;
  const executePoll = () => {
    try {
      Promise.resolve(poll()).catch(() => {
        // Swallow unexpected callback rejection to avoid unhandled promise and maintain interval
      });
    } catch {
      // Synchronous throw protection
    }
  };

  executePoll();

  const timer = setInterval(() => {
    if (stopped || !isEligible()) {
      clearInterval(timer);
      stopped = true;
      return;
    }
    executePoll();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}

type ProxyPollSource = { generation: number; client: MihomoApiClient };

/** Coalesces overlapping poll requests into at most one fresh follow-up read. */
export function createCoalescedProxyPollRunner(
  getSource: () => ProxyPollSource,
  isSameSource: (a: ProxyPollSource, b: ProxyPollSource) => boolean,
  execute: (isStillValid: (() => boolean) | undefined) => Promise<boolean>
): (isStillValid?: () => boolean) => Promise<boolean> {
  let inFlight = false;
  let pending: { isStillValid?: () => boolean; source: ProxyPollSource } | undefined;

  const run = async (isStillValid?: () => boolean): Promise<boolean> => {
    const source = getSource();
    if (inFlight) {
      pending = { isStillValid, source };
      return false;
    }

    inFlight = true;
    try {
      return await execute(isStillValid);
    } finally {
      inFlight = false;
      const queued = pending;
      pending = undefined;
      if (
        queued &&
        (!queued.isStillValid || queued.isStillValid()) &&
        isSameSource(queued.source, getSource())
      ) {
        // Deliberately do not await or retry this follow-up on failure. The regular
        // interval remains the retry mechanism.
        void run(queued.isStillValid).catch(() => {
          // Match startProxyPolling's protection against unhandled callback rejection.
        });
      }
    }
  };

  return run;
}

export const ControllerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialSnapshot] = useState<StorageSnapshot>(loadInitialControllerSnapshot);

  // Base URL stored in localStorage, secret strictly in sessionStorage or memory
  const [baseUrl, setBaseUrlState] = useState<string>(() => initialSnapshot.baseUrl);

  // Check if controller URL was explicitly saved in localStorage (non-empty)
  const [hasConfiguredController, setHasConfiguredController] = useState<boolean>(() => initialSnapshot.hasConfiguredController);

  const [hideGlobal, setHideGlobalState] = useState<boolean>(() => {
    try {
      return getStoredHideGlobal();
    } catch {
      return false;
    }
  });

  const setHideGlobal = (val: boolean) => {
    setHideGlobalState(val);
    try {
      setStoredHideGlobal(val);
    } catch {
      // Ignore storage errors
    }
  };

  const [secret, setSecretState] = useState<string>(() => initialSnapshot.secret);

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
  const consentRevisionRef = useRef(0);
  const proxyDispatchSeqRef = useRef<number>(0);
  const lastCommittedProxySeqRef = useRef<number>(0);
  const userMutationEpochRef = useRef<number>(0);
  const statusRef = useRef<ConnectionStatus>(status);
  statusRef.current = status;
  const versionRef = useRef<MihomoVersion | null>(version);
  versionRef.current = version;
  const [isRemembered, setIsRemembered] = useState<boolean>(() => initialSnapshot.isRemembered);

  // Cross-tab storage change sync for persistent credential state (never mutates active URL or secret)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_BOUND_SECRET) {
        setIsRemembered(isStoredSecretRemembered(baseUrl, secret, e.newValue));
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [baseUrl, secret]);

  const isCredentialRemembered = useCallback(
    (targetUrl?: string, targetSecret?: string): boolean => {
      const u = targetUrl !== undefined ? targetUrl : baseUrl;
      const s = targetSecret !== undefined ? targetSecret : secret;
      return isStoredSecretRemembered(u, s);
    },
    [baseUrl, secret]
  );

  const clearPersistedCredential = useCallback((): boolean => {
    // Revoke any in-flight checked-save consent to prevent resurrection
    consentRevisionRef.current++;
    const success = safeRemovePersistentBoundSecret();
    if (success) {
      setIsRemembered(false);
    }
    return success;
  }, []);

  const cancelPendingRemember = useCallback((): void => {
    // Revoke in-flight checked-save consent on modal dismiss or cancel
    consentRevisionRef.current++;
  }, []);

  const wsHealthRef = useRef<{ traffic: boolean; connections: boolean }>({ traffic: false, connections: false });

  // API Client ref
  const apiClientRef = useRef<MihomoApiClient>(new MihomoApiClient(baseUrl, secret));

  // WebSocket streams refs
  const trafficWsRef = useRef<MihomoWsStream<TrafficTick> | null>(null);
  const memoryWsRef = useRef<MihomoWsStream<MemoryTick> | null>(null);
  const connWsRef = useRef<MihomoWsStream<ConnectionsResponse> | null>(null);
  const logsWsRef = useRef<MihomoWsStream<LogTick> | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


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
    userMutationEpochRef.current++;
    lastCommittedProxySeqRef.current = ++proxyDispatchSeqRef.current;
    setProxies({});
    setRules([]);
    setConnections([]);
    setLogs([]);
    setUnreadLogCount(0);
    setVersion(null);
    versionRef.current = null;
    setConfig(null);
  }, []);

  const isCurrentActionValid = useCallback(
    (actionGen: number, client: MihomoApiClient | null, isDemo: boolean): boolean => {
      return isActionGenerationValid(
        actionGen,
        connectGenRef.current,
        client,
        apiClientRef.current,
        isDemo,
        demoModeRef.current
      );
    },
    []
  );

  const commitProxySnapshot = useCallback(
    (
      reqSeq: number,
      reqMutationEpoch: number,
      actionGen: number,
      client: MihomoApiClient | null,
      isDemo: boolean,
      nextProxies: Record<string, ProxyItem>
    ): boolean => {
      const isValid = isCurrentActionValid(actionGen, client, isDemo);
      if (
        !shouldCommitProxySnapshot(
          reqSeq,
          lastCommittedProxySeqRef.current,
          reqMutationEpoch,
          userMutationEpochRef.current,
          isValid
        )
      ) {
        return false;
      }
      lastCommittedProxySeqRef.current = reqSeq;
      setProxies(nextProxies);
      return true;
    },
    [isCurrentActionValid]
  );

  // Real connection initializer with request generation counter and atomic demo exit
  const connectControllerInternal = useCallback(async (
    targetUrl?: string,
    targetSecret?: string,
    remember?: boolean,
    expectedConsentRev?: number
  ): Promise<SaveCredentialResult> => {
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
      if (gen !== connectGenRef.current) {
        return { connected: false, remembered: false, persistenceError: false };
      }

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
        setCurrentTraffic(null);
        setTrafficHistory([]);
        setCurrentMemory(null);
        setMemoryHistory([]);
        setLogs([]);
        setUnreadLogCount(0);
      }

      let remembered = false;
      let persistenceError = false;

      // Commit validated credentials to active state and storage
      if (outcome.shouldCommitCredentials) {
        setBaseUrlState(url);
        setSecretState(sec);
        apiClientRef.current = client;
        setHasConfiguredController(true);

        safeSetSessionBoundSecret(url, sec);

        if (remember === true) {
          // Check consent revision guard to prevent resurrection from unchecked/dismissed actions
          if (expectedConsentRev === undefined || expectedConsentRev === consentRevisionRef.current) {
            const commitRes = commitCheckedSaveCredentials(url, sec);
            remembered = commitRes.remembered;
            persistenceError = commitRes.persistenceError;
            setIsRemembered(commitRes.remembered);
          } else {
            // Consent was revoked while connecting: do not write persistent secret, only update BASE_URL
            safeSetLocalStorage(STORAGE_KEY_BASE_URL, url);
            setIsRemembered(isStoredSecretRemembered(url, sec));
          }
        } else {
          safeSetLocalStorage(STORAGE_KEY_BASE_URL, url);
          // Existing startup/reconnect/demo transitions never write/delete persistent credential.
          setIsRemembered(isStoredSecretRemembered(url, sec));
        }
      }

      setVersion(handshake.version);
      versionRef.current = handshake.version;
      const effectiveLogLevel = resolveEffectiveLogLevel(handshake.config?.['log-level']);
      setConfig({ ...handshake.config, 'log-level': effectiveLogLevel });
      const reqSeq = ++proxyDispatchSeqRef.current;
      const reqMutationEpoch = userMutationEpochRef.current;
      commitProxySnapshot(reqSeq, reqMutationEpoch, gen, client, false, handshake.proxies.proxies || {});
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

      return {
        connected: true,
        remembered,
        persistenceError
      };
    } catch (err: unknown) {
      if (gen !== connectGenRef.current) {
        return { connected: false, remembered: false, persistenceError: false };
      }
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
      return {
        connected: false,
        remembered: false,
        persistenceError: false
      };
    }
  }, [baseUrl, secret, status, statusError, cleanupWebSockets, stopDemoSimulation, resetMetricsAndData]);

  const connectController = useCallback(
    async (targetUrl?: string, targetSecret?: string): Promise<boolean> => {
      const res = await connectControllerInternal(targetUrl, targetSecret, false);
      return res.connected;
    },
    [connectControllerInternal]
  );

  const saveAndConnect = useCallback(
    async (targetUrl: string, targetSecret: string, remember: boolean): Promise<SaveCredentialResult> => {
      const consentRev = ++consentRevisionRef.current;
      return connectControllerInternal(targetUrl, targetSecret, remember, consentRev);
    },
    [connectControllerInternal]
  );

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

    const logGen = connectGenRef.current;
    logsWsRef.current = subscribeLogs(baseUrl, secret, logLevel, (logItem) => {
      if (logGen !== connectGenRef.current || demoModeRef.current) return;
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
      versionRef.current = DEMO_VERSION;
      setConfig(DEMO_CONFIG);
      userMutationEpochRef.current++;
      lastCommittedProxySeqRef.current = ++proxyDispatchSeqRef.current;
      setProxies({ ...DEMO_PROXIES });
      setRules([...DEMO_RULES]);
      setConnections(createInitialDemoConnections());
      setLogs([...INITIAL_DEMO_LOGS]);
      setUnreadLogCount(0);
      setCurrentTraffic({ up: 120000, down: 1850000 });
      setTrafficHistory([]);
      setCurrentMemory({ inuse: 68157440, oslimit: 17179869184 });
      setMemoryHistory([]);
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
    return () => {
      ++connectGenRef.current;
      cleanupStreams();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh All: propagate errors so caller can report failure instead of claiming success
  const refreshAll = async () => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      userMutationEpochRef.current++;
      lastCommittedProxySeqRef.current = ++proxyDispatchSeqRef.current;
      setProxies({ ...DEMO_PROXIES });
      setRules([...DEMO_RULES]);
      return;
    }
    if (status === 'connected' || (versionRef.current && status !== 'disconnected')) {
      try {
        const reqSeq = ++proxyDispatchSeqRef.current;
        const reqMutationEpoch = userMutationEpochRef.current;
        const [p, r, c, cfg] = await Promise.all([
          client.getProxies(),
          client.getRules(),
          client.getConnections(),
          client.getConfigs()
        ]);
        if (!isCurrentActionValid(actionGen, client, isDemo)) {
          throw new ActionCancelledError();
        }
        commitProxySnapshot(reqSeq, reqMutationEpoch, actionGen, client, isDemo, p.proxies || {});
        setRules(r.rules || []);
        setConnections(c.connections || []);
        setTrafficTotal({ upTotal: c.uploadTotal || 0, downTotal: c.downloadTotal || 0 });
        if (cfg) {
          const effectiveLogLevel = resolveEffectiveLogLevel(cfg?.['log-level']);
          setConfig({ ...cfg, 'log-level': effectiveLogLevel });
        }
      } catch (err: unknown) {
        if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
          throw isActionCancelledError(err) ? err : new ActionCancelledError();
        }
        const msg = (err as Error)?.message || '刷新数据失败';
        setStatusError(msg);
        throw err; // Re-throw so Navbar knows refresh failed!
      }
    } else {
      throw new Error('控制器未连接，无法刷新数据');
    }
  };

  const switchProxy = async (groupName: string, selectedNode: string) => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      userMutationEpochRef.current++;
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

    try {
      userMutationEpochRef.current++;
      await client.switchProxy(groupName, selectedNode);
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      // Refresh proxies after switch using consistent ordering policy
      const reqSeq = ++proxyDispatchSeqRef.current;
      const reqMutationEpoch = userMutationEpochRef.current;
      const p = await client.getProxies();
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      commitProxySnapshot(reqSeq, reqMutationEpoch, actionGen, client, isDemo, p.proxies || {});
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const unfixProxy = async (groupName: string) => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      userMutationEpochRef.current++;
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

    try {
      userMutationEpochRef.current++;
      await client.unfixProxy(groupName);
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      const reqSeq = ++proxyDispatchSeqRef.current;
      const reqMutationEpoch = userMutationEpochRef.current;
      const p = await client.getProxies();
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      commitProxySnapshot(reqSeq, reqMutationEpoch, actionGen, client, isDemo, p.proxies || {});
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const testProxyDelay = async (nodeName: string): Promise<number> => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      // Simulate test delay with realistic jitter
      await new Promise((res) => setTimeout(res, 300));
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      const simulatedDelay = Math.floor(30 + Math.random() * 90);
      userMutationEpochRef.current++;
      setProxies((prev) => {
        const node = prev[nodeName];
        if (!node) return prev;
        const history = appendProxyHistory(node.history, {
          time: new Date().toISOString(),
          delay: simulatedDelay
        });
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

    try {
      const delay = await client.testProxyDelay(nodeName);
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      // Update local state for immediate feedback
      userMutationEpochRef.current++;
      setProxies((prev) => {
        const node = prev[nodeName];
        if (!node) return prev;
        const history = appendProxyHistory(node.history, {
          time: new Date().toISOString(),
          delay
        });
        return {
          ...prev,
          [nodeName]: {
            ...node,
            history
          }
        };
      });
      return delay;
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const testProxyDelayBatch = async (nodeNames: string[]): Promise<void> => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    const isValid = () => isCurrentActionValid(actionGen, client, isDemo);

    return executeBatchProxyDelay(
      nodeNames,
      isValid,
      (name) => testProxyDelay(name)
    );
  };

  const updateConfigMode = async (mode: RunMode) => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConfig((prev) => (prev ? { ...prev, mode } : prev));
      return;
    }
    try {
      await client.updateConfigs({ mode });
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConfig((prev) => (prev ? { ...prev, mode } : prev));
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const updateConfigField = useCallback(async (patch: Partial<MihomoConfig>) => {
    const cleanPatch = { ...patch };
    if (cleanPatch['log-level']) {
      cleanPatch['log-level'] = resolveEffectiveLogLevel(cleanPatch['log-level']);
    }
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
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
    try {
      await client.updateConfigs(cleanPatch);
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      const updated = await client.getConfigs();
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      const effectiveLogLevel = resolveEffectiveLogLevel(updated?.['log-level']);
      setConfig({ ...updated, 'log-level': effectiveLogLevel });
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  }, [isCurrentActionValid]);

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
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConnections((prev) => prev.filter((c) => c.id !== id));
      return;
    }
    try {
      await client.closeConnection(id);
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const closeAllConnections = async () => {
    const actionGen = connectGenRef.current;
    const client = apiClientRef.current;
    const isDemo = demoModeRef.current;

    if (isDemo) {
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConnections([]);
      return;
    }
    try {
      await client.closeAllConnections();
      if (!isCurrentActionValid(actionGen, client, isDemo)) {
        throw new ActionCancelledError();
      }
      setConnections([]);
    } catch (err: unknown) {
      if (!isCurrentActionValid(actionGen, client, isDemo) || isActionCancelledError(err)) {
        throw isActionCancelledError(err) ? err : new ActionCancelledError();
      }
      throw err;
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setUnreadLogCount(0);
  };

  const proxyPollRunnerRef = useRef<((isStillValid?: () => boolean) => Promise<boolean>) | null>(null);
  if (!proxyPollRunnerRef.current) {
    proxyPollRunnerRef.current = createCoalescedProxyPollRunner(
      () => ({ generation: connectGenRef.current, client: apiClientRef.current }),
      (a, b) => a.generation === b.generation && a.client === b.client,
      async (isStillValid) => {
        // Must be active REST-verified real controller (not demo, not terminal)
        if (
          demoModeRef.current ||
          !versionRef.current ||
          statusRef.current === 'disconnected' ||
          statusRef.current === 'error'
        ) {
          return false;
        }
        // Immediate validity check before dispatching network request
        if (isStillValid && !isStillValid()) {
          return false;
        }

        const actionGen = connectGenRef.current;
        const client = apiClientRef.current;
        const isDemo = demoModeRef.current;
        const reqSeq = ++proxyDispatchSeqRef.current;
        const reqMutationEpoch = userMutationEpochRef.current;

        try {
          const res = await client.getProxies();
          if (isStillValid && !isStillValid()) {
            return false;
          }
          // Atomically replace entire map via consistent whole-map ordering and mutation guard
          if (res && res.proxies) {
            return commitProxySnapshot(reqSeq, reqMutationEpoch, actionGen, client, isDemo, res.proxies);
          }
          return false;
        } catch {
          // Do not clear proxies on poll failure; avoid unhandled rejections and a retry storm
          return false;
        }
      }
    );
  }
  const pollProxies = useCallback(
    (isStillValid?: () => boolean): Promise<boolean> => proxyPollRunnerRef.current!(isStillValid),
    []
  );

  return (
    <ControllerContext.Provider
      value={{
        baseUrl,
        secret,
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
        isRemembered,
        isCredentialRemembered,
        saveAndConnect,
        clearPersistedCredential,
        cancelPendingRemember,
        connectController,
        refreshAll,
        pollProxies,
        switchProxy,
        unfixProxy,
        testProxyDelay,
        testProxyDelayBatch,
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
