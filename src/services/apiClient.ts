import { 
  MihomoVersion, 
  MihomoConfig, 
  ProxiesResponse, 
  RulesResponse, 
  ConnectionsResponse, 
  DelayResponse 
} from '../types/api';
import { buildHttpUrl } from '../utils/url';

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class MihomoApiClient {
  private baseUrl: string;
  private secret: string;

  constructor(baseUrl: string, secret = '') {
    this.baseUrl = baseUrl;
    this.secret = secret.trim();
  }

  public updateConfig(baseUrl: string, secret = '') {
    this.baseUrl = baseUrl;
    this.secret = secret.trim();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.secret) {
      headers['Authorization'] = `Bearer ${this.secret}`;
    }

    return headers;
  }

  private async request<T>(path: string, options: RequestInit = {}, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = buildHttpUrl(this.baseUrl, path, params);
    const headers = { ...this.getHeaders(), ...(options.headers as Record<string, string> || {}) };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status} ${response.statusText}`;
        try {
          const body = await response.json();
          if (body && typeof body === 'object') {
            if (typeof body.message === 'string' && body.message) {
              errorDetail = body.message;
            } else if (typeof body.error === 'string' && body.error) {
              errorDetail = body.error;
            }
          }
        } catch {
          // Response body is not json, ignore
        }

        if (response.status === 401 || response.status === 403) {
          throw new ApiError('身份验证失败：密钥错误或未提供', response.status);
        }
        if (response.status === 404) {
          throw new ApiError(`资源未找到 (404): ${path}`, response.status);
        }

        throw new ApiError(`请求失败: ${errorDetail}`, response.status);
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }

      const msg = (err as Error)?.message || '未知网络错误';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network request failed')) {
        throw new ApiError(
          '无法连接到外部控制器。请检查后端是否已启动并允许跨域 (CORS)，或确认地址端口是否正确。'
        );
      }
      throw new ApiError(msg);
    }
  }

  // --- Version & Health ---
  public async getVersion(): Promise<MihomoVersion> {
    return this.request<MihomoVersion>('/version');
  }

  // --- Configs ---
  public async getConfigs(): Promise<MihomoConfig> {
    return this.request<MihomoConfig>('/configs');
  }

  public async updateConfigs(patch: Partial<MihomoConfig>): Promise<void> {
    await this.request<void>('/configs', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }

  // --- Proxies ---
  public async getProxies(): Promise<ProxiesResponse> {
    return this.request<ProxiesResponse>('/proxies');
  }

  public async switchProxy(groupName: string, selectedNode: string): Promise<void> {
    const encodedGroup = encodeURIComponent(groupName);
    await this.request<void>(`/proxies/${encodedGroup}`, {
      method: 'PUT',
      body: JSON.stringify({ name: selectedNode })
    });
  }

  public async unfixProxy(groupName: string): Promise<void> {
    const encodedGroup = encodeURIComponent(groupName);
    await this.request<void>(`/proxies/${encodedGroup}`, {
      method: 'DELETE'
    });
  }

  public async testProxyDelay(
    proxyName: string, 
    testUrl = 'http://cp.cloudflare.com/generate_204', 
    timeout = 5000
  ): Promise<number> {
    const encodedName = encodeURIComponent(proxyName);
    const data = await this.request<DelayResponse>(`/proxies/${encodedName}/delay`, {
      method: 'GET'
    }, {
      url: testUrl,
      timeout
    });
    return data.delay;
  }

  // --- Rules ---
  public async getRules(): Promise<RulesResponse> {
    return this.request<RulesResponse>('/rules');
  }

  // --- Connections ---
  public async getConnections(): Promise<ConnectionsResponse> {
    return this.request<ConnectionsResponse>('/connections');
  }

  public async closeConnection(id: string): Promise<void> {
    const encodedId = encodeURIComponent(id);
    await this.request<void>(`/connections/${encodedId}`, {
      method: 'DELETE'
    });
  }

  public async closeAllConnections(): Promise<void> {
    await this.request<void>('/connections', {
      method: 'DELETE'
    });
  }

  // --- Cache Management ---
  public async flushFakeipCache(): Promise<void> {
    await this.request<void>('/cache/fakeip/flush', {
      method: 'POST'
    });
  }

  public async flushDnsCache(): Promise<void> {
    try {
      await this.request<void>('/cache/dns/flush', {
        method: 'POST'
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new ApiError('当前 Mihomo 内核版本不支持清理 DNS 缓存 (POST /cache/dns/flush 需 >= v1.19.12)', 404);
      }
      throw err;
    }
  }

  // --- Full Atomic Handshake ---
  public async verifyFullRestHandshake(): Promise<{
    version: MihomoVersion;
    config: MihomoConfig;
    proxies: ProxiesResponse;
    rules: RulesResponse;
    connections: ConnectionsResponse;
  }> {
    const version = await this.getVersion();
    const config = await this.getConfigs();
    const proxies = await this.getProxies();
    const rules = await this.getRules();
    const connections = await this.getConnections();
    return { version, config, proxies, rules, connections };
  }
}
