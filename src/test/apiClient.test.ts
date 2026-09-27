import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MihomoApiClient, ApiError } from '../services/apiClient';

describe('MihomoApiClient', () => {
  const baseUrl = 'http://127.0.0.1:9090';
  const secret = 'test-secret-123';
  let client: MihomoApiClient;

  beforeEach(() => {
    client = new MihomoApiClient(baseUrl, secret);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request timeout', () => {
    it('times out a fetch that never resolves and aborts its signal', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      globalThis.fetch = vi.fn((_url, options) => {
        signal = options?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }) as unknown as typeof fetch;

      const request = client.getVersion();
      const expectation = expect(request).rejects.toThrow(/请求超时/);
      await vi.advanceTimersByTimeAsync(15_000);
      await expectation;

      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('times out while reading a response body even if json ignores abort', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      globalThis.fetch = vi.fn((_url, options) => {
        signal = options?.signal as AbortSignal;
        return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
      }) as unknown as typeof fetch;

      const request = client.getVersion();
      const expectation = expect(request).rejects.toThrow(/请求超时/);
      await vi.advanceTimersByTimeAsync(15_000);
      await expectation;

      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('cleans up the timer after success and HTTP errors', async () => {
      vi.useFakeTimers();
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ version: 'v1' }) })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ message: 'server error' })
        });

      await expect(client.getVersion()).resolves.toEqual({ version: 'v1' });
      expect(vi.getTimerCount()).toBe(0);
      await expect(client.getVersion()).rejects.toThrow('server error');
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('includes Authorization Bearer header when secret is provided', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ version: 'v1.19.3' })
      });
    });

    const res = await client.getVersion();
    expect(res.version).toBe('v1.19.3');
    expect(capturedHeaders['Authorization']).toBe('Bearer test-secret-123');
  });

  it('omits Authorization header when secret is empty', async () => {
    const noSecretClient = new MihomoApiClient(baseUrl, '');
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ version: 'v1.19.3' })
      });
    });

    await noSecretClient.getVersion();
    expect(capturedHeaders['Authorization']).toBeUndefined();
  });

  it('properly encodes proxy group names with special chars in switchProxy', async () => {
    let requestedUrl = '';
    let requestBody = '';
    globalThis.fetch = vi.fn().mockImplementation((url, options) => {
      requestedUrl = url;
      requestBody = options.body;
      return Promise.resolve({
        ok: true,
        status: 204
      });
    });

    await client.switchProxy('🇭🇰 香港节点 [IEPL]', '🇭🇰 香港 01');
    expect(requestedUrl).toContain(encodeURIComponent('🇭🇰 香港节点 [IEPL]'));
    expect(JSON.parse(requestBody)).toEqual({ name: '🇭🇰 香港 01' });
  });

  it('properly encodes proxy group names and sends DELETE when unfixing a proxy', async () => {
    let requestedUrl = '';
    let requestedMethod = '';
    globalThis.fetch = vi.fn().mockImplementation((url, options) => {
      requestedUrl = url;
      requestedMethod = options.method;
      return Promise.resolve({ ok: true, status: 204 });
    });

    await client.unfixProxy('🇭🇰 香港节点 [IEPL]');
    expect(requestedUrl).toBe(`${baseUrl}/proxies/${encodeURIComponent('🇭🇰 香港节点 [IEPL]')}`);
    expect(requestedMethod).toBe('DELETE');
  });

  it('properly encodes delay test query params', async () => {
    let requestedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      requestedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ delay: 42 })
      });
    });

    const delay = await client.testProxyDelay('🇭🇰 香港 01', 'http://cp.cloudflare.com/generate_204', 3000);
    expect(delay).toBe(42);
    expect(requestedUrl).toContain(encodeURIComponent('🇭🇰 香港 01'));
    expect(requestedUrl).toContain('timeout=3000');
  });

  it('throws ApiError with unauthorized message on 401 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ message: 'Unauthorized' })
    });

    await expect(client.getVersion()).rejects.toThrow(ApiError);
    await expect(client.getVersion()).rejects.toThrow(/身份验证失败/);
  });

  describe('Cache Management', () => {
    it('flushFakeipCache sends authorized POST request to /cache/fakeip/flush and handles 204 No Content', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation((url, options) => {
        requestedUrl = url;
        requestedMethod = options.method;
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 204
        });
      });

      const res = await client.flushFakeipCache();
      expect(res).toBeUndefined();
      expect(requestedUrl).toBe(`${baseUrl}/cache/fakeip/flush`);
      expect(requestedMethod).toBe('POST');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${secret}`);
      expect(capturedHeaders['Accept']).toBe('application/json');
    });

    it('flushFakeipCache omits Authorization header when secret is empty', async () => {
      const noSecretClient = new MihomoApiClient(baseUrl, '');
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 204
        });
      });

      await noSecretClient.flushFakeipCache();
      expect(capturedHeaders['Authorization']).toBeUndefined();
    });

    it('flushFakeipCache surfaces 400 JSON message on flush or persistence failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'fake-ip is not enabled' })
      });

      try {
        await client.flushFakeipCache();
        expect.unreachable('Should have thrown an ApiError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toContain('fake-ip is not enabled');
      }
    });

    it('flushFakeipCache handles 400 error without JSON body gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      try {
        await client.flushFakeipCache();
        expect.unreachable('Should have thrown an ApiError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toContain('HTTP 400 Bad Request');
      }
    });

    it('flushDnsCache sends authorized POST request to /cache/dns/flush and handles 204 No Content', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation((url, options) => {
        requestedUrl = url;
        requestedMethod = options.method;
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 204
        });
      });

      const res = await client.flushDnsCache();
      expect(res).toBeUndefined();
      expect(requestedUrl).toBe(`${baseUrl}/cache/dns/flush`);
      expect(requestedMethod).toBe('POST');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${secret}`);
      expect(capturedHeaders['Accept']).toBe('application/json');
    });

    it('flushDnsCache omits Authorization header when secret is empty', async () => {
      const noSecretClient = new MihomoApiClient(baseUrl, '');
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 204
        });
      });

      await noSecretClient.flushDnsCache();
      expect(capturedHeaders['Authorization']).toBeUndefined();
    });

    it('flushDnsCache distinctly handles 404 when Mihomo kernel lacks DNS flush support (<1.19.12)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: '404 page not found' })
      });

      try {
        await client.flushDnsCache();
        expect.unreachable('Should have thrown an ApiError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.message).toContain('不支持清理 DNS 缓存');
        expect(apiErr.message).toContain('1.19.12');
      }
    });

    it('flushDnsCache preserves general error propagation on non-404 error (e.g. 500)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'core internal error' })
      });

      try {
        await client.flushDnsCache();
        expect.unreachable('Should have thrown an ApiError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.message).toContain('core internal error');
      }
    });

    it('generic request helper does not parse 204 response body as JSON even if json() would throw', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: () => {
          throw new SyntaxError('Unexpected end of JSON input');
        }
      });

      // Neither call should throw SyntaxError
      await expect(client.flushFakeipCache()).resolves.toBeUndefined();
      await expect(client.flushDnsCache()).resolves.toBeUndefined();
    });
  });
});
