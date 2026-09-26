import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  STORAGE_KEY_PROXIES_IS_COMPACT,
  STORAGE_KEY_PROXIES_GROUP_OVERRIDES,
  getStoredProxiesIsCompact,
  setStoredProxiesIsCompact,
  getStoredProxiesGroupOverrides,
  setStoredProxiesGroupOverrides
} from '../utils/proxyPersistence';

class MockStorage implements Storage {
  private store: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  clear(): void {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }
}

describe('Proxy Layout & Per-Group Overrides Persistence', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
    vi.stubGlobal('localStorage', mockStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Initial & Default State', () => {
    it('defaults to expanded mode (isCompact = false) when storage is empty', () => {
      expect(mockStorage.getItem(STORAGE_KEY_PROXIES_IS_COMPACT)).toBeNull();
      expect(getStoredProxiesIsCompact()).toBe(false);
    });

    it('defaults to empty map for per-group overrides when storage is empty', () => {
      expect(mockStorage.getItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES)).toBeNull();
      expect(getStoredProxiesGroupOverrides()).toEqual({});
    });
  });

  describe('Valid Persistence', () => {
    it('persists and retrieves global compact preference (true / false)', () => {
      setStoredProxiesIsCompact(true);
      expect(mockStorage.getItem(STORAGE_KEY_PROXIES_IS_COMPACT)).toBe('true');
      expect(getStoredProxiesIsCompact()).toBe(true);

      setStoredProxiesIsCompact(false);
      expect(mockStorage.getItem(STORAGE_KEY_PROXIES_IS_COMPACT)).toBe('false');
      expect(getStoredProxiesIsCompact()).toBe(false);
    });

    it('persists and retrieves per-group expansion overrides map', () => {
      const overrides = {
        '节点选择': true,
        'ProxyGroup': false,
        '漏网之鱼': true
      };

      setStoredProxiesGroupOverrides(overrides);
      expect(JSON.parse(mockStorage.getItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES)!)).toEqual(overrides);
      expect(getStoredProxiesGroupOverrides()).toEqual(overrides);
    });
  });

  describe('Malformed Storage & Storage Unavailable (Resilience)', () => {
    it('falls back to {} when stored JSON is invalid/malformed', () => {
      mockStorage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, '{"unclosed json:');
      expect(getStoredProxiesGroupOverrides()).toEqual({});

      mockStorage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, 'not a json string');
      expect(getStoredProxiesGroupOverrides()).toEqual({});
    });

    it('falls back to {} when stored value is not a plain object (e.g. number, array, string)', () => {
      mockStorage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, '12345');
      expect(getStoredProxiesGroupOverrides()).toEqual({});

      mockStorage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, '["array", "of", "strings"]');
      expect(getStoredProxiesGroupOverrides()).toEqual({});

      mockStorage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, '"primitive string"');
      expect(getStoredProxiesGroupOverrides()).toEqual({});
    });

    it('sanitizes and filters out non-boolean values from stored overrides', () => {
      mockStorage.setItem(
        STORAGE_KEY_PROXIES_GROUP_OVERRIDES,
        JSON.stringify({
          validGroup: true,
          anotherValid: false,
          invalidNumber: 123,
          invalidString: 'true',
          invalidObject: { nested: true },
          invalidNull: null
        })
      );

      const parsed = getStoredProxiesGroupOverrides();
      expect(parsed).toEqual({
        validGroup: true,
        anotherValid: false
      });
    });

    it('sanitizes non-boolean values on setStoredProxiesGroupOverrides', () => {
      const badInput: any = {
        valid: true,
        notBool: 'yes',
        badNum: 99
      };

      setStoredProxiesGroupOverrides(badInput);
      expect(getStoredProxiesGroupOverrides()).toEqual({ valid: true });
    });

    it('gracefully handles SecurityError or blocked storage on read without throwing', () => {
      vi.spyOn(mockStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: The operation is insecure.');
      });

      expect(() => getStoredProxiesIsCompact()).not.toThrow();
      expect(getStoredProxiesIsCompact()).toBe(false);

      expect(() => getStoredProxiesGroupOverrides()).not.toThrow();
      expect(getStoredProxiesGroupOverrides()).toEqual({});
    });

    it('gracefully handles QuotaExceededError or blocked storage on write without throwing', () => {
      vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError: storage full');
      });

      expect(() => setStoredProxiesIsCompact(true)).not.toThrow();
      expect(() => setStoredProxiesGroupOverrides({ groupA: true })).not.toThrow();
    });

    it('gracefully handles environment where localStorage is undefined (SSR / worker)', () => {
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('window', undefined);

      expect(() => getStoredProxiesIsCompact()).not.toThrow();
      expect(getStoredProxiesIsCompact()).toBe(false);

      expect(() => getStoredProxiesGroupOverrides()).not.toThrow();
      expect(getStoredProxiesGroupOverrides()).toEqual({});

      expect(() => setStoredProxiesIsCompact(true)).not.toThrow();
      expect(() => setStoredProxiesGroupOverrides({ groupA: true })).not.toThrow();
    });
  });

  describe('Per-Group Persistence & Stale Group Names', () => {
    it('preserves existing overrides when toggling a single group', () => {
      // Step 1: Initial state has GroupA
      setStoredProxiesGroupOverrides({ GroupA: true });
      const current = getStoredProxiesGroupOverrides();

      // Step 2: User toggles GroupB
      const updated = { ...current, GroupB: !current['GroupB'] };
      setStoredProxiesGroupOverrides(updated);

      expect(getStoredProxiesGroupOverrides()).toEqual({
        GroupA: true,
        GroupB: true
      });
    });

    it('harmlessly preserves stale group names from previous configs without corruption', () => {
      // GroupOld was from an older config and is no longer in current active proxy groups
      setStoredProxiesGroupOverrides({
        GroupOld: true,
        GroupActive: true
      });

      const stored = getStoredProxiesGroupOverrides();
      expect(stored['GroupOld']).toBe(true);
      expect(stored['GroupActive']).toBe(true);
    });
  });

  describe('Global Reset & Semantics', () => {
    it('persists global layout toggle and resets overrides to {} without clearing unrelated keys', () => {
      // Setup unrelated settings
      mockStorage.setItem('meta_dashboard_hide_global', 'true');
      mockStorage.setItem('clash_meta_base_url', 'http://127.0.0.1:9090');

      // Setup proxy compact layout with overrides
      setStoredProxiesIsCompact(true);
      setStoredProxiesGroupOverrides({
        '节点选择': true,
        'ProxyGroup': true
      });

      expect(getStoredProxiesIsCompact()).toBe(true);
      expect(Object.keys(getStoredProxiesGroupOverrides()).length).toBe(2);

      // Simulate global toggle action (flips isCompact, clears overrides)
      const currentCompact = getStoredProxiesIsCompact();
      const nextCompact = !currentCompact;
      setStoredProxiesIsCompact(nextCompact);
      setStoredProxiesGroupOverrides({});

      // Assert proxy layout reset
      expect(getStoredProxiesIsCompact()).toBe(false);
      expect(getStoredProxiesGroupOverrides()).toEqual({});

      // Assert unrelated keys remain completely intact (no data loss)
      expect(mockStorage.getItem('meta_dashboard_hide_global')).toBe('true');
      expect(mockStorage.getItem('clash_meta_base_url')).toBe('http://127.0.0.1:9090');
    });
  });
});
