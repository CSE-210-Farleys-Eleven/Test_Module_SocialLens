/**
 * IT-1, IT-2, IT-3, IT-9, IT-10 (docs/architecture/PLAN.md §11):
 * the real modules, wired as in the app, run over the synthetic fixture server.
 */
import { describe, expect, it } from 'vitest';
import { compose } from './harness';
import { LIMITS, ORIGINS } from '../../src/shared';
import { DEMO_ACCOUNT } from '../../src/adapters/fixtures';
import type { ComposedApp } from '../../src/compose';
import type { AnalysisJob } from '../../src/analytics/worker/contract';

async function load(scenario: 'complete' | 'partial' | 'empty', range: '7d' | '30d' | '90d' | 'all' = 'all') {
  const app = compose();
  await app.actions.enterDemo(scenario);
  if (app.store.getState().range !== range) await app.actions.selectRange(range);
  const state = app.store.getState();
  if (state.snapshot === null || state.analysis.result === null) throw new Error(`no result: ${JSON.stringify(state.load)} ${JSON.stringify(state.analysis.failure)}`);
  return { app, state, snapshot: state.snapshot, analytics: state.analysis.result.analytics, privacy: state.analysis.result.privacy, manifest: app.fixtures.manifest(scenario) };
}

const coverageOf = (snapshot: { coverage: readonly { collection: string }[] }, nsid: string) => {
  const row = snapshot.coverage.find((c) => c.collection === nsid);
  if (row === undefined) throw new Error(`no coverage row for ${nsid}`);
  return row as (typeof snapshot.coverage)[number] & { status: string; reasonCode: string; accepted: number; pagesFetched: number };
};

function jobOf(app: ComposedApp): AnalysisJob {
  const state = app.store.getState();
  if (state.snapshot === null) throw new Error('no snapshot');
  return {
    jobId: 'parity',
    snapshot: state.snapshot,
    registry: app.registry.data,
    analytics: { range: state.range, topPosts: LIMITS.topPosts, settlingHours: LIMITS.settlingHours, timelineMaxDays: LIMITS.timelineMaxDays, textPreviewChars: LIMITS.textPreviewChars },
    privacy: { sampleUris: LIMITS.sampleUris, patternMinItems: LIMITS.patternMinItems, patternBandHours: LIMITS.patternBandHours, patternShareThreshold: LIMITS.patternShareThreshold },
  };
}

describe('IT-1 demo "complete", range all', () => {
  it('reads every collection completely and matches the fixture manifest', async () => {
    const { state, snapshot, manifest } = await load('complete');
    expect(state.load.status).toBe('ready');
    expect(state.mode).toBe('demo');
    expect(snapshot.mode).toBe('demo');
    expect(snapshot.records).toHaveLength(214);
    expect(snapshot.skipped).toHaveLength(0);
    expect(snapshot.coverage).toHaveLength(10);
    expect(snapshot.coverage.every((c) => c.status === 'complete')).toBe(true);
    for (const expected of manifest.collections) {
      const row = coverageOf(snapshot, expected.collection);
      expect([row.collection, row.status, row.reasonCode, row.accepted]).toEqual([expected.collection, expected.expectedStatus, expected.expectedReasonCode, expected.servedValid]);
    }
    expect([...snapshot.unanalysedCollections].sort()).toEqual([...manifest.presentNotAnalysed].sort());
    expect(snapshot.unanalysedCollections).toHaveLength(2);
    expect(snapshot.engagementCoverage).toMatchObject({ status: 'complete', requested: 120, known: 120, unknown: 0 });
    expect(snapshot.notices.map((n) => n.code)).toContain('demo-synthetic');
    expect(snapshot.account).toMatchObject({ did: DEMO_ACCOUNT.did, handle: DEMO_ACCOUNT.handle, handleStatus: 'valid', pdsOrigin: DEMO_ACCOUNT.pdsOrigin });
  });

  it('computes exact totals and pooled interactions per post from the manifest numbers', async () => {
    const { analytics, manifest } = await load('complete');
    expect(analytics.overview.recordsTotal).toMatchObject({ value: 214, status: 'exact' });
    expect(analytics.overview.contentItems).toMatchObject({ value: 124, status: 'exact' });
    const totals = manifest.countTotals;
    const sum = totals.likes + totals.reposts + totals.replies + totals.quotes;
    expect(analytics.engagement.interactions.value).toBe(sum);
    expect(analytics.engagement.likes.value).toBe(totals.likes);
    expect(analytics.engagement.knownPosts).toBe(120);
    expect(analytics.engagement.interactionsPerPost).toMatchObject({ status: 'settling', numerator: sum, denominator: 120 });
    expect(analytics.engagement.interactionsPerPost.value).toBeCloseTo(sum / 120, 10);
    // Standard.site has no counters: that is "not available", never zero.
    expect(analytics.engagement.perApp.find((a) => a.appId === 'standard-site')).toMatchObject({ available: false });
  });

  it('produces the expected evidence-backed privacy observations', async () => {
    const { privacy } = await load('complete');
    const byId = new Map(privacy.observations.map((o) => [o.id, o]));
    expect(byId.get('public-likes')?.evidence).toMatchObject({ count: 40, countCertainty: 'exact' });
    expect(byId.get('public-follows')?.evidence).toMatchObject({ count: 25, countCertainty: 'exact' });
    expect(byId.get('public-blocks')?.evidence).toMatchObject({ count: 3, countCertainty: 'exact' });
    expect(byId.get('public-lists')?.evidence).toMatchObject({ count: 8, countCertainty: 'exact' });
    expect(byId.has('cross-app-identity')).toBe(true);
    expect(byId.has('posting-time-pattern')).toBe(true);
    // Two advertised collections are not analysed, so the view is honestly "not the whole footprint".
    expect(byId.has('incomplete-coverage')).toBe(true);
    expect(byId.has('handle-validity')).toBe(false);
    expect(privacy.notTriggered.map((n) => n.id)).toEqual(['handle-validity']);
    for (const observation of privacy.observations) {
      expect(observation.limitation.length).toBeGreaterThan(20);
      expect(observation.action.length).toBeGreaterThan(20);
      expect(observation.source.url.startsWith('https://')).toBe(true);
      for (const uri of observation.evidence.sampleUris) expect(uri.startsWith(`at://${DEMO_ACCOUNT.did}/`)).toBe(true);
    }
  });

  it('sends only unauthenticated GETs to the three expected origins: 18 requests', async () => {
    const { app } = await load('complete');
    const log = app.lastDemoServer()?.requests() ?? [];
    expect(log).toHaveLength(18);
    const path = (url: string) => new URL(url).pathname;
    expect(log.filter((r) => new URL(r.url).origin === ORIGINS.plcDirectory)).toHaveLength(1);
    expect(log.filter((r) => path(r.url).endsWith('com.atproto.repo.describeRepo'))).toHaveLength(1);
    expect(log.filter((r) => path(r.url).endsWith('com.atproto.repo.listRecords'))).toHaveLength(11);
    expect(log.filter((r) => path(r.url).endsWith('app.bsky.feed.getPosts'))).toHaveLength(5);
    expect(log.filter((r) => r.unexpected)).toEqual([]);
    expect(log.every((r) => r.method === 'GET' && r.credentials === 'omit' && !r.hadAuthorization)).toBe(true);
    const origins = new Set(log.map((r) => new URL(r.url).origin));
    expect([...origins].sort()).toEqual([DEMO_ACCOUNT.pdsOrigin, ORIGINS.plcDirectory, ORIGINS.appView].sort());
  });
});

describe('IT-2 demo "partial": uncertainty survives end to end', () => {
  it('reports per-collection coverage exactly as the manifest says', async () => {
    const { snapshot, manifest, app } = await load('partial');
    for (const expected of manifest.collections) {
      const row = coverageOf(snapshot, expected.collection);
      expect([row.collection, row.status, row.reasonCode]).toEqual([expected.collection, expected.expectedStatus, expected.expectedReasonCode]);
    }
    expect(coverageOf(snapshot, 'app.bsky.feed.post')).toMatchObject({ status: 'partial', reasonCode: 'records-rejected' });
    expect(coverageOf(snapshot, 'app.bsky.feed.like')).toMatchObject({ status: 'partial', reasonCode: 'later-page-failed', accepted: 100 });
    expect(coverageOf(snapshot, 'app.bsky.graph.follow')).toMatchObject({ status: 'partial', reasonCode: 'page-cap', accepted: 1000 });
    expect(coverageOf(snapshot, 'app.bsky.graph.block')).toMatchObject({ status: 'unavailable', reasonCode: 'first-page-failed', accepted: 0 });
    // Not advertised by describeRepo → observed absent, and no listRecords request is spent on them.
    const listed = (app.lastDemoServer()?.requests() ?? []).map((r) => new URL(r.url).searchParams.get('collection'));
    for (const nsid of ['app.bsky.graph.list', 'app.bsky.graph.listitem']) {
      expect(coverageOf(snapshot, nsid)).toMatchObject({ reasonCode: 'not-present', accepted: 0 });
      expect(listed).not.toContain(nsid);
    }
    expect(app.lastDemoServer()?.requests()).toHaveLength(30);
  });

  it('never turns a failed read into zero', async () => {
    const { analytics, privacy } = await load('partial');
    const blocks = analytics.byKind.find((k) => k.kind === 'block');
    expect(blocks?.count).toMatchObject({ value: null, status: 'unknown' });
    const likes = analytics.byKind.find((k) => k.kind === 'like');
    expect(likes?.count).toMatchObject({ value: 100, status: 'partial', isLowerBound: true });
    expect(privacy.observations.map((o) => o.id)).not.toContain('public-blocks');
    expect(privacy.notTriggered.find((n) => n.id === 'public-blocks')?.reason).toMatch(/could not be read/i);
    expect(privacy.observations.map((o) => o.id)).toContain('handle-validity');
    expect(privacy.observations.find((o) => o.id === 'public-likes')?.evidence).toMatchObject({ count: 100, countCertainty: 'lower-bound' });
  });

  it('keeps every unusable record in the skipped bucket and flags incomplete counters', async () => {
    const { snapshot, analytics, manifest } = await load('partial');
    expect(snapshot.skipped.filter((s) => s.stage === 'fetch')).toHaveLength(2);
    expect(snapshot.skipped.filter((s) => s.stage === 'normalize')).toHaveLength(manifest.expectedNormalizeSkips);
    expect(snapshot.skipped).toHaveLength(3);
    for (const skipped of snapshot.skipped) expect(skipped.detail.length).toBeGreaterThan(0);
    expect(snapshot.engagementCoverage).toMatchObject({ status: 'partial', known: 34 });
    expect(analytics.engagement).toMatchObject({ eligiblePosts: 59, knownPosts: 34, unknownPosts: 25 });
    expect(analytics.engagement.interactions.status).toBe('partial');
    const codes = snapshot.notices.map((n) => n.code);
    for (const code of ['coverage-incomplete', 'engagement-incomplete', 'records-skipped', 'handle-not-valid']) expect(codes).toContain(code);
  });
});

describe('IT-3 demo "empty": an observed zero is a real zero', () => {
  it('makes two requests and reports exact zeros, unknown ratio, no observations', async () => {
    const { app, snapshot, analytics, privacy } = await load('empty');
    expect(app.lastDemoServer()?.requests()).toHaveLength(2);
    expect(snapshot.records).toHaveLength(0);
    expect(analytics.overview.recordsTotal).toMatchObject({ value: 0, status: 'exact' });
    expect(analytics.overview.contentItems).toMatchObject({ value: 0, status: 'exact' });
    for (const row of analytics.byKind) expect(row.count).toMatchObject({ value: 0, status: 'exact' });
    expect(analytics.engagement.interactionsPerPost).toMatchObject({ value: null, status: 'unknown' });
    expect(privacy.observations).toHaveLength(0);
    expect(privacy.notTriggered).toHaveLength(8);
  });
});

describe('IT-9 worker parity', () => {
  it('gives the same result for a structured-cloned job, and reports the main-thread fallback', async () => {
    const { app, state } = await load('complete');
    const job = jobOf(app);
    const direct = app.compute(job);
    expect(app.compute(structuredClone(job))).toEqual(direct);
    expect(structuredClone(direct)).toEqual(direct);
    expect(state.analysis.result).toEqual(direct);
    expect(state.analysis).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-unavailable' });
  });
});

describe('IT-10 determinism', () => {
  it('two independent demo runs give deep-equal snapshots and analysis', async () => {
    const first = await load('complete');
    const second = await load('complete');
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.state.analysis.result).toEqual(first.state.analysis.result);
  });
});
