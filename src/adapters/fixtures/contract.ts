/**
 * M4c `adapters/fixtures/` — FROZEN CONTRACT.
 * Fully synthetic response data shaped like real listRecords / getPosts /
 * describeRepo / DID-document responses, replayed through a `fetch` mock.
 * The same pipeline serves demo mode and integration tests.
 */
import type { EngagementCounts, FetchLike, IsoDateTime, SessionRef } from '../../shared/contract';

export type DemoScenarioId = 'complete' | 'partial' | 'empty';
export const DEMO_SCENARIO_IDS = ['complete', 'partial', 'empty'] as const satisfies readonly DemoScenarioId[];

/**
 * Identity of the one synthetic account. Deliberately impossible on the real network:
 * `.example` handles and `.invalid` hosts never resolve.
 */
export const DEMO_ACCOUNT = {
  did: 'did:plc:demosyntheticaccount2222',
  handle: 'synthetic-demo.example',
  pdsOrigin: 'https://pds.synthetic-demo.invalid',
  /** Fixed reference "now" for every scenario, so demo output is byte-for-byte reproducible. */
  now: '2026-11-10T23:59:59.000Z',
} as const;

export interface DemoScenarioInfo {
  readonly id: DemoScenarioId;
  readonly label: string;
  readonly description: string;
}

/** What a scenario's collection will look like after a correct read. Used by integration tests. */
export interface FixtureCollectionExpectation {
  readonly collection: string;
  /** Whether describeRepo advertises it. */
  readonly advertised: boolean;
  /** Well-formed, own records the fixture serves across all successful pages. */
  readonly servedValid: number;
  /** Deliberately malformed / foreign items served (must end up in the skipped bucket). */
  readonly servedInvalid: number;
  /** Pages the fixture can serve before the cursor ends (ignoring the client's page cap). */
  readonly pages: number;
  readonly expectedStatus: 'complete' | 'partial' | 'unavailable';
  readonly expectedReasonCode: string;
}

/** Ground truth for a scenario, hand-computable from the fixture source. */
export interface FixtureManifest {
  readonly scenario: DemoScenarioId;
  readonly did: string;
  readonly handle: string;
  readonly pdsOrigin: string;
  readonly now: string;
  /** What describeRepo reports. */
  readonly handleIsCorrect: boolean;
  readonly collections: readonly FixtureCollectionExpectation[];
  /** Advertised NSIDs the registry does not analyse. */
  readonly presentNotAnalysed: readonly string[];
  /** Own posts/replies the AppView fixture returns counters for. */
  readonly postsWithCounts: number;
  /** Own posts/replies whose counters stay unknown (failed batch or omitted post). */
  readonly postsWithUnknownCounts: number;
  /** Sum of the served counters over `postsWithCounts`. */
  readonly countTotals: EngagementCounts;
  /** Number of getPosts calls expected for a correct client. */
  readonly expectedCountBatches: number;
  /** Well-formed envelopes whose body `normalize/` must skip (e.g. a post without `text`). */
  readonly expectedNormalizeSkips: number;
}

export interface FixtureRequestLogEntry {
  readonly url: string;
  readonly method: string;
  /** `init.credentials` as passed by the caller, or null when not set. */
  readonly credentials: string | null;
  /** True when an Authorization header was present (must never happen). */
  readonly hadAuthorization: boolean;
  /** HTTP status served, or null when the mock rejected (unexpected URL / abort). */
  readonly status: number | null;
  /** True when no route matched: the mock rejected with a TypeError and nothing was served. */
  readonly unexpected: boolean;
}

export interface FixtureServerOptions {
  /** Artificial delay per response in ms (default 0). Honours the request's AbortSignal. */
  readonly latencyMs: number;
}

/** A `fetch` replacement that serves one scenario and records every call. Makes no real network request. */
export interface FixtureServer {
  readonly fetch: FetchLike;
  requests(): readonly FixtureRequestLogEntry[];
  resetLog(): void;
}

export interface Fixtures {
  readonly scenarios: readonly DemoScenarioInfo[];
  /** Synthetic session for the demo account: `{ did: DEMO_ACCOUNT.did, source: 'demo' }`. */
  readonly session: SessionRef;
  /** DEMO_ACCOUNT.now as a branded instant: the fixed clock every demo load uses. */
  readonly now: IsoDateTime;
  manifest(scenario: DemoScenarioId): FixtureManifest;
  createServer(scenario: DemoScenarioId, options: FixtureServerOptions | null): FixtureServer;
}

export type CreateFixtures = () => Fixtures;
