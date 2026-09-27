import { describe, it, expect, vi } from 'vitest';
import {
  parseBoundSecretRecord,
  resolveRestoredSecret,
  loadInitialControllerSnapshot,
  ActionCancelledError,
  isActionCancelledError,
  executeBatchProxyDelay,
  isActionGenerationValid,
  STORAGE_KEY_BASE_URL,
  SESSION_KEY_BOUND_SECRET
} from '../context/ControllerContext';
import { resolveTransitionOutcome, TransitionState } from '../utils/lifecycle';

describe('Credential Parser & Single-Record Session Binding', () => {
  describe('parseBoundSecretRecord', () => {
    it('successfully parses valid JSON record with normalized URL and secret', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'super-secret-123'
      });
      const parsed = parseBoundSecretRecord(raw);
      expect(parsed).toEqual({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'super-secret-123'
      });
    });

    it('normalizes URL during record parsing', () => {
      const raw = JSON.stringify({
        normalizedUrl: '127.0.0.1:9090///',
        secret: 'abc'
      });
      const parsed = parseBoundSecretRecord(raw);
      expect(parsed).toEqual({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'abc'
      });
    });

    it('allows empty secret string when controller has no secret', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: ''
      });
      const parsed = parseBoundSecretRecord(raw);
      expect(parsed).toEqual({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: ''
      });
    });

    it('returns null for malformed JSON syntax', () => {
      expect(parseBoundSecretRecord('{ unclosed json')).toBeNull();
      expect(parseBoundSecretRecord('{"normalizedUrl": ')).toBeNull();
      expect(parseBoundSecretRecord('undefined')).toBeNull();
    });

    it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
      expect(parseBoundSecretRecord(null)).toBeNull();
      expect(parseBoundSecretRecord(undefined)).toBeNull();
      expect(parseBoundSecretRecord('')).toBeNull();
      expect(parseBoundSecretRecord('   ')).toBeNull();
    });

    it('returns null for non-object JSON values (legacy plain string, number, array)', () => {
      // Legacy plain secret stored as bare string
      expect(parseBoundSecretRecord('"legacy-plain-secret"')).toBeNull();
      // Bare unquoted string (treated as invalid JSON or primitive)
      expect(parseBoundSecretRecord('legacy-plain-secret')).toBeNull();
      expect(parseBoundSecretRecord('12345')).toBeNull();
      expect(parseBoundSecretRecord('true')).toBeNull();
      expect(parseBoundSecretRecord('["http://127.0.0.1:9090", "secret"]')).toBeNull();
    });

    it('returns null for partial or incomplete records', () => {
      // Missing normalizedUrl
      expect(parseBoundSecretRecord(JSON.stringify({ secret: 'secret-only' }))).toBeNull();
      // Missing secret
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: 'http://127.0.0.1:9090' }))).toBeNull();
      // Empty normalizedUrl
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: '', secret: 'foo' }))).toBeNull();
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: '   ', secret: 'foo' }))).toBeNull();
    });

    it('returns null when record fields have invalid types', () => {
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: 12345, secret: 'foo' }))).toBeNull();
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: 'http://127.0.0.1:9090', secret: null }))).toBeNull();
      expect(parseBoundSecretRecord(JSON.stringify({ normalizedUrl: 'http://127.0.0.1:9090', secret: 123 }))).toBeNull();
    });
  });

  describe('resolveRestoredSecret', () => {
    it('restores secret when record normalizedUrl matches persisted localStorage URL', () => {
      const rawRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'correct-secret'
      });
      const restored = resolveRestoredSecret('http://127.0.0.1:9090', rawRecord);
      expect(restored).toBe('correct-secret');
    });

    it('restores secret when URLs match under normalization (trailing slash, default scheme)', () => {
      const rawRecord = JSON.stringify({
        normalizedUrl: '127.0.0.1:9090/',
        secret: 'my-token'
      });
      const restored = resolveRestoredSecret('http://127.0.0.1:9090', rawRecord);
      expect(restored).toBe('my-token');
    });

    it('refuses to restore secret when persisted URL mismatches record URL (cross-tab leak prevention)', () => {
      // Tab B changed URL in localStorage to Controller B
      // Tab A still has Controller A's secret bound to Controller A's URL in sessionStorage
      const rawRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090', // Controller A
        secret: 'secret-A'
      });
      const restored = resolveRestoredSecret('http://192.168.1.200:9090', rawRecord); // Controller B
      expect(restored).toBe('');
    });

    it('refuses to restore legacy plain secret string (unbound legacy data)', () => {
      expect(resolveRestoredSecret('http://127.0.0.1:9090', 'legacy-plain-secret')).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '"legacy-plain-secret"')).toBe('');
    });

    it('refuses to restore when raw record is malformed or corrupted', () => {
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '{ corrupt json')).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '{"secret": "foo"}')).toBe('');
    });

    it('returns empty string when persistedUrl is missing or empty', () => {
      const rawRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'secret'
      });
      expect(resolveRestoredSecret(null, rawRecord)).toBe('');
      expect(resolveRestoredSecret(undefined, rawRecord)).toBe('');
      expect(resolveRestoredSecret('', rawRecord)).toBe('');
      expect(resolveRestoredSecret('   ', rawRecord)).toBe('');
    });

    it('returns empty string when rawRecord is missing or empty', () => {
      expect(resolveRestoredSecret('http://127.0.0.1:9090', null)).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', undefined)).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '')).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '   ')).toBe('');
    });
  });

  describe('Storage Keys Configuration', () => {
    it('uses correct storage keys', () => {
      expect(STORAGE_KEY_BASE_URL).toBe('meta_dashboard_base_url');
      expect(SESSION_KEY_BOUND_SECRET).toBe('meta_dashboard_session_bound_secret_v1');
    });
  });

  describe('loadInitialControllerSnapshot (Atomic Initial Storage Read)', () => {
    it('reads localStorage URL only once and consistently initializes baseUrl, hasConfiguredController, and secret', () => {
      // Simulate cross-tab race where a subsequent read of localStorage would yield Controller B
      let readCount = 0;
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) {
          readCount++;
          // First read gives Controller A, subsequent reads give Controller B
          return readCount === 1 ? 'http://controller-a:9090' : 'http://controller-b:9090';
        }
        return null;
      });

      const boundSecretRecord = JSON.stringify({
        normalizedUrl: 'http://controller-a:9090',
        secret: 'secret-a'
      });
      const getSessionStorage = vi.fn((key: string) => {
        if (key === SESSION_KEY_BOUND_SECRET) {
          return boundSecretRecord;
        }
        return null;
      });

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);

      // Verify localStorage was read only once for the URL
      expect(getLocalStorage).toHaveBeenCalledTimes(1);
      expect(getLocalStorage).toHaveBeenCalledWith(STORAGE_KEY_BASE_URL);
      expect(getSessionStorage).toHaveBeenCalledTimes(1);
      expect(getSessionStorage).toHaveBeenCalledWith(SESSION_KEY_BOUND_SECRET);

      // Snapshot must be completely consistent based on Controller A:
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('secret-a');
    });

    it('returns default baseUrl and hasConfiguredController=false when no URL is stored', () => {
      const getLocalStorage = vi.fn(() => null);
      const getSessionStorage = vi.fn(() => null);

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://127.0.0.1:9090');
      expect(snapshot.hasConfiguredController).toBe(false);
      expect(snapshot.secret).toBe('');
    });

    it('does not restore secret when bound secret URL mismatches persisted URL in snapshot', () => {
      const getLocalStorage = vi.fn(() => 'http://controller-b:9090');
      const getSessionStorage = vi.fn(() =>
        JSON.stringify({
          normalizedUrl: 'http://controller-a:9090',
          secret: 'secret-for-a-only'
        })
      );

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-b:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('');
    });

  });
});

describe('Action Cancellation & Batch Execution', () => {
  describe('ActionCancelledError & isActionCancelledError', () => {
    it('creates an ActionCancelledError with proper properties', () => {
      const err = new ActionCancelledError('Custom cancellation message');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ActionCancelledError);
      expect(err.name).toBe('ActionCancelledError');
      expect(err.isCancelled).toBe(true);
      expect(err.message).toBe('Custom cancellation message');
    });

    it('uses default message when none provided', () => {
      const err = new ActionCancelledError();
      expect(err.message).toBe('Action cancelled due to controller reconnection or source switch');
    });

    it('identifies ActionCancelledError instances and duck-typed objects', () => {
      expect(isActionCancelledError(new ActionCancelledError())).toBe(true);
      expect(
        isActionCancelledError({
          name: 'ActionCancelledError',
          isCancelled: true,
          message: 'cancelled'
        })
      ).toBe(true);
    });

    it('returns false for standard errors or non-cancelled errors', () => {
      expect(isActionCancelledError(new Error('401 Unauthorized'))).toBe(false);
      expect(isActionCancelledError(new Error('Network offline'))).toBe(false);
      expect(isActionCancelledError({ message: 'random error' })).toBe(false);
      expect(isActionCancelledError(null)).toBe(false);
      expect(isActionCancelledError(undefined)).toBe(false);
      expect(isActionCancelledError('string error')).toBe(false);
    });
  });

  describe('executeBatchProxyDelay', () => {
    it('executes node tests sequentially', async () => {
      const testSingle = vi.fn(async (node: string) => {
        return node === 'node-1' ? 45 : 85;
      });
      await executeBatchProxyDelay(['node-1', 'node-2'], () => true, testSingle);

      expect(testSingle.mock.calls).toEqual([['node-1'], ['node-2']]);
    });

    it('continues batch testing when an individual node has a non-cancellation network error', async () => {
      const testSingle = vi.fn(async (node: string) => {
        if (node === 'node-timeout') {
          throw new Error('Connection timeout');
        }
        return 60;
      });

      await executeBatchProxyDelay(['node-timeout', 'node-ok'], () => true, testSingle);

      expect(testSingle.mock.calls).toEqual([['node-timeout'], ['node-ok']]);
    });

    it('immediately aborts before testing next node when cancelled midway', async () => {
      let valid = true;
      const testedNodes: string[] = [];

      const testSingle = vi.fn(async (node: string) => {
        testedNodes.push(node);
        if (node === 'node-1') {
          // Invalidate before node-2 can be tested
          valid = false;
        }
        return 50;
      });

      await expect(
        executeBatchProxyDelay(
          ['node-1', 'node-2', 'node-3'],
          () => valid,
          testSingle
        )
      ).rejects.toThrow(ActionCancelledError);

      // Node-2 and Node-3 must NEVER have been called!
      expect(testedNodes).toEqual(['node-1']);
      expect(testSingle).toHaveBeenCalledTimes(1);
    });

    it('immediately aborts before starting if initially invalid', async () => {
      const testSingle = vi.fn(async () => 50);

      await expect(
        executeBatchProxyDelay(
          ['node-1', 'node-2'],
          () => false,
          testSingle
        )
      ).rejects.toThrow(ActionCancelledError);

      expect(testSingle).not.toHaveBeenCalled();
    });

    it('immediately rethrows when testSingleNode throws ActionCancelledError', async () => {
      const testSingle = vi.fn(async () => {
        throw new ActionCancelledError('Single test cancelled');
      });

      await expect(
        executeBatchProxyDelay(
          ['node-1', 'node-2'],
          () => true,
          testSingle
        )
      ).rejects.toThrow(ActionCancelledError);

      expect(testSingle).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Action Generation Guards & Consequential Lifecycle Races', () => {
  const dummyClientA = { id: 'client-A' };
  const dummyClientB = { id: 'client-B' };

  describe('isActionGenerationValid', () => {
    it('returns true when generation, client, and demo mode match exactly', () => {
      expect(isActionGenerationValid(1, 1, dummyClientA, dummyClientA, false, false)).toBe(true);
      expect(isActionGenerationValid(3, 3, dummyClientB, dummyClientB, false, false)).toBe(true);
      expect(isActionGenerationValid(5, 5, dummyClientA, dummyClientA, true, true)).toBe(true);
    });

    it('returns false when generation has changed (e.g. new connection attempt initiated)', () => {
      expect(isActionGenerationValid(1, 2, dummyClientA, dummyClientA, false, false)).toBe(false);
    });

    it('returns false when client instance has changed (e.g. client committed after handshake)', () => {
      expect(isActionGenerationValid(1, 1, dummyClientA, dummyClientB, false, false)).toBe(false);
    });

    it('returns false when demo mode was toggled (demo -> real or real -> demo)', () => {
      // Action started in demo mode, but current state is real mode
      expect(isActionGenerationValid(1, 1, dummyClientA, dummyClientA, true, false)).toBe(false);
      // Action started in real mode, but current state is demo mode
      expect(isActionGenerationValid(1, 1, dummyClientA, dummyClientA, false, true)).toBe(false);
    });
  });

  describe('Source Telemetry Reset Invariants', () => {
    it('preserves demo samples and logs on failed connection attempt from demo mode', () => {
      const currentState: TransitionState = {
        isDemo: true,
        activeUrl: 'http://127.0.0.1:9090',
        activeSecret: '',
        status: 'connected',
        statusError: null,
        isDemoTimerRunning: true
      };

      // Failed handshake from demo mode
      const outcome = resolveTransitionOutcome(
        currentState,
        'http://192.168.1.55:9090',
        'bad-secret',
        false,
        'Connection refused'
      );

      // Outcome dictates NO demo timer stop, NO exit demo, and preserved status
      expect(outcome.shouldExitDemo).toBe(false);
      expect(outcome.shouldStopDemoTimer).toBe(false);
      expect(outcome.shouldCommitCredentials).toBe(false);
      expect(outcome.nextStatus).toBe('connected');
    });

    it('requires demo exit and allows telemetry reset on successful handshake from demo mode', () => {
      const currentState: TransitionState = {
        isDemo: true,
        activeUrl: 'http://127.0.0.1:9090',
        activeSecret: '',
        status: 'connected',
        statusError: null,
        isDemoTimerRunning: true
      };

      // Successful handshake from demo mode
      const outcome = resolveTransitionOutcome(
        currentState,
        'http://192.168.1.55:9090',
        'valid-secret',
        true
      );

      expect(outcome.shouldExitDemo).toBe(true);
      expect(outcome.shouldStopDemoTimer).toBe(true);
      expect(outcome.shouldCommitCredentials).toBe(true);
    });
  });
});
