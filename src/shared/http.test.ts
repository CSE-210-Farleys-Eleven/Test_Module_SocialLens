import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, HttpClientDeps, HttpLimits, HttpsOrigin, Sleep } from './contract';
import { buildXrpcUrl, createHttpClient } from './http';

const APPVIEW = 'https://public.api.bsky.app';
const PLC_DIR = 'https://plc.directory';
const URL_OK = `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=a`;
const TIMEOUT = 10_000;
const NOW = Date.parse('2026-11-18T12:00:00.000Z');

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

interface Deferred {
  resolve(): void;
  promise: Promise<void>;
}

/** Sleep fake: timeout sleeps stay pending until `fireTimeout` (or abort); retry sleeps resolve at once unless overridden. */
function makeSleep(retrySleep?: Sleep) {
  const calls: { ms: number; signal: AbortSignal }[] = [];
  const timeouts: Deferred[] = [];
  const sleep = vi.fn<Sleep>((ms, signal) => {
    calls.push({ ms, signal });
    if (ms === TIMEOUT) {
      let resolve!: () => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        signal.addEventListener('abort', () => rej(signal.reason), { once: true });
      });
      timeouts.push({ resolve, promise });
      return promise;
    }
    return retrySleep ? retrySleep(ms, signal) : Promise.resolve();
  });
  return {
    sleep,
    calls,
    retryWaits: () => calls.filter((c) => c.ms !== TIMEOUT).map((c) => c.ms),
    timeoutCalls: () => calls.filter((c) => c.ms === TIMEOUT),
    fireTimeout: (i = timeouts.length - 1) => timeouts[i]?.resolve(),
  };
}

function setup(handlers: Handler[], opts: { limits?: Partial<HttpLimits>; retrySleep?: Sleep; nowMs?: number } = {}) {
  const requests: { url: string; init: RequestInit }[] = [];
  const queue = [...handlers];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const i = init ?? {};
    requests.push({ url, init: i });
    const h = queue.shift();
    if (!h) throw new Error('unexpected fetch');
    return h(url, i);
  });
  const s = makeSleep(opts.retrySleep);
  const deps: HttpClientDeps = {
    fetch,
    sleep: s.sleep,
    nowMs: () => opts.nowMs ?? NOW,
    fixedOrigins: [APPVIEW, PLC_DIR],
    limits: opts.limits ?? null,
  };
  return { client: createHttpClient(deps), fetch, requests, ...s };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A body stream that records cancellation; `chunks` are emitted, then it hangs (or ends). */
function trackedStream(chunks: Uint8Array[], end: boolean) {
  const state = { cancelled: false, pulls: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      const c = chunks.shift();
      if (c) controller.enqueue(c);
      else if (end) controller.close();
      else return new Promise<void>(() => {}); // hang
      return undefined;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const signal = () => new AbortController().signal;

describe('createHttpClient — request shape (I-4)', () => {
  it('sends a GET with credentials omit, redirect error, Accept JSON and no Authorization', async () => {
    const t = setup([json({ a: 1 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r).toEqual({ ok: true, value: { a: 1 } });
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const { url, init } = t.requests[0]!;
    expect(url).toBe(URL_OK);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect([...headers.keys()]).toEqual(['accept']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('clears the per-attempt timeout once the request finishes', async () => {
    const t = setup([json({})]);
    await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(t.timeoutCalls()).toHaveLength(1);
    expect(t.timeoutCalls()[0]!.signal.aborted).toBe(true);
  });
});

describe('createHttpClient — origin policy (I-3)', () => {
  it('unpermitted origin → blocked-origin with 0 fetch calls; after permitOrigin it is fetched', async () => {
    const t = setup([json({ ok: 1 })]);
    const url = 'https://pds.example.org/xrpc/com.atproto.repo.describeRepo?repo=x';
    const r1 = await t.client.getJson({ url, signal: signal() });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.failure.kind).toBe('blocked-origin');
      expect(r1.failure.origin).toBe('https://pds.example.org');
    }
    expect(t.fetch).toHaveBeenCalledTimes(0);
    t.client.permitOrigin('https://pds.example.org' as HttpsOrigin, 'pds-from-did-document');
    const r2 = await t.client.getJson({ url, signal: signal() });
    expect(r2.ok).toBe(true);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['http://', 'http://public.api.bsky.app/xrpc/x'],
    ['credentials', 'https://user:pw@public.api.bsky.app/xrpc/x'],
    ['username only', 'https://user@public.api.bsky.app/xrpc/x'],
    ['fragment', `${URL_OK}#frag`],
    ['empty fragment', `${URL_OK}#`],
    ['explicit port changes origin', 'https://public.api.bsky.app:8443/xrpc/x'],
    ['look-alike host', 'https://public.api.bsky.app.evil.example/xrpc/x'],
    ['not a URL', 'not a url'],
    ['relative URL', '/xrpc/x'],
  ])('%s → blocked-origin, 0 calls', async (_l, url) => {
    const t = setup([json({})]);
    const r = await t.client.getJson({ url, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('blocked-origin');
    expect(t.fetch).toHaveBeenCalledTimes(0);
    expect(t.sleep).toHaveBeenCalledTimes(0);
  });
  it('permitOrigin is idempotent and permittedOrigins lists fixed then permitted, de-duplicated', () => {
    const t = setup([]);
    t.client.permitOrigin('https://pds.example.org' as HttpsOrigin, 'pds-from-did-document');
    t.client.permitOrigin('https://pds.example.org' as HttpsOrigin, 'pds-from-did-document');
    t.client.permitOrigin(APPVIEW as HttpsOrigin, 'did-web-host');
    t.client.permitOrigin('https://example.com' as HttpsOrigin, 'did-web-host');
    expect(t.client.permittedOrigins()).toEqual([APPVIEW, PLC_DIR, 'https://pds.example.org', 'https://example.com']);
  });
  it('permitOrigin refuses a value that is not a valid HttpsOrigin (programmer error)', () => {
    const t = setup([]);
    expect(() => t.client.permitOrigin('http://localhost:3000' as HttpsOrigin, 'did-web-host')).toThrow(TypeError);
    expect(t.client.permittedOrigins()).toEqual([APPVIEW, PLC_DIR]);
  });
  it('permittedOrigins returns a copy', () => {
    const t = setup([]);
    const list = t.client.permittedOrigins() as string[];
    list.push('https://evil.example');
    expect(t.client.permittedOrigins()).toEqual([APPVIEW, PLC_DIR]);
  });
});

describe('createHttpClient — 2xx bodies', () => {
  it('200 with valid JSON → ok', async () => {
    const t = setup([json([1, 'two', null])]);
    expect(await t.client.getJson({ url: URL_OK, signal: signal() })).toEqual({ ok: true, value: [1, 'two', null] });
  });
  it('200 with invalid JSON → invalid-response', async () => {
    const t = setup([() => new Response('<html>nope</html>', { status: 200 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('invalid-response');
      expect(r.failure.status).toBe(200);
      expect(r.failure.origin).toBe(APPVIEW);
    }
  });
  it('200 with an empty body → invalid-response', async () => {
    const t = setup([() => new Response(null, { status: 200 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('invalid-response');
  });
  it('body larger than the limit → too-large and the stream is cancelled', async () => {
    const { stream, state } = trackedStream(
      [new Uint8Array(6).fill(0x31), new Uint8Array(6).fill(0x31), new Uint8Array(6).fill(0x31)],
      true,
    );
    const t = setup([() => new Response(stream, { status: 200 })], { limits: { maxResponseBytes: 10 } });
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('too-large');
    expect(state.cancelled).toBe(true);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('a body of exactly the limit is accepted', async () => {
    const t = setup([() => new Response('[1,2,3,4]', { status: 200 })], { limits: { maxResponseBytes: 9 } });
    expect(await t.client.getJson({ url: URL_OK, signal: signal() })).toEqual({ ok: true, value: [1, 2, 3, 4] });
  });
  it('invalid UTF-8 → invalid-response', async () => {
    const t = setup([() => new Response(new Uint8Array([0x22, 0xff, 0x22]), { status: 200 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('invalid-response');
  });
});

describe('createHttpClient — retries (I-9)', () => {
  it('429 with Retry-After: 1 → sleeps 1000 ms then retries and succeeds (2 calls)', async () => {
    const t = setup([json({ error: 'RateLimitExceeded' }, 429, { 'retry-after': '1' }), json({ done: true })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r).toEqual({ ok: true, value: { done: true } });
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.retryWaits()).toEqual([1000]);
  });
  it('429 with Retry-After: 60 → rate-limited, retryAfterMs 60000, exactly 1 call, no retry sleep', async () => {
    const t = setup([json({}, 429, { 'retry-after': '60' }), json({})]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('rate-limited');
      expect(r.failure.retryAfterMs).toBe(60_000);
      expect(r.failure.status).toBe(429);
      expect(r.failure.origin).toBe(APPVIEW);
    }
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.retryWaits()).toEqual([]);
  });
  it('Retry-After as an HTTP-date is relative to deps.nowMs()', async () => {
    const date = new Date(NOW + 2000).toUTCString();
    const t = setup([json({}, 429, { 'retry-after': date }), json({ x: 1 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(true);
    expect(t.retryWaits()).toEqual([2000]);
  });
  it('Retry-After HTTP-date in the past waits 0 ms', async () => {
    const date = new Date(NOW - 60_000).toUTCString();
    const t = setup([json({}, 503, { 'retry-after': date }), json({ x: 1 })]);
    await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(t.retryWaits()).toEqual([0]);
  });
  it('unparseable Retry-After falls back to exponential backoff', async () => {
    const t = setup([json({}, 429, { 'retry-after': 'soon' }), json({}, 429, { 'retry-after': '-3' }), json({})]);
    await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(t.retryWaits()).toEqual([500, 1000]);
  });
  it('503 three times → http with status 503 after exactly 3 calls; backoff waits 500 then 1000 ms', async () => {
    const t = setup([json({}, 503), json({}, 503), json({}, 503), json({})]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('http');
      expect(r.failure.status).toBe(503);
      expect(r.failure.retryAfterMs).toBeNull();
    }
    expect(t.fetch).toHaveBeenCalledTimes(3);
    expect(t.retryWaits()).toEqual([500, 1000]);
  });
  it('429 three times with Retry-After: 1 → rate-limited after 3 calls with retryAfterMs 1000', async () => {
    const t = setup([1, 2, 3].map(() => json({}, 429, { 'retry-after': '1' })));
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('rate-limited');
      expect(r.failure.retryAfterMs).toBe(1000);
    }
    expect(t.fetch).toHaveBeenCalledTimes(3);
    expect(t.retryWaits()).toEqual([1000, 1000]);
  });
  it('503 with Retry-After above the cap → http immediately, retryAfterMs set, 1 call', async () => {
    const t = setup([json({}, 503, { 'retry-after': '6' })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('http');
      expect(r.failure.retryAfterMs).toBe(6000);
    }
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('honours limit overrides (maxRetries 0 → single attempt)', async () => {
    const t = setup([json({}, 500), json({})], { limits: { maxRetries: 0 } });
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('http');
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels the unread body of a retried response', async () => {
    const { stream, state } = trackedStream([new TextEncoder().encode('{}')], false);
    const t = setup([() => new Response(stream, { status: 503 }), json({})]);
    await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(state.cancelled).toBe(true);
  });
});

describe('createHttpClient — other failures', () => {
  it('400 with { error: "InvalidRequest" } → xrpc, no retry, server message not copied', async () => {
    const t = setup([json({ error: 'InvalidRequest', message: 'secret-server-text' }, 400), json({})]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('xrpc');
      expect(r.failure.xrpcError).toBe('InvalidRequest');
      expect(r.failure.status).toBe(400);
      expect(r.failure.origin).toBe(APPVIEW);
      expect(r.failure.message).not.toContain('secret-server-text');
      expect(r.failure.message.length).toBeGreaterThan(0);
    }
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('404 with HTML → http', async () => {
    const t = setup([() => new Response('<h1>Not found</h1>', { status: 404 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('http');
      expect(r.failure.status).toBe(404);
      expect(r.failure.xrpcError).toBeNull();
      expect(r.failure.origin).toBe(APPVIEW);
    }
  });
  it('error JSON whose error is not a string → http', async () => {
    const t = setup([json({ error: 42 }, 400)]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('http');
  });
  it('error body over 64 KB is not parsed → http, and is cancelled', async () => {
    const big = new TextEncoder().encode(`{"error":"X","pad":"${'a'.repeat(70_000)}"}`);
    const { stream, state } = trackedStream([big.slice(0, 40_000), big.slice(40_000)], false);
    const t = setup([() => new Response(stream, { status: 400 })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('http');
    expect(state.cancelled).toBe(true);
  });
  it('fetch rejects with TypeError → network, 1 call', async () => {
    const t = setup([
      () => {
        throw new TypeError('Failed to fetch');
      },
      json({}),
    ]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('network');
      expect(r.failure.origin).toBe(APPVIEW);
      expect(r.failure.status).toBeNull();
    }
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('3xx (should not happen with redirect: error) → http', async () => {
    const t = setup([() => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })]);
    const r = await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(!r.ok && r.failure.kind).toBe('http');
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('createHttpClient — timeout', () => {
  it('fake sleep for the timeout resolves first → timeout; the attempt signal is aborted; no retry', async () => {
    let attemptSignal: AbortSignal | undefined;
    const t = setup([
      (_u, init) => {
        attemptSignal = init.signal ?? undefined;
        return new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal?.reason));
        });
      },
      json({}),
    ]);
    const p = t.client.getJson({ url: URL_OK, signal: signal() });
    await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledTimes(1));
    expect(t.timeoutCalls()[0]!.ms).toBe(TIMEOUT);
    t.fireTimeout();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('timeout');
      expect(r.failure.origin).toBe(APPVIEW);
    }
    expect(attemptSignal?.aborted).toBe(true);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });
  it('timeout while reading the body → timeout and the body is cancelled', async () => {
    const { stream, state } = trackedStream([new TextEncoder().encode('{"a":')], false);
    const t = setup([() => new Response(stream, { status: 200 })]);
    const p = t.client.getJson({ url: URL_OK, signal: signal() });
    await vi.waitFor(() => expect(state.pulls).toBeGreaterThanOrEqual(2));
    t.fireTimeout();
    const r = await p;
    expect(!r.ok && r.failure.kind).toBe('timeout');
    expect(state.cancelled).toBe(true);
  });
  it('uses the timeoutMs override', async () => {
    const t = setup([json({})], { limits: { timeoutMs: 1234 } });
    await t.client.getJson({ url: URL_OK, signal: signal() });
    expect(t.calls[0]!.ms).toBe(1234);
  });
});

describe('createHttpClient — cancellation', () => {
  it('caller aborted before the call → rejects with the reason, 0 calls', async () => {
    const t = setup([json({})]);
    const c = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    c.abort(reason);
    await expect(t.client.getJson({ url: URL_OK, signal: c.signal })).rejects.toBe(reason);
    expect(t.fetch).toHaveBeenCalledTimes(0);
  });
  it('caller aborted before the call with a blocked URL still rejects (abort first)', async () => {
    const t = setup([]);
    const c = new AbortController();
    c.abort('r');
    await expect(t.client.getJson({ url: 'http://x.example', signal: c.signal })).rejects.toBe('r');
  });
  it('caller aborts during the fetch → rejects with the caller reason (not a Failure)', async () => {
    const c = new AbortController();
    const reason = new DOMException('user cancelled', 'AbortError');
    let seen: AbortSignal | undefined;
    const t = setup([
      (_u, init) => {
        seen = init.signal ?? undefined;
        return new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        });
      },
    ]);
    const p = t.client.getJson({ url: URL_OK, signal: c.signal });
    await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledTimes(1));
    c.abort(reason);
    await expect(p).rejects.toBe(reason);
    expect(seen?.aborted).toBe(true);
  });
  it('caller aborts during a fetch that ignores the signal → still rejects', async () => {
    const c = new AbortController();
    let release!: () => void;
    const t = setup([
      () =>
        new Promise<Response>((res) => {
          release = () => res(new Response('{}', { status: 200 }));
        }),
    ]);
    const p = t.client.getJson({ url: URL_OK, signal: c.signal });
    await vi.waitFor(() => expect(t.fetch).toHaveBeenCalledTimes(1));
    c.abort('gone');
    release();
    await expect(p).rejects.toBe('gone');
  });
  it('caller aborts while reading the body → rejects with the reason and cancels the body', async () => {
    const c = new AbortController();
    const { stream, state } = trackedStream([new TextEncoder().encode('{"a":')], false);
    const t = setup([() => new Response(stream, { status: 200 })]);
    const p = t.client.getJson({ url: URL_OK, signal: c.signal });
    await vi.waitFor(() => expect(state.pulls).toBeGreaterThanOrEqual(2));
    c.abort('bye');
    await expect(p).rejects.toBe('bye');
    expect(state.cancelled).toBe(true);
  });
  it('caller aborts during a retry wait → rejects, no second call', async () => {
    const c = new AbortController();
    const retrySleep: Sleep = (_ms, s) =>
      new Promise<void>((_res, rej) => {
        s.addEventListener('abort', () => rej(s.reason), { once: true });
      });
    const t = setup([json({}, 503), json({})], { retrySleep });
    const p = t.client.getJson({ url: URL_OK, signal: c.signal });
    await vi.waitFor(() => expect(t.retryWaits()).toEqual([500]));
    c.abort('stop');
    await expect(p).rejects.toBe('stop');
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const retryCall = t.calls.find((x) => x.ms === 500)!;
    expect(retryCall.signal).toBe(c.signal);
  });
});

describe('buildXrpcUrl', () => {
  it('repeats array params and percent-encodes values', () => {
    const url = buildXrpcUrl(APPVIEW, 'app.bsky.feed.getPosts', {
      uris: ['at://did:plc:a/app.bsky.feed.post/1', 'b'],
    });
    expect(url).toBe(
      `${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Aa%2Fapp.bsky.feed.post%2F1&uris=b`,
    );
    expect(buildXrpcUrl(APPVIEW, 'm', { uris: ['a', 'b'] })).toBe(`${APPVIEW}/xrpc/m?uris=a&uris=b`);
  });
  it('keeps insertion order and stringifies numbers and booleans', () => {
    expect(
      buildXrpcUrl('https://pds.example.org', 'com.atproto.repo.listRecords', {
        repo: 'did:plc:x',
        collection: 'app.bsky.feed.post',
        limit: 100,
        reverse: false,
        cursor: 'a b&c',
      }),
    ).toBe(
      'https://pds.example.org/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Ax&collection=app.bsky.feed.post&limit=100&reverse=false&cursor=a+b%26c',
    );
  });
  it('has no trailing ? without params', () => {
    expect(buildXrpcUrl(APPVIEW, 'com.atproto.repo.describeRepo', {})).toBe(
      `${APPVIEW}/xrpc/com.atproto.repo.describeRepo`,
    );
    expect(buildXrpcUrl(APPVIEW, 'm', { uris: [] })).toBe(`${APPVIEW}/xrpc/m`);
  });
});
