import { describe, expect, it } from 'vitest';
import type { AtUri, Clock, Did, Failure, HttpClient, HttpGetRequest, IsoDateTime, JsonValue, Result } from '../../shared/contract';
import type { CountsProgress, EngagementLookup } from './contract';
import { createBlueskyAdapter } from './index';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' as Did;
const OTHER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' as Did;
const NOW = '2026-11-18T12:00:00.000Z' as IsoDateTime;
const SESSION = { did: DID, source: 'oauth' } as const;
const ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts';

const post = (i: number, did: Did = DID): AtUri => `at://${did}/app.bsky.feed.post/3k${String(i).padStart(4, '0')}` as AtUri;
const posts = (n: number): AtUri[] => Array.from({ length: n }, (_, i) => post(i));

const clock: Clock = { now: () => NOW, nowMs: () => 0 };
const FAIL: Failure = { kind: 'http', message: 'boom', status: 500, xrpcError: null, retryAfterMs: null, origin: null };

const view = (uri: string, extra: Record<string, JsonValue> = {}): JsonValue => ({
  uri,
  cid: 'bafy',
  author: { did: DID, handle: 'a.test' },
  record: { text: 'hi' },
  indexedAt: '2026-01-01T00:00:00.000Z',
  bookmarkCount: 9,
  viewer: {},
  likeCount: 3,
  repostCount: 2,
  replyCount: 1,
  quoteCount: 0,
  ...extra,
});

type Responder = (urls: string[], call: number) => Result<JsonValue> | Promise<Result<JsonValue>>;

function fake(responder: Responder) {
  const requests: string[] = [];
  const http: HttpClient = {
    async getJson(req: HttpGetRequest) {
      requests.push(req.url);
      return responder(new URL(req.url).searchParams.getAll('uris'), requests.length);
    },
    permitOrigin: () => undefined,
    permittedOrigins: () => [],
  };
  return { http, requests };
}

const okAll: Responder = (urls) => ({ ok: true, value: { posts: urls.map((u) => view(u)) } });
const run = (
  http: HttpClient,
  uris: readonly AtUri[],
  opts: { signal?: AbortSignal; onProgress?: ((p: CountsProgress) => void) | null } = {},
): Promise<EngagementLookup> =>
  createBlueskyAdapter({ http, clock }).getCounts({
    session: SESSION,
    uris,
    signal: opts.signal ?? new AbortController().signal,
    onProgress: opts.onProgress ?? null,
  });
const urisOf = (url: string) => new URL(url).searchParams.getAll('uris');
const reasons = (l: EngagementLookup) => l.results.map((r) => (r.engagement.status === 'unknown' ? r.engagement.reason : r.engagement.status));
const invariant = (l: EngagementLookup, requested: number) => {
  expect(l.results.length).toBe(requested);
  expect(l.coverage.requested).toBe(requested);
  expect(l.coverage.known + l.coverage.unknown).toBe(requested);
  for (const r of l.results) expect(r.engagement.status).not.toBe('not-available');
};

describe('batching', () => {
  it('empty uris: no request, complete', async () => {
    const f = fake(okAll);
    const l = await run(f.http, []);
    expect(f.requests).toHaveLength(0);
    expect(l.coverage).toMatchObject({ status: 'complete', requested: 0, known: 0, unknown: 0, batches: 0, batchesFailed: 0, failure: null, reason: 'No posts to look up.' });
    invariant(l, 0);
  });

  it('one own post: one request to getPosts with one uris param', async () => {
    const f = fake(okAll);
    const l = await run(f.http, [post(1)]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.startsWith(`${ENDPOINT}?`)).toBe(true);
    expect(urisOf(f.requests[0]!)).toEqual([post(1)]);
    expect(l.coverage).toMatchObject({ status: 'complete', known: 1, batches: 1, reason: 'Counters were read for every post.' });
    invariant(l, 1);
  });

  it.each([
    [25, [25]],
    [26, [25, 1]],
    [50, [25, 25]],
    [51, [25, 25, 1]],
  ])('%i URIs -> batches %j', async (n, sizes) => {
    const f = fake(okAll);
    const l = await run(f.http, posts(n));
    expect(f.requests.map((u) => urisOf(u).length)).toEqual(sizes);
    expect(l.coverage.batches).toBe(sizes.length);
    invariant(l, n);
  });

  it('duplicates: one result, one occurrence in the URL', async () => {
    const f = fake(okAll);
    const l = await run(f.http, [post(1), post(2), post(1)]);
    expect(urisOf(f.requests[0]!)).toEqual([post(1), post(2)]);
    expect(l.results.map((r) => r.uri)).toEqual([post(1), post(2)]);
    invariant(l, 2);
  });

  it('results follow request order regardless of response order', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [...urls].reverse().map((u) => view(u)) } }));
    const l = await run(f.http, posts(5));
    expect(l.results.map((r) => r.uri)).toEqual(posts(5));
  });
});

describe('parsing counts', () => {
  it('observed zeros are known zeros; observedAt is the clock value', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: urls.map((u) => view(u, { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 })) } }));
    const l = await run(f.http, [post(1)]);
    expect(l.results[0]!.engagement).toEqual({ status: 'known', counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, observedAt: NOW });
  });

  it('maps the four counters and ignores bookmarks/viewer/author/record', async () => {
    const f = fake(okAll);
    const l = await run(f.http, [post(1)]);
    expect(l.results[0]!.engagement).toEqual({ status: 'known', counts: { likes: 3, reposts: 2, replies: 1, quotes: 0 }, observedAt: NOW });
  });

  it('missing quoteCount -> invalid-counts, not zero', async () => {
    const f = fake((urls) => {
      const v = view(urls[0]!) as Record<string, JsonValue>;
      delete v.quoteCount;
      return { ok: true, value: { posts: [v] } };
    });
    const l = await run(f.http, [post(1)]);
    expect(l.results[0]!.engagement).toEqual({ status: 'unknown', reason: 'invalid-counts' });
    expect(l.coverage.status).toBe('partial');
    expect(l.coverage.unknown).toBe(1);
  });

  it.each([[-1], [1.5], ['3'], [Number.MAX_SAFE_INTEGER + 1], [null], [true]] as const)('bad counter %j -> invalid-counts', async (bad) => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(urls[0]!, { likeCount: bad as JsonValue })] } }));
    const l = await run(f.http, [post(1)]);
    expect(reasons(l)).toEqual(['invalid-counts']);
  });

  it('accepts MAX_SAFE_INTEGER', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(urls[0]!, { likeCount: Number.MAX_SAFE_INTEGER })] } }));
    expect(reasons(await run(f.http, [post(1)]))).toEqual(['known']);
  });

  it('requested URI absent from posts -> not-returned', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(urls[0]!)] } }));
    const l = await run(f.http, [post(1), post(2)]);
    expect(reasons(l)).toEqual(['known', 'not-returned']);
    expect(l.coverage).toMatchObject({ status: 'partial', known: 1, unknown: 1, batchesFailed: 0 });
    invariant(l, 2);
  });

  it('empty posts array: every URI not-returned, batch counted as success', async () => {
    const f = fake(() => ({ ok: true, value: { posts: [] } }));
    const l = await run(f.http, [post(1)]);
    expect(reasons(l)).toEqual(['not-returned']);
    expect(l.coverage.status).toBe('partial');
  });

  it('unrequested URI in response is ignored', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(post(99)), view(urls[0]!), view(post(98, OTHER))] } }));
    const l = await run(f.http, [post(1)]);
    expect(l.results.map((r) => r.uri)).toEqual([post(1)]);
    invariant(l, 1);
  });

  it('repeated URI: first occurrence wins', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(urls[0]!, { likeCount: 7 }), view(urls[0]!, { likeCount: 100 })] } }));
    const l = await run(f.http, [post(1)]);
    expect(l.results[0]!.engagement).toMatchObject({ status: 'known', counts: { likes: 7 } });
  });

  it('first occurrence wins even when it is invalid', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [view(urls[0]!, { likeCount: -1 }), view(urls[0]!)] } }));
    expect(reasons(await run(f.http, [post(1)]))).toEqual(['invalid-counts']);
  });

  it('garbage elements in posts are ignored', async () => {
    const f = fake((urls) => ({ ok: true, value: { posts: [null, 5, 'x', [], { uri: 3 }, {}, view(urls[0]!)] } }));
    const l = await run(f.http, [post(1)]);
    expect(reasons(l)).toEqual(['known']);
  });
});

describe('self-only (I-1)', () => {
  it('foreign DID URI is rejected-not-self and never in a URL', async () => {
    const f = fake(okAll);
    const foreign = post(5, OTHER);
    const l = await run(f.http, [post(1), foreign, post(2)]);
    expect(reasons(l)).toEqual(['known', 'rejected-not-self', 'known']);
    for (const url of f.requests) {
      expect(url).not.toContain(OTHER);
      expect(urisOf(url)).not.toContain(foreign);
    }
    invariant(l, 3);
  });

  it('own like URI is rejected-not-self', async () => {
    const f = fake(okAll);
    const like = `at://${DID}/app.bsky.feed.like/3k0001` as AtUri;
    const l = await run(f.http, [like]);
    expect(reasons(l)).toEqual(['rejected-not-self']);
    expect(f.requests).toHaveLength(0);
  });

  it('unparseable URI is rejected-not-self', async () => {
    const f = fake(okAll);
    const l = await run(f.http, ['nonsense' as AtUri, 'at://alice.test/app.bsky.feed.post/x' as AtUri]);
    expect(reasons(l)).toEqual(['rejected-not-self', 'rejected-not-self']);
    expect(f.requests).toHaveLength(0);
  });

  it('all foreign: no requests, unavailable', async () => {
    const f = fake(okAll);
    const l = await run(f.http, [post(1, OTHER), post(2, OTHER)]);
    expect(f.requests).toHaveLength(0);
    expect(l.coverage).toMatchObject({ status: 'unavailable', requested: 2, known: 0, unknown: 2, batches: 0, batchesFailed: 0, failure: null, reason: 'Counters could not be read. They are unknown, not zero.' });
    expect(reasons(l)).toEqual(['rejected-not-self', 'rejected-not-self']);
  });

  it('batching counts only sendable URIs', async () => {
    const f = fake(okAll);
    await run(f.http, [...posts(25), post(500, OTHER), post(600)]);
    expect(f.requests.map((u) => urisOf(u).length)).toEqual([25, 1]);
  });
});

describe('failures and circuit breaker', () => {
  const failBatches = (bad: ReadonlySet<number>): Responder => (urls, call) =>
    bad.has(call) ? { ok: false, failure: FAIL } : okAll(urls, call);

  it('batch 2 of 3 fails: lookup-failed, batch 3 still requested, partial', async () => {
    const f = fake(failBatches(new Set([2])));
    const l = await run(f.http, posts(75));
    expect(f.requests).toHaveLength(3);
    expect(reasons(l).slice(0, 25).every((r) => r === 'known')).toBe(true);
    expect(reasons(l).slice(25, 50).every((r) => r === 'lookup-failed')).toBe(true);
    expect(reasons(l).slice(50).every((r) => r === 'known')).toBe(true);
    expect(l.coverage).toMatchObject({ status: 'partial', batches: 3, batchesFailed: 1, known: 50, unknown: 25, failure: FAIL });
    expect(l.coverage.reason).toBe('Counters are known for 50 of 75 posts; the rest are unknown, not zero.');
    invariant(l, 75);
  });

  it('batches 1 and 2 fail: batch 3 not requested, not-requested, unavailable', async () => {
    const f = fake(failBatches(new Set([1, 2])));
    const l = await run(f.http, posts(75));
    expect(f.requests).toHaveLength(2);
    expect(reasons(l).slice(0, 50).every((r) => r === 'lookup-failed')).toBe(true);
    expect(reasons(l).slice(50).every((r) => r === 'not-requested')).toBe(true);
    expect(l.coverage).toMatchObject({ status: 'unavailable', batches: 2, batchesFailed: 2, known: 0, failure: FAIL });
    invariant(l, 75);
  });

  it('fail, succeed, fail, succeed: all four requested', async () => {
    const f = fake(failBatches(new Set([1, 3])));
    const l = await run(f.http, posts(100));
    expect(f.requests).toHaveLength(4);
    expect(l.coverage).toMatchObject({ status: 'partial', batches: 4, batchesFailed: 2, known: 50 });
    invariant(l, 100);
  });

  it('failure is the most recent batch failure', async () => {
    const second: Failure = { ...FAIL, status: 503 };
    const f = fake((_u, call) => ({ ok: false, failure: call === 1 ? FAIL : second }));
    const l = await run(f.http, posts(75));
    expect(l.coverage.failure).toEqual(second);
  });

  it('later success keeps failure set (most recent failure)', async () => {
    const f = fake(failBatches(new Set([1])));
    const l = await run(f.http, posts(50));
    expect(l.coverage.failure).toEqual(FAIL);
  });

  it('no failure -> failure null', async () => {
    const f = fake(okAll);
    expect((await run(f.http, posts(3))).coverage.failure).toBeNull();
  });

  it.each([
    ['no posts', { other: 1 }],
    ['posts not array', { posts: 'x' }],
    ['array body', []],
    ['null body', null],
    ['string body', 'hi'],
  ] as const)('malformed body (%s) is a failed batch', async (_n, body) => {
    const f = fake(() => ({ ok: true, value: body as JsonValue }));
    const l = await run(f.http, [post(1)]);
    expect(reasons(l)).toEqual(['lookup-failed']);
    expect(l.coverage).toMatchObject({ status: 'unavailable', batchesFailed: 1 });
    expect(l.coverage.failure).not.toBeNull();
    expect(l.coverage.failure!.kind).toBe('invalid-response');
  });

  it('a non-abort throw from http is a failed batch, not a rejection', async () => {
    const http: HttpClient = { getJson: () => Promise.reject(new Error('x')), permitOrigin: () => undefined, permittedOrigins: () => [] };
    const l = await run(http, [post(1)]);
    expect(reasons(l)).toEqual(['lookup-failed']);
  });
});

describe('progress and abort', () => {
  it('onProgress fires once per attempted batch', async () => {
    const f = fake(okAll);
    const seen: CountsProgress[] = [];
    await run(f.http, posts(51), { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([{ batch: 1, batches: 3 }, { batch: 2, batches: 3 }, { batch: 3, batches: 3 }]);
  });

  it('onProgress stops at the circuit breaker, only for attempted batches', async () => {
    const f = fake(() => ({ ok: false, failure: FAIL }));
    const seen: CountsProgress[] = [];
    await run(f.http, posts(75), { onProgress: (p) => seen.push(p) });
    expect(seen.map((p) => p.batch)).toEqual([1, 2]);
  });

  it('no progress and no request for a no-batch lookup', async () => {
    const seen: CountsProgress[] = [];
    await run(fake(okAll).http, [], { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([]);
  });

  it('abort before batch 2 rejects; batch 2 never requested; no progress after abort', async () => {
    const ac = new AbortController();
    const seen: CountsProgress[] = [];
    const f = fake(okAll);
    const p = run(f.http, posts(75), {
      signal: ac.signal,
      onProgress: (pr) => {
        seen.push(pr);
        ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it('already-aborted signal rejects without any request', async () => {
    const ac = new AbortController();
    ac.abort();
    const f = fake(okAll);
    await expect(run(f.http, posts(3), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.requests).toHaveLength(0);
  });

  it('abort during an in-flight request rejects and fires no progress', async () => {
    const ac = new AbortController();
    const seen: CountsProgress[] = [];
    const http: HttpClient = {
      getJson: async () => {
        ac.abort();
        return { ok: true, value: { posts: [] } };
      },
      permitOrigin: () => undefined,
      permittedOrigins: () => [],
    };
    await expect(run(http, posts(2), { signal: ac.signal, onProgress: (p) => seen.push(p) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([]);
  });

  it('http rejecting with the abort error propagates', async () => {
    const ac = new AbortController();
    const http: HttpClient = {
      getJson: () => {
        ac.abort();
        return Promise.reject(ac.signal.reason);
      },
      permitOrigin: () => undefined,
      permittedOrigins: () => [],
    };
    await expect(run(http, posts(2), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('request hygiene (I-12)', () => {
  it('only getPosts on the AppView, only uris param', async () => {
    const f = fake(okAll);
    await run(f.http, posts(30));
    for (const url of f.requests) {
      const u = new URL(url);
      expect(u.origin).toBe('https://public.api.bsky.app');
      expect(u.pathname).toBe('/xrpc/app.bsky.feed.getPosts');
      expect([...new Set(u.searchParams.keys())]).toEqual(['uris']);
    }
  });
});
