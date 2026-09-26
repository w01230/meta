/**
 * URL normalization and construction helpers for Mihomo Controller
 */

export function normalizeBaseUrl(input: string): string {
  let cleaned = (input || '').trim();
  if (!cleaned) {
    return 'http://127.0.0.1:9090';
  }

  // Prepend http:// if protocol is omitted
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `http://${cleaned}`;
  }

  // Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  try {
    const parsed = new URL(cleaned);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return cleaned;
  }
}

export function buildHttpUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalized}${cleanPath}`);

  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        url.searchParams.set(key, String(val));
      }
    });
  }

  return url.toString();
}

export function buildWsUrl(
  baseUrl: string,
  path: string,
  secret?: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const httpUrl = buildHttpUrl(baseUrl, path, params);
  const parsed = new URL(httpUrl);

  // Convert http/https to ws/wss
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else {
    parsed.protocol = 'ws:';
  }

  // Append secret as token parameter if provided
  if (secret && secret.trim()) {
    parsed.searchParams.set('token', secret.trim());
  }

  return parsed.toString();
}

/**
 * Check if the browser environment might block requests due to HTTPS -> HTTP Mixed Content
 */
export function checkMixedContentRisk(targetBaseUrl: string): { hasRisk: boolean; message?: string } {
  if (typeof window === 'undefined') return { hasRisk: false };

  const isPageHttps = window.location.protocol === 'https:';
  const isTargetHttp = targetBaseUrl.toLowerCase().startsWith('http://');

  if (isPageHttps && isTargetHttp) {
    return {
      hasRisk: true,
      message: '当前网页处于 HTTPS 协议下，浏览器会默认阻止向 HTTP 控制台（如 http://127.0.0.1:9090）发送混合内容请求。建议使用 HTTP 访问本控制台，或为核心配置 TLS 证书。'
    };
  }

  return { hasRisk: false };
}
