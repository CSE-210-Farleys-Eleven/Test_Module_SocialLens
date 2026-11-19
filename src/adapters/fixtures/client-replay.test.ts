// Replays the request sequence the real adapters send (per the atproto / bluesky / registry
// CONTRACT.md files) through the REAL shared HTTP client over the fixture server, and checks the
// observations against the manifest. Uses only `shared` at runtime (no other module's implementation).
import { describe, expect, it } from 'vitest';
import { buildXrpcUrl, createHttpClient, LIMITS, ORIGINS, type JsonValue, type Sleep } from '../../shared';
import { DEMO_ACCOUNT, DEMO_SCENARIO_IDS, type DemoScenarioId } from './contract';
import { REGISTERED_COLLECTIONS } from './generator';
import { createFixtures } from './index';

const fixtures = createFixtures();

/** Short waits (Retry-After 0 / backoff) resolve at once; the 10 s timeout never fires. */
const sleep: Sleep = (ms, signal) =>
  ms >= LIMITS.httpTimeoutMs
    ? new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    : Promise.resolve();

type Obj = Record<string, any>;

async function replay(id: DemoScenarioId) {
  const server = fixtures.createServer(id, null);
  const http = createHttpClient({ fetch: server.fetch, sleep, nowMs: () => 0, fixedOrigins: [ORIGINS.appView, ORIGINS.plcDirectory], limits: null });
  const signal = new AbortController().signal;
  const get = async (url: string): Promise<Obj | null> => {
    const r = await http.getJson({ url, signal });
    return r.ok ? (r.value as Obj) : null;
  };
  const did = DEMO_ACCOUNT.did;

  const doc = (await get(`${ORIGINS.plcDirectory}/${did}`))!;
  const pds = doc.service[0].serviceEndpoint as string;
  http.permitOrigin(pds as never, 'pds-from-did-document');
  const repo = (await get(buildXrpcUrl(pds, 'com.atproto.repo.describeRepo', { repo: did })))!;

  const rows: Obj = {};
  let postUris: string[] = [];
  for (const { nsid, pageSize } of REGISTERED_COLLECTIONS) {
    if (!(repo.collections as string[]).includes(nsid)) continue;
    let cursor: string | undefined;
    let accepted = 0;
    let rejected = 0;
    let status = 'complete';
    for (let page = 1; page <= LIMITS.maxPagesPerCollection; page++) {
      const params: Record<string, string | number> = { repo: did, collection: nsid, limit: pageSize };
      if (cursor !== undefined) params['cursor'] = cursor;
      const body = await get(buildXrpcUrl(pds, 'com.atproto.repo.listRecords', params));
      if (body === null) {
        status = page === 1 ? 'first-page-failed' : 'later-page-failed';
        break;
      }
      for (const r of body.records as JsonValue[] as Obj[]) {
        const ok = typeof r.value === 'object' && r.value !== null && (r.uri as string).startsWith(`at://${did}/${nsid}/`);
        if (ok) {
          accepted++;
          if (nsid === 'app.bsky.feed.post') postUris.push(r.uri);
        } else rejected++;
      }
      cursor = body.cursor;
      if (cursor === undefined || body.records.length === 0) break;
      if (page === LIMITS.maxPagesPerCollection) status = 'page-cap';
    }
    rows[nsid] = { accepted, rejected, status };
  }

  let known = 0;
  for (let i = 0; i < postUris.length; i += 25) {
    const body = await get(buildXrpcUrl(ORIGINS.appView, 'app.bsky.feed.getPosts', { uris: postUris.slice(i, i + 25) }));
    if (body !== null) known += body.posts.length;
  }
  return { log: server.requests(), rows, known, postUris, repo };
}

describe('replay through the real shared HTTP client', () => {
  it('complete: 18 requests (1 DID doc, 1 describeRepo, 11 listRecords, 5 getPosts), all clean', async () => {
    const { log, rows, known } = await replay('complete');
    expect(log).toHaveLength(18);
    expect(log.filter((e) => e.url.includes('listRecords'))).toHaveLength(11);
    expect(log.filter((e) => e.url.includes('getPosts'))).toHaveLength(5);
    expect(log.every((e) => !e.unexpected && e.credentials === 'omit' && !e.hadAuthorization && e.status === 200)).toBe(true);
    const origins = new Set(log.map((e) => new URL(e.url).origin));
    expect([...origins].sort()).toEqual([DEMO_ACCOUNT.pdsOrigin, 'https://plc.directory', 'https://public.api.bsky.app'].sort());
    const m = fixtures.manifest('complete');
    for (const row of m.collections) expect([row.collection, rows[row.collection].accepted]).toEqual([row.collection, row.servedValid]);
    expect(known).toBe(m.postsWithCounts);
  });

  it('partial: scripted failures are observed as the manifest says', async () => {
    const { log, rows, known, postUris } = await replay('partial');
    const m = fixtures.manifest('partial');
    expect(postUris).toHaveLength(60);
    expect(rows['app.bsky.feed.post']).toEqual({ accepted: 60, rejected: 2, status: 'complete' });
    expect(rows['app.bsky.feed.repost'].accepted).toBe(8);
    expect(rows['app.bsky.feed.like']).toMatchObject({ accepted: 100, status: 'later-page-failed' });
    expect(rows['app.bsky.graph.follow']).toMatchObject({ accepted: 1000, status: 'page-cap' });
    expect(rows['app.bsky.graph.block']).toMatchObject({ accepted: 0, status: 'first-page-failed' });
    expect(rows['app.bsky.graph.list']).toBeUndefined();
    expect(known).toBe(m.postsWithCounts);
    expect(log.some((e) => e.url.includes('app.bsky.graph.list&') || e.url.includes('graph.listitem'))).toBe(false);
    // Each always-failing request is sent 1 + httpMaxRetries times.
    const blockCalls = log.filter((e) => e.url.includes('graph.block'));
    expect(blockCalls.map((e) => e.status)).toEqual([500, 500, 500]);
    expect(log.filter((e) => e.url.includes('feed.repost')).map((e) => e.status)).toEqual([429, 200]);
    expect(log.filter((e) => e.url.includes('getPosts')).map((e) => e.status)).toEqual([200, 500, 500, 500, 200]);
    expect(log).toHaveLength(30);
    expect(log.every((e) => !e.unexpected)).toBe(true);
  });

  it('empty: exactly 2 requests', async () => {
    const { log, repo } = await replay('empty');
    expect(repo.collections).toEqual([]);
    expect(log).toHaveLength(2);
  });

  it.each(DEMO_SCENARIO_IDS)('%s: two replays log identical requests', async (id) => {
    expect((await replay(id)).log).toEqual((await replay(id)).log);
  });
});
