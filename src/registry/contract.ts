/**
 * M3 `registry/` — FROZEN CONTRACT.
 * Which apps and collections SocialLens knows, what each can and cannot tell us.
 * Static, versioned, no network. Types only.
 */
import type { AppId, MetricId, Nsid, RecordKind, SourceId, UnavailableMetricId, VisibilityClass } from '../shared/contract';

/** One pure mapper in `normalize/` per id. */
export type NormalizerId =
  | 'bsky.post'
  | 'bsky.repost'
  | 'bsky.like'
  | 'bsky.follow'
  | 'bsky.block'
  | 'bsky.list'
  | 'bsky.listitem'
  | 'bsky.profile'
  | 'standard.document'
  | 'standard.publication';

/** Where public interaction counters for a collection's records can be read; null = nowhere. */
export type EngagementSourceId = 'bluesky-appview';

export interface CollectionDefinition {
  readonly nsid: Nsid;
  readonly appId: AppId;
  /** Plain-language plural, e.g. "Posts & replies". */
  readonly label: string;
  readonly normalizerId: NormalizerId;
  /** Kinds this collection can produce (post collection → ['post', 'reply']). */
  readonly kinds: readonly RecordKind[];
  readonly visibility: VisibilityClass;
  /** Official source backing the visibility claim. */
  readonly visibilitySource: SourceId;
  /** Record field holding the author-supplied time, or null when the lexicon has none. */
  readonly timestampField: 'createdAt' | 'publishedAt' | null;
  /** Count source for records of this collection, or null ("not available on this app"). */
  readonly engagementSource: EngagementSourceId | null;
  /** listRecords page size to request (≤ 100). Smaller for collections with large records. */
  readonly pageSize: number;
}

export interface UnavailableOnApp {
  readonly metricId: MetricId | UnavailableMetricId;
  readonly reason: string;
}

/** Capability row: what this app can tell us. Used to hide / label unsupported cards instead of showing 0. */
export interface AppCapability {
  readonly appId: AppId;
  /** Metric ids this app contributes to. */
  readonly metrics: readonly MetricId[];
  /** Metrics that exist for other apps but not this one, each with a reason. */
  readonly unavailable: readonly UnavailableOnApp[];
  /** True when a public count source exists for this app's content. */
  readonly engagementCounts: boolean;
  /** Plain-language: how far back data goes. */
  readonly history: string;
  /** Plain-language: how fresh the data is. */
  readonly freshness: string;
}

export interface AppDefinition {
  readonly id: AppId;
  readonly displayName: string;
  /** e.g. "Reposts" for Bluesky; display aliases keyed by kind. */
  readonly kindLabels: Readonly<Partial<Record<RecordKind, string>>>;
  /** NSIDs in registry order. */
  readonly collections: readonly Nsid[];
  readonly capability: AppCapability;
  readonly source: SourceId;
}

/** Things that are NOT in the public repo, listed so the UI can say what it cannot see. */
export interface NonRepoDataNote {
  readonly label: string;
  readonly visibility: Exclude<VisibilityClass, 'public-repo'>;
  readonly explanation: string;
  readonly source: SourceId;
}

/** The whole registry as plain structured-cloneable data (crosses the Worker boundary). */
export interface RegistryData {
  /** Bump on any entry change. */
  readonly version: string;
  /** In display order. */
  readonly apps: readonly AppDefinition[];
  /** Every analysed collection, in the fixed order used for coverage rows and reads. */
  readonly collections: readonly CollectionDefinition[];
  readonly nonRepoData: readonly NonRepoDataNote[];
}

/** Result of comparing a repo's advertised collections with the registry. */
export interface CollectionInventory {
  /** Registered collections the repo advertises, in registry order. */
  readonly present: readonly Nsid[];
  /** Registered collections the repo does not advertise (observed zero records). */
  readonly absent: readonly Nsid[];
  /** Advertised, syntactically valid NSIDs the registry does not analyse, sorted ascending. */
  readonly presentNotAnalysed: readonly Nsid[];
}

/** Lookup port over RegistryData. Pure, synchronous, never throws. */
export interface Registry {
  readonly data: RegistryData;
  app(id: AppId): AppDefinition;
  /** Null for unregistered NSIDs. */
  collection(nsid: string): CollectionDefinition | null;
  /** All analysed collections in registry order (same array as `data.collections`). */
  analysedCollections(): readonly CollectionDefinition[];
  /** Classify the NSIDs a repo advertises (from describeRepo). Invalid strings are ignored. */
  inventory(advertised: readonly string[]): CollectionInventory;
}

export type CreateRegistry = () => Registry;
