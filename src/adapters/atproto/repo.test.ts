import { describe, expect, it } from 'vitest';
import { buildXrpcUrl } from '../../shared/index';
import type { Coverage, Did, HttpsOrigin, JsonValue, Nsid, SessionRef } from '../../shared/contract';
import type { CollectionRead, ListCollectionRequest, ListProgress } from './contract';
import { createFakeHttp, failWith, fakeClock, hangUntilAbort, okJson } from './fake-http';
import { createAtprotoAdapter } from './index';

const me = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
const other = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' as Did;
const session: SessionRef = { did: me, source: 'oauth' };
const pds = 'https://morel.us-east.host.bsky.network' as HttpsOrigin;
const POST = 'app.bsky.feed.post' as Nsid;
const LIKE = 'app.bsky.feed.like' as Nsid;
const CID = 'bafyreihlm4gyfwglnuvdeqkcdpfqrdxjmuk5cxfgvcqkr2gnclrbklqzzu';

function setup() {
  const http = createFakeHttp();
  const adapter = createAtprotoAdapter({ http, clock: fakeClock });
  return { http, adapter, signal: new AbortController().signal };
}

// ─────────────────────────────── describeRepo ───────────────────────────────

const DESCRIBE_URL = buildXrpcUrl(pds, 'com.atproto.repo.describeRepo', { repo: me });

/** Shaped like a real bsky PDS describeRepo response (didDoc included). */
function describeBody(overrides: Record<string, JsonValue> = {}): JsonValue {
  return {
    handle: 'alice.bsky.social',
    did: me,
    didDoc: { id: me, alsoKnownAs: ['at://alice.bsky.social'], service: [] },
    collections: ['app.bsky.graph.follow', 'app.bsky.feed.post', 'app.bsky.actor.profile', 'app.bsky.feed.like'],
    handleIsCorrect: true,
    ...overrides,
  };
}

describe('describeRepo', () => {
  it('foreign DID → access-denied, 0 requests', async () => {
    const { http, adapter, signal } = setup();
    const r = await adapter.describeRepo({ session, did: other, pdsOrigin: pds, signal });
    expect(!r.ok && r.failure.kind).toBe('access-denied');
    expect(http.calls).toEqual([]);
  });

  it('requests describeRepo with repo=<did> and returns handle, handleIsCorrect, sorted de-duplicated NSIDs', async () => {
    const { http, adapter, signal } = setup();
    http.on(DESCRIBE_URL, okJson(describeBody({ collections: ['app.bsky.feed.post', 'app.bsky.actor.profile', 'app.bsky.feed.post'] })));
    const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
    expect(http.calls).toHaveLength(1);
    const url = new URL(http.calls[0]!);
    expect(url.origin + url.pathname).toBe(`${pds}/xrpc/com.atproto.repo.describeRepo`);
    expect(url.searchParams.get('repo')).toBe(me);
    expect(r).toEqual({
      ok: true,
      value: {
        did: me,
        handle: 'alice.bsky.social',
        handleIsCorrect: true,
        collections: ['app.bsky.actor.profile', 'app.bsky.feed.post'],
        invalidCollectionCount: 0,
      },
    });
  });

  it('response did differs → invalid-response', async () => {
    const { http, adapter, signal } = setup();
    http.on(DESCRIBE_URL, okJson(describeBody({ did: other })));
    const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
    expect(!r.ok && r.failure.kind).toBe('invalid-response');
  });

  it('collections not an array → invalid-response (also: non-object body)', async () => {
    for (const body of [describeBody({ collections: 'app.bsky.feed.post' }), describeBody({ collections: null }), [describeBody()], null] as JsonValue[]) {
      const { http, adapter, signal } = setup();
      http.on(DESCRIBE_URL, okJson(body));
      const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
      expect(!r.ok && r.failure.kind).toBe('invalid-response');
    }
  });

  it('invalid collection strings are counted in invalidCollectionCount and excluded', async () => {
    const { http, adapter, signal } = setup();
    http.on(DESCRIBE_URL, okJson(describeBody({ collections: ['app.bsky.feed.post', '<script>', 'nodots', 42, null, 'site.standard.document'] })));
    const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.collections).toEqual(['app.bsky.feed.post', 'site.standard.document']);
      expect(r.value.invalidCollectionCount).toBe(4);
    }
  });

  it('handleIsCorrect missing → false; handle handle.invalid is returned as a handle', async () => {
    const { http, adapter, signal } = setup();
    const body = describeBody({ handle: 'handle.invalid' }) as Record<string, JsonValue>;
    const { handleIsCorrect: _omit, ...rest } = body;
    http.on(DESCRIBE_URL, okJson(rest));
    const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handleIsCorrect).toBe(false);
      expect(r.value.handle).toBe('handle.invalid');
    }
  });

  it('handle missing or syntactically invalid → null; handleIsCorrect only true for literal true', async () => {
    const { http, adapter, signal } = setup();
    http.on(DESCRIBE_URL, okJson(describeBody({ handle: 'not a handle', handleIsCorrect: 'true' })));
    const r = await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal });
    expect(r.ok && r.value.handle).toBeNull();
    expect(r.ok && r.value.handleIsCorrect).toBe(false);
  });

  it('HTTP failure is returned unchanged', async () => {
    const { http, adapter, signal } = setup();
    const failure = failWith('xrpc', { status: 400, xrpcError: 'RepoNotFound' });
    http.on(DESCRIBE_URL, failure);
    expect(await adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal })).toEqual(failure);
  });

  it('abort during the request rejects with the abort reason', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    http.on(DESCRIBE_URL, hangUntilAbort(() => queueMicrotask(() => controller.abort())));
    await expect(adapter.describeRepo({ session, did: me, pdsOrigin: pds, signal: controller.signal })).rejects.toSatisfy((e) => e === controller.signal.reason && controller.signal.aborted);
  });
});

// ─────────────────────────────── listCollection ─────────────────────────────

function listUrl(cursor?: string, pageSize = 100, collection: Nsid = POST): string {
  return buildXrpcUrl(pds, 'com.atproto.repo.listRecords', {
    repo: me,
    collection,
    limit: pageSize,
    ...(cursor === undefined ? {} : { cursor }),
  });
}

function rec(rkey: string, overrides: Record<string, JsonValue> = {}): JsonValue {
  return {
    uri: `at://${me}/${POST}/${rkey}`,
    cid: CID,
    value: { $type: POST, text: `post ${rkey}`, createdAt: '2026-11-01T00:00:00.000Z', langs: ['en'] },
    ...overrides,
  };
}

function page(records: JsonValue[], cursor?: string): JsonValue {
  return cursor === undefined ? { records } : { records, cursor };
}

function req(overrides: Partial<ListCollectionRequest> = {}): ListCollectionRequest {
  return {
    session,
    did: me,
    pdsOrigin: pds,
    signal: new AbortController().signal,
    collection: POST,
    pageSize: 100,
    maxPages: 10,
    onProgress: null,
    ...overrides,
  };
}

function expectBalanced(read: CollectionRead): void {
  const c = read.coverage;
  expect(c.returned).toBe(c.accepted + c.rejected + c.duplicates);
  expect(c.accepted).toBe(read.records.length);
  expect(c.rejected).toBe(read.rejected.length);
  expect(c.collection).toBe(POST);
  expect(new Set(read.records.map((r) => r.uri)).size).toBe(read.records.length);
  for (const r of read.records) {
    expect(r.uri.startsWith(`at://${me}/${POST}/`)).toBe(true);
    expect(r.collection).toBe(POST);
  }
  for (const s of read.rejected) expect(s.stage).toBe('fetch');
}

describe('listCollection — guards (no I/O)', () => {
  it('foreign DID → unavailable / first-page-failed with access-denied, 0 requests', async () => {
    const { http, adapter } = setup();
    const read = await adapter.listCollection(req({ did: other }));
    expect(http.calls).toEqual([]);
    expect(read.records).toEqual([]);
    expect(read.rejected).toEqual([]);
    expect(read.coverage).toMatchObject({
      status: 'unavailable',
      reasonCode: 'first-page-failed',
      reason: 'This collection could not be read. Its count is unknown, not zero.',
      pagesFetched: 0,
      returned: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
    });
    expect(read.coverage.failure?.kind).toBe('access-denied');
  });

  it('pageSize 0 or 101, maxPages 0 or 11 (or non-integers) → unavailable with validation, 0 requests', async () => {
    const bad: Partial<ListCollectionRequest>[] = [
      { pageSize: 0 },
      { pageSize: 101 },
      { pageSize: 50.5 },
      { pageSize: Number.NaN },
      { maxPages: 0 },
      { maxPages: 11 },
      { maxPages: 2.5 },
    ];
    for (const o of bad) {
      const { http, adapter } = setup();
      const read = await adapter.listCollection(req(o));
      expect(http.calls).toEqual([]);
      expect(read.coverage.status).toBe('unavailable');
      expect(read.coverage.reasonCode).toBe('first-page-failed');
      expect(read.coverage.failure?.kind).toBe('validation');
      expectBalanced(read);
    }
  });

  it('self-only is checked before the limit validation', async () => {
    const { adapter } = setup();
    const read = await adapter.listCollection(req({ did: other, pageSize: 0 }));
    expect(read.coverage.failure?.kind).toBe('access-denied');
  });
});

describe('listCollection — pagination', () => {
  it('single page without cursor → complete / ok; counts add up', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('3kaaaaaaaaa2a'), rec('3kaaaaaaaaa2b')])));
    const read = await adapter.listCollection(req());
    expect(read.coverage).toEqual<Coverage>({
      collection: POST,
      status: 'complete',
      reasonCode: 'ok',
      reason: 'Pagination ended; every returned record was accepted.',
      pagesFetched: 1,
      returned: 2,
      accepted: 2,
      rejected: 0,
      duplicates: 0,
      failure: null,
    });
    expect(read.records[0]).toEqual({
      uri: `at://${me}/${POST}/3kaaaaaaaaa2a`,
      cid: CID,
      collection: POST,
      rkey: '3kaaaaaaaaa2a',
      value: { $type: POST, text: 'post 3kaaaaaaaaa2a', createdAt: '2026-11-01T00:00:00.000Z', langs: ['en'] },
    });
    expectBalanced(read);
  });

  it('two pages (cursor then none) → second request carries cursor; pagesFetched = 2', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('a1')], 'a1')));
    http.on(listUrl('a1'), okJson(page([rec('a0')])));
    const read = await adapter.listCollection(req());
    expect(http.calls).toEqual([listUrl(), listUrl('a1')]);
    expect(new URL(http.calls[1]!).searchParams.get('cursor')).toBe('a1');
    expect(read.coverage.pagesFetched).toBe(2);
    expect(read.coverage.status).toBe('complete');
    expect(read.records.map((r) => r.rkey)).toEqual(['a1', 'a0']);
    expectBalanced(read);
  });

  it('request URL has repo, collection, limit=<pageSize> and no reverse', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(undefined, 50, LIKE), okJson(page([])));
    await adapter.listCollection(req({ pageSize: 50, collection: LIKE }));
    expect(http.calls).toHaveLength(1);
    const url = new URL(http.calls[0]!);
    expect(url.origin + url.pathname).toBe(`${pds}/xrpc/com.atproto.repo.listRecords`);
    expect(url.searchParams.get('repo')).toBe(me);
    expect(url.searchParams.get('collection')).toBe(LIKE);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('reverse')).toBe(false);
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('empty first page with no cursor → complete, 0 records (an observed zero)', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([])));
    const read = await adapter.listCollection(req());
    expect(read.coverage).toMatchObject({ status: 'complete', reasonCode: 'ok', pagesFetched: 1, returned: 0, accepted: 0, failure: null });
    expectBalanced(read);
  });

  it('empty page with a cursor → complete (pagination ends)', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('a1')], 'a1')));
    http.on(listUrl('a1'), okJson(page([], 'a0')));
    const read = await adapter.listCollection(req());
    expect(http.calls).toHaveLength(2);
    expect(read.coverage).toMatchObject({ status: 'complete', reasonCode: 'ok', pagesFetched: 2, accepted: 1 });
    expectBalanced(read);
  });

  it('tolerates unknown extra fields on the page and on items', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson({ records: [rec('a1', { extra: true, blobs: [] })], serverHint: 'x' }));
    const read = await adapter.listCollection(req());
    expect(read.coverage).toMatchObject({ status: 'complete', accepted: 1 });
  });

  it('cap: 3 pages available, maxPages 2 → partial / page-cap, exactly 2 requests', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('c3')], 'c3')));
    http.on(listUrl('c3'), okJson(page([rec('c2')], 'c2')));
    http.on(listUrl('c2'), okJson(page([rec('c1')])));
    const read = await adapter.listCollection(req({ maxPages: 2 }));
    expect(http.calls).toHaveLength(2);
    expect(read.coverage).toMatchObject({
      status: 'partial',
      reasonCode: 'page-cap',
      reason: 'Stopped at the 2-page limit (2 newest records read); older records were not read. Counts are lower bounds.',
      pagesFetched: 2,
      accepted: 2,
      failure: null,
    });
    expectBalanced(read);
  });

  it('maxPages = LIMITS max (10) is allowed', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(undefined, 1), okJson(page([])));
    const read = await adapter.listCollection(req({ maxPages: 10, pageSize: 1 }));
    expect(read.coverage.status).toBe('complete');
  });

  it('repeated cursor → partial / repeated-cursor, no third request', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('r2')], 'same')));
    http.on(listUrl('same'), okJson(page([rec('r1')], 'same')));
    http.on(listUrl('same'), okJson(page([rec('r0')])));
    const read = await adapter.listCollection(req());
    expect(http.calls).toHaveLength(2);
    expect(read.coverage).toMatchObject({
      status: 'partial',
      reasonCode: 'repeated-cursor',
      reason: 'The server repeated a page marker; reading stopped to avoid a loop. Counts are lower bounds.',
      pagesFetched: 2,
      accepted: 2,
      failure: null,
    });
    expectBalanced(read);
  });
});

describe('listCollection — page failures', () => {
  it('page 1 fails (500) → unavailable / first-page-failed, failure.kind http, 0 records', async () => {
    const { http, adapter } = setup();
    const failure = failWith('http', { status: 500, origin: pds });
    http.on(listUrl(), failure);
    const read = await adapter.listCollection(req());
    expect(read.records).toEqual([]);
    expect(read.coverage).toEqual<Coverage>({
      collection: POST,
      status: 'unavailable',
      reasonCode: 'first-page-failed',
      reason: 'This collection could not be read. Its count is unknown, not zero.',
      pagesFetched: 0,
      returned: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      failure: !failure.ok ? failure.failure : null,
    });
  });

  it('page 2 fails after page 1 succeeded → partial / later-page-failed, page-1 records kept', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('p2'), rec('p1')], 'p1')));
    http.on(listUrl('p1'), failWith('timeout'));
    const read = await adapter.listCollection(req());
    expect(read.records.map((r) => r.rkey)).toEqual(['p2', 'p1']);
    expect(read.coverage).toMatchObject({
      status: 'partial',
      reasonCode: 'later-page-failed',
      reason: 'A later page could not be read; 2 record(s) read before that are kept. Counts are lower bounds.',
      pagesFetched: 1,
      returned: 2,
      accepted: 2,
    });
    expect(read.coverage.failure?.kind).toBe('timeout');
    expectBalanced(read);
  });

  it('page body without records, with a non-string cursor, or with more records than pageSize → failed page', async () => {
    const bodies: JsonValue[] = [
      {},
      { records: null },
      { records: {} },
      { records: [rec('a')], cursor: 5 },
      { records: [rec('a')], cursor: null },
      { records: [rec('a'), rec('b'), rec('c')] }, // pageSize 2
      [rec('a')],
      'not json object',
      null,
    ];
    for (const body of bodies) {
      const { http, adapter } = setup();
      http.on(listUrl(undefined, 2), okJson(body));
      const read = await adapter.listCollection(req({ pageSize: 2 }));
      expect(read.coverage.status, JSON.stringify(body)).toBe('unavailable');
      expect(read.coverage.reasonCode).toBe('first-page-failed');
      expect(read.coverage.failure?.kind).toBe('invalid-response');
      expect(read.coverage.returned).toBe(0);
      expect(read.records).toEqual([]);
      expectBalanced(read);
    }
    // ...and on page 2 it is later-page-failed with page 1 kept
    const { http, adapter } = setup();
    http.on(listUrl(undefined, 2), okJson(page([rec('a')], 'a')));
    http.on(listUrl('a', 2), okJson({ records: [rec('b')], cursor: 7 }));
    const read = await adapter.listCollection(req({ pageSize: 2 }));
    expect(read.coverage).toMatchObject({ status: 'partial', reasonCode: 'later-page-failed', accepted: 1, returned: 1 });
    expect(read.coverage.failure?.kind).toBe('invalid-response');
  });

  it('a rate-limited page 1 → unavailable with that failure preserved', async () => {
    const { http, adapter } = setup();
    const failure = failWith('rate-limited', { status: 429, retryAfterMs: 60_000, origin: pds });
    http.on(listUrl(), failure);
    const read = await adapter.listCollection(req());
    expect(read.coverage.status).toBe('unavailable');
    expect(read.coverage.reasonCode).toBe('first-page-failed');
    expect(read.coverage.failure).toEqual(!failure.ok ? failure.failure : null);
  });
});

describe('listCollection — item checks', () => {
  it('missing cid, non-object value (string, array, null), non-object item → malformed-envelope', async () => {
    const { http, adapter } = setup();
    const good = `at://${me}/${POST}/m1`;
    http.on(
      listUrl(),
      okJson(
        page([
          { uri: good, value: { text: 'x' } }, // no cid
          rec('m2', { value: 'string' }),
          rec('m3', { value: [] }),
          rec('m4', { value: null }),
          rec('m5', { uri: 42 }),
          null,
          'item',
        ]),
      ),
    );
    const read = await adapter.listCollection(req());
    expect(read.records).toEqual([]);
    expect(read.rejected.map((s) => s.reasonCode)).toEqual(Array(7).fill('malformed-envelope'));
    expect(read.rejected[0]).toMatchObject({ uri: good, collection: POST, stage: 'fetch' });
    expect(read.rejected[1]!.uri).toBe(`at://${me}/${POST}/m2`);
    expect(read.rejected[4]!.uri).toBeNull();
    expect(read.rejected[5]!.uri).toBeNull();
    for (const s of read.rejected) expect(typeof s.detail).toBe('string');
    expectBalanced(read);
  });

  it('malformed-envelope keeps uri null when the uri string does not parse', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([{ uri: 'at://alice.bsky.social/app.bsky.feed.post/x', value: {} }])));
    const read = await adapter.listCollection(req());
    expect(read.rejected[0]).toMatchObject({ uri: null, reasonCode: 'malformed-envelope' });
  });

  it('foreign-owner, wrong-collection, invalid-uri (handle authority), invalid-cid', async () => {
    const { http, adapter } = setup();
    http.on(
      listUrl(),
      okJson(
        page([
          rec('f1', { uri: `at://${other}/${POST}/f1` }),
          rec('w1', { uri: `at://${me}/${LIKE}/w1` }),
          rec('h1', { uri: `at://alice.bsky.social/${POST}/h1` }),
          rec('c1', { cid: 'not a cid!' }),
          rec('ok1'),
        ]),
      ),
    );
    const read = await adapter.listCollection(req());
    expect(read.rejected.map((s) => [s.reasonCode, s.uri])).toEqual([
      ['foreign-owner', `at://${other}/${POST}/f1`],
      ['wrong-collection', `at://${me}/${LIKE}/w1`],
      ['invalid-uri', null],
      ['invalid-cid', `at://${me}/${POST}/c1`],
    ]);
    expect(read.records.map((r) => r.rkey)).toEqual(['ok1']);
    expectBalanced(read);
  });

  it('rejected items make a finished read partial / records-rejected, and rejected.length === coverage.rejected', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('a', { cid: '' }), rec('b')], 'b')));
    http.on(listUrl('b'), okJson(page([rec('c', { value: 1 })])));
    const read = await adapter.listCollection(req());
    expect(read.coverage).toMatchObject({
      status: 'partial',
      reasonCode: 'records-rejected',
      reason: '2 returned record(s) failed checks and were set aside.',
      pagesFetched: 2,
      returned: 3,
      accepted: 1,
      rejected: 2,
      failure: null,
    });
    expect(read.rejected).toHaveLength(2);
    expectBalanced(read);
  });

  it('page-cap takes precedence over records-rejected when both apply', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('a', { cid: '' })], 'a')));
    const read = await adapter.listCollection(req({ maxPages: 1 }));
    expect(read.coverage).toMatchObject({ status: 'partial', reasonCode: 'page-cap', rejected: 1 });
    expectBalanced(read);
  });

  it('duplicate URI across pages is counted in duplicates, kept once, and does not change complete', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('d2'), rec('d1')], 'd1')));
    http.on(listUrl('d1'), okJson(page([rec('d1'), rec('d0')])));
    const read = await adapter.listCollection(req());
    expect(read.records.map((r) => r.rkey)).toEqual(['d2', 'd1', 'd0']);
    expect(read.coverage).toMatchObject({ status: 'complete', reasonCode: 'ok', returned: 4, accepted: 3, duplicates: 1, rejected: 0 });
    expectBalanced(read);
  });
});

describe('listCollection — progress and abort', () => {
  it('onProgress is called once per successful page with increasing page', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), okJson(page([rec('a'), rec('b')], 'b')));
    http.on(listUrl('b'), okJson(page([rec('c')], 'c')));
    http.on(listUrl('c'), failWith('http', { status: 502 }));
    const seen: ListProgress[] = [];
    await adapter.listCollection(req({ maxPages: 5, onProgress: (p) => seen.push(p) }));
    expect(seen).toEqual([
      { collection: POST, page: 1, maxPages: 5, acceptedSoFar: 2 },
      { collection: POST, page: 2, maxPages: 5, acceptedSoFar: 3 },
    ]);
  });

  it('abort between pages rejects; onProgress not called afterwards; no further request', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    http.on(listUrl(), okJson(page([rec('a')], 'a')));
    http.on(listUrl('a'), okJson(page([rec('b')])));
    const seen: number[] = [];
    const promise = adapter.listCollection(
      req({
        signal: controller.signal,
        onProgress: (p) => {
          seen.push(p.page);
          controller.abort();
        },
      }),
    );
    await expect(promise).rejects.toSatisfy((e) => e === controller.signal.reason && controller.signal.aborted);
    expect(seen).toEqual([1]);
    expect(http.calls).toEqual([listUrl()]);
  });

  it('abort during a page request rejects with the abort reason and fires no progress', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    http.on(listUrl(), hangUntilAbort(() => queueMicrotask(() => controller.abort())));
    const seen: number[] = [];
    await expect(adapter.listCollection(req({ signal: controller.signal, onProgress: (p) => seen.push(p.page) }))).rejects.toSatisfy((e) => e === controller.signal.reason && controller.signal.aborted);
    expect(seen).toEqual([]);
  });

  it('a page that resolves after the signal aborted is not published', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    http.on(listUrl(), async () => {
      controller.abort();
      return okJson(page([rec('a')]));
    });
    const seen: number[] = [];
    await expect(adapter.listCollection(req({ signal: controller.signal, onProgress: (p) => seen.push(p.page) }))).rejects.toSatisfy((e) => e === controller.signal.reason && controller.signal.aborted);
    expect(seen).toEqual([]);
  });

  it('a non-abort rejection from the client becomes an internal failure in coverage, not a throw', async () => {
    const { http, adapter } = setup();
    http.on(listUrl(), async () => {
      throw new TypeError('boom');
    });
    const read = await adapter.listCollection(req());
    expect(read.coverage).toMatchObject({ status: 'unavailable', reasonCode: 'first-page-failed' });
    expect(read.coverage.failure?.kind).toBe('internal');
  });
});
