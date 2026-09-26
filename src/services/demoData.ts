import { 
  MihomoVersion, 
  MihomoConfig, 
  ProxiesResponse, 
  RulesResponse, 
  ConnectionItem, 
  LogTick 
} from '../types/api';

export const DEMO_VERSION: MihomoVersion = {
  version: 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2',
  meta: true,
  premium: true
};

export const DEMO_CONFIG: MihomoConfig = {
  port: 7890,
  'socks-port': 7891,
  'redir-port': 7892,
  'tproxy-port': 7893,
  'mixed-port': 7890,
  mode: 'rule',
  'log-level': 'info',
  'allow-lan': true,
  bindAddress: '*',
  sniffing: true
};

export const DEMO_PROXIES: ProxiesResponse['proxies'] = {
  'GLOBAL': {
    name: 'GLOBAL',
    type: 'Selector',
    now: '节点选择',
    all: ['DIRECT', 'REJECT', '节点选择', '自动选择', '故障转移', '🇭🇰 香港 01 [IEPL 专线]', '🇭🇰 香港 02 [BGP 高速]', '🇯🇵 日本 01 [软银 Direct]', '🇯🇵 日本 02 [原生 IP]', '🇸🇬 新加坡 01 [企业专线]', '🇺🇸 美国 01 [Anycast 4K]', '🇩🇪 德国 01 [低延迟]']
  },
  '节点选择': {
    name: '节点选择',
    type: 'Selector',
    now: '🇭🇰 香港 01 [IEPL 专线]',
    all: ['自动选择', '故障转移', '🇭🇰 香港 01 [IEPL 专线]', '🇭🇰 香港 02 [BGP 高速]', '🇯🇵 日本 01 [软银 Direct]', '🇯🇵 日本 02 [原生 IP]', '🇸🇬 新加坡 01 [企业专线]', '🇺🇸 美国 01 [Anycast 4K]', '🇩🇪 德国 01 [低延迟]', 'DIRECT']
  },
  '自动选择': {
    name: '自动选择',
    type: 'URLTest',
    now: '🇭🇰 香港 01 [IEPL 专线]',
    all: ['🇭🇰 香港 01 [IEPL 专线]', '🇭🇰 香港 02 [BGP 高速]', '🇯🇵 日本 01 [软银 Direct]', '🇸🇬 新加坡 01 [企业专线]'],
    history: [{ time: new Date().toISOString(), delay: 38 }]
  },
  '故障转移': {
    name: '故障转移',
    type: 'Fallback',
    now: '🇭🇰 香港 01 [IEPL 专线]',
    all: ['🇭🇰 香港 01 [IEPL 专线]', '🇯🇵 日本 01 [软银 Direct]', '🇺🇸 美国 01 [Anycast 4K]'],
    history: [{ time: new Date().toISOString(), delay: 42 }]
  },
  '国外媒体': {
    name: '国外媒体',
    type: 'Selector',
    now: '🇸🇬 新加坡 01 [企业专线]',
    all: ['节点选择', '🇭🇰 香港 01 [IEPL 专线]', '🇯🇵 日本 02 [原生 IP]', '🇸🇬 新加坡 01 [企业专线]', '🇺🇸 美国 01 [Anycast 4K]']
  },
  '国内直连': {
    name: '国内直连',
    type: 'Direct'
  },
  'DIRECT': {
    name: 'DIRECT',
    type: 'Direct'
  },
  'REJECT': {
    name: 'REJECT',
    type: 'Reject'
  },
  '🇭🇰 香港 01 [IEPL 专线]': {
    name: '🇭🇰 香港 01 [IEPL 专线]',
    type: 'Hysteria2',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 32 }]
  },
  '🇭🇰 香港 02 [BGP 高速]': {
    name: '🇭🇰 香港 02 [BGP 高速]',
    type: 'Shadowsocks',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 48 }]
  },
  '🇯🇵 日本 01 [软银 Direct]': {
    name: '🇯🇵 日本 01 [软银 Direct]',
    type: 'Trojan',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 65 }]
  },
  '🇯🇵 日本 02 [原生 IP]': {
    name: '🇯🇵 日本 02 [原生 IP]',
    type: 'Vmess',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 72 }]
  },
  '🇸🇬 新加坡 01 [企业专线]': {
    name: '🇸🇬 新加坡 01 [企业专线]',
    type: 'Trojan',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 84 }]
  },
  '🇺🇸 美国 01 [Anycast 4K]': {
    name: '🇺🇸 美国 01 [Anycast 4K]',
    type: 'WireGuard',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 156 }]
  },
  '🇩🇪 德国 01 [低延迟]': {
    name: '🇩🇪 德国 01 [低延迟]',
    type: 'Shadowsocks',
    udp: true,
    history: [{ time: new Date().toISOString(), delay: 210 }]
  }
};

export const DEMO_RULES: RulesResponse['rules'] = [
  { type: 'DOMAIN-SUFFIX', payload: 'youtube.com', proxy: '国外媒体' },
  { type: 'DOMAIN-SUFFIX', payload: 'googlevideo.com', proxy: '国外媒体' },
  { type: 'DOMAIN-SUFFIX', payload: 'netflix.com', proxy: '国外媒体' },
  { type: 'DOMAIN-SUFFIX', payload: 'spotify.com', proxy: '国外媒体' },
  { type: 'DOMAIN-KEYWORD', payload: 'github', proxy: '节点选择' },
  { type: 'DOMAIN-SUFFIX', payload: 'openai.com', proxy: '节点选择' },
  { type: 'DOMAIN-SUFFIX', payload: 'anthropic.com', proxy: '节点选择' },
  { type: 'DOMAIN-SUFFIX', payload: 'telegram.org', proxy: '节点选择' },
  { type: 'IP-CIDR', payload: '91.108.4.0/22', proxy: '节点选择' },
  { type: 'DOMAIN-SUFFIX', payload: 'apple.com', proxy: '国内直连' },
  { type: 'DOMAIN-SUFFIX', payload: 'icloud.com', proxy: '国内直连' },
  { type: 'DOMAIN-SUFFIX', payload: 'bilibili.com', proxy: '国内直连' },
  { type: 'DOMAIN-SUFFIX', payload: 'zhihu.com', proxy: '国内直连' },
  { type: 'GEOIP', payload: 'CN', proxy: '国内直连' },
  { type: 'MATCH', payload: '', proxy: '节点选择' }
];

export function createInitialDemoConnections(): ConnectionItem[] {
  const now = Date.now();
  return [
    {
      id: 'conn-101',
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        sourceIP: '192.168.1.102',
        sourcePort: '54210',
        destinationIP: '142.250.190.46',
        destinationPort: '443',
        host: 'rr4---sn-ab5sznzs.googlevideo.com',
        process: 'Google Chrome',
        processPath: '/Applications/Google Chrome.app',
        inboundIP: '127.0.0.1',
        inboundPort: '7890'
      },
      upload: 4851200,
      download: 142857000,
      start: new Date(now - 145000).toISOString(),
      chains: ['国外媒体', '🇭🇰 香港 01 [IEPL 专线]'],
      rule: 'DOMAIN-SUFFIX',
      rulePayload: 'googlevideo.com'
    },
    {
      id: 'conn-102',
      metadata: {
        network: 'tcp',
        type: 'HTTPS',
        sourceIP: '192.168.1.102',
        sourcePort: '54212',
        destinationIP: '140.82.112.4',
        destinationPort: '443',
        host: 'api.github.com',
        process: 'Code',
        processPath: '/Applications/Visual Studio Code.app',
        inboundIP: '127.0.0.1',
        inboundPort: '7890'
      },
      upload: 254000,
      download: 1845000,
      start: new Date(now - 28000).toISOString(),
      chains: ['节点选择', '🇭🇰 香港 01 [IEPL 专线]'],
      rule: 'DOMAIN-KEYWORD',
      rulePayload: 'github'
    },
    {
      id: 'conn-103',
      metadata: {
        network: 'tcp',
        type: 'TCP',
        sourceIP: '192.168.1.102',
        sourcePort: '54218',
        destinationIP: '149.154.167.50',
        destinationPort: '443',
        host: '149.154.167.50',
        process: 'Telegram',
        processPath: '/Applications/Telegram.app',
        inboundIP: '127.0.0.1',
        inboundPort: '7890'
      },
      upload: 1250000,
      download: 6420000,
      start: new Date(now - 600000).toISOString(),
      chains: ['节点选择', '🇭🇰 香港 01 [IEPL 专线]'],
      rule: 'IP-CIDR',
      rulePayload: '91.108.4.0/22'
    },
    {
      id: 'conn-104',
      metadata: {
        network: 'udp',
        type: 'UDP',
        sourceIP: '192.168.1.102',
        sourcePort: '61432',
        destinationIP: '110.242.68.66',
        destinationPort: '443',
        host: 'api.bilibili.com',
        process: 'Bilibili',
        inboundIP: '127.0.0.1',
        inboundPort: '7890'
      },
      upload: 82000,
      download: 512000,
      start: new Date(now - 8000).toISOString(),
      chains: ['国内直连', 'DIRECT'],
      rule: 'DOMAIN-SUFFIX',
      rulePayload: 'bilibili.com'
    },
    {
      id: 'conn-105',
      metadata: {
        network: 'tcp',
        type: 'HTTPS',
        sourceIP: '192.168.1.102',
        sourcePort: '54302',
        destinationIP: '104.18.24.12',
        destinationPort: '443',
        host: 'chatgpt.com',
        process: 'Google Chrome',
        inboundIP: '127.0.0.1',
        inboundPort: '7890'
      },
      upload: 432000,
      download: 3120000,
      start: new Date(now - 45000).toISOString(),
      chains: ['节点选择', '🇭🇰 香港 01 [IEPL 专线]'],
      rule: 'DOMAIN-SUFFIX',
      rulePayload: 'openai.com'
    }
  ];
}

export const INITIAL_DEMO_LOGS: LogTick[] = [
  { id: 'log-1', type: 'info', payload: '[TCP] 192.168.1.102:54210 --> rr4---sn-ab5sznzs.googlevideo.com:443 match DomainSuffix(googlevideo.com) using 国外媒体[🇭🇰 香港 01 [IEPL 专线]]', time: new Date(Date.now() - 4000).toLocaleTimeString() },
  { id: 'log-2', type: 'info', payload: '[TCP] 192.168.1.102:54212 --> api.github.com:443 match DomainKeyword(github) using 节点选择[🇭🇰 香港 01 [IEPL 专线]]', time: new Date(Date.now() - 3200).toLocaleTimeString() },
  { id: 'log-3', type: 'info', payload: '[DNS] Resolve api.github.com -> 140.82.112.4 in 24ms', time: new Date(Date.now() - 2500).toLocaleTimeString() },
  { id: 'log-4', type: 'warning', payload: '[TCP] connection to 17.253.144.10:443 reset by peer, retrying fallback', time: new Date(Date.now() - 1800).toLocaleTimeString() },
  { id: 'log-5', type: 'info', payload: '[TCP] 192.168.1.102:54302 --> chatgpt.com:443 match DomainSuffix(openai.com) using 节点选择[🇭🇰 香港 01 [IEPL 专线]]', time: new Date(Date.now() - 600).toLocaleTimeString() }
];
