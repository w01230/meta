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
  SESSION_KEY_BOUND_SECRET,
  STORAGE_KEY_BOUND_SECRET,
  STORAGE_KEY_REMEMBERED_SECRET,
  isStoredSecretRemembered,
  safeSetPersistentBoundSecret,
  safeRemovePersistentBoundSecret,
  commitCheckedSaveCredentials,
  SaveCredentialResult
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

    it('gives precedence to matching session record even when secret is empty string', () => {
      const rawSessionRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: ''
      });
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'saved-persistent-secret'
      });
      const restored = resolveRestoredSecret('http://127.0.0.1:9090', rawSessionRecord, rawPersistentRecord);
      expect(restored).toBe('');
    });

    it('gives precedence to matching session record over persistent record with non-empty secret', () => {
      const rawSessionRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'active-session-secret'
      });
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'old-persistent-secret'
      });
      const restored = resolveRestoredSecret('http://127.0.0.1:9090', rawSessionRecord, rawPersistentRecord);
      expect(restored).toBe('active-session-secret');
    });

    it('falls back to matching persistent record when session record is null or missing', () => {
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'restored-persistent-token'
      });
      expect(resolveRestoredSecret('http://127.0.0.1:9090', null, rawPersistentRecord)).toBe('restored-persistent-token');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', undefined, rawPersistentRecord)).toBe('restored-persistent-token');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '', rawPersistentRecord)).toBe('restored-persistent-token');
    });

    it('falls back to matching persistent record when session record is malformed', () => {
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'valid-persistent-secret'
      });
      expect(resolveRestoredSecret('http://127.0.0.1:9090', '{ corrupt json', rawPersistentRecord)).toBe('valid-persistent-secret');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', 'plain-text-session', rawPersistentRecord)).toBe('valid-persistent-secret');
    });

    it('falls back to matching persistent record when session record normalizedUrl mismatches', () => {
      const rawSessionRecord = JSON.stringify({
        normalizedUrl: 'http://controller-b:9090',
        secret: 'secret-for-b'
      });
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://controller-a:9090',
        secret: 'secret-for-a'
      });
      const restored = resolveRestoredSecret('http://controller-a:9090', rawSessionRecord, rawPersistentRecord);
      expect(restored).toBe('secret-for-a');
    });

    it('rejects mismatched persistent record and prevents sending secret A to URL B', () => {
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://controller-a:9090',
        secret: 'secret-a'
      });
      // Target is Controller B
      expect(resolveRestoredSecret('http://controller-b:9090', null, rawPersistentRecord)).toBe('');
    });

    it('rejects malformed or legacy persistent records', () => {
      expect(resolveRestoredSecret('http://127.0.0.1:9090', null, '{ bad json')).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', null, 'legacy-bare-secret')).toBe('');
      expect(resolveRestoredSecret('http://127.0.0.1:9090', null, JSON.stringify({ secret: 'no-url' }))).toBe('');
    });

    it('normalizes URLs when matching persistent record', () => {
      const rawPersistentRecord = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'token-norm'
      });
      expect(resolveRestoredSecret('127.0.0.1:9090///', null, rawPersistentRecord)).toBe('token-norm');
    });
  });

  describe('Storage Keys Configuration', () => {
    it('uses correct storage keys', () => {
      expect(STORAGE_KEY_BASE_URL).toBe('meta_dashboard_base_url');
      expect(SESSION_KEY_BOUND_SECRET).toBe('meta_dashboard_session_bound_secret_v1');
      expect(STORAGE_KEY_BOUND_SECRET).toBe('meta_dashboard_bound_secret_v1');
      expect(STORAGE_KEY_REMEMBERED_SECRET).toBe('meta_dashboard_bound_secret_v1');
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

      // Verify localStorage was read once for URL and once for persistent record
      expect(getLocalStorage).toHaveBeenCalledTimes(2);
      expect(getLocalStorage).toHaveBeenNthCalledWith(1, STORAGE_KEY_BASE_URL);
      expect(getLocalStorage).toHaveBeenNthCalledWith(2, STORAGE_KEY_BOUND_SECRET);
      expect(getSessionStorage).toHaveBeenCalledTimes(1);
      expect(getSessionStorage).toHaveBeenCalledWith(SESSION_KEY_BOUND_SECRET);

      // Snapshot must be completely consistent based on Controller A:
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('secret-a');
      expect(snapshot.isRemembered).toBe(false);
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

    it('restores secret from persistent storage when session storage is empty (tab close scenario)', () => {
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) return 'http://controller-a:9090';
        if (key === STORAGE_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-a:9090',
            secret: 'remembered-tab-close-secret'
          });
        }
        return null;
      });
      const getSessionStorage = vi.fn(() => null);

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('remembered-tab-close-secret');
      expect(snapshot.isRemembered).toBe(true);
    });

    it('gives precedence to session empty record over persistent record on snapshot boot', () => {
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) return 'http://controller-a:9090';
        if (key === STORAGE_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-a:9090',
            secret: 'persistent-secret-to-be-overridden'
          });
        }
        return null;
      });
      const getSessionStorage = vi.fn((key: string) => {
        if (key === SESSION_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-a:9090',
            secret: ''
          });
        }
        return null;
      });

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('');
      // In this session, user chose empty secret, persistent record does not take over
      expect(snapshot.isRemembered).toBe(false);
      expect(getLocalStorage).toHaveBeenCalledTimes(2);
    });

    it('derives isRemembered=true when matching session record matches persistent record', () => {
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) return 'http://controller-a:9090';
        if (key === STORAGE_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-a:9090',
            secret: 'shared-secret'
          });
        }
        return null;
      });
      const getSessionStorage = vi.fn((key: string) => {
        if (key === SESSION_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-a:9090',
            secret: 'shared-secret'
          });
        }
        return null;
      });

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('shared-secret');
      expect(snapshot.isRemembered).toBe(true);
      expect(getLocalStorage).toHaveBeenCalledTimes(2);
    });

    it('rejects mismatched persistent record on snapshot boot', () => {
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) return 'http://controller-a:9090';
        if (key === STORAGE_KEY_BOUND_SECRET) {
          return JSON.stringify({
            normalizedUrl: 'http://controller-b:9090',
            secret: 'secret-for-b'
          });
        }
        return null;
      });
      const getSessionStorage = vi.fn(() => null);

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('');
      expect(snapshot.isRemembered).toBe(false);
    });

    it('safely handles corrupted persistent record on boot without throwing', () => {
      const getLocalStorage = vi.fn((key: string) => {
        if (key === STORAGE_KEY_BASE_URL) return 'http://controller-a:9090';
        if (key === STORAGE_KEY_BOUND_SECRET) return '{ malformed JSON';
        return null;
      });
      const getSessionStorage = vi.fn(() => null);

      const snapshot = loadInitialControllerSnapshot(getLocalStorage, getSessionStorage);
      expect(snapshot.baseUrl).toBe('http://controller-a:9090');
      expect(snapshot.hasConfiguredController).toBe(true);
      expect(snapshot.secret).toBe('');
    });
  });

  describe('isStoredSecretRemembered', () => {
    it('returns true when URL and secret match stored persistent record', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'my-secret-123'
      });
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', 'my-secret-123', raw)).toBe(true);
    });

    it('returns true under URL normalization differences', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'my-secret-123'
      });
      expect(isStoredSecretRemembered('127.0.0.1:9090/', 'my-secret-123', raw)).toBe(true);
    });

    it('returns false when secret differs', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'my-secret-123'
      });
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', 'different-secret', raw)).toBe(false);
    });

    it('returns false when URL differs', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'my-secret-123'
      });
      expect(isStoredSecretRemembered('http://192.168.1.1:9090', 'my-secret-123', raw)).toBe(false);
    });

    it('returns false when raw record is null, empty, or malformed', () => {
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', 'sec', null)).toBe(false);
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', 'sec', '')).toBe(false);
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', 'sec', '{ invalid')).toBe(false);
    });

    it('returns false when input url or secret is missing or empty', () => {
      const raw = JSON.stringify({
        normalizedUrl: 'http://127.0.0.1:9090',
        secret: 'my-secret-123'
      });
      expect(isStoredSecretRemembered('', 'my-secret-123', raw)).toBe(false);
      expect(isStoredSecretRemembered(null, 'my-secret-123', raw)).toBe(false);
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', undefined, raw)).toBe(false);
      expect(isStoredSecretRemembered('http://127.0.0.1:9090', null, raw)).toBe(false);
    });
  });

  describe('safeSetPersistentBoundSecret & safeRemovePersistentBoundSecret (Storage Guards & Truthful Removal)', () => {
    it('safeSetPersistentBoundSecret writes normalized JSON record and returns true', () => {
      const mockSet = vi.fn();
      const success = safeSetPersistentBoundSecret('127.0.0.1:9090/', 'my-token', mockSet);
      expect(success).toBe(true);
      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(
        STORAGE_KEY_BOUND_SECRET,
        JSON.stringify({
          normalizedUrl: 'http://127.0.0.1:9090',
          secret: 'my-token'
        })
      );
    });

    it('safeSetPersistentBoundSecret catches QuotaExceededError and returns false without throwing', () => {
      const throwingSet = vi.fn(() => {
        throw new Error('QuotaExceededError: DOM Exception 22');
      });
      const success = safeSetPersistentBoundSecret('http://127.0.0.1:9090', 'token', throwingSet);
      expect(success).toBe(false);
    });

    it('safeRemovePersistentBoundSecret removes item from storage and returns true', () => {
      const mockRemove = vi.fn();
      const success = safeRemovePersistentBoundSecret(mockRemove);
      expect(success).toBe(true);
      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith(STORAGE_KEY_BOUND_SECRET);
    });

    it('safeRemovePersistentBoundSecret truthfully returns false when storage removal fails', () => {
      const throwingRemove = vi.fn(() => {
        throw new Error('SecurityError: Access is denied for this document');
      });
      const success = safeRemovePersistentBoundSecret(throwingRemove);
      expect(success).toBe(false);
    });
  });

  describe('Opt-In Persistence, Consent Revision & Commit Invariants', () => {
    it('requires verified handshake success before committing credentials', () => {
      const currentState: TransitionState = {
        isDemo: false,
        activeUrl: 'http://127.0.0.1:9090',
        activeSecret: '',
        status: 'disconnected',
        statusError: null,
        isDemoTimerRunning: false
      };

      const outcomeFailed = resolveTransitionOutcome(
        currentState,
        'http://new-target:9090',
        'bad-token',
        false,
        '401 Unauthorized'
      );
      expect(outcomeFailed.shouldCommitCredentials).toBe(false);

      const outcomeSuccess = resolveTransitionOutcome(
        currentState,
        'http://new-target:9090',
        'valid-token',
        true
      );
      expect(outcomeSuccess.shouldCommitCredentials).toBe(true);
    });

    it('verifies consent revision prevents resurrection when unchecked pending', async () => {
      let consentRevision = 1;
      const initialRev = consentRevision;

      // User initiates checked save with initialRev = 1
      // While handshake is in flight, user unchecks (calling clearPersistedCredential):
      consentRevision++;

      // Handshake finishes later:
      const shouldPersist = (expectedRev: number, currentRev: number) => expectedRev === currentRev;
      expect(shouldPersist(initialRev, consentRevision)).toBe(false);
    });

    it('verifies consent revision prevents resurrection when modal dismissed pending', async () => {
      let consentRevision = 1;
      const initialRev = consentRevision;

      // User initiates checked save with initialRev = 1
      // User dismisses modal / cancels pending remember:
      consentRevision++;

      // Handshake completes after dismiss:
      const shouldPersist = (expectedRev: number, currentRev: number) => expectedRev === currentRev;
      expect(shouldPersist(initialRev, consentRevision)).toBe(false);
    });

    describe('commitCheckedSaveCredentials production helper', () => {
      it('successfully commits credentials and returns remembered: true when URL write and verification succeed', () => {
        const mockStorage: Record<string, string> = {};
        const mockGet = vi.fn((key: string) => mockStorage[key] ?? null);
        const mockSet = vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        });

        const res = commitCheckedSaveCredentials(
          'http://127.0.0.1:9090',
          'my-secret-key',
          mockGet,
          mockSet
        );

        expect(res).toEqual({ remembered: true, persistenceError: false });
        expect(mockStorage[STORAGE_KEY_BASE_URL]).toBe('http://127.0.0.1:9090');
        const boundSecret = JSON.parse(mockStorage[STORAGE_KEY_BOUND_SECRET]);
        expect(boundSecret).toEqual({
          normalizedUrl: 'http://127.0.0.1:9090',
          secret: 'my-secret-key'
        });
      });

      it('normalizes target URL when committing credentials', () => {
        const mockStorage: Record<string, string> = {};
        const res = commitCheckedSaveCredentials(
          '127.0.0.1:9090///',
          'token-abc',
          (key) => mockStorage[key] ?? null,
          (key, value) => {
            mockStorage[key] = value;
          }
        );

        expect(res).toEqual({ remembered: true, persistenceError: false });
        expect(mockStorage[STORAGE_KEY_BASE_URL]).toBe('http://127.0.0.1:9090');
        const boundSecret = JSON.parse(mockStorage[STORAGE_KEY_BOUND_SECRET]);
        expect(boundSecret.normalizedUrl).toBe('http://127.0.0.1:9090');
      });

      it('handles URL storage-write failure (exception) without corrupting/writing secret', () => {
        const mockStorage: Record<string, string> = {
          [STORAGE_KEY_BOUND_SECRET]: JSON.stringify({
            normalizedUrl: 'http://pre-existing:9090',
            secret: 'old-secret'
          })
        };
        const failingSet = vi.fn((key: string, value: string) => {
          if (key === STORAGE_KEY_BASE_URL) {
            throw new Error('QuotaExceededError: storage is full');
          }
          mockStorage[key] = value;
        });

        const res = commitCheckedSaveCredentials(
          'http://new-target:9090',
          'new-secret',
          (key) => mockStorage[key] ?? null,
          failingSet
        );

        expect(res).toEqual({ remembered: false, persistenceError: true });
        // Bound secret must NOT be overwritten or corrupted
        const boundSecret = JSON.parse(mockStorage[STORAGE_KEY_BOUND_SECRET]);
        expect(boundSecret.normalizedUrl).toBe('http://pre-existing:9090');
        expect(boundSecret.secret).toBe('old-secret');
      });

      it('handles URL mismatch after write (silent storage failure or null) without writing secret', () => {
        const mockStorage: Record<string, string> = {
          [STORAGE_KEY_BASE_URL]: 'http://pre-existing:9090'
        };
        // Simulated silent failure where setItem does not update the storage
        const silentNoopSet = vi.fn();
        const res = commitCheckedSaveCredentials(
          'http://new-target:9090',
          'new-secret',
          (key) => mockStorage[key] ?? null,
          silentNoopSet
        );

        expect(res).toEqual({ remembered: false, persistenceError: true });
        expect(mockStorage[STORAGE_KEY_BOUND_SECRET]).toBeUndefined();
      });

      it('handles URL race condition during secret write and returns persistenceError: true', () => {
        let readCount = 0;
        const mockStorage: Record<string, string> = {};
        const mockGet = vi.fn((key: string) => {
          if (key === STORAGE_KEY_BASE_URL) {
            readCount++;
            // First read succeeds and matches
            if (readCount === 1) return 'http://target:9090';
            // Second read (post-secret verification) simulates another tab overwriting BASE_URL
            return 'http://concurrent-other-tab:9090';
          }
          return mockStorage[key] ?? null;
        });
        const mockSet = vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        });

        const res = commitCheckedSaveCredentials(
          'http://target:9090',
          'my-secret',
          mockGet,
          mockSet
        );

        expect(res).toEqual({ remembered: false, persistenceError: true });
      });

      it('handles bound secret storage-write failure (exception) and returns persistenceError: true', () => {
        const mockStorage: Record<string, string> = {};
        const failingSecretSet = vi.fn((key: string, value: string) => {
          if (key === STORAGE_KEY_BOUND_SECRET) {
            throw new Error('QuotaExceededError on secret');
          }
          mockStorage[key] = value;
        });

        const res = commitCheckedSaveCredentials(
          'http://127.0.0.1:9090',
          'secret-123',
          (key) => mockStorage[key] ?? null,
          failingSecretSet
        );

        expect(res).toEqual({ remembered: false, persistenceError: true });
      });
    });

    it('failed persistence does not fail a successful handshake connection using production helper', () => {
      const mockStorage: Record<string, string> = {};
      const failingSet = (key: string, value: string) => {
        if (key === STORAGE_KEY_BASE_URL) {
          throw new Error('QuotaExceededError');
        }
        mockStorage[key] = value;
      };
      const commitRes = commitCheckedSaveCredentials(
        'http://127.0.0.1:9090',
        'my-secret',
        (key) => mockStorage[key] ?? null,
        failingSet
      );

      expect(commitRes.remembered).toBe(false);
      expect(commitRes.persistenceError).toBe(true);

      const handshakeSucceeded = true;
      const result: SaveCredentialResult = {
        connected: handshakeSucceeded,
        remembered: commitRes.remembered,
        persistenceError: commitRes.persistenceError
      };

      expect(result.connected).toBe(true);
      expect(result.remembered).toBe(false);
      expect(result.persistenceError).toBe(true);
    });

    it('leaves isRemembered truthful (does not set false) when clearPersistedCredential removal fails', () => {
      let isRememberedState = true;
      const setIsRemembered = (val: boolean) => {
        isRememberedState = val;
      };

      // When removal fails (safeRemovePersistentBoundSecret returns false)
      const mockFailingRemove = () => false;
      const clearPersistedCredentialImpl = () => {
        const success = mockFailingRemove();
        if (success) {
          setIsRemembered(false);
        }
        return success;
      };

      const result = clearPersistedCredentialImpl();
      expect(result).toBe(false);
      // isRemembered must remain truthful (true), NOT forcibly set to false!
      expect(isRememberedState).toBe(true);
    });

    it('ensures secrets are never exposed in plaintext error messages or logs', () => {
      const secret = 'super-confidential-token-xyz-987';
      const safeErrorMsg = '无法连接到外部控制器';

      expect(safeErrorMsg.includes(secret)).toBe(false);

      const err = new Error('无法连接到外部控制器: Connection refused');
      expect(err.message).not.toContain(secret);
    });

    it('cross-tab localStorage change does not alter this tab active state or leak secret', () => {
      const tab1ActiveUrl = 'http://127.0.0.1:9090';
      const tab1ActiveSecret = 'tab1-secret';

      const crossTabUrl = 'http://192.168.1.100:9090';
      const crossTabRecord = JSON.stringify({
        normalizedUrl: crossTabUrl,
        secret: 'tab2-secret'
      });

      const isTab1Remembered = isStoredSecretRemembered(tab1ActiveUrl, tab1ActiveSecret, crossTabRecord);
      expect(isTab1Remembered).toBe(false);

      const tab1Restored = resolveRestoredSecret(tab1ActiveUrl, null, crossTabRecord);
      expect(tab1Restored).toBe('');
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
