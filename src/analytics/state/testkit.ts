/**
 * Test-only fakes for `analytics/state`. Hand-written; imports no other module's implementation.
 * Every port records its calls and can be driven with controllable deferred promises.
 */
import type {
  AccountIdentity,
  ActivityRecord,
  AtUri,
  Cid,
  Coverage,
  Did,
  EngagementCoverage,
  Failure,
  HttpsOrigin,
  IsoDateTime,
  Nsid,
  RawRecord,
  RecordKey,
  Result,
  SessionRef,
  SkippedRecord,
  Snapshot,
} from '../../shared/contract';
import type { AuthDisclosure, AuthInitResult, AuthService, SessionEndedEvent } from '../../auth/contract';
import type { AccountsService, LinkedAccount, VerifiedAccount, VerifyRequest } from '../../accounts/contract';
import type { CollectionRead, ListCollectionRequest, RepoDescription, RepoRequest, RepoSource } from '../../adapters/atproto/contract';
import type { EngagementLookup, EngagementRequest, EngagementResult, EngagementSource } from '../../adapters/bluesky/contract';
import type { DemoScenarioId } from '../../adapters/fixtures/contract';
import type { CollectionDefinition, CollectionInventory, Registry, RegistryData } from '../../registry/contract';
import type { NormalizeInput, NormalizeResult, Normalizer } from '../../normalize/contract';
import type { AnalysisJob, AnalysisOutcome, AnalysisResult, AnalysisRunner } from '../worker/contract';
import type { AppControllerDeps, AppEvent, AppStore, DataPorts, DemoPorts } from './contract';

// ───────────────────────────── deferred ─────────────────────────────

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every queued microtask / promise continuation run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/** Like a real port: reject with the signal's reason as soon as it aborts. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((res, rej) => {
    const onAbort = (): void => rej(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        res(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        rej(e);
      },
    );
  });
}

// ───────────────────────────── sample data ─────────────────────────────

export const LIVE_DID = 'did:plc:livelivelivelivelive' as Did;
export const OTHER_DID = 'did:plc:otherotherotherother' as Did;
export const DEMO_DID = 'did:plc:demodemodemodemodemo' as Did;
export const PDS = 'https://pds.example.com' as HttpsOrigin;
export const NOW = '2026-11-18T12:00:00.000Z' as IsoDateTime;

export const POST = 'app.bsky.feed.post' as Nsid;
export const LIKE = 'app.bsky.feed.like' as Nsid;
export const DOC = 'site.standard.document' as Nsid;
export const UNANALYSED = 'com.example.other' as Nsid;

export const oauthSession = (did: Did = LIVE_DID): SessionRef => ({ did, source: 'oauth' });
export const demoSession = (did: Did = DEMO_DID): SessionRef => ({ did, source: 'demo' });

export function failure(kind: Failure['kind'], message = `${kind} failure`): Failure {
  return { kind, message, status: null, xrpcError: null, retryAfterMs: null, origin: null };
}

export function identity(did: Did, handleStatus: AccountIdentity['handleStatus'] = 'valid'): AccountIdentity {
  return {
    did,
    didMethod: 'plc',
    handle: null,
    handleStatus,
    handleCheck: 'pds-attested',
    pdsOrigin: PDS,
    verifiedAt: NOW,
  };
}

export function repoDescription(did: Did, collections: readonly Nsid[]): RepoDescription {
  return { did, handle: null, handleIsCorrect: true, collections, invalidCollectionCount: 0 };
}

export function raw(did: Did, collection: Nsid, rkey: string): RawRecord {
  return {
    uri: `at://${did}/${collection}/${rkey}` as AtUri,
    cid: `bafy${rkey}` as Cid,
    collection,
    rkey: rkey as RecordKey,
    value: { text: rkey },
  };
}

export function coverage(collection: Nsid, accepted: number, status: Coverage['status'] = 'complete'): Coverage {
  return {
    collection,
    status,
    reasonCode: status === 'complete' ? 'ok' : 'later-page-failed',
    reason: 'test',
    pagesFetched: 1,
    returned: accepted,
    accepted,
    rejected: 0,
    duplicates: 0,
    failure: null,
  };
}

export function skipped(collection: Nsid, stage: SkippedRecord['stage'], detail: string): SkippedRecord {
  return {
    uri: null,
    collection,
    stage,
    reasonCode: stage === 'fetch' ? 'malformed-envelope' : 'invalid-field',
    detail,
  };
}

export function engagementCoverage(requested: number, unknown = 0): EngagementCoverage {
  return {
    status: unknown === 0 ? 'complete' : 'partial',
    requested,
    known: requested - unknown,
    unknown,
    batches: requested === 0 ? 0 : 1,
    batchesFailed: 0,
    failure: null,
    reason: 'test',
  };
}

export const ANALYSIS_RESULT = { analytics: { marker: 'analytics' }, privacy: { marker: 'privacy' } } as unknown as AnalysisResult;

export function outcome(fallbackReason: AnalysisOutcome['fallbackReason'] = null): AnalysisOutcome {
  return {
    result: ANALYSIS_RESULT,
    ranIn: fallbackReason === null ? 'worker' : 'main-thread',
    fallbackReason,
    durationMs: 7,
  };
}

export function sampleSnapshot(did: Did = DEMO_DID): Snapshot {
  return {
    schemaVersion: 1,
    mode: 'demo',
    demoScenario: 'complete',
    account: identity(did),
    fetchedAt: NOW,
    records: [],
    skipped: [],
    coverage: [],
    engagementCoverage: engagementCoverage(0),
    inventoryStatus: 'known',
    unanalysedCollections: [],
    notices: [],
  };
}

export function linked(did: Did, status: LinkedAccount['status'] = 'verified'): LinkedAccount {
  return {
    did,
    didMethod: 'plc',
    handle: null,
    handleStatus: 'valid',
    pdsOrigin: PDS,
    status,
    verifiedAt: NOW,
    addedAt: NOW,
    lastFailure: null,
  };
}

export const DISCLOSURE: AuthDisclosure = {
  scope: 'atproto',
  clientKind: 'loopback',
  handleResolverOrigin: 'https://bsky.social',
  handleResolverIsThirdParty: true,
  resolverNotice: 'resolver notice',
  storageNotice: 'storage notice',
  source: 'atprotoOauthClientBrowser' as AuthDisclosure['source'],
};

// ───────────────────────────── registry ─────────────────────────────

function def(nsid: Nsid, engagement: boolean, pageSize: number): CollectionDefinition {
  return {
    nsid,
    appId: nsid.startsWith('site.') ? 'standard-site' : 'bluesky',
    label: nsid,
    normalizerId: 'bsky.post',
    kinds: ['post'],
    visibility: 'public-repo',
    visibilitySource: 'x' as CollectionDefinition['visibilitySource'],
    timestampField: 'createdAt',
    engagementSource: engagement ? 'bluesky-appview' : null,
    pageSize,
  };
}

export const COLLECTIONS: readonly CollectionDefinition[] = [def(POST, true, 100), def(LIKE, false, 100), def(DOC, false, 50)];

export function fakeRegistry(): Registry & { readonly inventoryCalls: (readonly string[])[] } {
  const data: RegistryData = { version: 'test', apps: [], collections: COLLECTIONS, nonRepoData: [] };
  const inventoryCalls: (readonly string[])[] = [];
  return {
    data,
    inventoryCalls,
    app: () => {
      throw new Error('not used');
    },
    collection: (nsid) => COLLECTIONS.find((c) => c.nsid === nsid) ?? null,
    analysedCollections: () => COLLECTIONS,
    inventory(advertised): CollectionInventory {
      inventoryCalls.push(advertised);
      const known = COLLECTIONS.map((c) => c.nsid as string);
      return {
        present: COLLECTIONS.filter((c) => advertised.includes(c.nsid)).map((c) => c.nsid),
        absent: COLLECTIONS.filter((c) => !advertised.includes(c.nsid)).map((c) => c.nsid),
        presentNotAnalysed: advertised.filter((a) => !known.includes(a)).map((a) => a as Nsid).sort(),
      };
    },
  };
}

// ───────────────────────────── data ports ─────────────────────────────

export interface FakeAccounts extends AccountsService {
  accounts: LinkedAccount[];
  readonly verifyCalls: VerifyRequest[];
  readonly calls: string[];
  /** Next verify outcome; a Deferred lets the test hold it pending. */
  verifyWith: ((req: VerifyRequest) => Promise<Result<VerifiedAccount>>) | null;
  storageFailureValue: Failure | null;
}

export function fakeAccounts(): FakeAccounts {
  const self: FakeAccounts = {
    accounts: [],
    verifyCalls: [],
    calls: [],
    verifyWith: null,
    storageFailureValue: null,
    list() {
      self.calls.push('list');
      return self.accounts;
    },
    get(did) {
      self.calls.push('get');
      return self.accounts.find((a) => a.did === did) ?? null;
    },
    async verify(req) {
      self.calls.push('verify');
      self.verifyCalls.push(req);
      if (self.verifyWith !== null) return self.verifyWith(req);
      const did = req.session.did;
      if (!self.accounts.some((a) => a.did === did)) self.accounts = [...self.accounts, linked(did)];
      return { ok: true, value: { identity: identity(did), repo: repoDescription(did, [POST, LIKE, DOC]), repoFailure: null } };
    },
    markNeedsSignIn(did) {
      self.calls.push(`markNeedsSignIn:${did}`);
      self.accounts = self.accounts.map((a) => (a.did === did ? { ...a, status: 'needs-sign-in' } : a));
    },
    remove(did) {
      self.calls.push(`remove:${did}`);
      const removed = self.accounts.some((a) => a.did === did);
      self.accounts = self.accounts.filter((a) => a.did !== did);
      return { did, removed, scope: 'local-only' };
    },
    clear() {
      self.calls.push('clear');
      self.accounts = [];
    },
    storageFailure() {
      self.calls.push('storageFailure');
      return self.storageFailureValue;
    },
  };
  return self;
}

export interface FakeRepo extends RepoSource {
  readonly listCalls: ListCollectionRequest[];
  readonly describeCalls: RepoRequest[];
  /** Per-collection read; default: 2 records, complete. */
  readWith: ((req: ListCollectionRequest) => Promise<CollectionRead>) | null;
}

export function defaultRead(req: ListCollectionRequest): CollectionRead {
  const records = [raw(req.did, req.collection, 'a'), raw(req.did, req.collection, 'b')];
  return { records, rejected: [], coverage: coverage(req.collection, records.length) };
}

export function fakeRepo(): FakeRepo {
  const self: FakeRepo = {
    listCalls: [],
    describeCalls: [],
    readWith: null,
    async describeRepo(req) {
      self.describeCalls.push(req);
      return { ok: true, value: repoDescription(req.did, []) };
    },
    async listCollection(req) {
      self.listCalls.push(req);
      if (self.readWith !== null) return self.readWith(req);
      return defaultRead(req);
    },
  };
  return self;
}

export interface FakeEngagement extends EngagementSource {
  readonly calls: EngagementRequest[];
  countsWith: ((req: EngagementRequest) => Promise<EngagementLookup>) | null;
}

export function defaultLookup(req: EngagementRequest): EngagementLookup {
  const results: EngagementResult[] = req.uris.map((uri) => ({
    uri,
    engagement: { status: 'known', counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, observedAt: NOW },
  }));
  return { results, coverage: engagementCoverage(req.uris.length) };
}

export function fakeEngagement(): FakeEngagement {
  const self: FakeEngagement = {
    calls: [],
    countsWith: null,
    async getCounts(req) {
      self.calls.push(req);
      if (self.countsWith !== null) return self.countsWith(req);
      return defaultLookup(req);
    },
  };
  return self;
}

export interface FakePorts extends DataPorts {
  readonly accounts: FakeAccounts;
  readonly repo: FakeRepo;
  readonly engagement: FakeEngagement;
  readonly nowCalls: { count: number };
}

export function fakePorts(now: IsoDateTime = NOW): FakePorts {
  const nowCalls = { count: 0 };
  return {
    accounts: fakeAccounts(),
    repo: fakeRepo(),
    engagement: fakeEngagement(),
    nowCalls,
    now: () => {
      nowCalls.count++;
      return now;
    },
  };
}

// ───────────────────────────── normalizer / runner ─────────────────────────────

export interface FakeNormalizer extends Normalizer {
  readonly calls: NormalizeInput[];
  /** URIs (by rkey suffix) to put in the skipped bucket. */
  skipRkeys: string[];
  throwWith: Error | null;
}

export function fakeNormalizer(): FakeNormalizer {
  const self: FakeNormalizer = {
    calls: [],
    skipRkeys: [],
    throwWith: null,
    normalize(input): NormalizeResult {
      self.calls.push(input);
      if (self.throwWith !== null) throw self.throwWith;
      const records: ActivityRecord[] = [];
      const skippedOut: SkippedRecord[] = [];
      for (const r of input.records) {
        if (self.skipRkeys.includes(r.rkey)) {
          skippedOut.push({ uri: r.uri, collection: r.collection, stage: 'normalize', reasonCode: 'invalid-field', detail: `norm ${r.rkey}` });
          continue;
        }
        records.push({
          uri: r.uri,
          cid: r.cid,
          did: input.did,
          collection: r.collection,
          rkey: r.rkey,
          app: 'bluesky',
          kind: 'post',
          createdAt: null,
          timeSource: 'none',
          rkeyTime: null,
          title: null,
          text: null,
          subjectUri: null,
          subjectDid: null,
          tags: [],
          engagement: { status: 'not-available' },
        });
      }
      return { records, skipped: skippedOut };
    },
  };
  return self;
}

export interface FakeRunner extends AnalysisRunner {
  readonly jobs: AnalysisJob[];
  readonly signals: AbortSignal[];
  runWith: ((job: AnalysisJob, signal: AbortSignal) => Promise<Result<AnalysisOutcome>>) | null;
}

export function fakeRunner(): FakeRunner {
  const self: FakeRunner = {
    jobs: [],
    signals: [],
    runWith: null,
    async run(job, signal) {
      self.jobs.push(job);
      self.signals.push(signal);
      if (self.runWith !== null) return self.runWith(job, signal);
      return { ok: true, value: outcome() };
    },
    dispose() {},
  };
  return self;
}

// ───────────────────────────── auth ─────────────────────────────

export interface FakeAuth extends AuthService {
  readonly calls: string[];
  initWith: () => Promise<Result<AuthInitResult>>;
  signInWith: (handle: string) => Promise<Result<null>>;
  restoreWith: (did: Did) => Promise<Result<SessionRef>>;
  signOutWith: (did: Did) => Promise<Result<null>>;
  emit(event: SessionEndedEvent): void;
  listenerCount(): number;
}

export function fakeAuth(): FakeAuth {
  const listeners = new Set<(event: SessionEndedEvent) => void>();
  const self: FakeAuth = {
    disclosure: DISCLOSURE,
    calls: [],
    initWith: async () => ({ ok: true, value: { session: null, via: 'none', problem: null } }),
    signInWith: async () => ({ ok: false, failure: failure('auth', 'sign-in failed') }),
    restoreWith: async (did) => ({ ok: true, value: oauthSession(did) }),
    signOutWith: async () => ({ ok: true, value: null }),
    init() {
      self.calls.push('init');
      return self.initWith();
    },
    signIn(handle) {
      self.calls.push(`signIn:${handle}`);
      return self.signInWith(handle);
    },
    restore(did) {
      self.calls.push(`restore:${did}`);
      return self.restoreWith(did);
    },
    async signOut(did) {
      self.calls.push(`signOut:${did}`);
      const r = await self.signOutWith(did);
      self.emit({ did, reason: 'signed-out' });
      return r;
    },
    onSessionEnded(listener) {
      self.calls.push('onSessionEnded');
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const l of [...listeners]) l(event);
    },
    listenerCount: () => listeners.size,
  };
  return self;
}

// ───────────────────────────── harness ─────────────────────────────

export interface Harness {
  readonly deps: AppControllerDeps;
  readonly store: AppStore;
  readonly events: AppEvent[];
  readonly live: FakePorts;
  readonly demoPorts: Map<DemoScenarioId, FakePorts & DemoPorts>;
  readonly demoCalls: DemoScenarioId[];
  readonly registry: ReturnType<typeof fakeRegistry>;
  readonly normalizer: FakeNormalizer;
  readonly runner: FakeRunner;
  readonly auth: FakeAuth | null;
  /** Configure the demo ports for a scenario before enterDemo is called. */
  demo(scenario: DemoScenarioId): FakePorts & DemoPorts;
}

export function makeHarness(store: AppStore, options: { readonly auth?: FakeAuth | null } = {}): Harness {
  const events: AppEvent[] = [];
  const spyStore: AppStore = {
    getState: () => store.getState(),
    subscribe: (l) => store.subscribe(l),
    dispatch: (e) => {
      events.push(e);
      store.dispatch(e);
    },
  };
  const live = fakePorts();
  const demoPorts = new Map<DemoScenarioId, FakePorts & DemoPorts>();
  const demoCalls: DemoScenarioId[] = [];
  const demo = (scenario: DemoScenarioId): FakePorts & DemoPorts => {
    let p = demoPorts.get(scenario);
    if (p === undefined) {
      p = { ...fakePorts(), session: demoSession() };
      demoPorts.set(scenario, p);
    }
    return p;
  };
  const registry = fakeRegistry();
  const normalizer = fakeNormalizer();
  const runner = fakeRunner();
  const auth = options.auth === undefined ? fakeAuth() : options.auth;
  let ms = 1000;
  const deps: AppControllerDeps = {
    store: spyStore,
    auth,
    live,
    demo: (scenario) => {
      demoCalls.push(scenario);
      return demo(scenario);
    },
    registry,
    normalizer,
    runner,
    analytics: { topPosts: 5, settlingHours: 36, timelineMaxDays: 400, textPreviewChars: 140 },
    privacy: { sampleUris: 3, patternMinItems: 10, patternBandHours: 3, patternShareThreshold: 0.6 },
    maxPagesPerCollection: 10,
    nowMs: () => (ms += 25),
  };
  return { deps, store: spyStore, events, live, demoPorts, demoCalls, registry, normalizer, runner, auth, demo };
}
