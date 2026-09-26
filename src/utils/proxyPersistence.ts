export const STORAGE_KEY_PROXIES_IS_COMPACT = 'meta_proxies_is_compact_v1';
export const STORAGE_KEY_PROXIES_GROUP_OVERRIDES = 'meta_proxies_group_overrides_v1';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads the persisted global compact layout mode from localStorage.
 * Defaults to false (expanded card layout) if no valid stored state is present or storage is blocked.
 */
export function getStoredProxiesIsCompact(): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;
    const raw = storage.getItem(STORAGE_KEY_PROXIES_IS_COMPACT);
    if (raw === null) return false;
    return raw === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists the global compact layout mode to localStorage.
 * Safely handles blocked storage or quota exceeded errors.
 */
export function setStoredProxiesIsCompact(isCompact: boolean): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(STORAGE_KEY_PROXIES_IS_COMPACT, String(isCompact));
  } catch {
    // ignore storage quota / blocked storage errors
  }
}

/**
 * Reads the persisted per-group expansion overrides map from localStorage.
 * Validates that all parsed values are valid boolean entries.
 * Defaults to {} if missing, malformed, or storage is blocked.
 */
export function getStoredProxiesGroupOverrides(): Record<string, boolean> {
  try {
    const storage = getStorage();
    if (!storage) return {};
    const raw = storage.getItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const validated: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof val === 'boolean') {
        validated[key] = val;
      }
    }
    return validated;
  } catch {
    return {};
  }
}

/**
 * Persists the per-group expansion overrides map to localStorage.
 * Sanitizes entries to ensure only boolean values are serialized.
 * Safely handles blocked storage or quota exceeded errors.
 */
export function setStoredProxiesGroupOverrides(overrides: Record<string, boolean>): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      storage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, JSON.stringify({}));
      return;
    }
    const sanitized: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(overrides)) {
      if (typeof key === 'string' && typeof val === 'boolean') {
        sanitized[key] = val;
      }
    }
    storage.setItem(STORAGE_KEY_PROXIES_GROUP_OVERRIDES, JSON.stringify(sanitized));
  } catch {
    // ignore storage quota / blocked storage errors
  }
}
