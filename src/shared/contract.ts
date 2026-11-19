/**
 * M8 `shared/` — FROZEN CONTRACT (types + `as const` contract data only).
 *
 * Every other module may import TYPES and the `as const` data below from this
 * file, and RUNTIME FUNCTIONS from `src/shared/index.ts` (see `SharedApi`).
 * This file must never import from another module.
 *
 * Everything declared here that is data (not a port) is plain,
 * structured-cloneable JSON: no functions, classes, `Map`, `Set` or `Date`.
 */

// ───────────────────────────── identifiers ─────────────────────────────

/** Nominal typing for validated strings. The brand exists only at type level. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };

/** `did:plc:<24 base32>` or `did:web:<hostname>` (no path segments, no port). */
export type Did = Brand<string, 'Did'>;
/** Lower-cased, syntactically valid handle. NOT proof that it resolves. */
export type Handle = Brand<string, 'Handle'>;
/** Full record URI: `at://<did>/<nsid>/<rkey>`. Handle authorities are rejected. */
export type AtUri = Brand<string, 'AtUri'>;
export type Nsid = Brand<string, 'Nsid'>;
/** Syntactically plausible CID string. Never verified against record bytes. */
export type Cid = Brand<string, 'Cid'>;
export type RecordKey = Brand<string, 'RecordKey'>;
/** UTC instant, always normalised to `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export type IsoDateTime = Brand<string, 'IsoDateTime'>;
/** UTC calendar day `YYYY-MM-DD`. */
export type IsoDate = Brand<string, 'IsoDate'>;
/** `https://host` — no path, query, fragment, credentials or explicit port; not an IP literal or local name. */
export type HttpsOrigin = Brand<string, 'HttpsOrigin'>;

export type DidMethod = 'plc' | 'web';

export interface ParsedAtUri {
  readonly uri: AtUri;
  readonly did: Did;
  readonly collection: Nsid;
  readonly rkey: RecordKey;
}

// ──────────────────────────────── JSON ─────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

// ─────────────────────── failures (typed errors as data) ───────────────

/**
 * Expected failures are VALUES, never thrown. The only thing a port may throw
 * (reject with) is the caller's own cancellation (`AbortError`) or a programmer
 * error. Failures are plain data so they cross the Worker boundary.
 */
export type FailureKind =
  | 'network' // fetch rejected: DNS, CORS, offline, TLS
  | 'timeout' // per-attempt timeout elapsed
  | 'http' // non-2xx without a parseable XRPC error body
  | 'xrpc' // non-2xx with `{ error, message }` body
  | 'rate-limited' // 429 that could not be retried within the bounded wait
  | 'invalid-response' // 2xx but not JSON / wrong shape / identity mismatch
  | 'too-large' // response exceeded the byte limit
  | 'blocked-origin' // URL refused by the origin policy; NO request was sent
  | 'access-denied' // self-only guard refused the target; NO request was sent
  | 'validation' // caller input was invalid; NO request was sent
  | 'unsupported' // valid but outside MVP scope (e.g. did:web with a path)
  | 'auth' // OAuth library reported a sign-in / restore / revoke problem
  | 'storage' // browser storage unavailable or corrupt
  | 'internal'; // bug or unexpected exception caught at a boundary

export interface Failure {
  readonly kind: FailureKind;
  /** Plain-language, user-presentable sentence. Never contains tokens or response bodies. */
  readonly message: string;
  /** HTTP status when one was received, else null. */
  readonly status: number | null;
  /** XRPC `error` name (e.g. `RepoNotFound`) when present, else null. */
  readonly xrpcError: string | null;
  /** Server-requested wait in ms when known (429 / 503), else null. */
  readonly retryAfterMs: number | null;
  /** Origin the request targeted (or would have), else null. */
  readonly origin: string | null;
}

export type Result<T, E = Failure> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: E };

export type Unsubscribe = () => void;

// ─────────────────────────────── sessions ──────────────────────────────

/**
 * Proof-of-identity handle passed to every read. `did` is the OAuth
 * `session.sub` for `source: 'oauth'`, or the synthetic demo DID for
 * `source: 'demo'`. Contains no tokens.
 */
export interface SessionRef {
  readonly did: Did;
  readonly source: 'oauth' | 'demo';
}

// ───────────────────────── apps, kinds, visibility ─────────────────────

export type AppId = 'bluesky' | 'standard-site';
export const APP_IDS = ['bluesky', 'standard-site'] as const satisfies readonly AppId[];

export type RecordKind =
  | 'post'
  | 'reply'
  | 'repost'
  | 'like'
  | 'follow'
  | 'block'
  | 'list'
  | 'list-item'
  | 'profile'
  | 'document'
  | 'publication';

/** Fixed display / iteration order for kinds. */
export const RECORD_KINDS = [
  'post',
  'reply',
  'repost',
  'like',
  'follow',
  'block',
  'list',
  'list-item',
  'profile',
  'document',
  'publication',
] as const satisfies readonly RecordKind[];

/** "Content items": things the person authored as content. Basis of all activity metrics. */
export const CONTENT_KINDS = ['post', 'reply', 'document'] as const satisfies readonly RecordKind[];
/** Outbound interaction / graph records the person created about someone or something else. */
export const OUTBOUND_KINDS = ['repost', 'like', 'follow', 'block', 'list-item'] as const satisfies readonly RecordKind[];

export type VisibilityClass = 'public-repo' | 'private-app' | 'private-service' | 'future-permissioned';

// ─────────────────────────── records & coverage ────────────────────────

/** One accepted `com.atproto.repo.listRecords` item, after envelope + ownership checks. */
export interface RawRecord {
  readonly uri: AtUri;
  readonly cid: Cid;
  readonly collection: Nsid;
  readonly rkey: RecordKey;
  /** The record body. Guaranteed to be a JSON object; its fields are NOT validated yet. */
  readonly value: JsonObject;
}

export type SkipStage = 'fetch' | 'normalize';

export type SkipReasonCode =
  // produced at stage 'fetch' (adapters/atproto)
  | 'malformed-envelope' // item is not `{ uri: string, cid: string, value: object }`
  | 'invalid-uri' // uri is not a full at:// record URI
  | 'foreign-owner' // uri authority is not the authenticated DID (re-checked at stage 'normalize')
  | 'wrong-collection' // uri collection differs from the requested collection
  | 'invalid-cid'
  // produced at stage 'normalize' (normalize)
  | 'unregistered-collection' // no registry entry / normalizer for the collection
  | 'type-mismatch' // `$type` is present and differs from the collection NSID
  | 'missing-required-field'
  | 'invalid-field';

/** Audit trail: nothing is silently dropped. */
export interface SkippedRecord {
  readonly uri: AtUri | null;
  readonly collection: Nsid;
  readonly stage: SkipStage;
  readonly reasonCode: SkipReasonCode;
  /** Short plain-language detail, e.g. `"subject.uri is not an AT-URI"`. Never the record body. */
  readonly detail: string;
}

export type CoverageStatus = 'complete' | 'partial' | 'unavailable';

export type CoverageReasonCode =
  | 'ok' // pagination ended, nothing rejected
  | 'not-present' // describeRepo did not list the collection: an observed zero, no listRecords call made
  | 'page-cap' // stopped at the page cap; older records were not fetched
  | 'repeated-cursor' // server repeated a cursor; stopped to avoid a loop
  | 'records-rejected' // pagination ended but some items failed envelope/ownership checks
  | 'later-page-failed' // a page after the first failed; earlier pages are kept
  | 'first-page-failed'; // nothing could be read

/** Fetch completeness for ONE collection. Independent of any date filter. */
export interface Coverage {
  readonly collection: Nsid;
  readonly status: CoverageStatus;
  readonly reasonCode: CoverageReasonCode;
  /** Plain-language sentence for the UI. */
  readonly reason: string;
  readonly pagesFetched: number;
  /** Items returned by the server across all pages (before any check). */
  readonly returned: number;
  /** Items accepted as `RawRecord`s (unique URIs). */
  readonly accepted: number;
  /** Items rejected at the fetch stage (each also appears in the skipped bucket). */
  readonly rejected: number;
  /** Items dropped because the same URI had already been accepted. */
  readonly duplicates: number;
  /** The failure that ended the read, when there was one. */
  readonly failure: Failure | null;
}

// ────────────────────────────── engagement ─────────────────────────────

/** Observed public counters for one post. Every field is an observed non-negative integer. */
export interface EngagementCounts {
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
}

export type EngagementUnknownReason =
  | 'lookup-failed' // the batch containing this URI failed
  | 'not-returned' // the AppView answered but omitted this post (deleted, taken down, not indexed)
  | 'invalid-counts' // a counter was missing, negative, or not a safe integer
  | 'not-requested' // lookup stopped early (circuit breaker) or was never attempted
  | 'rejected-not-self'; // URI is not an own post; it was never sent anywhere

/**
 * Missing is never zero:
 *  - `known`         → counters were observed (0 is a real zero)
 *  - `unknown`       → a count source exists but we do not have a trustworthy value
 *  - `not-available` → this app has no public count source at all
 */
export type Engagement =
  | { readonly status: 'known'; readonly counts: EngagementCounts; readonly observedAt: IsoDateTime }
  | { readonly status: 'unknown'; readonly reason: EngagementUnknownReason }
  | { readonly status: 'not-available' };

export interface EngagementCoverage {
  readonly status: CoverageStatus;
  /** URIs the pipeline asked about. */
  readonly requested: number;
  readonly known: number;
  readonly unknown: number;
  readonly batches: number;
  readonly batchesFailed: number;
  readonly failure: Failure | null;
  /** Plain-language sentence for the UI. */
  readonly reason: string;
}

// ───────────────────────────── shared model ────────────────────────────

/** One normalised record. A subset of the source record, not a lexicon-validated copy. */
export interface ActivityRecord {
  readonly uri: AtUri;
  readonly cid: Cid;
  /** Repository owner; always the authenticated DID. */
  readonly did: Did;
  readonly collection: Nsid;
  readonly rkey: RecordKey;
  readonly app: AppId;
  readonly kind: RecordKind;
  /**
   * Author-supplied time of this record, normalised to UTC; null when absent or invalid.
   * For posts/replies it is the post time; for likes/reposts/follows/blocks/list-items
   * it is the interaction time; for documents it is `publishedAt`; publications have none.
   */
  readonly createdAt: IsoDateTime | null;
  readonly timeSource: 'createdAt' | 'publishedAt' | 'none';
  /** Time decoded from a TID record key (repo-assigned ordering aid), else null. */
  readonly rkeyTime: IsoDateTime | null;
  /** Document / publication / list / profile name; null otherwise. Source text, render as text only. */
  readonly title: string | null;
  /** Post text or document/list/profile description (truncated to LIMITS.maxTextChars); null when absent. */
  readonly text: string | null;
  /** Record this one points at (like/repost subject, reply parent, list of a list-item, document's publication). */
  readonly subjectUri: AtUri | null;
  /** Account this one points at (follow/block/list-item subject). Never displayed by the MVP UI. */
  readonly subjectDid: Did | null;
  /** Explicit tags (record `tags` plus rich-text tag facets), de-duplicated, max 30. */
  readonly tags: readonly string[];
  readonly engagement: Engagement;
}

export type HandleStatus =
  | 'valid' // DID document claims the handle AND the PDS attests it resolves back
  | 'invalid' // the PDS reports the handle does not resolve back, or it is `handle.invalid`
  | 'unverified'; // could not be checked (describeRepo failed); shown, never trusted

/** The verified account all data in a snapshot belongs to. */
export interface AccountIdentity {
  readonly did: Did;
  readonly didMethod: DidMethod;
  readonly handle: Handle | null;
  readonly handleStatus: HandleStatus;
  /** How the handle was checked. MVP never does its own DNS / well-known lookup. */
  readonly handleCheck: 'pds-attested' | 'none';
  readonly pdsOrigin: HttpsOrigin;
  readonly verifiedAt: IsoDateTime;
}

export type NoticeCode =
  | 'demo-synthetic'
  | 'non-atomic-read'
  | 'coverage-incomplete'
  | 'inventory-unknown'
  | 'engagement-incomplete'
  | 'records-skipped'
  | 'handle-not-valid'
  | 'analysis-fallback'
  | 'session-ended'
  | 'storage-unavailable'
  | 'auth-unavailable';

export interface Notice {
  readonly code: NoticeCode;
  readonly level: 'info' | 'warning';
  readonly message: string;
}

/** Everything known about one account from one load. Immutable; a reload produces a new Snapshot. */
export interface Snapshot {
  readonly schemaVersion: 1;
  readonly mode: 'live' | 'demo';
  /** Demo scenario id when `mode === 'demo'`, else null. */
  readonly demoScenario: string | null;
  readonly account: AccountIdentity;
  /** When acquisition finished. The single reference "now" for every calculation. */
  readonly fetchedAt: IsoDateTime;
  readonly records: readonly ActivityRecord[];
  readonly skipped: readonly SkippedRecord[];
  /** Exactly one entry per analysed (registered) collection, in registry order. */
  readonly coverage: readonly Coverage[];
  readonly engagementCoverage: EngagementCoverage;
  /** `known` when describeRepo succeeded; `unknown` when it failed (then every registered collection is listed blindly). */
  readonly inventoryStatus: 'known' | 'unknown';
  /** Collections present in the repo that the registry does not analyse ("present, not analysed"). */
  readonly unanalysedCollections: readonly Nsid[];
  readonly notices: readonly Notice[];
}

// ─────────────────────────── metrics & glossary ────────────────────────

export type RangeId = '7d' | '30d' | '90d' | 'all';
export const RANGE_IDS = ['7d', '30d', '90d', 'all'] as const satisfies readonly RangeId[];

/** Every number the UI shows has one of these ids and a glossary entry. See docs/architecture/GLOSSARY.md. */
export const METRIC_IDS = [
  'records.total',
  'records.byKind',
  'records.byApp',
  'content.items',
  'activity.activeDays',
  'activity.dailyTimeline',
  'activity.hourHistogram',
  'activity.weekdayHistogram',
  'activity.streak.current',
  'activity.streak.longest',
  'activity.weekOverWeek',
  'engagement.likes',
  'engagement.reposts',
  'engagement.replies',
  'engagement.quotes',
  'engagement.interactions',
  'engagement.interactionsPerPost',
  'engagement.knownShare',
  'engagement.topPosts',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

/** Metrics SocialLens deliberately does not show, with the reason in the glossary. */
export const UNAVAILABLE_METRIC_IDS = [
  'impressions',
  'reach',
  'engagement-rate',
  'follower-growth',
  'unfollows',
  'who-blocks-me',
  'bookmarks',
  'best-time-to-post',
  'cross-app-score',
] as const;
export type UnavailableMetricId = (typeof UNAVAILABLE_METRIC_IDS)[number];

export type ValueStatus =
  | 'exact' // fully observed (an exact 0 is a real zero)
  | 'partial' // some contributing data is partial, skipped or unknown; see `isLowerBound`
  | 'settling' // fully observed, but includes very fresh posts whose counters are still moving
  | 'unknown' // a source exists but nothing trustworthy was observed
  | 'not-available'; // no contributing app can supply this metric

/**
 * One displayed number with its honesty label.
 * `value` is null iff status is 'unknown' or 'not-available'.
 * Status precedence when several apply: not-available > unknown > partial > settling > exact.
 */
export interface MetricValue {
  readonly metricId: MetricId;
  readonly value: number | null;
  readonly status: ValueStatus;
  /**
   * True only when status is 'partial' AND the value is a count that can only grow with more
   * data: print it as "At least N". Ratios and shares on partial data are NOT lower bounds.
   */
  readonly isLowerBound: boolean;
  /** Why the status is not 'exact' (plain language); null when exact. */
  readonly reason: string | null;
  /** For ratios: the pooled numerator / denominator actually used; null otherwise. */
  readonly numerator: number | null;
  readonly denominator: number | null;
  /** Apps whose records actually contributed to this value. */
  readonly contributingApps: readonly AppId[];
}

/** The six labels the UI can put on a number. Derived from MetricValue by `statusLabelFor`. */
export type StatusLabel = 'known' | 'zero' | 'partial' | 'settling' | 'unknown' | 'not-available';

/** Prefix printed before a lower-bound count ("At least 12"). */
export const AT_LEAST_PREFIX = 'At least ';

/** Exact user-visible wording. Views, components and tests all use these strings. */
export const STATUS_LABEL_TEXT = {
  known: '',
  zero: 'Observed zero',
  partial: 'Partial',
  settling: 'Settling',
  unknown: 'Unknown',
  'not-available': 'Not available on this app',
} as const satisfies Record<StatusLabel, string>;

export const DEMO_BANNER_TEXT = 'Synthetic demo data — fictional records, no real account, no network requests.';

export interface MetricDefinition {
  readonly id: MetricId;
  readonly label: string;
  /** One plain-language sentence. */
  readonly definition: string;
  readonly formula: string;
  /** What the value is divided by, or null for plain counts. */
  readonly denominator: string | null;
  readonly includes: string;
  readonly excludes: string;
  readonly contributingApps: readonly AppId[];
  /** True when every supported app contributes, so the metric may appear on the Overview. */
  readonly sharedByAllApps: boolean;
  /** e.g. "UTC calendar days; posts published in range, lifetime counts". */
  readonly timeBasis: string;
  readonly unit: 'count' | 'per-post' | 'share' | 'days' | 'series' | 'ranking';
}

export interface UnavailableMetricDefinition {
  readonly id: UnavailableMetricId;
  readonly label: string;
  /** Why it is not shown. */
  readonly reason: string;
  /** What it would take (usually a history service or data that is not public). */
  readonly wouldRequire: string;
}

export interface Glossary {
  /** Bump on any wording or formula change. */
  readonly version: string;
  readonly metrics: readonly MetricDefinition[];
  readonly unavailable: readonly UnavailableMetricDefinition[];
}

// ─────────────────────── privacy observation ids ───────────────────────

export const OBSERVATION_IDS = [
  'public-likes',
  'public-follows',
  'public-blocks',
  'public-lists',
  'cross-app-identity',
  'posting-time-pattern',
  'handle-validity',
  'incomplete-coverage',
] as const;
export type ObservationId = (typeof OBSERVATION_IDS)[number];

// ─────────────────────────── cited sources ─────────────────────────────

export interface SourceDefinition {
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  /** Date the URL was last checked by the research (YYYY-MM-DD). */
  readonly accessed: string;
}

/**
 * Official sources that observations, registry rows and disclosures cite. URLs are from docs/research;
 * the two `lexicons/com/atproto/repo/*.json` URLs refine a folder link from the research (files verified in the local clone).
 */
export const SOURCES = {
  'atproto-blog-blocks': {
    title: 'Block implementation (2023-06-08)',
    publisher: 'AT Protocol blog',
    url: 'https://atproto.com/blog/block-implementation',
    accessed: '2026-11-18',
  },
  'atproto-discussion-private-blocks': {
    title: 'Discussion #1131: public blocks',
    publisher: 'bluesky-social/atproto',
    url: 'https://github.com/bluesky-social/atproto/discussions/1131',
    accessed: '2026-11-18',
  },
  'bsky-docs-following': {
    title: 'Bluesky API: following, blocks and mutes',
    publisher: 'Bluesky documentation',
    url: 'https://bsky.network/docs/bluesky-api/following',
    accessed: '2026-11-18',
  },
  'bsky-privacy-policy': {
    title: 'Privacy Policy (updated 2025-08-14)',
    publisher: 'Bluesky Social PBC',
    url: 'https://bsky.social/about/support/privacy-policy',
    accessed: '2026-11-18',
  },
  'atproto-blog-spaces': {
    title: 'AT Protocol Spaces alpha (2026-08-20)',
    publisher: 'AT Protocol blog',
    url: 'https://atproto.com/blog/atproto-spaces-alpha',
    accessed: '2026-11-18',
  },
  'atproto-spec-handle': {
    title: 'Handle specification',
    publisher: 'AT Protocol',
    url: 'https://atproto.com/specs/handle',
    accessed: '2026-11-18',
  },
  'atproto-spec-oauth': {
    title: 'OAuth specification',
    publisher: 'AT Protocol',
    url: 'https://atproto.com/specs/oauth',
    accessed: '2026-11-18',
  },
  'oauth-client-browser-readme': {
    title: '@atproto/oauth-client-browser README (handle resolver caution)',
    publisher: 'bluesky-social/atproto',
    url: 'https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client-browser',
    accessed: '2026-11-18',
  },
  'bsky-rate-limits': {
    title: 'Rate limits',
    publisher: 'Bluesky documentation',
    url: 'https://bsky.network/docs/rate-limits',
    accessed: '2026-11-18',
  },
  'lexicon-list-records': {
    title: 'Lexicon com.atproto.repo.listRecords',
    publisher: 'bluesky-social/atproto',
    url: 'https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/listRecords.json',
    accessed: '2026-11-18',
  },
  'lexicon-describe-repo': {
    title: 'Lexicon com.atproto.repo.describeRepo',
    publisher: 'bluesky-social/atproto',
    url: 'https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/describeRepo.json',
    accessed: '2026-11-18',
  },
  'lexicon-get-posts': {
    title: 'Lexicon app.bsky.feed.getPosts',
    publisher: 'bluesky-social/atproto',
    url: 'https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/getPosts.json',
    accessed: '2026-11-18',
  },
  'standard-site': {
    title: 'Standard.site lexicons',
    publisher: 'standard.site',
    url: 'https://standard.site',
    accessed: '2026-11-18',
  },
  'x-post-settling': {
    title: 'Post activity dashboard (metrics settle within 36 hours)',
    publisher: 'X Business Help',
    url: 'https://business.x.com/en/help/campaign-measurement-and-analytics/tweet-activity-dashboard',
    accessed: '2026-11-18',
  },
} as const satisfies Record<string, SourceDefinition>;
export type SourceId = keyof typeof SOURCES;

/** A source reference embedded in data (structured-cloneable copy of a SOURCES entry). */
export interface Citation {
  readonly sourceId: SourceId;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly accessed: string;
}

// ─────────────────────────────── config ────────────────────────────────

/** Bounded-wait and size limits. Changing a value here is a contract change. */
export const LIMITS = {
  /** com.atproto.repo.listRecords maximum (lexicon: limit max 100). */
  listPageSize: 100,
  /** Explicit page cap per collection (10 pages = up to 1,000 records). Newest records come first. */
  maxPagesPerCollection: 10,
  /** app.bsky.feed.getPosts `uris` maxLength (lexicon: 25). */
  getPostsBatchSize: 25,
  /** Stop asking the AppView after this many consecutive failed batches. */
  maxConsecutiveCountFailures: 2,
  httpTimeoutMs: 10_000,
  httpMaxResponseBytes: 5_000_000,
  /** Retries after the first attempt, only for 429 and 5xx. */
  httpMaxRetries: 2,
  /** A server-requested wait longer than this is NOT honoured: the request fails as 'rate-limited'. */
  retryAfterCapMs: 5_000,
  backoffBaseMs: 500,
  /** Worker budget before falling back to the main thread. */
  analysisTimeoutMs: 5_000,
  /** Posts younger than this are flagged "settling" (heuristic borrowed from SOURCES['x-post-settling']). */
  settlingHours: 36,
  topPosts: 5,
  /** Sample AT-URIs shown per observation / metric. */
  sampleUris: 3,
  timelineMaxDays: 366,
  maxTextChars: 10_000,
  textPreviewChars: 280,
  maxTagsPerRecord: 30,
  /** Posting-time observation: minimum dated content items. */
  patternMinItems: 10,
  patternBandHours: 6,
  /** Posting-time observation: minimum share of items in the busiest band (uniform would be 0.25). */
  patternShareThreshold: 0.4,
} as const;

/** The only origins that are contacted without being derived from the authenticated DID's identity chain. */
export const ORIGINS = {
  appView: 'https://public.api.bsky.app',
  plcDirectory: 'https://plc.directory',
  /** Used ONLY by the OAuth library to resolve the typed handle at sign-in. Disclosed in the UI. */
  oauthHandleResolver: 'https://bsky.social',
} as const;

/** Loopback development origin (must match vite.config.ts). */
export const DEV_SERVER = { host: '127.0.0.1', port: 5173 } as const;

/** localStorage keys this app owns. Tokens are NEVER stored by this app (the OAuth library owns IndexedDB). */
export const STORAGE_KEYS = { accounts: 'sociallens:accounts:v1' } as const;

// ───────────────────────────── shared ports ────────────────────────────

export interface Clock {
  /** Current UTC instant. */
  now(): IsoDateTime;
  /** Monotonic-enough milliseconds for measuring durations. */
  nowMs(): number;
}

/** Resolves after `ms`, or rejects with the signal's AbortError if aborted first. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** The subset of `fetch` this app uses. `globalThis.fetch` and the fixture fetch both satisfy it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The subset of `Storage` this app uses. `localStorage` satisfies it. Methods may throw; callers must catch. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Why an origin outside ORIGINS may be contacted. */
export type OriginBasis = 'pds-from-did-document' | 'did-web-host';

export interface HttpGetRequest {
  readonly url: string;
  readonly signal: AbortSignal;
}

/**
 * The single bounded, read-only, unauthenticated HTTP path of the app.
 * `getJson` resolves with a Result for every expected failure and rejects ONLY
 * when the caller's `signal` is aborted (with that signal's reason).
 */
export interface HttpClient {
  getJson(request: HttpGetRequest): Promise<Result<JsonValue>>;
  /** Allow one extra origin for the lifetime of this client. Called only by adapters/atproto. */
  permitOrigin(origin: HttpsOrigin, basis: OriginBasis): void;
  /** Origins currently contactable (fixed + permitted), for the Accounts view and tests. */
  permittedOrigins(): readonly string[];
}

export interface HttpClientDeps {
  readonly fetch: FetchLike;
  readonly sleep: Sleep;
  readonly nowMs: () => number;
  /** Always-allowed origins; the composition root passes `[ORIGINS.appView, ORIGINS.plcDirectory]`. */
  readonly fixedOrigins: readonly string[];
  /** Optional overrides of the LIMITS http values (tests only). */
  readonly limits: Partial<HttpLimits> | null;
}

export interface HttpLimits {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  readonly retryAfterCapMs: number;
  readonly backoffBaseMs: number;
}

export type XrpcParams = Readonly<Record<string, string | number | boolean | readonly string[]>>;

// ───────────────────── runtime API of src/shared/index.ts ───────────────

/**
 * `src/shared/index.ts` must export a value for every member below, with
 * exactly these names and types (end the file with
 * `({ ... }) satisfies SharedApi` to prove it), and re-export this file
 * (`export * from './contract'`).
 */
export interface SharedApi {
  // results & failures
  ok<T>(value: T): Result<T, never>;
  err(failure: Failure): Result<never, Failure>;
  makeFailure(kind: FailureKind, message: string, extra?: Partial<Omit<Failure, 'kind' | 'message'>>): Failure;
  isAbortError(error: unknown): boolean;

  // syntax (pure; return null instead of throwing)
  parseDid(value: unknown): Did | null;
  didMethodOf(did: Did): DidMethod;
  parseHandle(value: unknown): Handle | null;
  parseNsid(value: unknown): Nsid | null;
  parseRecordKey(value: unknown): RecordKey | null;
  parseCid(value: unknown): Cid | null;
  parseAtUri(value: unknown): ParsedAtUri | null;
  makeAtUri(did: Did, collection: Nsid, rkey: RecordKey): AtUri;
  parseHttpsOrigin(value: unknown): Result<HttpsOrigin>;

  // time (pure)
  parseIsoDateTime(value: unknown): IsoDateTime | null;
  isoDateOf(instant: IsoDateTime): IsoDate;
  tidToIsoDateTime(rkey: string): IsoDateTime | null;

  // guards (pure)
  checkSelf(session: SessionRef | null, target: Did): Result<Did>;

  // http
  createHttpClient(deps: HttpClientDeps): HttpClient;
  buildXrpcUrl(origin: string, method: string, params: XrpcParams): string;

  // data helpers
  citation(sourceId: SourceId): Citation;
  statusLabelFor(value: MetricValue): StatusLabel;
  readonly GLOSSARY: Glossary;
  metricDefinition(id: MetricId): MetricDefinition;

  // default port implementations (the only impure members)
  readonly systemClock: Clock;
  readonly realSleep: Sleep;
}
