// Deterministic, fully synthetic repository + AppView data for each demo scenario.
// The TID encoder (s32 alphabet, 11 timestamp chars + 2 clock-id chars) is
// adapted from bluesky-social/atproto (MIT), packages/common-web/src/tid.ts and util.ts (s32encode).
//
// No Math.random, no Date.now: every value is a pure function of the scenario id.

import type { EngagementCounts, JsonObject, JsonValue } from '../../shared/contract';
import { DEMO_ACCOUNT, type DemoScenarioId } from './contract';

// ───────────────────────────── registered collections ─────────────────────────────

/**
 * Written out here on purpose (not imported from `registry/`): if the registry changes and the
 * fixtures are not updated, an integration test fails. Page sizes mirror the registry contract.
 */
export const REGISTERED_COLLECTIONS = [
  { nsid: 'app.bsky.feed.post', pageSize: 100 },
  { nsid: 'app.bsky.feed.repost', pageSize: 100 },
  { nsid: 'app.bsky.feed.like', pageSize: 100 },
  { nsid: 'app.bsky.graph.follow', pageSize: 100 },
  { nsid: 'app.bsky.graph.block', pageSize: 100 },
  { nsid: 'app.bsky.graph.list', pageSize: 100 },
  { nsid: 'app.bsky.graph.listitem', pageSize: 100 },
  { nsid: 'app.bsky.actor.profile', pageSize: 100 },
  { nsid: 'site.standard.document', pageSize: 50 },
  { nsid: 'site.standard.publication', pageSize: 100 },
] as const;

const POST = 'app.bsky.feed.post';
const LISTBLOCK = 'app.bsky.graph.listblock';
const CHAT_DECLARATION = 'chat.bsky.actor.declaration';

// ─────────────────────────────────── types ───────────────────────────────────

/** One item exactly as listRecords would serve it, plus generator-side bookkeeping. */
export interface ListItem {
  readonly uri: string;
  readonly cid: string;
  readonly value: JsonValue;
  readonly rkey: string;
  /** True for a well-formed own envelope (what a correct client accepts). Never served. */
  readonly valid: boolean;
  /** The body's own timestamp (`createdAt` / `publishedAt`), or null when the body has none. */
  readonly createdAt: string | null;
}

/**
 * How a collection's listRecords route misbehaves:
 * - `rate-limit-first-request`: the first request to it → 429 (`Retry-After: 0`), then normal;
 * - `fail-after-first-page`: any request carrying a cursor → 500 (`Retry-After: 0`) every time;
 * - `fail-always`: every request → 500 (`Retry-After: 0`).
 */
export type FailureScript = 'none' | 'rate-limit-first-request' | 'fail-after-first-page' | 'fail-always';

export interface CollectionData {
  readonly nsid: string;
  /** Newest first, strictly descending rkeys (so `rkey < cursor` pagination is exact). */
  readonly items: readonly ListItem[];
  readonly script: FailureScript;
}

export interface PostView extends JsonObject {
  readonly uri: string;
  readonly cid: string;
  readonly author: { readonly did: string; readonly handle: string };
  readonly record: JsonValue;
  readonly likeCount: number;
  readonly repostCount: number;
  readonly replyCount: number;
  readonly quoteCount: number;
  readonly indexedAt: string;
}

export interface PostViewSource {
  readonly uri: string;
  readonly view: PostView;
}

export interface ScenarioData {
  readonly scenario: DemoScenarioId;
  readonly handleIsCorrect: boolean;
  /** describeRepo `collections`, sorted ascending. */
  readonly advertised: readonly string[];
  readonly collections: readonly CollectionData[];
  /** What the AppView knows: one view per own post the AppView has indexed. */
  readonly postViews: readonly PostViewSource[];
  /** A getPosts request containing any of these URIs → 500 (`Retry-After: 0`), every time. */
  readonly countFailUris: readonly string[];
  /** These URIs are never returned by getPosts (deleted / not indexed). */
  readonly countOmitUris: readonly string[];
}

// ─────────────────────────────── primitives ───────────────────────────────

const S32_CHAR = '234567abcdefghijklmnopqrstuvwxyz';

function s32encode(i: number): string {
  let s = '';
  let n = i;
  while (n) {
    const c = n % 32;
    n = Math.floor(n / 32);
    s = S32_CHAR.charAt(c) + s;
  }
  return s;
}

/** TID for an instant in ms (micros = ms * 1000, exact below 2^53) and a clock id 0–1023. */
export function tidFromMs(ms: number, clockId: number): string {
  return `${s32encode(ms * 1000).padStart(11, '2')}${s32encode(clockId % 1024).padStart(2, '2')}`;
}

/** 24 chars of [a-z2-7]: `prefix` + base32 digits of `n`, left-padded with '2'. */
function plcSuffix(prefix: string, n: number): string {
  return prefix + s32encode(n).padStart(24 - prefix.length, '2');
}

/** Synthetic third-party DID number `n` (never the demo DID). */
export function peerDid(n: number): string {
  return `did:plc:${plcSuffix('syntheticpeer', n)}`;
}

/** A DID that is not the demo account, used for the foreign-owner probe item. */
export const FOREIGN_DID = 'did:plc:syntheticotheraccount222';

/** `bafyrei` + 52 chars of [a-z2-7]: 45 pseudo-random chars from an integer hash, then the counter. */
function cidFor(counter: number): string {
  let x = (counter * 2654435761 + 0x9e3779b9) >>> 0;
  let body = '';
  for (let k = 0; k < 45; k++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    body += S32_CHAR.charAt(x % 32);
  }
  return `bafyrei${body}${s32encode(counter).padStart(7, '2')}`;
}

const iso = (ms: number) => new Date(ms).toISOString();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW_MS = Date.parse(DEMO_ACCOUNT.now);
const NOW_DAY_START = Date.parse(`${DEMO_ACCOUNT.now.slice(0, 10)}T00:00:00.000Z`);

const did = DEMO_ACCOUNT.did;
const ownUri = (collection: string, rkey: string) => `at://${did}/${collection}/${rkey}`;

// ─────────────────────────────── text ───────────────────────────────

export const PROBE_TEXT = 'Is <b>this</b> shown as text? <img src=x onerror=alert(1)>';

const TOPICS = [
  'seed trays on the windowsill',
  'a slow loaf of bread',
  'tidying a bookshelf',
  'an evening walk route',
  'a half-finished jigsaw puzzle',
  'a pot of vegetable soup',
  'rearranging a desk',
  'a quick pencil sketch',
  'watering the herbs',
  'a rainy afternoon',
  'sorting old photos',
  'a new tea blend',
] as const;
const TAGS = ['synthdemo', 'garden', 'reading', 'cooking'] as const;

const topic = (n: number) => TOPICS[n % TOPICS.length]!;

// ─────────────────────────────── schedules ───────────────────────────────

/**
 * Post timestamps (ms), newest first, for up to 120 posts inside the 60 UTC days ending at now.
 * Today 20:14 and yesterday 19:42 are the only two inside the 36 h settling window. Each earlier
 * day (2–59 days ago) has a first post at 19:00–23:59 and a second one at 18:xx every third day,
 * otherwise 07:00–16:59; days 2 and 31 ago get a third post at 06:xx.
 */
const POST_SCHEDULE: readonly number[] = (() => {
  const out = [
    NOW_DAY_START + 20 * HOUR + 14 * MINUTE + 5 * SECOND,
    NOW_DAY_START - DAY + 19 * HOUR + 42 * MINUTE + 31 * SECOND,
  ];
  for (let d = 0; d < 58; d++) {
    const day = NOW_DAY_START - (2 + d) * DAY;
    out.push(day + (19 + (d % 5)) * HOUR + ((d * 7) % 60) * MINUTE + ((d * 13) % 60) * SECOND);
    out.push(day + (d % 3 === 0 ? 18 : 7 + (d % 10)) * HOUR + ((d * 11) % 60) * MINUTE + ((d * 17) % 60) * SECOND);
    if (d % 29 === 0) out.push(day + 6 * HOUR + ((d * 3) % 60) * MINUTE + 9 * SECOND);
  }
  return out;
})();

function postTime(i: number): number {
  const t = POST_SCHEDULE[i];
  if (t === undefined) throw new RangeError(`no schedule slot for post ${i}`);
  return t;
}

/** `count` whole-second instants, newest first, evenly spread over `spanDays` before `now - offsetHours`. */
function spread(count: number, spanDays: number, offsetHours: number): number[] {
  const end = Math.floor((NOW_MS - offsetHours * HOUR) / SECOND);
  const span = spanDays * 86_400;
  return Array.from({ length: count }, (_, k) => (end - Math.floor(((k + 1) * span) / count)) * SECOND);
}

// ─────────────────────────────── builders ───────────────────────────────

interface Builder {
  nextCid(): string;
  nextPeer(): number;
}

function makeBuilder(): Builder {
  let cid = 0;
  let peer = 0;
  return { nextCid: () => cidFor(++cid), nextPeer: () => ++peer };
}

function item(b: Builder, collection: string, ms: number, value: JsonObject, ts: string | null): ListItem {
  const rkey = tidFromMs(ms, 0);
  return { uri: ownUri(collection, rkey), cid: b.nextCid(), value, rkey, valid: true, createdAt: ts };
}

function peerPostRef(b: Builder, ms: number): JsonObject {
  return { uri: `at://${peerDid(b.nextPeer())}/${POST}/${tidFromMs(ms - 3 * HOUR, 7)}`, cid: b.nextCid() };
}

interface PostOptions {
  readonly count: number;
  readonly probe: boolean;
  /** 0-based index of a post whose body omits `text` (a well-formed envelope normalize must skip). */
  readonly textlessIndex: number | null;
}

function buildPosts(b: Builder, o: PostOptions): ListItem[] {
  const out: ListItem[] = [];
  for (let i = 0; i < o.count; i++) {
    const ms = postTime(i);
    const createdAt = iso(ms);
    const isReply = i % 4 === 3;
    const n = o.count - i; // 1 = oldest
    const value: Record<string, JsonValue> = { $type: POST };
    if (i !== o.textlessIndex) {
      let text = isReply ? `Synthetic demo reply ${n}: agreed about ${topic(i)}.` : `Synthetic demo post ${n}: ${topic(i)}.`;
      if (o.probe && i === 2) text = PROBE_TEXT;
      if (!isReply && i % 5 === 0 && !(o.probe && i === 2)) {
        const tag = TAGS[i % TAGS.length]!;
        const byteStart = text.length + 1; // ASCII only, so UTF-16 length === UTF-8 bytes
        text = `${text} #${tag}`;
        value['facets'] = [
          {
            index: { byteStart, byteEnd: byteStart + 1 + tag.length },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
          },
        ];
      }
      value['text'] = text;
    }
    if (i % 7 === 0) value['tags'] = ['demo-sample'];
    if (isReply) {
      const ref = peerPostRef(b, ms);
      value['reply'] = { root: ref, parent: ref };
    }
    value['langs'] = ['en'];
    value['createdAt'] = createdAt;
    out.push(item(b, POST, ms, value, createdAt));
  }
  return out;
}

function buildSubjectPosts(b: Builder, collection: string, times: readonly number[]): ListItem[] {
  return times.map((ms) => {
    const createdAt = iso(ms);
    return item(b, collection, ms, { $type: collection, subject: peerPostRef(b, ms), createdAt }, createdAt);
  });
}

function buildSubjectDids(b: Builder, collection: string, times: readonly number[]): ListItem[] {
  return times.map((ms) => {
    const createdAt = iso(ms);
    return item(b, collection, ms, { $type: collection, subject: peerDid(b.nextPeer()), createdAt }, createdAt);
  });
}

const LIST_NAMES = ['Synthetic reading circle', 'Synthetic garden notes'] as const;

function buildLists(b: Builder, times: readonly number[]): ListItem[] {
  return times.map((ms, k) => {
    const createdAt = iso(ms);
    const value: JsonObject = {
      $type: 'app.bsky.graph.list',
      purpose: 'app.bsky.graph.defs#curatelist',
      name: LIST_NAMES[k % LIST_NAMES.length]!,
      description: 'A fictional list in the SocialLens demo.',
      createdAt,
    };
    return item(b, 'app.bsky.graph.list', ms, value, createdAt);
  });
}

function buildListItems(b: Builder, lists: readonly ListItem[], times: readonly number[]): ListItem[] {
  return times.map((ms, k) => {
    const createdAt = iso(ms);
    const list = lists[k % lists.length]!;
    const value: JsonObject = { $type: 'app.bsky.graph.listitem', subject: peerDid(b.nextPeer()), list: list.uri, createdAt };
    return item(b, 'app.bsky.graph.listitem', ms, value, createdAt);
  });
}

function buildProfile(b: Builder): ListItem {
  const createdAt = iso(NOW_MS - 90 * DAY);
  const value: JsonObject = {
    $type: 'app.bsky.actor.profile',
    displayName: 'Synthetic Demo Account',
    description: 'A fictional profile used by the SocialLens demo. Not a real person.',
    createdAt,
  };
  return { uri: ownUri('app.bsky.actor.profile', 'self'), cid: b.nextCid(), value, rkey: 'self', valid: true, createdAt };
}

function buildPublication(b: Builder): ListItem {
  const value: JsonObject = {
    $type: 'site.standard.publication',
    url: 'https://notes.synthetic-demo.example',
    name: 'Synthetic Notes',
    description: 'A fictional publication used by the SocialLens demo.',
  };
  return item(b, 'site.standard.publication', NOW_MS - 80 * DAY, value, null);
}

const DOC_TIMES = [
  NOW_DAY_START - 11 * DAY + 20 * HOUR + 15 * MINUTE,
  NOW_DAY_START - 29 * DAY + 21 * HOUR + 40 * MINUTE,
  NOW_DAY_START - 43 * DAY + 10 * HOUR + 5 * MINUTE,
  NOW_DAY_START - 56 * DAY + 19 * HOUR + 30 * MINUTE,
] as const;

function buildDocuments(b: Builder, publication: ListItem, count: number): ListItem[] {
  return DOC_TIMES.slice(0, count).map((ms, k) => {
    const publishedAt = iso(ms);
    const value: JsonObject = {
      $type: 'site.standard.document',
      site: publication.uri,
      path: `/notes/${count - k}`,
      title: `Synthetic note ${count - k}: ${topic(k + 3)}`,
      description: 'A short fictional article used by the SocialLens demo.',
      tags: ['synthdemo'],
      publishedAt,
    };
    return item(b, 'site.standard.document', ms, value, publishedAt);
  });
}

function buildExtras(b: Builder, nsids: readonly string[]): CollectionData[] {
  return nsids.map((nsid) => {
    const ms = NOW_MS - 70 * DAY;
    const createdAt = iso(ms);
    const value: JsonObject =
      nsid === LISTBLOCK
        ? { $type: nsid, subject: `at://${peerDid(b.nextPeer())}/app.bsky.graph.list/${tidFromMs(ms - DAY, 3)}`, createdAt }
        : { $type: nsid, allowIncoming: 'following' };
    const it =
      nsid === CHAT_DECLARATION
        ? { uri: ownUri(nsid, 'self'), cid: b.nextCid(), value, rkey: 'self', valid: true, createdAt: null }
        : item(b, nsid, ms, value, createdAt);
    return { nsid, items: [it], script: 'none' as const };
  });
}

/** Deterministic counters with genuine zeros. */
function countersFor(i: number): EngagementCounts {
  return {
    likes: (i * 7) % 11,
    reposts: (i * 3) % 5,
    replies: i % 4 === 0 ? 0 : i % 3,
    quotes: i % 9 === 0 ? 1 : 0,
  };
}

function postViewsFor(posts: readonly ListItem[]): PostViewSource[] {
  return posts.map((p, i) => {
    const c = countersFor(i);
    const indexed = Math.min(Date.parse(p.createdAt ?? DEMO_ACCOUNT.now) + 2 * SECOND, NOW_MS);
    const view: PostView = {
      uri: p.uri,
      cid: p.cid,
      author: { did, handle: DEMO_ACCOUNT.handle },
      record: p.value,
      likeCount: c.likes,
      repostCount: c.reposts,
      replyCount: c.replies,
      quoteCount: c.quotes,
      indexedAt: iso(indexed),
    };
    return { uri: p.uri, view };
  });
}

// ─────────────────────────────── scenarios ───────────────────────────────

function complete(): ScenarioData {
  const b = makeBuilder();
  const posts = buildPosts(b, { count: 120, probe: true, textlessIndex: null });
  const lists = buildLists(b, spread(2, 50, 30));
  const publication = buildPublication(b);
  const collections: CollectionData[] = [
    { nsid: POST, items: posts, script: 'none' },
    { nsid: 'app.bsky.feed.repost', items: buildSubjectPosts(b, 'app.bsky.feed.repost', spread(12, 55, 5)), script: 'none' },
    { nsid: 'app.bsky.feed.like', items: buildSubjectPosts(b, 'app.bsky.feed.like', spread(40, 58, 2)), script: 'none' },
    { nsid: 'app.bsky.graph.follow', items: buildSubjectDids(b, 'app.bsky.graph.follow', spread(25, 59, 7)), script: 'none' },
    { nsid: 'app.bsky.graph.block', items: buildSubjectDids(b, 'app.bsky.graph.block', spread(3, 45, 11)), script: 'none' },
    { nsid: 'app.bsky.graph.list', items: lists, script: 'none' },
    { nsid: 'app.bsky.graph.listitem', items: buildListItems(b, lists, spread(6, 20, 9)), script: 'none' },
    { nsid: 'app.bsky.actor.profile', items: [buildProfile(b)], script: 'none' },
    { nsid: 'site.standard.document', items: buildDocuments(b, publication, 4), script: 'none' },
    { nsid: 'site.standard.publication', items: [publication], script: 'none' },
    ...buildExtras(b, [LISTBLOCK, CHAT_DECLARATION]),
  ];
  return {
    scenario: 'complete',
    handleIsCorrect: true,
    advertised: collections.map((c) => c.nsid).sort(),
    collections,
    postViews: postViewsFor(posts),
    countFailUris: [],
    countOmitUris: [],
  };
}

function partial(): ScenarioData {
  const b = makeBuilder();
  const posts = buildPosts(b, { count: 60, probe: false, textlessIndex: 29 });
  const oldest = postTime(59);
  // Two invalid items after the 60 valid ones (older, so rkey order stays strictly descending).
  const foreignMs = oldest - DAY;
  const foreignRkey = tidFromMs(foreignMs, 0);
  const foreignAt = iso(foreignMs);
  const foreign: ListItem = {
    uri: `at://${FOREIGN_DID}/${POST}/${foreignRkey}`,
    cid: b.nextCid(),
    value: { $type: POST, text: 'Synthetic item served under another account.', langs: ['en'], createdAt: foreignAt },
    rkey: foreignRkey,
    valid: false,
    createdAt: foreignAt,
  };
  const stringRkey = tidFromMs(oldest - 2 * DAY, 0);
  const stringValued: ListItem = {
    uri: ownUri(POST, stringRkey),
    cid: b.nextCid(),
    value: 'synthetic malformed record body',
    rkey: stringRkey,
    valid: false,
    createdAt: null,
  };
  const publication = buildPublication(b);
  const collections: CollectionData[] = [
    { nsid: POST, items: [...posts, foreign, stringValued], script: 'none' },
    { nsid: 'app.bsky.feed.repost', items: buildSubjectPosts(b, 'app.bsky.feed.repost', spread(8, 40, 5)), script: 'rate-limit-first-request' },
    { nsid: 'app.bsky.feed.like', items: buildSubjectPosts(b, 'app.bsky.feed.like', spread(130, 58, 2)), script: 'fail-after-first-page' },
    { nsid: 'app.bsky.graph.follow', items: buildSubjectDids(b, 'app.bsky.graph.follow', spread(1050, 200, 3)), script: 'none' },
    { nsid: 'app.bsky.graph.block', items: buildSubjectDids(b, 'app.bsky.graph.block', spread(3, 45, 11)), script: 'fail-always' },
    { nsid: 'app.bsky.actor.profile', items: [buildProfile(b)], script: 'none' },
    { nsid: 'site.standard.document', items: buildDocuments(b, publication, 2), script: 'none' },
    { nsid: 'site.standard.publication', items: [publication], script: 'none' },
    ...buildExtras(b, [LISTBLOCK]),
  ];
  return {
    scenario: 'partial',
    handleIsCorrect: false,
    advertised: collections.map((c) => c.nsid).sort(),
    collections,
    postViews: postViewsFor(posts),
    // Batch 2 of 3 (own posts 26–50, newest first) always fails; the last post of batch 3 is never returned.
    countFailUris: posts.slice(25, 50).map((p) => p.uri),
    countOmitUris: [posts[59]!.uri],
  };
}

function empty(): ScenarioData {
  return {
    scenario: 'empty',
    handleIsCorrect: true,
    advertised: [],
    collections: [],
    postViews: [],
    countFailUris: [],
    countOmitUris: [],
  };
}

export function generateScenario(id: DemoScenarioId): ScenarioData {
  switch (id) {
    case 'complete':
      return complete();
    case 'partial':
      return partial();
    case 'empty':
      return empty();
  }
}

// ──────────────────────── response bodies (pure; shared by server and manifest) ────────────────────────

export function didDocument(): JsonObject {
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ],
    id: did,
    alsoKnownAs: [`at://${DEMO_ACCOUNT.handle}`],
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase: 'zQ3shSyntheticDemoKeyForTestsNotARealKey',
      },
    ],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: DEMO_ACCOUNT.pdsOrigin }],
  };
}

export function describeRepoBody(data: ScenarioData): {
  handle: string;
  did: string;
  didDoc: JsonObject;
  collections: string[];
  handleIsCorrect: boolean;
} {
  return {
    handle: DEMO_ACCOUNT.handle,
    did,
    didDoc: didDocument(),
    collections: [...data.advertised],
    handleIsCorrect: data.handleIsCorrect,
  };
}

export interface ListPage {
  readonly items: readonly ListItem[];
  readonly cursor: string | null;
}

/** One listRecords page: newest first, records with `rkey < cursor`, a cursor only when more remain. */
export function listRecordsPage(items: readonly ListItem[], limit: number, cursor: string | null): ListPage {
  const rest = cursor === null ? items : items.filter((i) => i.rkey < cursor);
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, cursor: rest.length > limit && last !== undefined ? last.rkey : null };
}

export function listRecordsBody(page: ListPage): JsonObject {
  const records = page.items.map((i) => ({ uri: i.uri, cid: i.cid, value: i.value }));
  return page.cursor === null ? { records } : { records, cursor: page.cursor };
}

export type GetPostsOutcome = { readonly status: 200; readonly posts: readonly PostView[] } | { readonly status: 500 };

/** AppView answer for one batch (≤ 25 URIs, validated by the caller). Stateless: failures are content-based. */
export function getPostsOutcome(data: ScenarioData, uris: readonly string[]): GetPostsOutcome {
  if (uris.some((u) => data.countFailUris.includes(u))) return { status: 500 };
  const posts: PostView[] = [];
  const seen = new Set<string>();
  for (const u of uris) {
    if (seen.has(u) || data.countOmitUris.includes(u)) continue;
    seen.add(u);
    const found = data.postViews.find((p) => p.uri === u);
    if (found !== undefined) posts.push(found.view);
  }
  return { status: 200, posts };
}

export function collectionData(data: ScenarioData, nsid: string): CollectionData | null {
  return data.collections.find((c) => c.nsid === nsid) ?? null;
}
