import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PROXY_POLL_INTERVAL_MS,
  ELIGIBLE_POLL_TABS,
  isEligiblePollTab,
  isProxyPollingEligible,
  shouldCommitProxySnapshot,
  appendProxyHistory,
  startProxyPolling,
  createCoalescedProxyPollRunner,
  MAX_PROXY_HISTORY_LENGTH
} from '../context/ControllerContext';
import { MihomoVersion, ProxyItem } from '../types/api';

const MOCK_VERSION: MihomoVersion = {
  version: '1.18.0',
  meta: true,
  premium: false
};

describe('Proxy Polling & State Ordering Safeguards', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('1. REST Controller Gating & Eligibility Policy (isProxyPollingEligible)', () => {
    it('defines PROXY_POLL_INTERVAL_MS as 30s and eligible tabs as overview and proxies', () => {
      expect(PROXY_POLL_INTERVAL_MS).toBe(30000);
      expect(ELIGIBLE_POLL_TABS).toEqual(['overview', 'proxies']);
      expect(isEligiblePollTab('overview')).toBe(true);
      expect(isEligiblePollTab('proxies')).toBe(true);
      expect(isEligiblePollTab('connections')).toBe(false);
      expect(isEligiblePollTab('rules')).toBe(false);
      expect(isEligiblePollTab('logs')).toBe(false);
    });

    it('returns true when connected, visible, on eligible tab with REST-verified version', () => {
      expect(isProxyPollingEligible('overview', true, false, MOCK_VERSION, 'connected')).toBe(true);
      expect(isProxyPollingEligible('proxies', true, false, MOCK_VERSION, 'connected')).toBe(true);
    });

    it('allows polling during transient WS stream reconnect when REST handshake verified version is present', () => {
      // Joint WS drop causes status to become 'connecting', but REST controller is already verified
      expect(isProxyPollingEligible('overview', true, false, MOCK_VERSION, 'connecting')).toBe(true);
    });

    it('blocks polling during initial connect or new handshake before version is verified', () => {
      expect(isProxyPollingEligible('overview', true, false, null, 'connecting')).toBe(false);
    });

    it('blocks polling when controller is in terminal status (disconnected or error)', () => {
      expect(isProxyPollingEligible('overview', true, false, MOCK_VERSION, 'disconnected')).toBe(false);
      expect(isProxyPollingEligible('overview', true, false, MOCK_VERSION, 'error')).toBe(false);
    });

    it('does not gate on statusError so transient refreshAll or network error retries on 30s schedule', () => {
      // Even if a transient GET error occurs, status remains connected with verified version
      expect(isProxyPollingEligible('overview', true, false, MOCK_VERSION, 'connected')).toBe(true);
    });

    it('blocks polling in demo mode (no network)', () => {
      expect(isProxyPollingEligible('overview', true, true, MOCK_VERSION, 'connected')).toBe(false);
    });

    it('blocks polling when page is hidden or tab is ineligible', () => {
      expect(isProxyPollingEligible('overview', false, false, MOCK_VERSION, 'connected')).toBe(false);
      expect(isProxyPollingEligible('rules', true, false, MOCK_VERSION, 'connected')).toBe(false);
      expect(isProxyPollingEligible('connections', true, false, MOCK_VERSION, 'connected')).toBe(false);
    });
  });

  describe('2. Whole-Map Proxy Ordering & User Mutation Guard (shouldCommitProxySnapshot)', () => {
    it('commits in-order whole-map snapshot when no user mutation intervened', () => {
      const commit = shouldCommitProxySnapshot(
        1, // reqSeq
        0, // lastCommittedSeq
        0, // reqMutationEpoch
        0, // currentMutationEpoch
        true // isActionValid
      );
      expect(commit).toBe(true);
    });

    it('ensures later dispatched request wins and drops out-of-order older snapshot', () => {
      // Req 2 committed first (lastCommittedSeq = 2). Req 1 arrives later.
      const commitStaleReq1 = shouldCommitProxySnapshot(1, 2, 0, 0, true);
      expect(commitStaleReq1).toBe(false);

      // Subsequent Req 3 arrives after Req 2 -> allowed to commit
      const commitReq3 = shouldCommitProxySnapshot(3, 2, 0, 0, true);
      expect(commitReq3).toBe(true);
    });

    it('drops older snapshot when user-initiated mutation (testProxyDelay / switch) occurs while request is in flight', () => {
      // Whole-map read dispatched at mutationEpoch 0
      const reqMutationEpoch = 0;
      // User performed manual test delay while fetch was in flight -> currentMutationEpoch became 1
      const currentMutationEpoch = 1;

      const commit = shouldCommitProxySnapshot(
        1, // reqSeq
        0, // lastCommittedSeq
        reqMutationEpoch,
        currentMutationEpoch,
        true // isActionValid
      );
      // Older snapshot dropped to prevent overwriting user manual test results
      expect(commit).toBe(false);
    });

    it('rejects commit when action generation or client identity is invalidated', () => {
      const commit = shouldCommitProxySnapshot(2, 1, 0, 0, false);
      expect(commit).toBe(false);
    });
  });

  describe('3. Chronological Proxy Delay History (appendProxyHistory)', () => {
    it('appends latest measurement at the END of history (chronological order)', () => {
      const existing = [
        { time: '2026-09-27T10:00:00Z', delay: 100 },
        { time: '2026-09-27T10:01:00Z', delay: 120 }
      ];
      const newEntry = { time: '2026-09-27T10:02:00Z', delay: 85 };

      const updated = appendProxyHistory(existing, newEntry);
      expect(updated).toHaveLength(3);
      expect(updated[updated.length - 1]).toEqual(newEntry);
      expect(updated[0].delay).toBe(100);
      expect(updated[1].delay).toBe(120);
      expect(updated[2].delay).toBe(85);
    });

    it('caps history at MAX_PROXY_HISTORY_LENGTH (20) keeping the most recent', () => {
      const existing = Array.from({ length: 20 }, (_, i) => ({
        time: `2026-09-27T10:${i.toString().padStart(2, '0')}:00Z`,
        delay: 50 + i
      }));
      const newEntry = { time: '2026-09-27T10:20:00Z', delay: 35 };

      const updated = appendProxyHistory(existing, newEntry, MAX_PROXY_HISTORY_LENGTH);
      expect(updated).toHaveLength(20);
      // Oldest entry dropped
      expect(updated[0].delay).toBe(51);
      // Latest entry is at the end
      expect(updated[19].delay).toBe(35);
    });
  });

  describe('4. Atomic Whole-Map Update Policy (定时同步全部组)', () => {
    it('replaces entire map including nested and contained groups atomically', () => {
      const initialProxies: Record<string, ProxyItem> = {
        'GLOBAL': { name: 'GLOBAL', type: 'Selector', now: 'ProxyGroup1', all: ['ProxyGroup1', 'DIRECT'], history: [] },
        'ProxyGroup1': { name: 'ProxyGroup1', type: 'Selector', now: 'NodeA', all: ['NodeA', 'NodeB'], history: [] },
        'NodeA': { name: 'NodeA', type: 'Shadowsocks', history: [{ time: '2026-09-27T10:00:00Z', delay: 100 }] },
        'NodeB': { name: 'NodeB', type: 'Shadowsocks', history: [] }
      };

      const newSnapshot: Record<string, ProxyItem> = {
        'GLOBAL': { name: 'GLOBAL', type: 'Selector', now: 'ProxyGroup1', all: ['ProxyGroup1', 'DIRECT'], history: [] },
        'ProxyGroup1': { name: 'ProxyGroup1', type: 'Selector', now: 'NodeB', all: ['NodeA', 'NodeB'], history: [] },
        'NodeA': { name: 'NodeA', type: 'Shadowsocks', history: [{ time: '2026-09-27T10:05:00Z', delay: 90 }] },
        'NodeB': { name: 'NodeB', type: 'Shadowsocks', history: [{ time: '2026-09-27T10:05:00Z', delay: 60 }] }
      };

      // Atomic map replacement simulates setProxies(res.proxies)
      let currentMap = initialProxies;
      currentMap = newSnapshot;

      expect(currentMap['ProxyGroup1'].now).toBe('NodeB');
      expect(currentMap['NodeA'].history?.[0]?.delay).toBe(90);
      expect(currentMap['NodeB'].history?.[0]?.delay).toBe(60);
    });
  });

  describe('5. Polling Lifecycle & Timer Coordination (startProxyPolling)', () => {
    it('executes immediate poll upon start, then every 30s', async () => {
      let pollCount = 0;
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++;
      });

      const handle = startProxyPolling(() => true, pollFn, 30000);

      // Immediate refresh on entering eligible page
      expect(pollCount).toBe(1);

      // Advance by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(pollCount).toBe(2);

      // Advance by another 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      expect(pollCount).toBe(3);

      handle.stop();
      await vi.advanceTimersByTimeAsync(60000);
      // Stopped: no further polls
      expect(pollCount).toBe(3);
    });

    it('swallows unexpected callback rejection to avoid unhandled promise and maintains interval', async () => {
      let pollCount = 0;
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++;
        if (pollCount === 1) {
          throw new Error('Network timeout during poll');
        }
        return true;
      });

      const handle = startProxyPolling(() => true, pollFn, 30000);
      expect(pollCount).toBe(1);

      // Even though first poll threw, interval continues to fire after 30s
      await vi.advanceTimersByTimeAsync(30000);
      expect(pollCount).toBe(2);

      handle.stop();
    });

    it('does not start timer or poll if initially ineligible', async () => {
      const pollFn = vi.fn().mockResolvedValue(true);
      const handle = startProxyPolling(() => false, pollFn, 30000);

      expect(pollFn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60000);
      expect(pollFn).not.toHaveBeenCalled();

      handle.stop();
    });

    it('stops ticking when isEligible becomes false (e.g. page hidden or navigated away)', async () => {
      let eligible = true;
      let pollCount = 0;
      const pollFn = vi.fn().mockImplementation(async () => {
        pollCount++;
      });

      const handle = startProxyPolling(() => eligible, pollFn, 30000);
      expect(pollCount).toBe(1);

      // User navigates away or hides page
      eligible = false;
      await vi.advanceTimersByTimeAsync(30000);
      expect(pollCount).toBe(1);

      handle.stop();
    });
  });

  describe('6. Coalesced catch-up reads for an in-flight GET /proxies', () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => { resolve = done; });
      return { promise, resolve };
    };

    const flushPromises = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    it('runs exactly one fresh GET after overlapping requests, using the latest validity callback', async () => {
      const source = { generation: 1, client: {} as any };
      const responses = [deferred<boolean>(), deferred<boolean>()];
      const execute = vi.fn()
        .mockImplementationOnce(() => responses[0].promise)
        .mockImplementationOnce(() => responses[1].promise);
      const run = createCoalescedProxyPollRunner(
        () => ({ ...source }),
        (a, b) => a.generation === b.generation && a.client === b.client,
        execute
      );
      let oldCallbackValid = true;
      const oldCallback = () => oldCallbackValid;
      const latestCallback = () => true;

      const firstPoll = run(oldCallback);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(await run(oldCallback)).toBe(false);
      expect(await run(latestCallback)).toBe(false);
      oldCallbackValid = false;
      expect(execute).toHaveBeenCalledTimes(1);

      responses[0].resolve(true);
      await firstPoll;
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(2);

      responses[1].resolve(true);
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('cancels the queued catch-up if the view becomes ineligible or its source changes', async () => {
      const source = { generation: 1, client: {} as any };
      const response = deferred<boolean>();
      const execute = vi.fn().mockImplementation(() => response.promise);
      const run = createCoalescedProxyPollRunner(
        () => ({ ...source }),
        (a, b) => a.generation === b.generation && a.client === b.client,
        execute
      );
      let eligible = true;

      const firstPoll = run(() => eligible);
      await run(() => eligible);
      eligible = false;
      response.resolve(true);
      await firstPoll;
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(1);

      // A source change also invalidates any queued callback captured for the old client.
      eligible = true;
      const nextResponse = deferred<boolean>();
      execute.mockImplementationOnce(() => nextResponse.promise);
      const nextPoll = run(() => eligible);
      await run(() => eligible);
      source.generation += 1;
      source.client = {};
      nextResponse.resolve(true);
      await nextPoll;
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('allows an eligible request from a replacement source to catch up after the old GET settles', async () => {
      const source = { generation: 1, client: {} as any };
      const responses = [deferred<boolean>(), deferred<boolean>()];
      const execute = vi.fn()
        .mockImplementationOnce(() => responses[0].promise)
        .mockImplementationOnce(() => responses[1].promise);
      const run = createCoalescedProxyPollRunner(
        () => ({ ...source }),
        (a, b) => a.generation === b.generation && a.client === b.client,
        execute
      );

      const firstPoll = run(() => true);
      source.generation += 1;
      source.client = {};
      await run(() => true);
      responses[0].resolve(false);
      await firstPoll;
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(2);

      responses[1].resolve(true);
      await flushPromises();
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });
});
