import { describe, expect, it } from 'vitest';
import { parseIsoDateTime, tidToIsoDateTime } from '../../shared';
import { DEMO_ACCOUNT, DEMO_SCENARIO_IDS, type DemoScenarioId } from './contract';
import { REGISTERED_COLLECTIONS, didDocument, describeRepoBody, generateScenario, type ScenarioData } from './generator';
import { createFixtures } from './index';

const POST = 'app.bsky.feed.post';
const NOW_MS = Date.parse(DEMO_ACCOUNT.now);
const HOUR = 3_600_000;
const fixtures = createFixtures();

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
  return out;
}

/** Everything the generator can ever serve for a scenario. */
function servedSurface(data: ScenarioData): unknown[] {
  return [
    didDocument(),
    describeRepoBody(data),
    data.collections.map((c) => c.items.map((i) => ({ uri: i.uri, cid: i.cid, value: i.value }))),
    data.postViews.map((p) => p.view),
  ];
}

function posts(data: ScenarioData) {
  const c = data.collections.find((x) => x.nsid === POST);
  return (c?.items ?? []).filter((i) => i.valid);
}

function textOf(value: unknown): string | null {
  return value !== null && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
    ? value.text
    : null;
}

function timestampOf(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const t = v['createdAt'] ?? v['publishedAt'];
  return typeof t === 'string' ? t : null;
}

describe('generator', () => {
  it.each(DEMO_SCENARIO_IDS)('%s: every own record URI is at://<did>/<collection>/<rkey> and the rkey encodes its timestamp', (id) => {
    const data = generateScenario(id);
    for (const c of data.collections) {
      for (const item of c.items.filter((i) => i.valid)) {
        expect(item.uri).toBe(`at://${DEMO_ACCOUNT.did}/${c.nsid}/${item.rkey}`);
        if (c.nsid === 'app.bsky.actor.profile' || c.nsid === 'chat.bsky.actor.declaration') {
          expect(item.rkey).toBe('self');
          continue;
        }
        const decoded = tidToIsoDateTime(item.rkey);
        expect(decoded).not.toBeNull();
        const ts = timestampOf(item.value);
        if (ts !== null) expect(decoded!.slice(0, 19)).toBe(parseIsoDateTime(ts)!.slice(0, 19));
        expect(Date.parse(decoded!)).toBeLessThanOrEqual(NOW_MS);
      }
    }
  });

  it.each(DEMO_SCENARIO_IDS)('%s: no real host, handle or bsky.social anywhere', (id) => {
    const allowedContexts = new Set(didDocument()['@context'] as string[]);
    for (const s of collectStrings(servedSurface(generateScenario(id)))) {
      expect(s.toLowerCase()).not.toContain('bsky.social');
      if (s === '@context') continue;
      expect(s).not.toMatch(/@[A-Za-z0-9]/);
      if (allowedContexts.has(s)) continue;
      for (const m of s.matchAll(/https?:\/\/([^/\s"'<>]+)/g)) {
        expect(m[1]).toMatch(/\.(example|invalid)$/);
      }
    }
  });

  it('the DID document @context lists only W3C/w3id specification identifiers', () => {
    for (const c of didDocument()['@context'] as string[]) expect(c).toMatch(/^https:\/\/(www\.w3\.org|w3id\.org)\//);
  });

  it.each(DEMO_SCENARIO_IDS)('%s: every timestamp parses and is <= now', (id) => {
    const data = generateScenario(id);
    const stamps: string[] = [];
    for (const c of data.collections) for (const i of c.items) {
      const t = timestampOf(i.value);
      if (t !== null) stamps.push(t);
    }
    for (const p of data.postViews) stamps.push(p.view.indexedAt);
    for (const t of stamps) {
      const parsed = parseIsoDateTime(t);
      expect(parsed, t).not.toBeNull();
      expect(Date.parse(parsed!)).toBeLessThanOrEqual(NOW_MS);
    }
  });

  it('subject DIDs and CIDs have the synthetic shapes', () => {
    const data = generateScenario('complete');
    for (const c of data.collections) for (const i of c.items) {
      expect(i.cid).toMatch(/^bafyrei[a-z2-7]{52}$/);
      for (const s of collectStrings(i.value)) {
        for (const m of s.matchAll(/did:plc:[a-z2-7]+/g)) expect(m[0]).toMatch(/^did:plc:(synthetic|demosynthetic)[a-z2-7]+$/);
        for (const m of s.matchAll(/did:plc:[^\s/"]*/g)) expect(m[0]).toMatch(/^did:plc:[a-z2-7]{24}$/);
      }
    }
    const cids = data.collections.flatMap((c) => c.items.map((i) => i.cid));
    expect(new Set(cids).size).toBe(cids.length);
  });

  it('only the ten registered collections are in the registered list', () => {
    expect(REGISTERED_COLLECTIONS.map((c) => c.nsid)).toEqual([
      'app.bsky.feed.post',
      'app.bsky.feed.repost',
      'app.bsky.feed.like',
      'app.bsky.graph.follow',
      'app.bsky.graph.block',
      'app.bsky.graph.list',
      'app.bsky.graph.listitem',
      'app.bsky.actor.profile',
      'site.standard.document',
      'site.standard.publication',
    ]);
  });

  it('generating twice yields deep-equal output', () => {
    for (const id of DEMO_SCENARIO_IDS) {
      expect(generateScenario(id)).toEqual(generateScenario(id));
      expect(createFixtures().manifest(id)).toEqual(createFixtures().manifest(id));
    }
  });
});

describe('complete scenario', () => {
  const data = generateScenario('complete');
  const m = fixtures.manifest('complete');

  it('manifest totals', () => {
    expect(m.handleIsCorrect).toBe(true);
    expect(m.collections).toHaveLength(10);
    expect(m.collections.reduce((s, c) => s + c.servedValid, 0)).toBe(214);
    expect(m.collections.reduce((s, c) => s + c.servedInvalid, 0)).toBe(0);
    expect(m.collections.every((c) => c.advertised && c.expectedStatus === 'complete' && c.expectedReasonCode === 'ok')).toBe(true);
    expect(m.postsWithCounts).toBe(120);
    expect(m.postsWithUnknownCounts).toBe(0);
    expect(m.expectedCountBatches).toBe(5);
    expect(m.expectedNormalizeSkips).toBe(0);
    expect(m.presentNotAnalysed).toEqual(['app.bsky.graph.listblock', 'chat.bsky.actor.declaration']);
    expect(m.did).toBe(DEMO_ACCOUNT.did);
    expect(m.handle).toBe(DEMO_ACCOUNT.handle);
    expect(m.pdsOrigin).toBe(DEMO_ACCOUNT.pdsOrigin);
    expect(m.now).toBe(DEMO_ACCOUNT.now);
  });

  it('per-collection counts and pages as the contract table', () => {
    const row = (nsid: string) => m.collections.find((c) => c.collection === nsid)!;
    expect([row('app.bsky.feed.post').servedValid, row('app.bsky.feed.post').pages]).toEqual([120, 2]);
    const singles: Record<string, number> = {
      'app.bsky.feed.repost': 12,
      'app.bsky.feed.like': 40,
      'app.bsky.graph.follow': 25,
      'app.bsky.graph.block': 3,
      'app.bsky.graph.list': 2,
      'app.bsky.graph.listitem': 6,
      'app.bsky.actor.profile': 1,
      'site.standard.document': 4,
      'site.standard.publication': 1,
    };
    for (const [nsid, n] of Object.entries(singles)) expect([nsid, row(nsid).servedValid, row(nsid).pages]).toEqual([nsid, n, 1]);
    const ps = posts(data);
    expect(ps.filter((p) => (p.value as { reply?: unknown }).reply === undefined)).toHaveLength(90);
    expect(ps.filter((p) => (p.value as { reply?: unknown }).reply !== undefined)).toHaveLength(30);
  });

  it('exactly one post carries the markup probe, and it is the newest non-settling post', () => {
    const probe = 'Is <b>this</b> shown as text? <img src=x onerror=alert(1)>';
    const ps = posts(data);
    expect(ps.filter((p) => textOf(p.value) === probe)).toHaveLength(1);
    const nonSettling = ps.filter((p) => NOW_MS - Date.parse(p.createdAt!) >= 36 * HOUR);
    expect(textOf(nonSettling[0]!.value)).toBe(probe);
    const all = data.collections.flatMap((c) => c.items.map((i) => JSON.stringify(i.value)));
    expect(all.filter((s) => s.includes('<img'))).toHaveLength(1);
  });

  it('exactly 2 posts within 36 h of now', () => {
    expect(posts(data).filter((p) => NOW_MS - Date.parse(p.createdAt!) < 36 * HOUR)).toHaveLength(2);
  });

  it('posts span at most 60 days, newest first', () => {
    const times = posts(data).map((p) => Date.parse(p.createdAt!));
    expect(Math.min(...times)).toBeGreaterThan(NOW_MS - 60 * 24 * HOUR);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('>= 50 % of content items between 18:00 and 23:59 UTC', () => {
    const docs = data.collections.find((c) => c.nsid === 'site.standard.document')!.items;
    const stamps = [...posts(data), ...docs].map((i) => new Date(i.createdAt!).getUTCHours());
    expect(stamps).toHaveLength(124);
    expect(stamps.filter((h) => h >= 18).length / stamps.length).toBeGreaterThanOrEqual(0.5);
  });

  it('a post on each of the last 5 UTC days', () => {
    const days = new Set(posts(data).map((p) => p.createdAt!.slice(0, 10)));
    for (let d = 0; d < 5; d++) expect(days.has(new Date(NOW_MS - d * 24 * HOUR).toISOString().slice(0, 10))).toBe(true);
  });

  it('some posts carry tags (facets and/or tags)', () => {
    const tagged = posts(data).filter((p) => {
      const v = p.value as { facets?: unknown[]; tags?: unknown[] };
      return (v.facets?.length ?? 0) > 0 || (v.tags?.length ?? 0) > 0;
    });
    expect(tagged.length).toBeGreaterThan(0);
  });

  it('counters include genuine zeros', () => {
    const counts = data.postViews.map((p) => p.view);
    expect(counts.some((c) => c.likeCount === 0)).toBe(true);
    expect(counts.some((c) => c.quoteCount === 0)).toBe(true);
    expect(counts.some((c) => c.likeCount > 0)).toBe(true);
  });
});

describe('partial scenario', () => {
  const m = fixtures.manifest('partial');
  const row = (nsid: string) => m.collections.find((c) => c.collection === nsid)!;

  it('statuses and reason codes exactly as the table', () => {
    expect(m.handleIsCorrect).toBe(false);
    const got = Object.fromEntries(m.collections.map((c) => [c.collection, [c.advertised, c.expectedStatus, c.expectedReasonCode]]));
    expect(got).toEqual({
      'app.bsky.feed.post': [true, 'partial', 'records-rejected'],
      'app.bsky.feed.repost': [true, 'complete', 'ok'],
      'app.bsky.feed.like': [true, 'partial', 'later-page-failed'],
      'app.bsky.graph.follow': [true, 'partial', 'page-cap'],
      'app.bsky.graph.block': [true, 'unavailable', 'first-page-failed'],
      'app.bsky.graph.list': [false, 'complete', 'not-present'],
      'app.bsky.graph.listitem': [false, 'complete', 'not-present'],
      'app.bsky.actor.profile': [true, 'complete', 'ok'],
      'site.standard.document': [true, 'complete', 'ok'],
      'site.standard.publication': [true, 'complete', 'ok'],
    });
    expect(m.presentNotAnalysed).toEqual(['app.bsky.graph.listblock']);
  });

  it('served counts', () => {
    expect([row('app.bsky.feed.post').servedValid, row('app.bsky.feed.post').servedInvalid, row('app.bsky.feed.post').pages]).toEqual([60, 2, 1]);
    expect(row('app.bsky.feed.repost').servedValid).toBe(8);
    expect([row('app.bsky.feed.like').servedValid, row('app.bsky.feed.like').pages]).toEqual([100, 2]);
    expect([row('app.bsky.graph.follow').servedValid, row('app.bsky.graph.follow').pages]).toEqual([1050, 11]);
    expect([row('app.bsky.graph.block').servedValid, row('app.bsky.graph.block').pages]).toEqual([0, 1]);
    expect(row('app.bsky.graph.list').pages).toBe(0);
    expect(row('site.standard.document').servedValid).toBe(2);
  });

  it('engagement ground truth', () => {
    expect(m.postsWithCounts).toBe(34);
    expect(m.postsWithUnknownCounts).toBe(26);
    expect(m.expectedCountBatches).toBe(3);
    expect(m.expectedNormalizeSkips).toBe(1);
  });

  it('the 30th post has no text; the two invalid items come last', () => {
    const items = generateScenario('partial').collections.find((c) => c.nsid === POST)!.items;
    expect(items).toHaveLength(62);
    expect(items.slice(0, 60).every((i) => i.valid)).toBe(true);
    expect(textOf(items[29]!.value)).toBeNull();
    expect(items.filter((i) => textOf(i.value) === null)).toHaveLength(2); // the 30th, and the string-valued item
    expect(items[60]!.uri.startsWith(`at://${DEMO_ACCOUNT.did}/`)).toBe(false);
    expect(typeof items[61]!.value).toBe('string');
  });
});

describe('empty scenario', () => {
  it('no advertised collections, zero everywhere', () => {
    const m = fixtures.manifest('empty');
    expect(m.handleIsCorrect).toBe(true);
    expect(m.collections).toHaveLength(10);
    for (const c of m.collections) {
      expect(c).toMatchObject({ advertised: false, servedValid: 0, servedInvalid: 0, pages: 0, expectedStatus: 'complete', expectedReasonCode: 'not-present' });
    }
    expect(m.presentNotAnalysed).toEqual([]);
    expect([m.postsWithCounts, m.postsWithUnknownCounts, m.expectedCountBatches, m.expectedNormalizeSkips]).toEqual([0, 0, 0, 0]);
    expect(m.countTotals).toEqual({ likes: 0, reposts: 0, replies: 0, quotes: 0 });
    expect(describeRepoBody(generateScenario('empty')).collections).toEqual([]);
  });
});

describe('manifest vs server', () => {
  it.each(['complete', 'partial'] as DemoScenarioId[])('%s: countTotals equals the sum of counters the server returns', async (id) => {
    const server = fixtures.createServer(id, null);
    const uris = posts(generateScenario(id)).map((p) => p.uri);
    const totals = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
    let known = 0;
    for (let i = 0; i < uris.length; i += 25) {
      const qs = uris.slice(i, i + 25).map((u) => `uris=${encodeURIComponent(u)}`).join('&');
      const res = await server.fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${qs}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { posts: { likeCount: number; repostCount: number; replyCount: number; quoteCount: number }[] };
      for (const p of body.posts) {
        known++;
        totals.likes += p.likeCount;
        totals.reposts += p.repostCount;
        totals.replies += p.replyCount;
        totals.quotes += p.quoteCount;
      }
    }
    const m = fixtures.manifest(id);
    expect(known).toBe(m.postsWithCounts);
    expect(totals).toEqual(m.countTotals);
    expect(totals.likes).toBeGreaterThan(0);
  });

  it('fixtures exposes session, now and three scenarios', () => {
    expect(fixtures.session).toEqual({ did: DEMO_ACCOUNT.did, source: 'demo' });
    expect(fixtures.now).toBe(DEMO_ACCOUNT.now);
    expect(fixtures.scenarios.map((s) => [s.id, s.label])).toEqual([
      ['complete', 'Complete sample'],
      ['partial', 'Partial and unavailable reads'],
      ['empty', 'Empty account'],
    ]);
    for (const s of fixtures.scenarios) expect(s.description.length).toBeGreaterThan(10);
  });
});
