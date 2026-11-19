import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACCOUNT } from './contract';
import { generateScenario } from './generator';
import { createFixtures } from './index';

const fixtures = createFixtures();
const DID = DEMO_ACCOUNT.did;
const PDS = DEMO_ACCOUNT.pdsOrigin;
const APPVIEW = 'https://public.api.bsky.app';

const listUrl = (collection: string, limit: number, cursor?: string) =>
  `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(DID)}&collection=${collection}&limit=${limit}` +
  (cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`);
const getPostsUrl = (uris: readonly string[]) =>
  `${APPVIEW}/xrpc/app.bsky.feed.getPosts?${uris.map((u) => `uris=${encodeURIComponent(u)}`).join('&')}`;
const ownPostUris = (id: 'complete' | 'partial') =>
  generateScenario(id).collections.find((c) => c.nsid === 'app.bsky.feed.post')!.items.filter((i) => i.valid).map((i) => i.uri);

/** Read the body through its stream, as the shared HTTP client does. */
async function readJson(res: Response): Promise<any> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('identity routes', () => {
  it('DID document returns the PDS service and alsoKnownAs', async () => {
    const res = await fixtures.createServer('complete', null).fetch(`https://plc.directory/${DID}`);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const doc = await readJson(res);
    expect(doc.id).toBe(DID);
    expect(doc.alsoKnownAs).toEqual(['at://synthetic-demo.example']);
    expect(doc.service).toEqual([{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }]);
    expect(Array.isArray(doc['@context'])).toBe(true);
    expect(doc.verificationMethod[0].controller).toBe(DID);
  });

  it('another DID → 404', async () => {
    const res = await fixtures.createServer('complete', null).fetch('https://plc.directory/did:plc:syntheticnobody222222222');
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ message: 'DID not registered' });
  });

  it('describeRepo returns all five required fields', async () => {
    const res = await fixtures.createServer('complete', null).fetch(`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${DID}`);
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['collections', 'did', 'didDoc', 'handle', 'handleIsCorrect']);
    expect(body).toMatchObject({ did: DID, handle: DEMO_ACCOUNT.handle, handleIsCorrect: true });
    expect(body.collections).toHaveLength(12);
    expect(body.didDoc.id).toBe(DID);
  });

  it('describeRepo for another repo → 400 RepoNotFound; partial reports handleIsCorrect false', async () => {
    const s = fixtures.createServer('partial', null);
    const bad = await s.fetch(`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=did:plc:syntheticnobody222222222`);
    expect(bad.status).toBe(400);
    expect((await readJson(bad)).error).toBe('RepoNotFound');
    const ok = await readJson(await s.fetch(`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${DID}`));
    expect(ok.handleIsCorrect).toBe(false);
    expect(ok.collections).not.toContain('app.bsky.graph.list');
    expect(ok.collections).toContain('app.bsky.graph.listblock');
  });
});

describe('listRecords', () => {
  it('complete posts: 100 + cursor, then 20 without cursor; unique URIs, newest first', async () => {
    const s = fixtures.createServer('complete', null);
    const p1 = await readJson(await s.fetch(listUrl('app.bsky.feed.post', 100)));
    expect(p1.records).toHaveLength(100);
    expect(typeof p1.cursor).toBe('string');
    const p2 = await readJson(await s.fetch(listUrl('app.bsky.feed.post', 100, p1.cursor)));
    expect(p2.records).toHaveLength(20);
    expect('cursor' in p2).toBe(false);
    const all = [...p1.records, ...p2.records];
    expect(new Set(all.map((r: any) => r.uri)).size).toBe(120);
    const times = all.map((r: any) => Date.parse(r.value.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const r of all) expect(Object.keys(r).sort()).toEqual(['cid', 'uri', 'value']);
    expect(p1.records[0].value.$type).toBe('app.bsky.feed.post');
  });

  it('honours limit=50 and rejects limit=101 and limit=0 with 400', async () => {
    const s = fixtures.createServer('complete', null);
    const docs = await readJson(await s.fetch(listUrl('site.standard.document', 50)));
    expect(docs.records).toHaveLength(4);
    expect(docs.cursor).toBeUndefined();
    const small = await readJson(await s.fetch(listUrl('app.bsky.feed.like', 3)));
    expect(small.records).toHaveLength(3);
    expect(typeof small.cursor).toBe('string');
    for (const limit of [101, 0]) {
      const res = await s.fetch(listUrl('app.bsky.feed.like', limit));
      expect(res.status).toBe(400);
      expect((await readJson(res)).error).toBe('InvalidRequest');
    }
  });

  it('default limit is 50; unknown collection → 200 empty records', async () => {
    const s = fixtures.createServer('partial', null);
    const res = await s.fetch(`${PDS}/xrpc/com.atproto.repo.listRecords?repo=${DID}&collection=app.bsky.graph.follow`);
    expect((await readJson(res)).records).toHaveLength(50);
    const none = await s.fetch(listUrl('app.bsky.graph.list', 100));
    expect(none.status).toBe(200);
    expect(await readJson(none)).toEqual({ records: [] });
  });

  it('partial: repost → 429 Retry-After 0 once, then 200 with 8 records', async () => {
    const s = fixtures.createServer('partial', null);
    const first = await s.fetch(listUrl('app.bsky.feed.repost', 100));
    expect(first.status).toBe(429);
    expect(first.headers.get('retry-after')).toBe('0');
    const second = await s.fetch(listUrl('app.bsky.feed.repost', 100));
    expect(second.status).toBe(200);
    expect((await readJson(second)).records).toHaveLength(8);
  });

  it('partial: like page 2 returns 500 every time', async () => {
    const s = fixtures.createServer('partial', null);
    const p1 = await readJson(await s.fetch(listUrl('app.bsky.feed.like', 100)));
    expect(p1.records).toHaveLength(100);
    for (let i = 0; i < 4; i++) {
      const res = await s.fetch(listUrl('app.bsky.feed.like', 100, p1.cursor));
      expect(res.status).toBe(500);
      expect(res.headers.get('retry-after')).toBe('0');
    }
  });

  it('partial: block returns 500 every time', async () => {
    const s = fixtures.createServer('partial', null);
    for (let i = 0; i < 4; i++) expect((await s.fetch(listUrl('app.bsky.graph.block', 100))).status).toBe(500);
  });

  it('partial: follow serves 11 pages (1,050 records)', async () => {
    const s = fixtures.createServer('partial', null);
    let cursor: string | undefined;
    let pages = 0;
    let total = 0;
    do {
      const body = await readJson(await s.fetch(listUrl('app.bsky.graph.follow', 100, cursor)));
      pages++;
      total += body.records.length;
      cursor = body.cursor;
    } while (cursor !== undefined && pages < 20);
    expect([pages, total]).toEqual([11, 1050]);
  });

  it('partial: posts page has 62 items, the last two invalid', async () => {
    const body = await readJson(await fixtures.createServer('partial', null).fetch(listUrl('app.bsky.feed.post', 100)));
    expect(body.records).toHaveLength(62);
    expect(body.cursor).toBeUndefined();
    expect(body.records[60].uri.startsWith(`at://${DID}/`)).toBe(false);
    expect(typeof body.records[61].value).toBe('string');
  });

  it('another repo → 400', async () => {
    const res = await fixtures.createServer('complete', null).fetch(
      `${PDS}/xrpc/com.atproto.repo.listRecords?repo=did:plc:syntheticnobody222222222&collection=app.bsky.feed.post&limit=10`,
    );
    expect(res.status).toBe(400);
  });
});

describe('getPosts', () => {
  it('25 URIs → 25 post views with the four counters; 26 → 400', async () => {
    const s = fixtures.createServer('complete', null);
    const uris = ownPostUris('complete');
    const body = await readJson(await s.fetch(getPostsUrl(uris.slice(0, 25))));
    expect(body.posts).toHaveLength(25);
    for (const [i, p] of body.posts.entries()) {
      expect(p.uri).toBe(uris[i]);
      expect(p.author).toEqual({ did: DID, handle: DEMO_ACCOUNT.handle });
      for (const k of ['likeCount', 'repostCount', 'replyCount', 'quoteCount']) expect(Number.isSafeInteger(p[k]) && p[k] >= 0).toBe(true);
      expect(typeof p.cid).toBe('string');
      expect(p.record.$type).toBe('app.bsky.feed.post');
      expect(typeof p.indexedAt).toBe('string');
    }
    const res = await s.fetch(getPostsUrl(uris.slice(0, 26)));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe('InvalidRequest');
  });

  it('unknown URIs are omitted', async () => {
    const s = fixtures.createServer('complete', null);
    const uris = ownPostUris('complete');
    const body = await readJson(await s.fetch(getPostsUrl([uris[0]!, `at://${DID}/app.bsky.feed.post/3aaaaaaaaaa22`])));
    expect(body.posts.map((p: any) => p.uri)).toEqual([uris[0]]);
  });

  it('partial: batch 2 returns 500 every time; batch 3 omits exactly one URI', async () => {
    const s = fixtures.createServer('partial', null);
    const uris = ownPostUris('partial');
    expect(uris).toHaveLength(60);
    expect((await readJson(await s.fetch(getPostsUrl(uris.slice(0, 25))))).posts).toHaveLength(25);
    for (let i = 0; i < 3; i++) {
      const res = await s.fetch(getPostsUrl(uris.slice(25, 50)));
      expect(res.status).toBe(500);
      expect(res.headers.get('retry-after')).toBe('0');
    }
    const third = await readJson(await s.fetch(getPostsUrl(uris.slice(50))));
    expect(third.posts).toHaveLength(9);
  });
});

describe('unexpected requests and the log', () => {
  it.each([
    ['other origin', 'https://example.org/', undefined],
    ['unknown PDS path', `${PDS}/xrpc/com.atproto.repo.getRecord?repo=${DID}`, undefined],
    ['POST', `${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${DID}`, { method: 'POST' }],
    ['not a URL', 'not a url', undefined],
  ] as const)('%s → TypeError, logged as unexpected', async (_name, url, init) => {
    const s = fixtures.createServer('complete', null);
    await expect(s.fetch(url, init)).rejects.toThrow(TypeError);
    await expect(s.fetch(url, init)).rejects.toThrow('Fixture fetch: unexpected request');
    expect(s.requests()[0]).toMatchObject({ url, unexpected: true, status: null });
  });

  it('records credentials, method and Authorization presence', async () => {
    const s = fixtures.createServer('complete', null);
    await s.fetch(`https://plc.directory/${DID}`, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } });
    await s.fetch(`https://plc.directory/${DID}`, { headers: { Authorization: 'Bearer synthetic' } });
    expect(s.requests()).toEqual([
      { url: `https://plc.directory/${DID}`, method: 'GET', credentials: 'omit', hadAuthorization: false, status: 200, unexpected: false },
      { url: `https://plc.directory/${DID}`, method: 'GET', credentials: null, hadAuthorization: true, status: 200, unexpected: false },
    ]);
    s.resetLog();
    expect(s.requests()).toEqual([]);
  });

  it('an already-aborted signal rejects with its reason', async () => {
    const s = fixtures.createServer('complete', null);
    const c = new AbortController();
    const reason = new Error('synthetic abort');
    c.abort(reason);
    await expect(s.fetch(`https://plc.directory/${DID}`, { signal: c.signal })).rejects.toBe(reason);
    expect(s.requests()[0]).toMatchObject({ status: null, unexpected: false });
  });

  it('latency 50 ms with fake timers: abort at 10 ms rejects and nothing is served', async () => {
    vi.useFakeTimers();
    const s = fixtures.createServer('partial', { latencyMs: 50 });
    const c = new AbortController();
    const p = s.fetch(listUrl('app.bsky.feed.repost', 100), { signal: c.signal });
    const settled = vi.fn();
    p.then(settled, settled);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
    const reason = new DOMException('stop', 'AbortError');
    c.abort(reason);
    await expect(p).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.requests()).toEqual([expect.objectContaining({ status: null, unexpected: false })]);
    // The aborted request did not consume the scripted 429.
    const next = s.fetch(listUrl('app.bsky.feed.repost', 100));
    await vi.advanceTimersByTimeAsync(50);
    expect((await next).status).toBe(429);
  });

  it('latency delays the response', async () => {
    vi.useFakeTimers();
    const s = fixtures.createServer('complete', { latencyMs: 50 });
    const settled = vi.fn();
    s.fetch(`https://plc.directory/${DID}`).then(settled);
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('two servers have independent logs and failure counters', async () => {
    const a = fixtures.createServer('partial', null);
    const b = fixtures.createServer('partial', null);
    expect((await a.fetch(listUrl('app.bsky.feed.repost', 100))).status).toBe(429);
    expect((await b.fetch(listUrl('app.bsky.feed.repost', 100))).status).toBe(429);
    expect((await a.fetch(listUrl('app.bsky.feed.repost', 100))).status).toBe(200);
    expect(a.requests()).toHaveLength(2);
    expect(b.requests()).toHaveLength(1);
  });

  it('two servers return deep-equal JSON for the same request sequence', async () => {
    const seq = [`https://plc.directory/${DID}`, `${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${DID}`, listUrl('app.bsky.feed.post', 100), getPostsUrl(ownPostUris('complete').slice(0, 25))];
    const run = async () => {
      const s = fixtures.createServer('complete', null);
      const out: string[] = [];
      for (const u of seq) out.push(await (await s.fetch(u)).text());
      return out;
    };
    expect(await run()).toEqual(await run());
  });

  it('never falls through to globalThis.fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real network'));
    const s = fixtures.createServer('complete', null);
    await s.fetch(`https://plc.directory/${DID}`);
    await expect(s.fetch('https://example.org/')).rejects.toThrow(TypeError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
