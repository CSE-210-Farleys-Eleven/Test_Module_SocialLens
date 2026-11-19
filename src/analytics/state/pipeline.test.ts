import { describe, expect, it } from 'vitest';
import { DEMO_BANNER_TEXT } from '../../shared/contract';
import type { AppEvent } from './contract';
import { createAppController, createAppStore } from './index';
import {
  COLLECTIONS,
  DEMO_DID,
  DOC,
  LIKE,
  LIVE_DID,
  PDS,
  POST,
  UNANALYSED,
  coverage,
  defaultRead,
  engagementCoverage,
  failure,
  identity,
  linked,
  makeHarness,
  oauthSession,
  outcome,
  raw,
  repoDescription,
  skipped,
} from './testkit';

function setup() {
  const h = makeHarness(createAppStore(null));
  const actions = createAppController(h.deps);
  return { h, actions };
}

const types = (events: readonly AppEvent[]): string[] => events.map((e) => e.type);

describe('demo happy path', () => {
  it('events arrive in order and the final state has a demo snapshot with the demo-synthetic notice', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    const seq = types(h.events).filter((t) => t !== 'load/progress');
    expect(seq).toEqual(['load/started', 'load/snapshot-ready', 'analysis/started', 'analysis/ready']);
    const progressIdx = h.events.findIndex((e) => e.type === 'load/progress');
    expect(progressIdx).toBeGreaterThan(0);
    expect(h.events.findIndex((e) => e.type === 'load/snapshot-ready')).toBeGreaterThan(progressIdx);
    const phases = h.events.flatMap((e) => (e.type === 'load/progress' ? [e.progress.phase] : []));
    expect([...new Set(phases)]).toEqual(['verifying-account', 'reading-records', 'reading-counts', 'normalising']);

    const s = h.store.getState();
    expect(s.mode).toBe('demo');
    expect(s.demoScenario).toBe('complete');
    expect(s.activeDid).toBe(DEMO_DID);
    expect(s.load.status).toBe('ready');
    expect(s.load.acquisitionMs).toBeGreaterThan(0);
    expect(s.snapshot?.mode).toBe('demo');
    expect(s.snapshot?.demoScenario).toBe('complete');
    expect(s.snapshot?.schemaVersion).toBe(1);
    expect(s.snapshot?.notices[0]).toEqual({ code: 'demo-synthetic', level: 'info', message: DEMO_BANNER_TEXT });
    expect(s.snapshot?.notices.map((n) => n.code)).not.toContain('non-atomic-read');
    expect(s.analysis.status).toBe('ready');
    expect(s.analysis.range).toBe('30d');
    expect(s.analysis.ranIn).toBe('worker');
  });

  it('reading-records progress names each collection with done/total', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    const reads = h.events.flatMap((e) => (e.type === 'load/progress' && e.progress.phase === 'reading-records' ? [e.progress] : []));
    expect(reads.map((p) => [p.collection, p.done, p.total])).toEqual([
      [POST, 0, 3],
      [LIKE, 1, 3],
      [DOC, 2, 3],
    ]);
  });

  it('builds the analysis job from the snapshot, registry data and options with the current range', async () => {
    const { h, actions } = setup();
    await actions.enterDemo('complete');
    const job = h.runner.jobs[0];
    expect(job?.jobId).toBe('1:30d');
    expect(job?.snapshot).toBe(h.store.getState().snapshot);
    expect(job?.registry).toBe(h.registry.data);
    expect(job?.analytics).toEqual({ ...h.deps.analytics, range: '30d' });
    expect(job?.privacy).toBe(h.deps.privacy);
  });
});

describe('reads', () => {
  it('listCollection is called once per present collection in registry order with the session DID, PDS, pageSize and maxPages', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    await actions.enterDemo('complete');
    expect(p.repo.listCalls.map((c) => c.collection)).toEqual([POST, LIKE, DOC]);
    for (const [i, c] of p.repo.listCalls.entries()) {
      expect(c.did).toBe(DEMO_DID);
      expect(c.session).toBe(p.session);
      expect(c.pdsOrigin).toBe(PDS);
      expect(c.pageSize).toBe(COLLECTIONS[i]?.pageSize);
      expect(c.maxPages).toBe(10);
      expect(c.onProgress).toBeNull();
      expect(c.signal).toBeInstanceOf(AbortSignal);
    }
    expect(p.accounts.verifyCalls[0]?.session).toBe(p.session);
  });

  it('an absent collection gets not-present coverage and no listCollection call', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    p.accounts.verifyWith = async (req) => ({
      ok: true,
      value: { identity: identity(req.session.did), repo: repoDescription(req.session.did, [POST, DOC, UNANALYSED]), repoFailure: null },
    });
    await actions.enterDemo('complete');
    expect(p.repo.listCalls.map((c) => c.collection)).toEqual([POST, DOC]);
    const snap = h.store.getState().snapshot;
    expect(snap?.coverage.map((c) => c.collection)).toEqual([POST, LIKE, DOC]);
    expect(snap?.coverage[1]).toEqual({
      collection: LIKE,
      status: 'complete',
      reasonCode: 'not-present',
      reason: 'Your repository has no records in this collection (an observed zero).',
      pagesFetched: 0,
      returned: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      failure: null,
    });
    expect(snap?.inventoryStatus).toBe('known');
    expect(snap?.unanalysedCollections).toEqual([UNANALYSED]);
    expect(h.registry.inventoryCalls).toEqual([[POST, DOC, UNANALYSED]]);
  });

  it('describeRepo failed (repo: null) → every registered collection is read, inventory unknown, inventory-unknown notice', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    p.accounts.verifyWith = async (req) => ({
      ok: true,
      value: { identity: identity(req.session.did), repo: null, repoFailure: failure('network') },
    });
    await actions.enterDemo('complete');
    expect(p.repo.listCalls.map((c) => c.collection)).toEqual([POST, LIKE, DOC]);
    const snap = h.store.getState().snapshot;
    expect(snap?.inventoryStatus).toBe('unknown');
    expect(snap?.unanalysedCollections).toEqual([]);
    expect(snap?.notices.find((n) => n.code === 'inventory-unknown')).toEqual({
      code: 'inventory-unknown',
      level: 'warning',
      message: "Your repository's collection list could not be read; collections that are present but not analysed cannot be listed.",
    });
    expect(h.registry.inventoryCalls).toEqual([]);
  });

  it('adapter coverage is stored unchanged', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    const partial = { ...coverage(LIKE, 1, 'partial'), failure: failure('timeout') };
    p.repo.readWith = async (req) => (req.collection === LIKE ? { records: [raw(req.did, LIKE, 'x')], rejected: [], coverage: partial } : defaultRead(req));
    await actions.enterDemo('complete');
    expect(h.store.getState().snapshot?.coverage[1]).toBe(partial);
  });
});

describe('counts and normalisation', () => {
  it('getCounts receives only URIs from collections with an engagement source, in read order', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    await actions.enterDemo('complete');
    expect(p.engagement.calls).toHaveLength(1);
    const call = p.engagement.calls[0];
    expect(call?.uris).toEqual([raw(DEMO_DID, POST, 'a').uri, raw(DEMO_DID, POST, 'b').uri]);
    expect(call?.session).toBe(p.session);
  });

  it('forwards count batch progress as load/progress', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    p.engagement.countsWith = async (req) => {
      req.onProgress?.({ batch: 1, batches: 2 });
      req.onProgress?.({ batch: 2, batches: 2 });
      return { results: [], coverage: engagementCoverage(0) };
    };
    await actions.enterDemo('complete');
    const counts = h.events.flatMap((e) => (e.type === 'load/progress' && e.progress.phase === 'reading-counts' ? [e.progress] : []));
    expect(counts.map((c) => [c.done, c.total])).toEqual([
      [0, 0],
      [1, 2],
      [2, 2],
    ]);
  });

  it('normalize receives all raw records and the lookup results; skipped = fetch rejects then normalize skips', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    const fetchRejects = [skipped(POST, 'fetch', 'post reject'), skipped(DOC, 'fetch', 'doc reject')];
    p.repo.readWith = async (req) => {
      const base = defaultRead(req);
      const rejected = req.collection === POST ? [fetchRejects[0]!] : req.collection === DOC ? [fetchRejects[1]!] : [];
      return { ...base, rejected };
    };
    h.normalizer.skipRkeys = ['b'];
    await actions.enterDemo('complete');
    const input = h.normalizer.calls[0];
    expect(input?.did).toBe(DEMO_DID);
    expect(input?.records.map((r) => r.uri)).toEqual(
      [POST, LIKE, DOC].flatMap((c) => [raw(DEMO_DID, c, 'a').uri, raw(DEMO_DID, c, 'b').uri]),
    );
    expect(input?.engagement).toHaveLength(2);
    const snap = h.store.getState().snapshot;
    expect(snap?.records).toHaveLength(3);
    expect(snap?.skipped.map((s) => s.detail)).toEqual(['post reject', 'doc reject', 'norm b', 'norm b', 'norm b']);
    expect(snap?.notices.find((n) => n.code === 'records-skipped')).toEqual({
      code: 'records-skipped',
      level: 'info',
      message: '5 record(s) could not be interpreted and were set aside with a reason.',
    });
  });

  it('snapshot.fetchedAt comes from ports.now() and engagementCoverage from the lookup', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    const cov = engagementCoverage(2);
    p.engagement.countsWith = async () => ({ results: [], coverage: cov });
    await actions.enterDemo('complete');
    const snap = h.store.getState().snapshot;
    expect(p.nowCalls.count).toBe(1);
    expect(snap?.fetchedAt).toBe('2026-11-18T12:00:00.000Z');
    expect(snap?.engagementCoverage).toBe(cov);
    expect(snap?.account).toEqual(identity(DEMO_DID));
  });
});

describe('notices', () => {
  it('a clean live load has only non-atomic-read', async () => {
    const { h, actions } = setup();
    h.auth!.initWith = async () => ({ ok: true, value: { session: oauthSession(), via: 'restore', problem: null } });
    await actions.start();
    const snap = h.store.getState().snapshot;
    expect(snap?.mode).toBe('live');
    expect(snap?.demoScenario).toBeNull();
    expect(snap?.notices).toEqual([
      {
        code: 'non-atomic-read',
        level: 'info',
        message: 'Live reads happen one after another, not as one atomic snapshot; records can change while reading.',
      },
    ]);
  });

  it('partial coverage, unknown counters and an invalid handle add their notices, in the documented order', async () => {
    const { h, actions } = setup();
    const p = h.demo('partial');
    p.accounts.verifyWith = async (req) => ({
      ok: true,
      value: { identity: identity(req.session.did, 'invalid'), repo: repoDescription(req.session.did, [POST, LIKE, DOC]), repoFailure: null },
    });
    p.repo.readWith = async (req) => (req.collection === LIKE ? { records: [], rejected: [skipped(LIKE, 'fetch', 'x')], coverage: coverage(LIKE, 0, 'partial') } : defaultRead(req));
    p.engagement.countsWith = async (req) => ({ results: [], coverage: engagementCoverage(req.uris.length, 1) });
    await actions.enterDemo('partial');
    const notices = h.store.getState().snapshot?.notices ?? [];
    expect(notices.map((n) => n.code)).toEqual([
      'demo-synthetic',
      'coverage-incomplete',
      'engagement-incomplete',
      'records-skipped',
      'handle-not-valid',
    ]);
    expect(notices[1]).toEqual({
      code: 'coverage-incomplete',
      level: 'warning',
      message: 'Some collections are partial or unavailable. Their numbers are lower bounds or unknown.',
    });
    expect(notices[2]).toEqual({
      code: 'engagement-incomplete',
      level: 'warning',
      message: 'Some interaction counters could not be read. They are shown as unknown, not zero.',
    });
    expect(notices[4]).toEqual({ code: 'handle-not-valid', level: 'warning', message: "This account's handle could not be confirmed." });
  });
});

describe('failures', () => {
  it('verify fails → load/failed with that failure, no listCollection call, accounts list refreshed (live)', async () => {
    const { h, actions } = setup();
    h.auth!.initWith = async () => ({ ok: true, value: { session: oauthSession(), via: 'restore', problem: null } });
    const f = failure('network', 'could not resolve');
    h.live.accounts.verifyWith = async () => {
      h.live.accounts.accounts = [linked(LIVE_DID, 'could-not-verify')];
      return { ok: false, failure: f };
    };
    await actions.start();
    const s = h.store.getState();
    expect(s.load.status).toBe('failed');
    expect(s.load.failure).toBe(f);
    expect(s.snapshot).toBeNull();
    expect(h.live.repo.listCalls).toHaveLength(0);
    const afterVerify = h.events.slice(h.events.findIndex((e) => e.type === 'load/started'));
    expect(types(afterVerify)).toContain('accounts/changed');
    expect(types(afterVerify).indexOf('accounts/changed')).toBeLessThan(types(afterVerify).indexOf('load/failed'));
    expect(s.accounts).toEqual([linked(LIVE_DID, 'could-not-verify')]);
    expect(h.runner.jobs).toHaveLength(0);
  });

  it('demo verify failure does not touch live accounts', async () => {
    const { h, actions } = setup();
    const p = h.demo('complete');
    p.accounts.verifyWith = async () => ({ ok: false, failure: failure('network') });
    await actions.enterDemo('complete');
    expect(h.store.getState().load.status).toBe('failed');
    expect(types(h.events)).not.toContain('accounts/changed');
    expect(h.live.accounts.calls).toEqual([]);
  });

  it('runner returns err → analysis/failed; snapshot is still shown', async () => {
    const { h, actions } = setup();
    h.runner.runWith = async () => ({ ok: false, failure: failure('internal', 'The analysis could not be completed.') });
    await actions.enterDemo('complete');
    const s = h.store.getState();
    expect(s.analysis.status).toBe('failed');
    expect(s.analysis.failure?.kind).toBe('internal');
    expect(s.snapshot).not.toBeNull();
    expect(s.load.status).toBe('ready');
  });

  it('runner reports worker-timeout → analysis-fallback notice; worker-unavailable → no notice', async () => {
    const a = setup();
    a.h.runner.runWith = async () => ({ ok: true, value: outcome('worker-timeout') });
    await a.actions.enterDemo('complete');
    expect(a.h.store.getState().analysis.fallbackReason).toBe('worker-timeout');
    expect(a.h.store.getState().notices).toContainEqual({
      code: 'analysis-fallback',
      level: 'info',
      message: 'Analysis ran on the main thread because the background worker did not answer.',
    });
    const b = setup();
    b.h.runner.runWith = async () => ({ ok: true, value: outcome('worker-unavailable') });
    await b.actions.enterDemo('complete');
    expect(b.h.store.getState().analysis.ranIn).toBe('main-thread');
    expect(b.h.store.getState().notices.map((n) => n.code)).not.toContain('analysis-fallback');
  });

  it('a port that throws a non-abort error → load/failed with kind internal; the action resolves', async () => {
    const { h, actions } = setup();
    h.demo('complete').repo.readWith = async () => {
      throw new TypeError('bug');
    };
    await expect(actions.enterDemo('complete')).resolves.toBeUndefined();
    const s = h.store.getState();
    expect(s.load.status).toBe('failed');
    expect(s.load.failure).toEqual({
      kind: 'internal',
      message: 'Something went wrong while reading this account.',
      status: null,
      xrpcError: null,
      retryAfterMs: null,
      origin: null,
    });
  });

  it('a normalizer that throws → load/failed internal', async () => {
    const { h, actions } = setup();
    h.normalizer.throwWith = new Error('bug');
    await actions.enterDemo('complete');
    expect(h.store.getState().load.failure?.kind).toBe('internal');
  });

  it('a runner that throws a non-abort error → analysis/failed internal, snapshot kept', async () => {
    const { h, actions } = setup();
    h.runner.runWith = async () => {
      throw new Error('bug');
    };
    await expect(actions.enterDemo('complete')).resolves.toBeUndefined();
    const s = h.store.getState();
    expect(s.analysis.status).toBe('failed');
    expect(s.analysis.failure?.kind).toBe('internal');
    expect(s.snapshot).not.toBeNull();
  });

  it('a demo factory that throws → load does not start and the action resolves', async () => {
    const h = makeHarness(createAppStore(null));
    const before = h.store.getState();
    const actions = createAppController({
      ...h.deps,
      demo: () => {
        throw new Error('fixtures broken');
      },
    });
    await expect(actions.enterDemo('complete')).resolves.toBeUndefined();
    expect(h.store.getState()).toBe(before);
  });
});
