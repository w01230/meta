export interface ControllerConfig {
  baseUrl: string; // e.g. "http://127.0.0.1:9090"
  secret: string;  // Bearer secret, kept in sessionStorage or memory
  autoConnect: boolean;
  rememberSecretInSession: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ControllerStatusState {
  status: ConnectionStatus;
  version: string | null;
  error: string | null;
  lastChecked: number | null;
}
