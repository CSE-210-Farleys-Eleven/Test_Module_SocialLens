/**
 * The load sequence (CONTRACT.md "Controller" steps 2–9): verify → inventory → list records →
 * counts → normalise → snapshot → analyse. Pure of DOM; every port arrives as an argument.
 *
 * Cancellation (PLAN §8): `signal.throwIfAborted()` after every await. The caller catches;
 * an aborted run dispatches nothing more. The reducer's runId guard is the second line.
 */
import { DEMO_BANNER_TEXT, makeFailure } from '../../shared';
import type { AtUri, Coverage, Nsid, Notice, RangeId, RawRecord, SessionRef, SkippedRecord, Snapshot } from '../../shared/contract';
import type { DemoScenarioId } from '../../adapters/fixtures/contract';
import type { Normalizer } from '../../normalize/contract';
import type { Registry } from '../../registry/contract';
import type { AnalyticsOptions } from '../contract';
import type { PrivacyOptions } from '../privacy/contract';
import type { AnalysisRunner } from '../worker/contract';
import type { AppEvent, AppState, DataPorts, LoadPhase, LoadProgress } from './contract';

export interface PipelineContext {
  readonly dispatch: (event: AppEvent) => void;
  readonly getState: () => AppState;
  readonly registry: Registry;
  readonly normalizer: Normalizer;
  readonly runner: AnalysisRunner;
  readonly analytics: Omit<AnalyticsOptions, 'range'>;
  readonly privacy: PrivacyOptions;
  readonly maxPagesPerCollection: number;
  readonly nowMs: () => number;
}

export interface AcquireRequest {
  readonly runId: number;
  readonly mode: 'live' | 'demo';
  readonly session: SessionRef;
  readonly ports: DataPorts;
  readonly scenario: DemoScenarioId | null;
  readonly signal: AbortSignal;
}

const NOT_PRESENT_REASON = 'Your repository has no records in this collection (an observed zero).';

const NOTICE_TEXT = {
  nonAtomic: 'Live reads happen one after another, not as one atomic snapshot; records can change while reading.',
  coverage: 'Some collections are partial or unavailable. Their numbers are lower bounds or unknown.',
  inventory: "Your repository's collection list could not be read; collections that are present but not analysed cannot be listed.",
  engagement: 'Some interaction counters could not be read. They are shown as unknown, not zero.',
  handle: "This account's handle could not be confirmed.",
} as const;

const ANALYSIS_FALLBACK_NOTICE: Notice = {
  code: 'analysis-fallback',
  level: 'info',
  message: 'Analysis ran on the main thread because the background worker did not answer.',
};

const PHASE_MESSAGE: Readonly<Record<LoadPhase, string>> = {
  'verifying-account': 'Checking which account this is and where its data lives…',
  'reading-records': 'Reading your public records…',
  'reading-counts': 'Reading public interaction counters for your posts…',
  normalising: 'Interpreting the records…',
};

function progress(phase: LoadPhase, done: number, total: number, collection: Nsid | null = null): LoadProgress {
  return { phase, collection, done, total, message: PHASE_MESSAGE[phase] };
}

function notPresentCoverage(collection: Nsid): Coverage {
  return {
    collection,
    status: 'complete',
    reasonCode: 'not-present',
    reason: NOT_PRESENT_REASON,
    pagesFetched: 0,
    returned: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    failure: null,
  };
}

/**
 * Steps 2–8. Resolves with the published snapshot, or null when verification failed
 * (then `load/failed` has been dispatched). Rejects with the abort reason when aborted,
 * or with any unexpected error (the controller turns it into an `internal` failure).
 */
export async function acquire(ctx: PipelineContext, req: AcquireRequest): Promise<Snapshot | null> {
  const { runId, mode, session, ports, signal } = req;
  const t0 = ctx.nowMs();
  const report = (p: LoadProgress): void => {
    if (!signal.aborted) ctx.dispatch({ type: 'load/progress', runId, progress: p });
  };

  // 2. Verify the account (always session.did; accounts.verify takes no target).
  report(progress('verifying-account', 0, 1));
  const verified = await ports.accounts.verify({ session, signal });
  signal.throwIfAborted();
  if (mode === 'live') ctx.dispatch({ type: 'accounts/changed', accounts: ports.accounts.list() });
  if (!verified.ok) {
    ctx.dispatch({ type: 'load/failed', runId, failure: verified.failure });
    return null;
  }
  const { identity, repo } = verified.value;

  // 3. Inventory.
  const inventory = repo !== null ? ctx.registry.inventory(repo.collections) : null;
  const inventoryStatus: Snapshot['inventoryStatus'] = inventory !== null ? 'known' : 'unknown';

  // 4. Read every analysed collection, in registry order, sequentially.
  const definitions = ctx.registry.analysedCollections();
  const allRaw: RawRecord[] = [];
  const countUris: AtUri[] = [];
  const fetchRejected: SkippedRecord[] = [];
  const coverage: Coverage[] = [];
  for (const [index, def] of definitions.entries()) {
    report(progress('reading-records', index, definitions.length, def.nsid));
    if (inventory !== null && inventory.absent.includes(def.nsid)) {
      coverage.push(notPresentCoverage(def.nsid));
      continue;
    }
    const read = await ports.repo.listCollection({
      session,
      did: session.did,
      pdsOrigin: identity.pdsOrigin,
      signal,
      collection: def.nsid,
      pageSize: def.pageSize,
      maxPages: ctx.maxPagesPerCollection,
      onProgress: null,
    });
    signal.throwIfAborted();
    allRaw.push(...read.records);
    if (def.engagementSource !== null) countUris.push(...read.records.map((r) => r.uri));
    fetchRejected.push(...read.rejected);
    coverage.push(read.coverage);
  }

  // 5. Public counters for own posts.
  report(progress('reading-counts', 0, 0));
  const lookup = await ports.engagement.getCounts({
    session,
    uris: countUris,
    signal,
    onProgress: (p) => report(progress('reading-counts', p.batch, p.batches)),
  });
  signal.throwIfAborted();

  // 6. Normalise (pure, synchronous).
  report(progress('normalising', 0, 1));
  const normalized = ctx.normalizer.normalize({ did: session.did, records: allRaw, engagement: lookup.results });

  // 7. Assemble the snapshot. Nothing is dropped: fetch rejects first, then normalise skips.
  const skipped = [...fetchRejected, ...normalized.skipped];
  const notices: Notice[] = [];
  if (mode === 'demo') notices.push({ code: 'demo-synthetic', level: 'info', message: DEMO_BANNER_TEXT });
  if (mode === 'live') notices.push({ code: 'non-atomic-read', level: 'info', message: NOTICE_TEXT.nonAtomic });
  if (coverage.some((c) => c.status !== 'complete')) {
    notices.push({ code: 'coverage-incomplete', level: 'warning', message: NOTICE_TEXT.coverage });
  }
  if (inventoryStatus === 'unknown') notices.push({ code: 'inventory-unknown', level: 'warning', message: NOTICE_TEXT.inventory });
  if (lookup.coverage.unknown > 0) notices.push({ code: 'engagement-incomplete', level: 'warning', message: NOTICE_TEXT.engagement });
  if (skipped.length > 0) {
    notices.push({
      code: 'records-skipped',
      level: 'info',
      message: `${skipped.length} record(s) could not be interpreted and were set aside with a reason.`,
    });
  }
  if (identity.handleStatus !== 'valid') notices.push({ code: 'handle-not-valid', level: 'warning', message: NOTICE_TEXT.handle });

  const snapshot: Snapshot = {
    schemaVersion: 1,
    mode,
    demoScenario: req.scenario,
    account: identity,
    fetchedAt: ports.now(),
    records: normalized.records,
    skipped,
    coverage,
    engagementCoverage: lookup.coverage,
    inventoryStatus,
    unanalysedCollections: inventory !== null ? inventory.presentNotAnalysed : [],
    notices,
  };

  // 8. Publish, unless cancelled meanwhile.
  signal.throwIfAborted();
  ctx.dispatch({ type: 'load/snapshot-ready', runId, snapshot, acquisitionMs: ctx.nowMs() - t0 });
  return snapshot;
}

export interface AnalyseRequest {
  readonly runId: number;
  readonly snapshot: Snapshot;
  readonly range: RangeId;
  readonly signal: AbortSignal;
}

/**
 * Step 9. Never rejects: an abort dispatches nothing; any other throw becomes `analysis/failed`
 * with an `internal` failure (the snapshot stays visible).
 */
export async function analyse(ctx: PipelineContext, req: AnalyseRequest): Promise<void> {
  const { runId, snapshot, range, signal } = req;
  try {
    signal.throwIfAborted();
    ctx.dispatch({ type: 'analysis/started', runId, range });
    const outcome = await ctx.runner.run(
      {
        jobId: `${runId}:${range}`,
        snapshot,
        registry: ctx.registry.data,
        analytics: { ...ctx.analytics, range },
        privacy: ctx.privacy,
      },
      signal,
    );
    signal.throwIfAborted();
    if (!outcome.ok) {
      ctx.dispatch({ type: 'analysis/failed', runId, range, failure: outcome.failure });
      return;
    }
    const { result, ranIn, fallbackReason, durationMs } = outcome.value;
    ctx.dispatch({ type: 'analysis/ready', runId, range, result, ranIn, fallbackReason, durationMs });
    if (fallbackReason !== null && fallbackReason !== 'worker-unavailable') {
      // Only when the result actually landed for the current run and range.
      const state = ctx.getState();
      if (state.load.runId === runId && state.analysis.status === 'ready' && state.analysis.range === range) {
        ctx.dispatch({ type: 'notice/added', notice: ANALYSIS_FALLBACK_NOTICE });
      }
    }
  } catch {
    if (signal.aborted) return;
    ctx.dispatch({
      type: 'analysis/failed',
      runId,
      range,
      failure: makeFailure('internal', 'The analysis could not be completed.'),
    });
  }
}
