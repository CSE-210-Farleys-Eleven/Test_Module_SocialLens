// Test-only builders for `analytics/` tests. Not exported from index.ts; never imported by implementation files.
import type {
  ActivityRecord,
  AppId,
  AtUri,
  Cid,
  CoverageStatus,
  Coverage,
  Did,
  Engagement,
  IsoDateTime,
  Nsid,
  RangeId,
  RecordKey,
  RecordKind,
  SkippedRecord,
  Snapshot,
} from '../shared/contract';
import type { AppDefinition, CollectionDefinition, RegistryData } from '../registry/contract';
import type { AnalyticsInput, AnalyticsOptions } from './contract';

export const N = '2026-11-10T23:59:59.000Z' as IsoDateTime;
export const DID = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;

export const NSID = {
  post: 'app.bsky.feed.post',
  repost: 'app.bsky.feed.repost',
  like: 'app.bsky.feed.like',
  follow: 'app.bsky.graph.follow',
  block: 'app.bsky.graph.block',
  list: 'app.bsky.graph.list',
  listitem: 'app.bsky.graph.listitem',
  profile: 'app.bsky.actor.profile',
  document: 'site.standard.document',
  publication: 'site.standard.publication',
} as const;

const KIND_TO_NSID: Record<RecordKind, string> = {
  post: NSID.post,
  reply: NSID.post,
  repost: NSID.repost,
  like: NSID.like,
  follow: NSID.follow,
  block: NSID.block,
  list: NSID.list,
  'list-item': NSID.listitem,
  profile: NSID.profile,
  document: NSID.document,
  publication: NSID.publication,
};

export const STANDARD_SITE_ENGAGEMENT_REASON = 'Standard.site has no public interaction counters.';

function col(
  nsid: string,
  appId: AppId,
  kinds: readonly RecordKind[],
  engagement: boolean,
): CollectionDefinition {
  return {
    nsid: nsid as Nsid,
    appId,
    label: nsid,
    normalizerId: 'bsky.post',
    kinds,
    visibility: 'public-repo',
    visibilitySource: 'bsky-privacy-policy',
    timestampField: kinds.includes('publication') ? null : 'createdAt',
    engagementSource: engagement ? 'bluesky-appview' : null,
    pageSize: 100,
  };
}

export function makeRegistry(opts: { engagement?: boolean } = {}): RegistryData {
  const engagement = opts.engagement ?? true;
  const collections: CollectionDefinition[] = [
    col(NSID.post, 'bluesky', ['post', 'reply'], engagement),
    col(NSID.repost, 'bluesky', ['repost'], false),
    col(NSID.like, 'bluesky', ['like'], false),
    col(NSID.follow, 'bluesky', ['follow'], false),
    col(NSID.block, 'bluesky', ['block'], false),
    col(NSID.list, 'bluesky', ['list'], false),
    col(NSID.listitem, 'bluesky', ['list-item'], false),
    col(NSID.profile, 'bluesky', ['profile'], false),
    col(NSID.document, 'standard-site', ['document'], false),
    col(NSID.publication, 'standard-site', ['publication'], false),
  ];
  const app = (id: AppId, counts: boolean): AppDefinition => ({
    id,
    displayName: id,
    kindLabels: {},
    collections: collections.filter((c) => c.appId === id).map((c) => c.nsid),
    capability: {
      appId: id,
      metrics: [],
      unavailable: counts
        ? []
        : [{ metricId: 'engagement.interactionsPerPost', reason: STANDARD_SITE_ENGAGEMENT_REASON }],
      engagementCounts: counts,
      history: '',
      freshness: '',
    },
    source: 'bsky-privacy-policy',
  });
  return {
    version: 'test',
    apps: [app('bluesky', engagement), app('standard-site', false)],
    collections,
    nonRepoData: [],
  };
}

let seq = 0;
export interface RecOpts {
  createdAt?: string | null;
  engagement?: Engagement;
  text?: string | null;
  uri?: string;
}
export function rec(kind: RecordKind, opts: RecOpts = {}): ActivityRecord {
  seq += 1;
  const collection = KIND_TO_NSID[kind] as Nsid;
  const rkey = (opts.uri?.split('/').pop() ?? `r${String(seq).padStart(6, '0')}`) as RecordKey;
  const app: AppId = kind === 'document' || kind === 'publication' ? 'standard-site' : 'bluesky';
  const counted = kind === 'post' || kind === 'reply';
  return {
    uri: (opts.uri ?? `at://${DID}/${collection}/${rkey}`) as AtUri,
    cid: 'bafytest' as Cid,
    did: DID,
    collection,
    rkey,
    app,
    kind,
    createdAt: (opts.createdAt === undefined ? '2026-11-10T12:00:00.000Z' : opts.createdAt) as IsoDateTime | null,
    timeSource: 'createdAt',
    rkeyTime: null,
    title: null,
    text: opts.text === undefined ? null : opts.text,
    subjectUri: null,
    subjectDid: null,
    tags: [],
    engagement: opts.engagement ?? (counted ? unknownEng() : { status: 'not-available' }),
  };
}

export function known(likes: number, reposts: number, replies: number, quotes: number): Engagement {
  return { status: 'known', counts: { likes, reposts, replies, quotes }, observedAt: N };
}
export function unknownEng(): Engagement {
  return { status: 'unknown', reason: 'lookup-failed' };
}

export function cov(nsid: string, status: CoverageStatus): Coverage {
  return {
    collection: nsid as Nsid,
    status,
    reasonCode: status === 'complete' ? 'ok' : status === 'partial' ? 'page-cap' : 'first-page-failed',
    reason:
      status === 'complete'
        ? 'Read completely.'
        : status === 'partial'
          ? `${nsid} stopped at the page limit; older records were not read.`
          : `${nsid} could not be read.`,
    pagesFetched: 1,
    returned: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    failure: null,
  };
}

export function skip(nsid: string): SkippedRecord {
  return { uri: null, collection: nsid as Nsid, stage: 'normalize', reasonCode: 'invalid-field', detail: 'bad' };
}

export interface SnapOpts {
  records?: readonly ActivityRecord[];
  /** Override coverage status per NSID; `null` removes the row. */
  coverage?: Partial<Record<string, CoverageStatus | null>>;
  skipped?: readonly SkippedRecord[];
  fetchedAt?: string;
  registry?: RegistryData;
}
export function makeSnapshot(opts: SnapOpts = {}): Snapshot {
  const registry = opts.registry ?? makeRegistry();
  const coverage: Coverage[] = [];
  for (const c of registry.collections) {
    const o = opts.coverage?.[c.nsid];
    if (o === null) continue;
    coverage.push(cov(c.nsid, o ?? 'complete'));
  }
  return {
    schemaVersion: 1,
    mode: 'demo',
    demoScenario: 'test',
    account: {
      did: DID,
      didMethod: 'plc',
      handle: null,
      handleStatus: 'valid',
      handleCheck: 'pds-attested',
      pdsOrigin: 'https://pds.example' as never,
      verifiedAt: N,
    },
    fetchedAt: (opts.fetchedAt ?? N) as IsoDateTime,
    records: opts.records ?? [],
    skipped: opts.skipped ?? [],
    coverage,
    engagementCoverage: {
      status: 'complete',
      requested: 0,
      known: 0,
      unknown: 0,
      batches: 0,
      batchesFailed: 0,
      failure: null,
      reason: 'ok',
    },
    inventoryStatus: 'known',
    unanalysedCollections: [],
    notices: [],
  };
}

export function makeOptions(range: RangeId = 'all', over: Partial<AnalyticsOptions> = {}): AnalyticsOptions {
  return { range, topPosts: 5, settlingHours: 36, timelineMaxDays: 366, textPreviewChars: 280, ...over };
}

export function makeInput(
  snap: SnapOpts = {},
  range: RangeId = 'all',
  over: Partial<AnalyticsOptions> = {},
): AnalyticsInput {
  const registry = snap.registry ?? makeRegistry();
  return { snapshot: makeSnapshot({ ...snap, registry }), registry, options: makeOptions(range, over) };
}
