import { describe, expect, it } from 'vitest';
import type { Notice } from '../../shared/contract';
import type { AppEvent, AppState } from './contract';
import { createInitialState, reduce } from './index';
import { ANALYSIS_RESULT, DEMO_DID, DISCLOSURE, LIVE_DID, OTHER_DID, failure, linked, sampleSnapshot } from './testkit';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function apply(state: AppState, ...events: AppEvent[]): AppState {
  return events.reduce((s, e) => reduce(deepFreeze(s), e), state);
}

const started = (runId: number, mode: 'live' | 'demo' = 'live', did = LIVE_DID): AppEvent => ({
  type: 'load/started',
  runId,
  mode,
  did,
  demoScenario: mode === 'demo' ? 'complete' : null,
});

function loaded(mode: 'live' | 'demo' = 'live', did = LIVE_DID): AppState {
  return apply(createInitialState(), started(1, mode, did), {
    type: 'load/snapshot-ready',
    runId: 1,
    snapshot: sampleSnapshot(did),
    acquisitionMs: 12,
  });
}

const notice = (code: Notice['code'], message = 'm'): Notice => ({ code, level: 'info', message });

describe('initial state', () => {
  it('matches the documented literal', () => {
    expect(createInitialState()).toEqual({
      auth: { status: 'initialising', disclosure: null, failure: null, signInPending: false },
      mode: 'none',
      demoScenario: null,
      accounts: [],
      activeDid: null,
      view: 'overview',
      range: '30d',
      load: { status: 'idle', runId: 0, progress: null, failure: null, acquisitionMs: null },
      snapshot: null,
      analysis: { status: 'idle', range: '30d', result: null, ranIn: null, fallbackReason: null, durationMs: null, failure: null },
      notices: [],
    });
  });
});

describe('load events', () => {
  it('load/started with runId = current + 1 clears snapshot and analysis and sets mode/activeDid', () => {
    const ready = apply(loaded(), { type: 'analysis/started', runId: 1, range: '30d' }, {
      type: 'notice/added',
      notice: notice('session-ended'),
    }, { type: 'notice/added', notice: notice('analysis-fallback') }, { type: 'notice/added', notice: notice('storage-unavailable') });
    const next = apply(ready, started(2, 'demo', DEMO_DID));
    expect(next.mode).toBe('demo');
    expect(next.activeDid).toBe(DEMO_DID);
    expect(next.demoScenario).toBe('complete');
    expect(next.snapshot).toBeNull();
    expect(next.analysis).toEqual(createInitialState().analysis);
    expect(next.load).toEqual({ status: 'loading', runId: 2, progress: null, failure: null, acquisitionMs: null });
    expect(next.notices.map((n) => n.code)).toEqual(['storage-unavailable']);
  });

  it('load/started analysis range follows the selected range', () => {
    const s = apply(createInitialState(), { type: 'range/selected', range: '7d' }, started(1));
    expect(s.analysis.range).toBe('7d');
  });

  it('load/started with any other runId returns the same reference', () => {
    const s = loaded();
    expect(reduce(s, started(1))).toBe(s);
    expect(reduce(s, started(3))).toBe(s);
  });

  it('progress, snapshot-ready, failed, cancelled with a stale runId return the same reference', () => {
    const s = apply(createInitialState(), started(1), started(2));
    const progress = { phase: 'verifying-account', collection: null, done: 0, total: 1, message: 'x' } as const;
    expect(reduce(s, { type: 'load/progress', runId: 1, progress })).toBe(s);
    expect(reduce(s, { type: 'load/snapshot-ready', runId: 1, snapshot: sampleSnapshot(), acquisitionMs: 1 })).toBe(s);
    expect(reduce(s, { type: 'load/failed', runId: 1, failure: failure('network') })).toBe(s);
    expect(reduce(s, { type: 'load/cancelled', runId: 1 })).toBe(s);
  });

  it('progress, snapshot-ready, failed, cancelled with the current runId apply while loading', () => {
    const s = apply(createInitialState(), started(1));
    const progress = { phase: 'reading-records', collection: null, done: 1, total: 3, message: 'x' } as const;
    expect(reduce(s, { type: 'load/progress', runId: 1, progress }).load.progress).toEqual(progress);
    const ready = apply(s, { type: 'load/progress', runId: 1, progress }, { type: 'load/snapshot-ready', runId: 1, snapshot: sampleSnapshot(), acquisitionMs: 9 });
    expect(ready.load).toEqual({ status: 'ready', runId: 1, progress: null, failure: null, acquisitionMs: 9 });
    expect(ready.snapshot).toEqual(sampleSnapshot());
    const failed = apply(s, { type: 'load/progress', runId: 1, progress }, { type: 'load/failed', runId: 1, failure: failure('network') });
    expect(failed.load.status).toBe('failed');
    expect(failed.load.failure).toEqual(failure('network'));
    expect(failed.load.progress).toBeNull();
    expect(failed.snapshot).toBeNull();
    const cancelled = apply(s, { type: 'load/progress', runId: 1, progress }, { type: 'load/cancelled', runId: 1 });
    expect(cancelled.load.status).toBe('cancelled');
    expect(cancelled.load.progress).toBeNull();
    expect(cancelled.snapshot).toBeNull();
  });

  it('load/snapshot-ready after load/cancelled (same runId) is ignored', () => {
    const s = apply(createInitialState(), started(1), { type: 'load/cancelled', runId: 1 });
    expect(reduce(s, { type: 'load/snapshot-ready', runId: 1, snapshot: sampleSnapshot(), acquisitionMs: 1 })).toBe(s);
    expect(reduce(s, { type: 'load/progress', runId: 1, progress: { phase: 'normalising', collection: null, done: 0, total: 1, message: 'x' } })).toBe(s);
  });
});

describe('analysis events', () => {
  const ready = {
    type: 'analysis/ready',
    runId: 1,
    range: '30d',
    result: ANALYSIS_RESULT,
    ranIn: 'worker',
    fallbackReason: null,
    durationMs: 5,
  } as const;

  it('analysis/started then ready stores the result', () => {
    const s = apply(loaded(), { type: 'analysis/started', runId: 1, range: '30d' });
    expect(s.analysis.status).toBe('running');
    const r = reduce(deepFreeze(s), ready);
    expect(r.analysis).toEqual({ status: 'ready', range: '30d', result: ANALYSIS_RESULT, ranIn: 'worker', fallbackReason: null, durationMs: 5, failure: null });
  });

  it('analysis/ready with a range different from state.range is ignored', () => {
    const s = loaded();
    expect(reduce(s, { ...ready, range: '7d' })).toBe(s);
  });

  it('analysis/ready with a stale runId is ignored', () => {
    const s = loaded();
    expect(reduce(s, { ...ready, runId: 0 })).toBe(s);
  });

  it('analysis/ready / started / failed without a snapshot are ignored', () => {
    const s = apply(createInitialState(), started(1));
    expect(reduce(s, ready)).toBe(s);
    expect(reduce(s, { type: 'analysis/started', runId: 1, range: '30d' })).toBe(s);
    expect(reduce(s, { type: 'analysis/failed', runId: 1, range: '30d', failure: failure('internal') })).toBe(s);
  });

  it('analysis/failed sets the failure and drops the result', () => {
    const s = apply(loaded(), ready, { type: 'analysis/failed', runId: 1, range: '30d', failure: failure('internal') });
    expect(s.analysis.status).toBe('failed');
    expect(s.analysis.failure).toEqual(failure('internal'));
    expect(s.analysis.result).toBeNull();
    expect(s.snapshot).not.toBeNull();
    const other = loaded();
    expect(reduce(other, { type: 'analysis/failed', runId: 1, range: '7d', failure: failure('internal') })).toBe(other);
  });
});

describe('selection events', () => {
  it('range/selected with the current range returns the same reference', () => {
    const s = createInitialState();
    expect(reduce(s, { type: 'range/selected', range: '30d' })).toBe(s);
    expect(reduce(s, { type: 'range/selected', range: '7d' }).range).toBe('7d');
  });

  it('view/selected with the current view returns the same reference', () => {
    const s = createInitialState();
    expect(reduce(s, { type: 'view/selected', view: 'overview' })).toBe(s);
    expect(reduce(s, { type: 'view/selected', view: 'privacy' }).view).toBe('privacy');
  });
});

describe('data/cleared', () => {
  it('keeps accounts/auth/view/range, clears data, increments runId', () => {
    const s = apply(
      loaded(),
      { type: 'auth/ready', disclosure: DISCLOSURE },
      { type: 'accounts/changed', accounts: [linked(LIVE_DID)] },
      { type: 'view/selected', view: 'privacy' },
      { type: 'range/selected', range: '90d' },
    );
    const c = apply(s, { type: 'data/cleared' });
    expect(c.auth).toBe(s.auth);
    expect(c.accounts).toBe(s.accounts);
    expect(c.view).toBe('privacy');
    expect(c.range).toBe('90d');
    expect(c.mode).toBe('none');
    expect(c.demoScenario).toBeNull();
    expect(c.activeDid).toBeNull();
    expect(c.snapshot).toBeNull();
    expect(c.analysis).toEqual({ ...createInitialState().analysis, range: '90d' });
    expect(c.load).toEqual({ status: 'idle', runId: 2, progress: null, failure: null, acquisitionMs: null });
  });
});

describe('session/ended', () => {
  it('for the active live DID clears data and adds the notice', () => {
    const s = apply(loaded('live', LIVE_DID), { type: 'session/ended', did: LIVE_DID, reason: 'expired' });
    expect(s.snapshot).toBeNull();
    expect(s.mode).toBe('none');
    expect(s.activeDid).toBeNull();
    expect(s.load.runId).toBe(2);
    expect(s.notices).toEqual([
      {
        code: 'session-ended',
        level: 'info',
        message: 'Your sign-in for this account ended, so its data was cleared. Sign in again to continue.',
      },
    ]);
  });

  it('with reason signed-out clears without a notice', () => {
    const s = apply(loaded('live', LIVE_DID), { type: 'session/ended', did: LIVE_DID, reason: 'signed-out' });
    expect(s.snapshot).toBeNull();
    expect(s.mode).toBe('none');
    expect(s.notices).toEqual([]);
  });

  it('for another DID, or in demo mode, changes nothing', () => {
    const live = loaded('live', LIVE_DID);
    expect(reduce(live, { type: 'session/ended', did: OTHER_DID, reason: 'expired' })).toBe(live);
    const demo = loaded('demo', DEMO_DID);
    expect(reduce(demo, { type: 'session/ended', did: DEMO_DID, reason: 'expired' })).toBe(demo);
  });
});

describe('notices', () => {
  it('notice/added replaces a notice with the same code, else appends', () => {
    const s = apply(
      createInitialState(),
      { type: 'notice/added', notice: notice('session-ended', 'one') },
      { type: 'notice/added', notice: notice('storage-unavailable', 'two') },
      { type: 'notice/added', notice: notice('session-ended', 'three') },
    );
    expect(s.notices).toEqual([notice('session-ended', 'three'), notice('storage-unavailable', 'two')]);
  });

  it('notice/dismissed removes it; dismissing a missing code returns the same reference', () => {
    const s = apply(createInitialState(), { type: 'notice/added', notice: notice('session-ended') });
    expect(reduce(s, { type: 'notice/dismissed', code: 'session-ended' }).notices).toEqual([]);
    expect(reduce(s, { type: 'notice/dismissed', code: 'auth-unavailable' })).toBe(s);
  });
});

describe('auth events', () => {
  it('auth/ready sets the disclosure and clears the failure', () => {
    const s = apply(createInitialState(), { type: 'auth/sign-in-failed', failure: failure('auth') }, { type: 'auth/ready', disclosure: DISCLOSURE });
    expect(s.auth).toEqual({ status: 'ready', disclosure: DISCLOSURE, failure: null, signInPending: false });
  });

  it('auth/unavailable sets the failure and the auth-unavailable warning', () => {
    const s = apply(createInitialState(), { type: 'auth/unavailable', failure: failure('unsupported') });
    expect(s.auth.status).toBe('unavailable');
    expect(s.auth.failure).toEqual(failure('unsupported'));
    expect(s.auth.signInPending).toBe(false);
    expect(s.notices).toEqual([
      { code: 'auth-unavailable', level: 'warning', message: 'Live sign-in is unavailable. The synthetic demo still works.' },
    ]);
  });

  it('auth/sign-in-started is ignored unless auth is ready', () => {
    const s = createInitialState();
    expect(reduce(s, { type: 'auth/sign-in-started' })).toBe(s);
    const ready = apply(s, { type: 'auth/ready', disclosure: DISCLOSURE }, { type: 'auth/sign-in-failed', failure: failure('auth') });
    const pending = reduce(deepFreeze(ready), { type: 'auth/sign-in-started' });
    expect(pending.auth.signInPending).toBe(true);
    expect(pending.auth.failure).toBeNull();
    const failed = reduce(deepFreeze(pending), { type: 'auth/sign-in-failed', failure: failure('validation') });
    expect(failed.auth.signInPending).toBe(false);
    expect(failed.auth.failure).toEqual(failure('validation'));
  });

  it('accounts/changed replaces the list', () => {
    const s = apply(createInitialState(), { type: 'accounts/changed', accounts: [linked(LIVE_DID)] });
    expect(s.accounts).toEqual([linked(LIVE_DID)]);
  });
});

describe('purity', () => {
  it('no event mutates a deep-frozen input state', () => {
    const base = deepFreeze(
      apply(loaded(), { type: 'auth/ready', disclosure: DISCLOSURE }, { type: 'notice/added', notice: notice('session-ended') }),
    );
    const snapshotJson = JSON.stringify(base);
    const all: AppEvent[] = [
      { type: 'auth/ready', disclosure: DISCLOSURE },
      { type: 'auth/unavailable', failure: failure('auth') },
      { type: 'auth/sign-in-started' },
      { type: 'auth/sign-in-failed', failure: failure('auth') },
      { type: 'accounts/changed', accounts: [linked(LIVE_DID)] },
      { type: 'session/ended', did: LIVE_DID, reason: 'expired' },
      started(2),
      { type: 'load/progress', runId: 1, progress: { phase: 'normalising', collection: null, done: 0, total: 1, message: 'x' } },
      { type: 'load/snapshot-ready', runId: 1, snapshot: sampleSnapshot(), acquisitionMs: 1 },
      { type: 'load/failed', runId: 1, failure: failure('network') },
      { type: 'load/cancelled', runId: 1 },
      { type: 'analysis/started', runId: 1, range: '30d' },
      { type: 'analysis/ready', runId: 1, range: '30d', result: ANALYSIS_RESULT, ranIn: 'main-thread', fallbackReason: 'worker-timeout', durationMs: 3 },
      { type: 'analysis/failed', runId: 1, range: '30d', failure: failure('internal') },
      { type: 'view/selected', view: 'accounts' },
      { type: 'range/selected', range: 'all' },
      { type: 'data/cleared' },
      { type: 'notice/added', notice: notice('records-skipped') },
      { type: 'notice/dismissed', code: 'session-ended' },
    ];
    for (const e of all) {
      expect(() => reduce(base, e)).not.toThrow();
    }
    expect(JSON.stringify(base)).toBe(snapshotJson);
  });
});
