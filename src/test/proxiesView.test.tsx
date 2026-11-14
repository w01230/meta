import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyItem } from '../types/api';
import { ProxiesView } from '../components/proxies/ProxiesView';

const state = vi.hoisted(() => ({
  proxies: {} as Record<string, ProxyItem>,
  compact: true,
  overrides: {} as Record<string, boolean>,
}));

vi.mock('../context/ControllerContext', () => ({
  useController: () => ({ proxies: state.proxies, status: 'connected', hideGlobal: false }),
}));
vi.mock('../components/common/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../utils/proxyPersistence', () => ({
  getStoredProxiesIsCompact: () => state.compact,
  getStoredProxiesGroupOverrides: () => state.overrides,
  setStoredProxiesIsCompact: vi.fn(),
  setStoredProxiesGroupOverrides: vi.fn(),
}));

function renderGroup(group: ProxyItem) {
  state.proxies = {
    [group.name]: group,
    ...Object.fromEntries([
      ['HK-01', 45], ['US-01', 180], ['JP-01', 350],
      ['SG-01', 0], ['GB-01', undefined],
    ].map(([name, delay]) => [name, {
      name, type: 'Shadowsocks',
      history: delay === undefined ? [] : [{ time: '2024-01-01T00:00:00Z', delay }],
    }])),
  };
  return renderToStaticMarkup(<ProxiesView />);
}

function compactButton(html: string, name: string) {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const button = buttons.find((item) =>
    item.includes('compact-node-btn') && item.includes(`aria-label="${name}, 延迟:`)
  );
  expect(button, `compact button for ${name}`).toBeDefined();
  return button!;
}

describe('ProxiesView compact rendering', () => {
  const nodes = ['HK-01', 'US-01', 'JP-01', 'SG-01', 'GB-01'];
  beforeEach(() => {
    state.compact = true;
    state.overrides = {};
  });

  it('renders Selector selection, accessibility, tooltips and all five latency rings', () => {
    const html = renderGroup({ name: 'Group', type: 'Selector', now: 'HK-01', all: nodes });
    for (const [name, level, text] of [
      ['HK-01', 'fast', '45 ms'],
      ['US-01', 'medium', '180 ms'],
      ['JP-01', 'slow', '350 ms'],
      ['SG-01', 'timeout', '超时'],
      ['GB-01', 'untested', '未测速'],
    ]) {
      const button = compactButton(html, name);
      const selected = name === 'HK-01';
      expect(button).toContain(`compact-flag-ring ring-${level}`);
      expect(button).toContain('compact-node-flag');
      expect(button).toContain(`aria-selected="${selected}"`);
      expect(button).toContain(`aria-pressed="${selected}"`);
      expect(button).toContain(`aria-label="${name}, 延迟: ${text}${selected ? ', 当前已选择' : ''}"`);
      expect(button).toContain(`data-tooltip="${name} (${text})${selected ? ' [当前已选]' : ''}"`);
      expect(button.includes('active-selected')).toBe(selected);
      expect(button).not.toMatch(/\sdisabled(?:=""|(?=[\s>]))/);
    }
  });

  it('marks the fixed URLTest node while describing fallback and showing now latency', () => {
    const html = renderGroup({ name: 'Auto', type: 'URLTest', fixed: 'HK-01', now: 'US-01', all: nodes });
    const fixed = compactButton(html, 'HK-01');
    const fallback = compactButton(html, 'US-01');
    expect(fixed).toContain('aria-selected="true"');
    expect(fixed).toContain('aria-pressed="true"');
    expect(fixed).toContain('aria-label="HK-01, 延迟: 45 ms, 已固定选择"');
    expect(fixed).toContain('data-tooltip="HK-01 (45 ms) [已固定选定] (暂由 US-01 回退转发)"');
    expect(fallback).toContain('aria-selected="false"');
    expect(fallback).toContain('aria-pressed="false"');
    expect(fallback).not.toContain('active-selected');
    expect(html).toContain('已固定: HK-01 (当前回退: US-01)');
    expect(html).toContain('当前选定「US-01」延迟: 180 ms');
  });

  it('renders automatic groups as disabled readonly nodes without aria-pressed', () => {
    const html = renderGroup({ name: 'Fallback', type: 'Fallback', now: 'HK-01', all: nodes });
    const selected = compactButton(html, 'HK-01');
    const unselected = compactButton(html, 'US-01');
    for (const button of [selected, unselected]) {
      expect(button).toContain('readonly-node');
      expect(button).toMatch(/\sdisabled(?:=""|(?=[\s>]))/);
      expect(button).not.toContain('aria-pressed=');
    }
    expect(selected).toContain('aria-selected="true"');
    expect(unselected).toContain('aria-selected="false"');
  });

  it.each(['global expanded layout', 'expanded group override'])('omits compact nodes in %s', (mode) => {
    state.compact = mode !== 'global expanded layout';
    state.overrides = state.compact ? { Group: true } : {};
    const html = renderGroup({ name: 'Group', type: 'Selector', now: 'HK-01', all: nodes });
    expect(html).toContain('proxy-nodes-grid');
    expect(html).toContain('node-card-select');
    expect(html).not.toContain('compact-node-btn');
    expect(html).not.toContain('compact-flag-ring');
  });
});
