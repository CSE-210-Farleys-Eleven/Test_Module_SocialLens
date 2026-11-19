/**
 * Composition root (shared by the page entry `main.ts` and the integration tests).
 *
 * This is one of the three files allowed to import module implementations
 * (PLAN.md §2 rule 5 names main.ts and worker-main.ts; this file holds the
 * wiring so tests can run the exact same wiring with fake environment ports).
 * It contains construction only: no business logic.
 */
import { createAccounts } from './accounts';
import { createAtprotoAdapter } from './adapters/atproto';
import { createBlueskyAdapter } from './adapters/bluesky';
import { createFixtures } from './adapters/fixtures';
import { computeAnalytics } from './analytics';
import { computePrivacy } from './analytics/privacy';
import { createAppController, createAppStore, createInitialState } from './analytics/state';
import { createAnalysisRunner, createComputeAnalysis } from './analytics/worker';
import { createNormalizer } from './normalize';
import { createRegistry } from './registry';
import { LIMITS, ORIGINS, createHttpClient } from './shared';

import type { AuthService } from './auth/contract';
import type { Fixtures, FixtureServer } from './adapters/fixtures/contract';
import type { AppActions, AppStore, DataPorts } from './analytics/state/contract';
import type { AnalysisRunner, ComputeAnalysis, TimerPort, WorkerLike } from './analytics/worker/contract';
import type { Registry } from './registry/contract';
import type { Clock, FetchLike, HttpClient, IsoDateTime, KeyValueStore, Sleep } from './shared/contract';

/** Everything that differs between a browser, a test, and the demo. */
export interface ComposeEnv {
  /** Network for LIVE reads (`globalThis.fetch` in the browser). */
  readonly fetch: FetchLike;
  /** `localStorage` for the linked-accounts list, or null for memory only. */
  readonly storage: KeyValueStore | null;
  /** null when live sign-in is unavailable in this build. */
  readonly auth: AuthService | null;
  /** null → every analysis runs on the main thread. */
  readonly spawnWorker: (() => WorkerLike) | null;
  readonly sleep: Sleep;
  readonly clock: Clock;
  readonly timers: TimerPort;
  /** Artificial latency of the demo fixture server in ms (0 in the app). */
  readonly demoLatencyMs: number;
}

export interface ComposedApp {
  readonly registry: Registry;
  readonly fixtures: Fixtures;
  readonly store: AppStore;
  readonly actions: AppActions;
  readonly runner: AnalysisRunner;
  readonly compute: ComputeAnalysis;
  readonly live: DataPorts & { readonly http: HttpClient };
  /** The fixture server of the most recent demo load (tests inspect its request log); null before any. */
  lastDemoServer(): FixtureServer | null;
}

export function composeApp(env: ComposeEnv): ComposedApp {
  const registry = createRegistry();
  const fixtures = createFixtures();
  const normalizer = createNormalizer({ registry });
  const compute = createComputeAnalysis({ computeAnalytics, computePrivacy });
  const runner = createAnalysisRunner({
    spawnWorker: env.spawnWorker,
    compute,
    timeoutMs: LIMITS.analysisTimeoutMs,
    nowMs: env.clock.nowMs,
    timers: env.timers,
  });

  const buildPorts = (fetchImpl: FetchLike, storage: KeyValueStore | null, now: () => IsoDateTime) => {
    const http = createHttpClient({
      fetch: fetchImpl,
      sleep: env.sleep,
      nowMs: env.clock.nowMs,
      fixedOrigins: [ORIGINS.appView, ORIGINS.plcDirectory],
      limits: null,
    });
    const clock: Clock = { now, nowMs: env.clock.nowMs };
    const atproto = createAtprotoAdapter({ http, clock });
    const engagement = createBlueskyAdapter({ http, clock });
    const accounts = createAccounts({ identity: atproto, repo: atproto, storage, clock });
    return { accounts, repo: atproto, engagement, now, http };
  };

  const live = buildPorts(env.fetch, env.storage, env.clock.now);

  let demoServer: FixtureServer | null = null;
  const demo: Parameters<typeof createAppController>[0]['demo'] = (scenario) => {
    // A new fixture server and HTTP client per demo load: nothing is shared with live mode.
    demoServer = fixtures.createServer(scenario, { latencyMs: env.demoLatencyMs });
    const ports = buildPorts(demoServer.fetch, null, () => fixtures.now);
    return { accounts: ports.accounts, repo: ports.repo, engagement: ports.engagement, now: ports.now, session: fixtures.session };
  };

  const store = createAppStore(createInitialState());
  const actions = createAppController({
    store,
    auth: env.auth,
    live,
    demo,
    registry,
    normalizer,
    runner,
    analytics: {
      topPosts: LIMITS.topPosts,
      settlingHours: LIMITS.settlingHours,
      timelineMaxDays: LIMITS.timelineMaxDays,
      textPreviewChars: LIMITS.textPreviewChars,
    },
    privacy: {
      sampleUris: LIMITS.sampleUris,
      patternMinItems: LIMITS.patternMinItems,
      patternBandHours: LIMITS.patternBandHours,
      patternShareThreshold: LIMITS.patternShareThreshold,
    },
    maxPagesPerCollection: LIMITS.maxPagesPerCollection,
    nowMs: env.clock.nowMs,
  });

  return { registry, fixtures, store, actions, runner, compute, live, lastDemoServer: () => demoServer };
}
