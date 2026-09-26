export type RunMode = 'rule' | 'global' | 'direct';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'silent';

export interface MihomoVersion {
  version: string;
  meta?: boolean;
  premium?: boolean;
}

export interface MihomoConfig {
  port: number;
  'socks-port': number;
  'redir-port': number;
  'tproxy-port': number;
  'mixed-port': number;
  mode: RunMode;
  'log-level': LogLevel;
  'allow-lan': boolean;
  bindAddress?: string;
  'sniffing'?: boolean;
}

export interface ProxyHistory {
  time: string;
  delay: number;
}

export interface ProxyItem {
  name: string;
  type: string;
  udp?: boolean;
  xudp?: boolean;
  now?: string;
  fixed?: string;
  all?: string[];
  history?: ProxyHistory[];
  alive?: boolean;
}

export interface ProxiesResponse {
  proxies: Record<string, ProxyItem>;
}

export interface RuleItem {
  type: string;
  payload: string;
  proxy: string;
  size?: number;
}

export interface RulesResponse {
  rules: RuleItem[];
}

export interface ConnectionMetadata {
  network: string;
  type: string;
  sourceIP: string;
  destinationIP: string;
  sourcePort: string;
  destinationPort: string;
  host: string;
  dnsMode?: string;
  process?: string;
  processPath?: string;
  specialProxy?: string;
  inboundIP?: string;
  inboundPort?: string;
  inboundName?: string;
  inboundUser?: string;
  uid?: number;
}

export interface ConnectionItem {
  id: string;
  metadata: ConnectionMetadata;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  curUploadSpeed?: number;
  curDownloadSpeed?: number;
}

export interface ConnectionsResponse {
  downloadTotal: number;
  uploadTotal: number;
  memory?: number;
  connections: ConnectionItem[];
}

export interface TrafficTick {
  up: number;
  down: number;
  time?: number;
}

export interface MemoryTick {
  inuse: number;
  oslimit: number;
  time?: number;
}

export interface LogTick {
  type: LogLevel;
  payload: string;
  time?: string;
  id?: string;
}

export interface DelayResponse {
  delay: number;
}
