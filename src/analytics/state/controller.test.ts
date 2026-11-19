import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result, Snapshot } from '../../shared/contract';
import type { CollectionRead } from '../../adapters/atproto/contract';
import type { AnalysisOutcome } from '../worker/contract';
import type { AppState } from './contract';
import { createAppController, createAppStore } from './index';
import {
  DEMO_DID,
  LIKE,
  LIVE_DID,
  OTHER_DID,
  POST,
  abortable,
  deferred,
  defaultRead,
  demoSession,
  failure,
  fakeAuth,
  flush,
  linked,
  makeHarness,
  oauthSession,
  outcome,
  raw,
  coverage,
} from './testkit';

function setup(auth: ReturnType<typeof fakeAuth> | null = fakeAuth()) {
  const h = makeHarness(createAppStore(null), { auth });
  const actions = createAppController(h.deps);
  const snapshots: Snapshot[] = [];
  h.store.subscribe((s) => {
    if (s.snapshot !== null && snapshots.at(-1) !== s.snapshot) snapshots.push(s.snapshot);
  });
  return { h, actions, snapshots };
}

/** Live start with a restored session for `did`. */
function restoreOn(h: ReturnType<typeof setup>['h'], did = LIVE_DID): void {
  h.auth!.initWith = async () => ({ ok: true, value: { session: oauthSession(did), via: 'restore', problem: null } });
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await flush();
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

describe('cancellation', () => {
  it('cancel mid-read: state cancelled, no snapshot; resolving the pending port afterwards changes nothing', async () => {
    const { h, actions, snapshots } = setup();
    const p = h.demo('complete');
    const pending = deferred<CollectionRead>();
    p.repo.readWith = (req) => (req.collection === LIKE ? pending.promise : Promise.resolve(defaultRead(req)));
    const run = actions.enterDemo('complete');
    await flush();
    expect(h.store.getState().load.status).toBe('loading');
    const signal = p.repo.listCalls.at(-1)!.signal;
    actions.cancelLoad();
    expect(signal.aborted).toBe(true);
    const afterCancel = h.store.getState();
    expect(afterCancel.load.status).toBe('cancelled');
    expect(afterCancel.load.progress).toBeNull();
    expect(afterCancel.snapshot).toBeNull();
    pending.resolve(defaultRead({ ...p.repo.listCalls.at(-1)! }));
    await expect(run).resolves.toBeUndefined();
    await flush();
    expect(h.store.getState()).toBe(afterCancel);
    expect(snapshots).toEqual([]);
    expect(p.engagement.calls).toHaveLength(0);
    expect(h.events.map((e) => e.type)).not.toContain('load/snapshot-ready');
  });

  it('cancel while a port honours the abort (rejects) → still cancelled, nothing else dispatched', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    p.repo.readWith = (req) => abortable(new Promise<CollectionRead>(() => {}), req.signal);
    const run = actions.enterDemo('complete');
    await flush();
    actions.cancelLoad();
    const after = h.store.getState();
    await run;
    expect(h.store.getState()).toBe(after);
    expect(after.load.status).toBe('cancelled');
  });

  it('cancelLoad when not loading is a no-op', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    const s = h.store.getState();
    actions.cancelLoad();
    expect(h.store.getState()).toBe(s);
  });

  it('supersede: only the second demo snapshot is ever published; the first run is aborted', async () => {
    const { h, actions, snapshots } = setup();
    const first = h.demo('complete');
    const second = h.demo('empty');
    const pending = deferred<CollectionRead>();
    first.repo.readWith = () => pending.promise;
    second.repo.readWith = async (req) => ({ records: [], rejected: [], coverage: coverage(req.collection, 0) });
    const run1 = actions.enterDemo('complete');
    await flush();
    const firstSignal = first.repo.listCalls[0]!.signal;
    const run2 = actions.enterDemo('empty');
    expect(firstSignal.aborted).toBe(true);
    pending.resolve(defaultRead(first.repo.listCalls[0]!));
    await Promise.all([run1, run2]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.demoScenario).toBe('empty');
    expect(h.store.getState().demoScenario).toBe('empty');
    expect(h.store.getState().load.runId).toBe(2);
    expect(first.engagement.calls).toHaveLength(0);
    expect(h.runner.jobs.map((j) => j.snapshot.demoScenario)).toEqual(['empty']);
  });

  it('supersede during analysis: the first analysis result never lands', async () => {
    const { h, actions } = setup();
    const firstRun = deferred<Result<AnalysisOutcome>>();
    let call = 0;
    h.runner.runWith = () => (++call === 1 ? firstRun.promise : Promise.resolve({ ok: true, value: outcome() }));
    const run1 = actions.enterDemo('complete');
    await flush();
    expect(h.store.getState().analysis.status).toBe('running');
    const run2 = actions.enterDemo('empty');
    expect(h.runner.signals[0]?.aborted).toBe(true);
    await run2;
    const after = h.store.getState();
    firstRun.resolve({ ok: true, value: outcome('worker-timeout') });
    await run1;
    await flush();
    expect(h.store.getState()).toBe(after);
    expect(after.demoScenario).toBe('empty');
    expect(after.notices.map((n) => n.code)).not.toContain('analysis-fallback');
  });

  it('sign-out mid-read: no snapshot appears afterwards', async () => {
    const { h, actions, snapshots } = setup();
    restoreOn(h);
    const pending = deferred<CollectionRead>();
    h.live.repo.readWith = () => pending.promise;
    const started = actions.start();
    await flush();
    expect(h.store.getState().load.status).toBe('loading');
    const signal = h.live.repo.listCalls[0]!.signal;
    await actions.signOut(LIVE_DID);
    expect(signal.aborted).toBe(true);
    pending.resolve(defaultRead(h.live.repo.listCalls[0]!));
    await started;
    await flush();
    const s = h.store.getState();
    expect(snapshots).toEqual([]);
    expect(s.snapshot).toBeNull();
    expect(s.mode).toBe('none');
    expect(s.activeDid).toBeNull();
    expect(s.notices.map((n) => n.code)).not.toContain('session-ended');
    expect(h.auth!.calls).toContain(`signOut:${LIVE_DID}`);
  });

  it('session ended event during a live read: run aborted, data cleared, account marked needs-sign-in, notice present', async () => {
    const { h, actions, snapshots } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID)];
    const pending = deferred<CollectionRead>();
    h.live.repo.readWith = () => pending.promise;
    const started = actions.start();
    await flush();
    const signal = h.live.repo.listCalls[0]!.signal;
    h.auth!.emit({ did: LIVE_DID, reason: 'expired' });
    expect(signal.aborted).toBe(true);
    pending.resolve(defaultRead(h.live.repo.listCalls[0]!));
    await started;
    await flush();
    const s = h.store.getState();
    expect(snapshots).toEqual([]);
    expect(s.snapshot).toBeNull();
    expect(s.mode).toBe('none');
    expect(s.load.status).toBe('idle');
    expect(s.accounts.find((a) => a.did === LIVE_DID)?.status).toBe('needs-sign-in');
    expect(h.live.accounts.calls).toContain(`markNeedsSignIn:${LIVE_DID}`);
    expect(s.notices.map((n) => n.code)).toContain('session-ended');
  });

  it('session ended for a non-active DID only marks the account', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID), linked(OTHER_DID)];
    await actions.start();
    const snap = h.store.getState().snapshot;
    h.auth!.emit({ did: OTHER_DID, reason: 'revoked' });
    const s = h.store.getState();
    expect(s.snapshot).toBe(snap);
    expect(s.accounts.find((a) => a.did === OTHER_DID)?.status).toBe('needs-sign-in');
    expect(s.notices.map((n) => n.code)).not.toContain('session-ended');
  });

  it('session ended for the live DID while the demo is shown leaves the demo alone', async () => {
    const { h, actions } = setup();
    await actions.start();
    await actions.enterDemo('complete');
    const snap = h.store.getState().snapshot;
    h.auth!.emit({ did: LIVE_DID, reason: 'expired' });
    expect(h.store.getState().snapshot).toBe(snap);
    expect(h.store.getState().mode).toBe('demo');
  });
});

describe('range re-analysis', () => {
  it('selectRange(7d) with a snapshot → only the runner is called; analysis/ready carries 7d', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    await actions.enterDemo('complete');
    const snap = h.store.getState().snapshot;
    const counts = [p.accounts.verifyCalls.length, p.repo.listCalls.length, p.engagement.calls.length, h.normalizer.calls.length, h.demoCalls.length];
    await actions.selectRange('7d');
    expect([p.accounts.verifyCalls.length, p.repo.listCalls.length, p.engagement.calls.length, h.normalizer.calls.length, h.demoCalls.length]).toEqual(counts);
    expect(h.runner.jobs).toHaveLength(2);
    expect(h.runner.jobs[1]?.jobId).toBe('1:7d');
    expect(h.runner.jobs[1]?.analytics.range).toBe('7d');
    expect(h.runner.jobs[1]?.snapshot).toBe(snap);
    const s = h.store.getState();
    expect(s.snapshot).toBe(snap);
    expect(s.analysis.status).toBe('ready');
    expect(s.analysis.range).toBe('7d');
    const ready = h.events.filter((e) => e.type === 'analysis/ready');
    expect(ready.at(-1)).toMatchObject({ range: '7d', runId: 1 });
  });

  it('a slower earlier analysis for 30d finishing later is ignored', async () => {
    const { h, actions } = setup();
    const slow = deferred<Result<AnalysisOutcome>>();
    let call = 0;
    h.runner.runWith = () => (++call === 1 ? slow.promise : Promise.resolve({ ok: true, value: outcome() }));
    const run = actions.enterDemo('complete');
    await flush();
    expect(h.store.getState().analysis).toMatchObject({ status: 'running', range: '30d' });
    await actions.selectRange('7d');
    expect(h.runner.signals[0]?.aborted).toBe(true);
    expect(h.runner.signals[1]?.aborted).toBe(false);
    const after = h.store.getState();
    expect(after.analysis).toMatchObject({ status: 'ready', range: '7d' });
    slow.resolve({ ok: true, value: outcome('worker-error') });
    await run;
    await flush();
    expect(h.store.getState()).toBe(after);
    expect(after.load.status).toBe('ready');
  });

  it('two quick range changes: only the last one lands', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    const d7 = deferred<Result<AnalysisOutcome>>();
    h.runner.runWith = (job) => (job.analytics.range === '7d' ? d7.promise : Promise.resolve({ ok: true, value: outcome() }));
    const a = actions.selectRange('7d');
    const b = actions.selectRange('90d');
    await b;
    const after = h.store.getState();
    d7.resolve({ ok: true, value: outcome() });
    await a;
    expect(h.store.getState()).toBe(after);
    expect(after.analysis.range).toBe('90d');
  });

  it('selectRange without a snapshot only changes the range', async () => {
    const { h, actions } = setup();
    await actions.selectRange('7d');
    expect(h.store.getState().range).toBe('7d');
    expect(h.runner.jobs).toHaveLength(0);
    expect(h.events.map((e) => e.type)).toEqual(['range/selected']);
  });

  it('range changed during a load is used by that load’s analysis', async () => {
    const { h, actions } = setup();
    const pending = deferred<CollectionRead>();
    h.demo('complete').repo.readWith = (req) => (req.collection === POST ? pending.promise : Promise.resolve(defaultRead(req)));
    const run = actions.enterDemo('complete');
    await flush();
    await actions.selectRange('all');
    expect(h.runner.jobs).toHaveLength(0);
    pending.resolve(defaultRead({ ...h.demo('complete').repo.listCalls[0]! }));
    await run;
    expect(h.runner.jobs.map((j) => j.analytics.range)).toEqual(['all']);
    expect(h.store.getState().analysis).toMatchObject({ status: 'ready', range: 'all' });
  });
});

describe('start', () => {
  it('auth null → auth/unavailable (unsupported); demo still loads', async () => {
    const { h, actions } = setup(null);
    await actions.start();
    const s = h.store.getState();
    expect(s.auth.status).toBe('unavailable');
    expect(s.auth.failure).toMatchObject({ kind: 'unsupported', message: 'Live sign-in is not available in this build.' });
    expect(s.notices.map((n) => n.code)).toContain('auth-unavailable');
    await actions.enterDemo('complete');
    expect(h.store.getState().snapshot?.mode).toBe('demo');
  });

  it('with a restored session → live load for exactly that DID', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID)];
    await actions.start();
    const s = h.store.getState();
    expect(s.auth).toMatchObject({ status: 'ready', failure: null });
    expect(s.auth.disclosure).toBe(h.auth!.disclosure);
    expect(s.mode).toBe('live');
    expect(s.activeDid).toBe(LIVE_DID);
    expect(s.snapshot?.account.did).toBe(LIVE_DID);
    expect(h.live.accounts.verifyCalls.map((c) => c.session)).toEqual([oauthSession(LIVE_DID)]);
    expect(h.live.repo.listCalls.every((c) => c.did === LIVE_DID && c.session.did === LIVE_DID)).toBe(true);
    expect(s.accounts).toEqual([linked(LIVE_DID)]);
    expect(h.auth!.calls.slice(0, 2)).toEqual(['onSessionEnded', 'init']);
  });

  it('with no session → no load', async () => {
    const { h, actions } = setup();
    h.live.accounts.accounts = [linked(LIVE_DID, 'needs-sign-in')];
    await actions.start();
    const s = h.store.getState();
    expect(s.auth.status).toBe('ready');
    expect(s.load.status).toBe('idle');
    expect(s.accounts).toEqual([linked(LIVE_DID, 'needs-sign-in')]);
    expect(h.live.accounts.verifyCalls).toHaveLength(0);
  });

  it('auth.init fails → auth/unavailable with the failure', async () => {
    const { h, actions } = setup();
    const f = failure('auth', 'Sign-in is not available in this browser.');
    h.auth!.initWith = async () => ({ ok: false, failure: f });
    await actions.start();
    const s = h.store.getState();
    expect(s.auth.status).toBe('unavailable');
    expect(s.auth.failure).toBe(f);
    expect(s.load.status).toBe('idle');
  });

  it('auth.init ok with a problem and no session → ready, failure = problem, no load', async () => {
    const { h, actions } = setup();
    const problem = failure('auth', 'Your earlier sign-in could not be restored or completed. Sign in again to continue.');
    h.auth!.initWith = async () => ({ ok: true, value: { session: null, via: 'none', problem } });
    await actions.start();
    const s = h.store.getState();
    expect(s.auth.status).toBe('ready');
    expect(s.auth.failure).toBe(problem);
    expect(s.auth.signInPending).toBe(false);
    expect(s.load.status).toBe('idle');
  });

  it('storage failure → storage-unavailable warning', async () => {
    const { h, actions } = setup();
    h.live.accounts.storageFailureValue = failure('storage');
    await actions.start();
    const n = h.store.getState().notices.find((x) => x.code === 'storage-unavailable');
    expect(n?.level).toBe('warning');
    expect(n?.message.length).toBeGreaterThan(0);
  });

  it('auth.init throwing does not reject start', async () => {
    const { h, actions } = setup();
    h.auth!.initWith = () => Promise.reject(new Error('library bug'));
    await expect(actions.start()).resolves.toBeUndefined();
    expect(h.store.getState().auth.status).toBe('unavailable');
  });

  it('calling start twice is a no-op the second time', async () => {
    const { h, actions } = setup();
    await actions.start();
    await actions.start();
    expect(h.auth!.calls.filter((c) => c === 'init')).toHaveLength(1);
    expect(h.auth!.listenerCount()).toBe(1);
  });
});

describe('signIn', () => {
  it('failure → auth.failure set and signInPending false', async () => {
    const { h, actions } = setup();
    await actions.start();
    let pendingDuring = false;
    h.auth!.signInWith = async () => {
      pendingDuring = h.store.getState().auth.signInPending;
      return { ok: false, failure: failure('validation', 'bad handle') };
    };
    await actions.signIn('alice.test');
    expect(pendingDuring).toBe(true);
    const s = h.store.getState();
    expect(s.auth.signInPending).toBe(false);
    expect(s.auth.failure).toMatchObject({ kind: 'validation' });
    expect(h.auth!.calls).toContain('signIn:alice.test');
  });

  it('while auth is not ready → no call to auth.signIn', async () => {
    const { h, actions } = setup();
    await actions.signIn('alice.test');
    expect(h.auth!.calls).not.toContain('signIn:alice.test');
    const none = setup(null);
    await none.actions.start();
    await expect(none.actions.signIn('alice.test')).resolves.toBeUndefined();
  });
});

describe('switchAccount', () => {
  it('restore ok → loads that DID', async () => {
    const { h, actions } = setup();
    await actions.start();
    await actions.switchAccount(OTHER_DID);
    const s = h.store.getState();
    expect(h.auth!.calls).toContain(`restore:${OTHER_DID}`);
    expect(s.mode).toBe('live');
    expect(s.activeDid).toBe(OTHER_DID);
    expect(s.snapshot?.account.did).toBe(OTHER_DID);
  });

  it('restore fails → no load, account marked', async () => {
    const { h, actions } = setup();
    h.live.accounts.accounts = [linked(OTHER_DID)];
    await actions.start();
    h.auth!.restoreWith = async () => ({ ok: false, failure: failure('auth', 'This account needs to sign in again.') });
    await actions.switchAccount(OTHER_DID);
    const s = h.store.getState();
    expect(s.load.status).toBe('idle');
    expect(h.live.accounts.verifyCalls).toHaveLength(0);
    expect(s.accounts.find((a) => a.did === OTHER_DID)?.status).toBe('needs-sign-in');
    expect(s.auth.failure).toMatchObject({ kind: 'auth' });
  });
});

describe('signOut / removeAccount', () => {
  it('signOut of the active account clears data without the session-ended notice and marks the account', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID)];
    await actions.start();
    expect(h.store.getState().snapshot).not.toBeNull();
    await actions.signOut(LIVE_DID);
    const s = h.store.getState();
    expect(s.snapshot).toBeNull();
    expect(s.mode).toBe('none');
    expect(s.accounts[0]?.status).toBe('needs-sign-in');
    expect(s.notices.map((n) => n.code)).not.toContain('session-ended');
  });

  it('signOut still clears local state when auth.signOut fails or throws', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID)];
    await actions.start();
    h.auth!.signOutWith = () => Promise.reject(new Error('network'));
    await expect(actions.signOut(LIVE_DID)).resolves.toBeUndefined();
    expect(h.store.getState().snapshot).toBeNull();
    expect(h.store.getState().accounts[0]?.status).toBe('needs-sign-in');
  });

  it('signOut of a non-active account keeps the shown data', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID), linked(OTHER_DID)];
    await actions.start();
    const snap = h.store.getState().snapshot;
    await actions.signOut(OTHER_DID);
    expect(h.store.getState().snapshot).toBe(snap);
    expect(h.store.getState().accounts.find((a) => a.did === OTHER_DID)?.status).toBe('needs-sign-in');
  });

  it('removeAccount calls auth.signOut then accounts.remove, and clears data if it was active', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    h.live.accounts.accounts = [linked(LIVE_DID)];
    await actions.start();
    await actions.removeAccount(LIVE_DID);
    const s = h.store.getState();
    const signOutAt = h.auth!.calls.indexOf(`signOut:${LIVE_DID}`);
    expect(signOutAt).toBeGreaterThanOrEqual(0);
    expect(h.live.accounts.calls).toContain(`remove:${LIVE_DID}`);
    expect(h.live.accounts.calls.indexOf(`remove:${LIVE_DID}`)).toBeGreaterThan(h.live.accounts.calls.indexOf(`markNeedsSignIn:${LIVE_DID}`));
    expect(s.accounts).toEqual([]);
    expect(s.snapshot).toBeNull();
  });

  it('reload after signOut does not read the signed-out account', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    await actions.start();
    await actions.signOut(LIVE_DID);
    const verifies = h.live.accounts.verifyCalls.length;
    await actions.reload();
    expect(h.live.accounts.verifyCalls).toHaveLength(verifies);
  });
});

describe('demo isolation and self-only', () => {
  it('live load refuses a session with source demo', async () => {
    const { h, actions } = setup();
    h.auth!.initWith = async () => ({ ok: true, value: { session: demoSession(LIVE_DID), via: 'restore', problem: null } });
    await actions.start();
    expect(h.store.getState().mode).toBe('none');
    expect(h.live.accounts.verifyCalls).toHaveLength(0);
    expect(h.events.map((e) => e.type)).not.toContain('load/started');
  });

  it('demo load refuses ports whose session is not a demo session', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    (p as { session: unknown }).session = oauthSession(LIVE_DID);
    await actions.enterDemo('complete');
    expect(p.accounts.verifyCalls).toHaveLength(0);
    expect(h.store.getState().mode).toBe('none');
  });

  it('demo load never calls live.accounts, auth or the live repo', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    await actions.selectRange('7d');
    await actions.reload();
    actions.exitDemo();
    expect(h.live.accounts.calls).toEqual([]);
    expect(h.live.repo.listCalls).toEqual([]);
    expect(h.live.repo.describeCalls).toEqual([]);
    expect(h.live.engagement.calls).toEqual([]);
    expect(h.live.nowCalls.count).toBe(0);
    expect(h.auth!.calls).toEqual([]);
    expect(h.events.map((e) => e.type)).not.toContain('accounts/changed');
  });

  it('enterDemo builds fresh ports per call and reload re-enters the same scenario', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('partial');
    await actions.reload();
    expect(h.demoCalls).toEqual(['partial', 'partial']);
    expect(h.store.getState().load.runId).toBe(2);
    expect(h.store.getState().demoScenario).toBe('partial');
  });

  it('exitDemo drops demo data; is a no-op outside demo mode', async () => {
    const { h, actions } = setup();
    actions.exitDemo();
    expect(h.events).toEqual([]);
    await actions.enterDemo('complete');
    actions.exitDemo();
    const s = h.store.getState();
    expect(s.mode).toBe('none');
    expect(s.snapshot).toBeNull();
    expect(s.demoScenario).toBeNull();
  });

  it('exitDemo mid-load aborts the run', async () => {
    const { h, actions, snapshots } = setup();
    const pending = deferred<CollectionRead>();
    h.demo('complete').repo.readWith = () => pending.promise;
    const run = actions.enterDemo('complete');
    await flush();
    actions.exitDemo();
    pending.resolve({ records: [raw(DEMO_DID, POST, 'z')], rejected: [], coverage: coverage(POST, 1) });
    await run;
    expect(snapshots).toEqual([]);
    expect(h.store.getState().mode).toBe('none');
  });
});

describe('other actions', () => {
  it('reload in live mode re-reads the current session', async () => {
    const { h, actions } = setup();
    restoreOn(h);
    await actions.start();
    await actions.reload();
    expect(h.live.accounts.verifyCalls.map((c) => c.session.did)).toEqual([LIVE_DID, LIVE_DID]);
    expect(h.store.getState().load.runId).toBe(2);
    expect(h.store.getState().load.status).toBe('ready');
  });

  it('reload with nothing loaded is a no-op', async () => {
    const { h, actions } = setup();
    await actions.reload();
    expect(h.events).toEqual([]);
  });

  it('clearData aborts and drops data', async () => {
    const { h, actions, snapshots } = setup();
    const pending = deferred<CollectionRead>();
    h.demo('complete').repo.readWith = () => pending.promise;
    const run = actions.enterDemo('complete');
    await flush();
    actions.clearData();
    pending.resolve(defaultRead(h.demo('complete').repo.listCalls[0]!));
    await run;
    expect(snapshots).toEqual([]);
    expect(h.store.getState().load).toMatchObject({ status: 'idle', runId: 2 });
  });

  it('selectView and dismissNotice dispatch', async () => {
    const { h, actions } = setup(null);
    await actions.start();
    actions.selectView('privacy');
    actions.dismissNotice('auth-unavailable');
    const s: AppState = h.store.getState();
    expect(s.view).toBe('privacy');
    expect(s.notices).toEqual([]);
  });

  it('no action throws synchronously even if the store listener throws', async () => {
    const { h, actions } = setup();
    h.store.subscribe(() => {
      throw new Error('ui bug');
    });
    expect(() => actions.selectView('activity')).not.toThrow();
    await expect(actions.enterDemo('complete')).resolves.toBeUndefined();
    expect(h.store.getState().snapshot).not.toBeNull();
  });
});

describe('timing', () => {
  it('acquisitionMs is measured with deps.nowMs around the acquisition', async () => {
    const h = makeHarness(createAppStore(null));
    const nowMs = vi.fn<() => number>().mockReturnValueOnce(100).mockReturnValue(340);
    const actions = createAppController({ ...h.deps, nowMs });
    await actions.enterDemo('complete');
    expect(h.store.getState().load.acquisitionMs).toBe(240);
  });
});
