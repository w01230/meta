import { describe, it, expect } from 'vitest';
import { resolveNavbarVersion } from '../components/common/Navbar';

describe('resolveNavbarVersion', () => {
  describe('demo mode', () => {
    it('renders extracted demo version alongside demo qualifier', () => {
      expect(resolveNavbarVersion('connected', true, 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3 · 演示');
      expect(resolveNavbarVersion('connected', true, 'v1.18.0')).toBe('v1.18.0 · 演示');
      expect(resolveNavbarVersion('connected', true, '1.19.2')).toBe('v1.19.2 · 演示');
      expect(resolveNavbarVersion('disconnected', true, 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3 · 演示');
    });

    it('falls back to just "演示" without fabricating a version number when demo version is unavailable or invalid', () => {
      expect(resolveNavbarVersion('connected', true, null)).toBe('演示');
      expect(resolveNavbarVersion('connected', true, undefined)).toBe('演示');
      expect(resolveNavbarVersion('connected', true, '')).toBe('演示');
      expect(resolveNavbarVersion('connected', true, '   ')).toBe('演示');
      expect(resolveNavbarVersion('connected', true, 'mihomo')).toBe('演示');
      expect(resolveNavbarVersion('connected', true, 'meta')).toBe('演示');
    });
  });

  describe('real connected controller', () => {
    it('renders extracted live version when connected', () => {
      expect(resolveNavbarVersion('connected', false, 'mihomo Meta v1.19.3 linux/amd64 with go1.23.2')).toBe('v1.19.3');
      expect(resolveNavbarVersion('connected', false, 'v1.18.0')).toBe('v1.18.0');
      expect(resolveNavbarVersion('connected', false, '1.19.2')).toBe('v1.19.2');
    });

    it('returns null when connected but no valid version token exists', () => {
      expect(resolveNavbarVersion('connected', false, null)).toBe(null);
      expect(resolveNavbarVersion('connected', false, undefined)).toBe(null);
      expect(resolveNavbarVersion('connected', false, '')).toBe(null);
      expect(resolveNavbarVersion('connected', false, 'mihomo')).toBe(null);
    });
  });

  describe('non-connected states without demo mode', () => {
    it('returns null when disconnected, connecting, or in error state', () => {
      expect(resolveNavbarVersion('disconnected', false, 'v1.19.3')).toBe(null);
      expect(resolveNavbarVersion('connecting', false, 'v1.19.3')).toBe(null);
      expect(resolveNavbarVersion('error', false, 'v1.19.3')).toBe(null);
    });
  });

  describe('Navbar status accent and accessibility properties', () => {
    it('correctly maps demo vs live state to status-demo vs status-live dot classes', () => {
      const getStatusDotClass = (demoMode: boolean) => (demoMode ? 'status-demo' : 'status-live');
      expect(getStatusDotClass(true)).toBe('status-demo');
      expect(getStatusDotClass(false)).toBe('status-live');
    });

    it('generates accurate accessible brand labels and full version tooltips', () => {
      const getBrandAriaLabel = () => 'Meta 返回总览';
      expect(getBrandAriaLabel()).toBe('Meta 返回总览');

      const getVersionTooltip = (demoMode: boolean, rawVersion?: string, token?: string | null) => {
        return demoMode
          ? (rawVersion ? `演示模式 · 核心版本: ${rawVersion}` : '演示模式')
          : (rawVersion ? `核心版本: ${rawVersion}` : (token ? `核心版本: ${token}` : undefined));
      };

      expect(getVersionTooltip(true, 'v1.19.3', 'v1.19.3 · 演示')).toBe('演示模式 · 核心版本: v1.19.3');
      expect(getVersionTooltip(false, 'v1.19.3', 'v1.19.3')).toBe('核心版本: v1.19.3');
    });
  });
});
