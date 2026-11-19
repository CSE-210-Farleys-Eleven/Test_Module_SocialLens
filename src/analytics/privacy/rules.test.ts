import { describe, expect, it } from 'vitest';
import type {
  ActivityRecord,
  AppId,
  AtUri,
  Cid,
  Coverage,
  CoverageStatus,
  Did,
  Handle,
  HttpsOrigin,
  IsoDateTime,
  Nsid,
  RecordKey,
  RecordKind,
  SkippedRecord,
  Snapshot,
} from '../../shared/contract';
import { SOURCES } from '../../shared/contract';
import type { CollectionDefinition, RegistryData } from '../../registry/contract';
import type { NotTriggered, PrivacyInput, PrivacyObservation, PrivacyOptions, PrivacyReport } from './contract';
import { computePrivacy } from './index';

// ───────────────────────────── fixtures ─────────────────────────────

const DID = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
const OTHER_A = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' as Did;
const OTHER_B = 'did:plc:yyyyyyyyyyyyyyyyyyyyyyyy' as Did;
const FETCHED = '2026-11-18T12:00:00.000Z' as IsoDateTime;

const N = {
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

const KIND_COLLECTION: Record<RecordKind, string> = {
  post: N.post,
  reply: N.post,
  repost: N.repost,
  like: N.like,
  follow: N.follow,
  block: N.block,
  list: N.list,
  'list-item': N.listitem,
  profile: N.profile,
  document: N.document,
  publication: N.publication,
};

function col(nsid: string, appId: AppId, label: string, kinds: RecordKind[]): CollectionDefinition {
  return {
    nsid: nsid as Nsid,
    appId,
    label,
    normalizerId: 'bsky.post',
    kinds,
    visibility: 'public-repo',
    visibilitySource: 'bsky-privacy-policy',
    timestampField: 'createdAt',
    engagementSource: null,
    pageSize: 100,
  };
}

const REGISTRY: RegistryData = {
  version: 'test-1',
  apps: [
    {
      id: 'bluesky',
      displayName: 'Bluesky',
      kindLabels: {},
      collections: [N.post, N.repost, N.like, N.follow, N.block, N.list, N.listitem, N.profile] as Nsid[],
      capability: { appId: 'bluesky', metrics: [], unavailable: [], engagementCounts: true, history: '', freshness: '' },
      source: 'bsky-privacy-policy',
    },
    {
      id: 'standard-site',
      displayName: 'Standard.site',
      kindLabels: {},
      collections: [N.document, N.publication] as Nsid[],
      capability: { appId: 'standard-site', metrics: [], unavailable: [], engagementCounts: false, history: '', freshness: '' },
      source: 'standard-site',
    },
  ],
  collections: [
    col(N.post, 'bluesky', 'Posts & replies', ['post', 'reply']),
    col(N.repost, 'bluesky', 'Reposts', ['repost']),
    col(N.like, 'bluesky', 'Likes', ['like']),
    col(N.follow, 'bluesky', 'Follows', ['follow']),
    col(N.block, 'bluesky', 'Blocks', ['block']),
    col(N.list, 'bluesky', 'Lists', ['list']),
    col(N.listitem, 'bluesky', 'List memberships', ['list-item']),
    col(N.profile, 'bluesky', 'Profile', ['profile']),
    col(N.document, 'standard-site', 'Documents', ['document']),
    col(N.publication, 'standard-site', 'Publications', ['publication']),
  ],
  nonRepoData: [
    { label: 'Mutes', visibility: 'private-app', explanation: 'Stored in the app.', source: 'bsky-docs-following' },
    { label: 'Direct messages', visibility: 'private-service', explanation: 'Not in the repo.', source: 'bsky-privacy-policy' },
  ],
};

const OPTIONS: PrivacyOptions = { sampleUris: 3, patternMinItems: 10, patternBandHours: 6, patternShareThreshold: 0.4 };

let seq = 0;
interface RecOpts {
  rkey?: string;
  createdAt?: string | null;
  subjectDid?: Did | null;
  did?: Did;
  text?: string | null;
  title?: string | null;
}
function rec(kind: RecordKind, o: RecOpts = {}): ActivityRecord {
  const collection = KIND_COLLECTION[kind] as Nsid;
  const rkey = (o.rkey ?? `r${String(++seq).padStart(4, '0')}`) as RecordKey;
  const did = o.did ?? DID;
  const createdAt = o.createdAt === undefined ? '2026-01-01T00:00:00.000Z' : o.createdAt;
  return {
    uri: `at://${did}/${collection}/${rkey}` as AtUri,
    cid: 'bafyreiabcdefgh' as Cid,
    did,
    collection,
    rkey,
    app: kind === 'document' || kind === 'publication' ? 'standard-site' : 'bluesky',
    kind,
    createdAt: createdAt as IsoDateTime | null,
    timeSource: createdAt === null ? 'none' : 'createdAt',
    rkeyTime: null,
    title: o.title ?? null,
    text: o.text ?? null,
    subjectUri: null,
    subjectDid: o.subjectDid ?? null,
    tags: [],
    engagement: { status: 'not-available' },
  };
}

function cov(nsid: string, status: CoverageStatus = 'complete', reason?: string): Coverage {
  return {
    collection: nsid as Nsid,
    status,
    reasonCode: status === 'complete' ? 'ok' : status === 'partial' ? 'page-cap' : 'first-page-failed',
    reason: reason ?? (status === 'complete' ? 'Read completely.' : `${nsid} was not read completely.`),
    pagesFetched: 1,
    returned: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    failure: null,
  };
}

interface SnapOpts {
  records?: ActivityRecord[];
  coverage?: Partial<Record<string, CoverageStatus | 'missing'>>;
  coverageReason?: Partial<Record<string, string>>;
  skipped?: SkippedRecord[];
  mode?: 'live' | 'demo';
  handle?: string | null;
  handleStatus?: 'valid' | 'invalid' | 'unverified';
  handleCheck?: 'pds-attested' | 'none';
  inventoryStatus?: 'known' | 'unknown';
  unanalysed?: string[];
  engagementStatus?: CoverageStatus;
}
function snap(o: SnapOpts = {}): Snapshot {
  const coverage: Coverage[] = [];
  for (const c of REGISTRY.collections) {
    const s = o.coverage?.[c.nsid] ?? 'complete';
    if (s === 'missing') continue;
    coverage.push(cov(c.nsid, s, o.coverageReason?.[c.nsid]));
  }
  return {
    schemaVersion: 1,
    mode: o.mode ?? 'live',
    demoScenario: o.mode === 'demo' ? 'demo-1' : null,
    account: {
      did: DID,
      didMethod: 'plc',
      handle: (o.handle === undefined ? 'alice.example.com' : o.handle) as Handle | null,
      handleStatus: o.handleStatus ?? 'valid',
      handleCheck: o.handleCheck ?? 'pds-attested',
      pdsOrigin: 'https://pds.example.com' as HttpsOrigin,
      verifiedAt: FETCHED,
    },
    fetchedAt: FETCHED,
    records: o.records ?? [],
    skipped: o.skipped ?? [],
    coverage,
    engagementCoverage: {
      status: o.engagementStatus ?? 'complete',
      requested: 0,
      known: 0,
      unknown: 0,
      batches: 0,
      batchesFailed: 0,
      failure: null,
      reason: o.engagementStatus && o.engagementStatus !== 'complete' ? 'Counts for 2 posts could not be read.' : 'All counts read.',
    },
    inventoryStatus: o.inventoryStatus ?? 'known',
    unanalysedCollections: (o.unanalysed ?? []) as Nsid[],
    notices: [],
  };
}

function run(s: Snapshot, options: Partial<PrivacyOptions> = {}): PrivacyReport {
  const input: PrivacyInput = { snapshot: s, registry: REGISTRY, options: { ...OPTIONS, ...options } };
  return computePrivacy(input);
}
function obs(r: PrivacyReport, id: string): PrivacyObservation | undefined {
  return r.observations.find((o) => o.id === id);
}
function nt(r: PrivacyReport, id: string): NotTriggered | undefined {
  return r.notTriggered.find((o) => o.id === id);
}
function detail(o: PrivacyObservation | undefined, label: string): string | undefined {
  return o?.evidence.details.find((d) => d.label === label)?.value;
}
const at = (iso: string) => iso as IsoDateTime;
function post(createdAt: string | null, rkey?: string): ActivityRecord {
  return rec('post', { createdAt, ...(rkey ? { rkey } : {}) });
}
function postsAt(hour: number, count: number, day = 1): ActivityRecord[] {
  return Array.from({ length: count }, (_, i) =>
    post(`2026-03-${String(day + i).padStart(2, '0')}T${String(hour).padStart(2, '0')}:30:00.000Z`),
  );
}
function skippedIn(collection: string): SkippedRecord {
  return { uri: null, collection: collection as Nsid, stage: 'normalize', reasonCode: 'invalid-field', detail: 'bad field' };
}

// ───────────────────────── record observations ─────────────────────────

describe('record observations', () => {
  it('3 likes, complete coverage → triggered, exact count, samples newest first, earliest/latest', () => {
    const likes = [
      rec('like', { rkey: 'a1', createdAt: '2026-01-01T00:00:00.000Z' }),
      rec('like', { rkey: 'a2', createdAt: '2026-03-01T00:00:00.000Z' }),
      rec('like', { rkey: 'a3', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const r = run(snap({ records: likes }));
    const o = obs(r, 'public-likes');
    expect(o).toBeDefined();
    expect(o?.evidence.count).toBe(3);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(o?.evidence.sampleUris).toEqual([likes[1]?.uri, likes[2]?.uri, likes[0]?.uri]);
    expect(o?.evidence.earliestAt).toBe('2026-01-01T00:00:00.000Z');
    expect(o?.evidence.latestAt).toBe('2026-03-01T00:00:00.000Z');
    expect(o?.evidence.collections).toEqual([N.like]);
    expect(o?.source.url).toBe(SOURCES['bsky-privacy-policy'].url);
    expect(o?.summary).toBe('In the records fetched, 3 like records are public.');
  });

  it('caps samples; ties on createdAt break by URI ascending; undated sort last', () => {
    const l1 = rec('like', { rkey: 'l1', createdAt: '2026-01-02T00:00:00.000Z' });
    const l2 = rec('like', { rkey: 'l2', createdAt: '2026-01-03T00:00:00.000Z' });
    const l3 = rec('like', { rkey: 'l3', createdAt: '2026-01-03T00:00:00.000Z' });
    const l4 = rec('like', { rkey: 'l4', createdAt: null });
    const l5 = rec('like', { rkey: 'l5', createdAt: '2026-01-01T00:00:00.000Z' });
    const records = [l4, l3, l5, l1, l2];
    const three = obs(run(snap({ records })), 'public-likes');
    expect(three?.evidence.sampleUris).toEqual([l2.uri, l3.uri, l1.uri]);
    const all = obs(run(snap({ records }), { sampleUris: 5 }), 'public-likes');
    expect(all?.evidence.sampleUris).toEqual([l2.uri, l3.uri, l1.uri, l5.uri, l4.uri]);
    expect(all?.evidence.count).toBe(5);
    expect(all?.evidence.earliestAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('likes coverage partial → lower-bound and the summary says "at least"', () => {
    const r = run(snap({ records: [rec('like'), rec('like'), rec('like')], coverage: { [N.like]: 'partial' } }));
    const o = obs(r, 'public-likes');
    expect(o?.evidence.countCertainty).toBe('lower-bound');
    expect(o?.summary).toBe('In the records fetched, at least 3 like records are public.');
  });

  it('likes coverage unavailable → not triggered "could not be read"', () => {
    const r = run(snap({ coverage: { [N.like]: 'unavailable' } }));
    expect(obs(r, 'public-likes')).toBeUndefined();
    expect(nt(r, 'public-likes')?.reason).toBe('The Likes collection could not be read, so this was not assessed.');
  });

  it('a missing coverage row counts as unavailable', () => {
    const r = run(snap({ coverage: { [N.like]: 'missing' } }));
    expect(nt(r, 'public-likes')?.reason).toBe('The Likes collection could not be read, so this was not assessed.');
  });

  it('0 likes, complete → not triggered "No like records were fetched."', () => {
    expect(nt(run(snap()), 'public-likes')?.reason).toBe('No like records were fetched.');
  });

  it.each([
    ['follow', 'public-follows', N.follow, 'Follows', 'follow', 'bsky-privacy-policy'],
    ['block', 'public-blocks', N.block, 'Blocks', 'block', 'bsky-docs-following'],
  ] as const)('%s records behave the same way', (kind, id, nsid, label, noun, source) => {
    const rs = [rec(kind, { subjectDid: OTHER_A }), rec(kind, { subjectDid: OTHER_B })];
    const r = run(snap({ records: rs }));
    const o = obs(r, id);
    expect(o?.evidence.count).toBe(2);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(o?.evidence.collections).toEqual([nsid]);
    expect(o?.source.url).toBe(SOURCES[source].url);
    expect(o?.summary).toBe(`In the records fetched, 2 ${noun} records are public.`);

    const partial = obs(run(snap({ records: rs, coverage: { [nsid]: 'partial' } })), id);
    expect(partial?.evidence.countCertainty).toBe('lower-bound');

    expect(nt(run(snap()), id)?.reason).toBe(`No ${noun} records were fetched.`);
    expect(nt(run(snap({ coverage: { [nsid]: 'unavailable' } })), id)?.reason).toBe(
      `The ${label} collection could not be read, so this was not assessed.`,
    );
  });

  it('uses singular wording for one record', () => {
    const o = obs(run(snap({ records: [rec('block', { subjectDid: OTHER_A })] })), 'public-blocks');
    expect(o?.summary).toBe('In the records fetched, 1 block record is public.');
  });

  it('public-lists counts lists + list-items and reports both in details', () => {
    const rs = [rec('list', { title: 'Secret list name' }), rec('list-item', { subjectDid: OTHER_A }), rec('list-item', { subjectDid: OTHER_B })];
    const o = obs(run(snap({ records: rs })), 'public-lists');
    expect(o?.evidence.count).toBe(3);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(detail(o, 'Lists')).toBe('1');
    expect(detail(o, 'List memberships you created')).toBe('2');
    expect(o?.evidence.collections).toEqual([N.list, N.listitem]);
    expect(o?.evidence.sampleUris).toHaveLength(3);
  });

  it('public-lists triggers with only list-items', () => {
    const o = obs(run(snap({ records: [rec('list-item', { subjectDid: OTHER_A })] })), 'public-lists');
    expect(o?.evidence.count).toBe(1);
    expect(detail(o, 'Lists')).toBe('0');
  });

  it('public-lists with the list collection unavailable and 2 list-items → lower-bound, never a reassuring zero', () => {
    const rs = [rec('list-item', { subjectDid: OTHER_A }), rec('list-item', { subjectDid: OTHER_B })];
    const o = obs(run(snap({ records: rs, coverage: { [N.list]: 'unavailable' } })), 'public-lists');
    expect(o?.evidence.count).toBe(2);
    expect(o?.evidence.countCertainty).toBe('lower-bound');
    expect(detail(o, 'Lists')).toBe('could not be read');
    expect(o?.summary).toMatch(/at least 2 /);
  });

  it('public-lists with both collections unavailable → not triggered (label of the first collection)', () => {
    const r = run(snap({ coverage: { [N.list]: 'unavailable', [N.listitem]: 'unavailable' } }));
    expect(nt(r, 'public-lists')?.reason).toBe('The Lists collection could not be read, so this was not assessed.');
  });

  it('0 list records → "No list records were fetched."', () => {
    expect(nt(run(snap()), 'public-lists')?.reason).toBe('No list records were fetched.');
  });

  it('a skipped record in the like collection → lower-bound', () => {
    const o = obs(run(snap({ records: [rec('like')], skipped: [skippedIn(N.like)] })), 'public-likes');
    expect(o?.evidence.countCertainty).toBe('lower-bound');
  });

  it('demo summary starts "In this synthetic example, "; live "In the records fetched, "', () => {
    const demo = run(snap({ mode: 'demo', records: [rec('like')] }));
    expect(demo.mode).toBe('demo');
    for (const o of demo.observations) expect(o.summary.startsWith('In this synthetic example, ')).toBe(true);
    const live = run(snap({ records: [rec('like')], handleStatus: 'invalid' }));
    for (const o of live.observations) expect(o.summary.startsWith('In the records fetched, ')).toBe(true);
  });

  it("a record whose URI is not the person's own is never a sample and makes the count a lower bound", () => {
    const own = rec('like');
    const foreign = rec('like', { did: OTHER_A, createdAt: '2026-06-01T00:00:00.000Z' });
    const o = obs(run(snap({ records: [own, foreign] })), 'public-likes');
    expect(o?.evidence.sampleUris).toEqual([own.uri]);
    expect(o?.evidence.count).toBe(1);
    expect(o?.evidence.countCertainty).toBe('lower-bound');
  });
});

// ─────────────────────── a rich snapshot for global checks ───────────────────────

function richSnapshot(): Snapshot {
  return snap({
    records: [
      ...postsAt(20, 8),
      rec('reply', { createdAt: '2026-04-01T21:00:00.000Z', text: 'private reply text' }),
      rec('document', { createdAt: '2026-04-02T22:00:00.000Z', title: 'Doc title' }),
      rec('like', { createdAt: '2026-05-01T00:00:00.000Z' }),
      rec('follow', { subjectDid: OTHER_A }),
      rec('block', { subjectDid: OTHER_B }),
      rec('list', { title: 'A list' }),
      rec('list-item', { subjectDid: OTHER_A }),
      rec('list-item', { subjectDid: OTHER_B }),
    ],
    coverage: { [N.repost]: 'partial' },
    handleStatus: 'unverified',
    handleCheck: 'none',
    unanalysed: ['com.example.thing'],
  });
}

describe('privacy of third parties and own-record samples', () => {
  it('every sample URI has the snapshot DID as authority', () => {
    const r = run(richSnapshot());
    expect(r.observations.length).toBeGreaterThan(4);
    for (const o of r.observations) {
      for (const u of o.evidence.sampleUris) expect(u.startsWith(`at://${DID}/`)).toBe(true);
    }
  });

  it('the serialised report contains none of the subjectDid values, nor record text or titles', () => {
    const s = richSnapshot();
    const json = JSON.stringify(run(s));
    const subjects = s.records.map((x) => x.subjectDid).filter((x): x is Did => x !== null);
    expect(subjects.length).toBeGreaterThan(0);
    for (const d of subjects) expect(json).not.toContain(d);
    expect(json).not.toContain('private reply text');
    expect(json).not.toContain('Doc title');
    expect(json).not.toContain('A list');
  });

  it('has no score, severity or ranking field', () => {
    const json = JSON.stringify(run(richSnapshot()));
    expect(json).not.toMatch(/"(score|severity|rank|ranking|risk)"/i);
  });
});

// ─────────────────────────── cross-app identity ───────────────────────────

describe('cross-app-identity', () => {
  it('only Bluesky records → not triggered', () => {
    const r = run(snap({ records: [post('2026-01-01T00:00:00.000Z'), rec('like')] }));
    expect(nt(r, 'cross-app-identity')?.reason).toBe('Records from only one app were fetched.');
  });

  it('Bluesky + one document → count 2, one sample per app, per-app details', () => {
    const p1 = post('2026-01-01T00:00:00.000Z', 'p1');
    const p2 = post('2026-02-01T00:00:00.000Z', 'p2');
    const d = rec('document', { rkey: 'd1', createdAt: '2026-01-15T00:00:00.000Z' });
    const o = obs(run(snap({ records: [p1, p2, d] })), 'cross-app-identity');
    expect(o?.evidence.count).toBe(2);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(o?.evidence.sampleUris).toEqual([p2.uri, d.uri]);
    expect(o?.evidence.details).toEqual([
      { label: 'Bluesky', value: '2 records' },
      { label: 'Standard.site', value: '1 record' },
    ]);
    expect(o?.evidence.collections).toEqual([N.post, N.document]);
    expect(o?.evidence.earliestAt).toBe('2026-01-01T00:00:00.000Z');
    expect(o?.evidence.latestAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

// ─────────────────────────── posting-time pattern ───────────────────────────

describe('posting-time-pattern', () => {
  it('9 dated content items → not triggered "Fewer than 10…"', () => {
    const r = run(snap({ records: postsAt(20, 9) }));
    expect(nt(r, 'posting-time-pattern')?.reason).toBe('Fewer than 10 dated content items were fetched.');
  });

  it('10 items, 4 in 18–23 UTC and 2 in each other band → triggered', () => {
    const r = run(snap({ records: [...postsAt(19, 4), ...postsAt(1, 2), ...postsAt(7, 2), ...postsAt(13, 2)] }));
    const o = obs(r, 'posting-time-pattern');
    expect(o?.evidence.count).toBe(4);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(detail(o, 'Busiest band')).toBe('18:00–23:59 UTC');
    expect(detail(o, 'Share')).toBe('40% of 10 dated items');
    expect(o?.evidence.sampleUris).toHaveLength(3);
    expect(o?.evidence.collections).toEqual([N.post, N.document]);
    expect(o?.summary).toBe('In the records fetched, 4 of 10 dated content items fall in 18:00–23:59 UTC.');
  });

  it('samples come from the busiest band only', () => {
    const band = postsAt(19, 4);
    const r = run(snap({ records: [...band, ...postsAt(1, 2, 20), ...postsAt(7, 2, 20), ...postsAt(13, 2, 20)] }));
    const uris = new Set(band.map((b) => b.uri));
    for (const u of obs(r, 'posting-time-pattern')?.evidence.sampleUris ?? []) expect(uris.has(u)).toBe(true);
  });

  it('12 items spread 3/3/3/3 → not triggered "No 6-hour UTC band…"', () => {
    const r = run(snap({ records: [...postsAt(1, 3), ...postsAt(7, 3), ...postsAt(13, 3), ...postsAt(19, 3)] }));
    expect(nt(r, 'posting-time-pattern')?.reason).toBe('No 6-hour UTC band holds 40% or more of your dated content items.');
  });

  it('tie between two bands above the threshold → the earliest band', () => {
    const r = run(snap({ records: [...postsAt(19, 4), ...postsAt(7, 4), ...postsAt(1, 2)] }));
    const o = obs(r, 'posting-time-pattern');
    expect(detail(o, 'Busiest band')).toBe('06:00–11:59 UTC');
    expect(detail(o, 'Share')).toBe('40% of 10 dated items');
  });

  it('likes do not count; undated and future-dated posts are ignored', () => {
    const likes = Array.from({ length: 5 }, () => rec('like', { createdAt: '2026-03-01T20:00:00.000Z' }));
    const r = run(
      snap({ records: [...postsAt(20, 9), ...likes, post(null), post('2026-12-01T20:00:00.000Z')] }),
    );
    expect(nt(r, 'posting-time-pattern')?.reason).toBe('Fewer than 10 dated content items were fetched.');
  });

  it('documents count as content items', () => {
    const docs = Array.from({ length: 2 }, (_, i) => rec('document', { createdAt: `2026-05-0${i + 1}T20:00:00.000Z` }));
    const o = obs(run(snap({ records: [...postsAt(20, 8), ...docs] })), 'posting-time-pattern');
    expect(detail(o, 'Share')).toBe('100% of 10 dated items');
  });

  it('band boundaries: 05:59:59Z → 00–05; 06:00:00Z → 06–11', () => {
    const others = [...postsAt(13, 2), ...postsAt(19, 2)];
    const early = Array.from({ length: 4 }, (_, i) => post(`2026-06-0${i + 1}T05:59:59.000Z`));
    const r1 = run(snap({ records: [...early, ...postsAt(7, 2), ...others] }));
    expect(detail(obs(r1, 'posting-time-pattern'), 'Busiest band')).toBe('00:00–05:59 UTC');
    const six = Array.from({ length: 4 }, (_, i) => post(`2026-06-0${i + 1}T06:00:00.000Z`));
    const r2 = run(snap({ records: [...six, ...postsAt(1, 2), ...others] }));
    expect(detail(obs(r2, 'posting-time-pattern'), 'Busiest band')).toBe('06:00–11:59 UTC');
  });

  it('rounds the share half up', () => {
    // 5 of 8 = 62.5% → 63%  (8 < 10, so lower patternMinItems for this case)
    const r = run(snap({ records: [...postsAt(19, 5), ...postsAt(1, 3)] }), { patternMinItems: 8 });
    expect(detail(obs(r, 'posting-time-pattern'), 'Share')).toBe('63% of 8 dated items');
  });

  it('partial content coverage → lower-bound', () => {
    const r = run(snap({ records: postsAt(20, 10), coverage: { [N.post]: 'partial' } }));
    expect(obs(r, 'posting-time-pattern')?.evidence.countCertainty).toBe('lower-bound');
  });
});

// ─────────────────────────── handle validity ───────────────────────────

describe('handle-validity', () => {
  it("'valid' → not triggered", () => {
    expect(nt(run(snap()), 'handle-validity')?.reason).toBe('Your PDS confirms the handle resolves to this account.');
  });

  it("'invalid' → triggered, count null, unknown, no samples, details", () => {
    const o = obs(run(snap({ handleStatus: 'invalid' })), 'handle-validity');
    expect(o?.evidence.count).toBeNull();
    expect(o?.evidence.countCertainty).toBe('unknown');
    expect(o?.evidence.sampleUris).toEqual([]);
    expect(o?.evidence.details).toEqual([
      { label: 'Handle', value: 'alice.example.com' },
      { label: 'Status', value: 'invalid' },
      { label: 'Checked by', value: 'your PDS (describeRepo)' },
    ]);
    expect(o?.source.url).toBe(SOURCES['atproto-spec-handle'].url);
  });

  it("'unverified' → triggered with \"not checked\"; no handle → \"none\"", () => {
    const o = obs(run(snap({ handleStatus: 'unverified', handleCheck: 'none', handle: null })), 'handle-validity');
    expect(detail(o, 'Status')).toBe('unverified');
    expect(detail(o, 'Checked by')).toBe('not checked');
    expect(detail(o, 'Handle')).toBe('none');
  });
});

// ─────────────────────────── incomplete coverage ───────────────────────────

describe('incomplete-coverage', () => {
  it('everything complete → not triggered', () => {
    expect(nt(run(snap()), 'incomplete-coverage')?.reason).toBe('Every analysed collection was read completely.');
  });

  it('one partial collection → triggered with a row quoting its reason', () => {
    const o = obs(
      run(snap({ coverage: { [N.like]: 'partial' }, coverageReason: { [N.like]: 'Likes stopped at the 10-page limit.' } })),
      'incomplete-coverage',
    );
    expect(o?.evidence.count).toBe(1);
    expect(o?.evidence.countCertainty).toBe('exact');
    expect(o?.evidence.collections).toEqual([N.like]);
    expect(o?.evidence.details).toContainEqual({ label: 'Likes', value: 'Likes stopped at the 10-page limit.' });
    expect(o?.evidence.sampleUris).toEqual([]);
    expect(o?.source.url).toBe(SOURCES['lexicon-list-records'].url);
  });

  it.each<[string, SnapOpts]>([
    ['engagement coverage partial', { engagementStatus: 'partial' }],
    ['one skipped record', { skipped: [skippedIn(N.like)] }],
    ["inventoryStatus 'unknown'", { inventoryStatus: 'unknown' }],
    ['one unanalysed collection', { unanalysed: ['com.example.thing'] }],
  ])('%s alone fires it', (_name, o) => {
    const r = run(snap(o));
    const ob = obs(r, 'incomplete-coverage');
    expect(ob).toBeDefined();
    expect(ob?.summary.startsWith('In the records fetched, ')).toBe(true);
    expect(ob?.evidence.details.length).toBeGreaterThan(0);
  });

  it('reports skipped and present-not-analysed counts', () => {
    const o = obs(
      run(snap({ skipped: [skippedIn(N.like), skippedIn(N.post)], unanalysed: ['com.example.a', 'com.example.b', 'com.example.c'] })),
      'incomplete-coverage',
    );
    expect(detail(o, 'Skipped records')).toBe('2');
    expect(detail(o, 'Present, not analysed')).toBe('3');
  });
});

// ─────────────────────────── report level ───────────────────────────

describe('report', () => {
  it('empty snapshot (complete coverage) → 0 observations, 8 not triggered', () => {
    const r = run(snap());
    expect(r.observations).toEqual([]);
    expect(r.notTriggered).toHaveLength(8);
    expect(r.schemaVersion).toBe(1);
    expect(r.did).toBe(DID);
    expect(r.fetchedAt).toBe(FETCHED);
  });

  it('lengths always sum to 8, ids unique and in catalogue order', () => {
    const ids = ['public-likes', 'public-follows', 'public-blocks', 'public-lists', 'cross-app-identity', 'posting-time-pattern', 'handle-validity', 'incomplete-coverage'];
    for (const s of [snap(), richSnapshot(), snap({ coverage: { [N.like]: 'unavailable' } })]) {
      const r = run(s);
      const all = [...r.observations.map((o) => o.id), ...r.notTriggered.map((n) => n.id)];
      expect(all).toHaveLength(8);
      expect(new Set(all).size).toBe(8);
      expect(r.observations.map((o) => o.id)).toEqual(ids.filter((i) => r.observations.some((o) => o.id === i)));
      expect(r.notTriggered.map((o) => o.id)).toEqual(ids.filter((i) => r.notTriggered.some((o) => o.id === i)));
    }
  });

  it('I-14: every observation has all four parts and a cited URL from SOURCES', () => {
    const urls = Object.values(SOURCES).map((s) => s.url);
    for (const o of run(richSnapshot()).observations) {
      expect(o.title).not.toBe('');
      expect(o.summary).not.toBe('');
      expect(o.limitation).not.toBe('');
      expect(o.action).not.toBe('');
      expect(urls).toContain(o.source.url);
      expect(o.evidence).toBeTypeOf('object');
    }
  });

  it('notAssessed equals the registry nonRepoData', () => {
    expect(run(snap()).notAssessed).toEqual(REGISTRY.nonRepoData);
  });

  it('survives structuredClone, is deterministic, and does not mutate the input', () => {
    const s = richSnapshot();
    const frozen = JSON.stringify(s);
    const a = run(s);
    const b = run(s);
    expect(b).toEqual(a);
    expect(structuredClone(a)).toEqual(a);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('never throws on odd input (malformed timestamps, zero sample cap)', () => {
    const bad = { ...rec('post'), createdAt: 'not-a-date' as IsoDateTime };
    expect(() => run(snap({ records: [bad, rec('like')] }), { sampleUris: 0 })).not.toThrow();
    expect(obs(run(snap({ records: [rec('like')] }), { sampleUris: 0 }), 'public-likes')?.evidence.sampleUris).toEqual([]);
  });

  it('uses the fetchedAt reference, not a clock, for future-dated items', () => {
    const r = run(snap({ records: [rec('like', { createdAt: '2027-01-01T00:00:00.000Z' }), rec('like')] }));
    expect(obs(r, 'public-likes')?.evidence.latestAt).toBe(at('2026-01-01T00:00:00.000Z'));
  });
});
