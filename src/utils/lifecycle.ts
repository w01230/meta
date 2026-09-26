import { ConnectionStatus } from '../types/connection';
import { MihomoVersion, MihomoConfig, ProxiesResponse, RulesResponse, ConnectionsResponse } from '../types/api';

export interface FullHandshakeData {
  version: MihomoVersion;
  config: MihomoConfig;
  proxies: ProxiesResponse;
  rules: RulesResponse;
  connections: ConnectionsResponse;
}

export interface TransitionState {
  isDemo: boolean;
  activeUrl: string;
  activeSecret: string;
  status: ConnectionStatus;
  statusError: string | null;
  isDemoTimerRunning: boolean;
}

export interface TransitionPlan {
  shouldStopDemoTimer: boolean;
  shouldCommitCredentials: boolean;
  shouldExitDemo: boolean;
  nextStatus: ConnectionStatus;
  nextStatusError: string | null;
  nextUrl: string;
  nextSecret: string;
}

/**
 * Pure transition decision function for atomic controller connection attempts.
 * Ensures that during failed connection attempts from demo mode:
 * 1. Demo timer is NOT stopped and remains active.
 * 2. Unverified credentials are NOT committed to storage or active state.
 * 3. Demo mode is NOT exited.
 */
export function resolveTransitionOutcome(
  currentState: TransitionState,
  targetUrl: string,
  targetSecret: string,
  handshakeSucceeded: boolean,
  errorMessage?: string
): TransitionPlan {
  if (handshakeSucceeded) {
    return {
      shouldStopDemoTimer: currentState.isDemo,
      shouldCommitCredentials: true,
      shouldExitDemo: currentState.isDemo,
      nextStatus: 'connecting', // will become 'connected' once joint mandatory WS streams report healthy
      nextStatusError: null,
      nextUrl: targetUrl,
      nextSecret: targetSecret
    };
  }

  // Failed handshake
  if (currentState.isDemo) {
    return {
      shouldStopDemoTimer: false, // Keep existing demo interval alive
      shouldCommitCredentials: false, // Do NOT persist unverified credentials
      shouldExitDemo: false, // Retain demo mode
      nextStatus: currentState.status,
      nextStatusError: null,
      nextUrl: currentState.activeUrl,
      nextSecret: currentState.activeSecret
    };
  }

  return {
    shouldStopDemoTimer: false,
    shouldCommitCredentials: false,
    shouldExitDemo: false,
    nextStatus: 'error',
    nextStatusError: errorMessage || '无法连接到外部控制器',
    nextUrl: currentState.activeUrl,
    nextSecret: currentState.activeSecret
  };
}

/**
 * Asynchronously executes full REST verification with strict generation counter checking.
 * Aborts cleanly if a concurrent connection or demo toggle superseded this request.
 */
export async function executeControllerHandshake(
  client: { verifyFullRestHandshake: () => Promise<FullHandshakeData> },
  getCurrentGen: () => number,
  expectedGen: number
): Promise<FullHandshakeData | null> {
  const data = await client.verifyFullRestHandshake();
  if (getCurrentGen() !== expectedGen) {
    return null;
  }
  return data;
}
