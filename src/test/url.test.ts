import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, buildHttpUrl, buildWsUrl, checkMixedContentRisk } from '../utils/url';

describe('normalizeBaseUrl', () => {
  it('handles empty or default input', () => {
    expect(normalizeBaseUrl('')).toBe('http://127.0.0.1:9090');
    expect(normalizeBaseUrl('   ')).toBe('http://127.0.0.1:9090');
  });

  it('prepends http:// if scheme omitted', () => {
    expect(normalizeBaseUrl('127.0.0.1:9090')).toBe('http://127.0.0.1:9090');
    expect(normalizeBaseUrl('localhost:9090/')).toBe('http://localhost:9090');
  });

  it('preserves https scheme and custom path without trailing slash', () => {
    expect(normalizeBaseUrl('https://myclash.example.com/api///')).toBe('https://myclash.example.com/api');
  });
});

describe('buildHttpUrl', () => {
  it('combines path and parameters', () => {
    const url = buildHttpUrl('http://127.0.0.1:9090', '/proxies/GLOBAL/delay', {
      url: 'http://cp.cloudflare.com',
      timeout: 5000
    });
    expect(url).toBe('http://127.0.0.1:9090/proxies/GLOBAL/delay?url=http%3A%2F%2Fcp.cloudflare.com&timeout=5000');
  });
});

describe('buildWsUrl', () => {
  it('converts http to ws and appends token parameter', () => {
    const wsUrl = buildWsUrl('http://127.0.0.1:9090', '/traffic', 'my-secret-123');
    expect(wsUrl).toBe('ws://127.0.0.1:9090/traffic?token=my-secret-123');
  });

  it('converts https to wss', () => {
    const wsUrl = buildWsUrl('https://proxy.example.com', '/logs', undefined, { level: 'info' });
    expect(wsUrl).toBe('wss://proxy.example.com/logs?level=info');
  });
});

describe('checkMixedContentRisk', () => {
  it('detects HTTP controller addresses without an explicit scheme on HTTPS pages', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { protocol: 'https:' } }
    });

    try {
      expect(checkMixedContentRisk('controller.example.com:9090').hasRisk).toBe(true);
      expect(checkMixedContentRisk('http://controller.example.com:9090').hasRisk).toBe(true);
      expect(checkMixedContentRisk('https://controller.example.com:9090').hasRisk).toBe(false);
      expect(checkMixedContentRisk(null).hasRisk).toBe(false);
      expect(checkMixedContentRisk(undefined).hasRisk).toBe(false);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
