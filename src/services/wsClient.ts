import { TrafficTick, MemoryTick, LogTick, ConnectionsResponse, LogLevel } from '../types/api';
import { buildWsUrl } from '../utils/url';

export type StreamStatusListener = (connected: boolean) => void;

export class MihomoWsStream<T> {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: (data: T) => void;
  private onStatusChange?: StreamStatusListener;
  private isDestroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 10000;

  constructor(
    url: string,
    onMessage: (data: T) => void,
    onStatusChange?: StreamStatusListener
  ) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.connect();
  }

  private connect() {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatusChange?.(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.onMessage(parsed);
        } catch {
          // ignore invalid JSON frames
        }
      };

      this.ws.onerror = () => {
        this.onStatusChange?.(false);
      };

      this.ws.onclose = () => {
        this.onStatusChange?.(false);
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      };
    } catch {
      this.onStatusChange?.(false);
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  public close() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange?.(false);
  }
}

export function subscribeTraffic(
  baseUrl: string,
  secret: string,
  onData: (data: TrafficTick) => void,
  onStatusChange?: StreamStatusListener
): MihomoWsStream<TrafficTick> {
  const url = buildWsUrl(baseUrl, '/traffic', secret);
  return new MihomoWsStream<TrafficTick>(url, onData, onStatusChange);
}

export function subscribeMemory(
  baseUrl: string,
  secret: string,
  onData: (data: MemoryTick) => void,
  onStatusChange?: StreamStatusListener
): MihomoWsStream<MemoryTick> {
  const url = buildWsUrl(baseUrl, '/memory', secret);
  return new MihomoWsStream<MemoryTick>(url, onData, onStatusChange);
}

export function subscribeConnections(
  baseUrl: string,
  secret: string,
  interval = 1000,
  onData: (data: ConnectionsResponse) => void,
  onStatusChange?: StreamStatusListener
): MihomoWsStream<ConnectionsResponse> {
  const url = buildWsUrl(baseUrl, '/connections', secret, { interval });
  return new MihomoWsStream<ConnectionsResponse>(url, onData, onStatusChange);
}

export function subscribeLogs(
  baseUrl: string,
  secret: string,
  level: LogLevel = 'info',
  onData: (data: LogTick) => void,
  onStatusChange?: StreamStatusListener
): MihomoWsStream<LogTick> {
  const url = buildWsUrl(baseUrl, '/logs', secret, { level });
  return new MihomoWsStream<LogTick>(url, onData, onStatusChange);
}
