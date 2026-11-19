import { describe, expect, it } from 'vitest';
import { METRIC_IDS, SOURCES, UNAVAILABLE_METRIC_IDS } from '../shared';
import { createRegistry } from './index';

const NSIDS = [
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
];

describe('registry data', () => {
  const r = createRegistry();

  it('lists exactly the 10 collections in order, 8 bluesky and 2 standard-site', () => {
    expect(r.data.collections.map((c) => c.nsid)).toEqual(NSIDS);
    expect(r.data.collections.filter((c) => c.appId === 'bluesky')).toHaveLength(8);
    expect(r.data.collections.filter((c) => c.appId === 'standard-site')).toHaveLength(2);
    expect(r.data.version).toBe('2026-11-18.1');
    expect(r.data.apps.map((a) => a.id)).toEqual(['bluesky', 'standard-site']);
  });

  it('every collection is public-repo and cites an existing SOURCES key', () => {
    for (const c of r.data.collections) {
      expect(c.visibility).toBe('public-repo');
      expect(Object.keys(SOURCES)).toContain(c.visibilitySource);
    }
    for (const a of r.data.apps) expect(Object.keys(SOURCES)).toContain(a.source);
    for (const n of r.data.nonRepoData) expect(Object.keys(SOURCES)).toContain(n.source);
  });

  it('only app.bsky.feed.post has an engagement source', () => {
    const withSource = r.data.collections.filter((c) => c.engagementSource !== null);
    expect(withSource.map((c) => c.nsid)).toEqual(['app.bsky.feed.post']);
    expect(withSource[0]?.engagementSource).toBe('bluesky-appview');
  });

  it('documents use publishedAt and page size 50; publications have no timestamp field', () => {
    const doc = r.collection('site.standard.document');
    const pub = r.collection('site.standard.publication');
    expect(doc?.timestampField).toBe('publishedAt');
    expect(doc?.pageSize).toBe(50);
    expect(pub?.timestampField).toBeNull();
    expect(r.data.collections.filter((c) => c.appId === 'bluesky').every((c) => c.timestampField === 'createdAt' && c.pageSize === 100)).toBe(true);
  });

  it('has the declared kinds and unique normalizer ids, NSIDs and valid page sizes', () => {
    expect(r.collection('app.bsky.feed.post')?.kinds).toEqual(['post', 'reply']);
    expect(new Set(r.data.collections.map((c) => c.normalizerId)).size).toBe(10);
    expect(new Set(r.data.collections.map((c) => c.nsid)).size).toBe(10);
    for (const c of r.data.collections) {
      expect(c.pageSize).toBeGreaterThanOrEqual(1);
      expect(c.pageSize).toBeLessThanOrEqual(100);
    }
  });

  it('app capabilities: bluesky has every metric; standard-site has no engagement.* and lists them as unavailable', () => {
    const bsky = r.app('bluesky').capability;
    const std = r.app('standard-site').capability;
    expect(bsky.metrics).toEqual([...METRIC_IDS]);
    expect(bsky.engagementCounts).toBe(true);
    expect(std.engagementCounts).toBe(false);
    expect(std.metrics.some((m) => m.startsWith('engagement.'))).toBe(false);
    const eng = METRIC_IDS.filter((m) => m.startsWith('engagement.'));
    for (const id of eng) {
      const u = std.unavailable.find((x) => x.metricId === id);
      expect(u?.reason.length).toBeGreaterThan(0);
    }
    expect(std.unavailable.map((u) => u.metricId)).toEqual(expect.arrayContaining(['impressions', 'reach']));
    expect(bsky.unavailable.map((u) => u.metricId)).toEqual(['impressions', 'reach', 'follower-growth', 'unfollows', 'who-blocks-me', 'bookmarks']);
    for (const u of [...bsky.unavailable, ...std.unavailable]) expect(u.reason.length).toBeGreaterThan(0);
  });

  it('every metric id is known; apps list their collections in order', () => {
    const known = new Set<string>([...METRIC_IDS, ...UNAVAILABLE_METRIC_IDS]);
    for (const a of r.data.apps) {
      for (const m of a.capability.metrics) expect(known.has(m)).toBe(true);
      for (const u of a.capability.unavailable) expect(known.has(u.metricId)).toBe(true);
      expect(a.capability.appId).toBe(a.id);
      expect(a.collections).toEqual(r.data.collections.filter((c) => c.appId === a.id).map((c) => c.nsid));
    }
  });

  it('I-12: no network-index or who-blocks-me capability anywhere', () => {
    const json = JSON.stringify(r.data).toLowerCase();
    expect(json).not.toContain('clearsky');
    expect(json).not.toContain('constellation');
    for (const a of r.data.apps) expect(a.capability.metrics as readonly string[]).not.toContain('who-blocks-me');
  });

  it('kindLabels follow the glossary aliases', () => {
    expect(r.app('bluesky').kindLabels).toMatchObject({ post: 'Post', like: 'Like given', 'list-item': 'List membership you created' });
    expect(r.app('standard-site').kindLabels).toEqual({ document: 'Document', publication: 'Publication' });
  });

  it('nonRepoData has the three rows and none is public-repo', () => {
    expect(r.data.nonRepoData.map((n) => n.visibility)).toEqual(['private-app', 'private-service', 'future-permissioned']);
    expect(r.data.nonRepoData.every((n) => (n.visibility as string) !== 'public-repo')).toBe(true);
  });

  it('data is deeply frozen and JSON / structuredClone round-trips unchanged', () => {
    expect(() => {
      (r.data.collections[0] as { label: string }).label = 'x';
    }).toThrow(TypeError);
    expect(() => {
      (r.app('bluesky').capability.metrics as string[]).push('x');
    }).toThrow(TypeError);
    expect(() => {
      (r.data.apps[1]?.capability.unavailable[0] as { reason: string }).reason = 'x';
    }).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(r.data))).toEqual(r.data);
    expect(structuredClone(r.data)).toEqual(r.data);
  });

  it('two createRegistry() calls return equal data', () => {
    expect(createRegistry().data).toEqual(r.data);
  });
});

describe('registry lookups', () => {
  const r = createRegistry();

  it('collection(): exact match, else null', () => {
    expect(r.collection('app.bsky.feed.post')?.normalizerId).toBe('bsky.post');
    expect(r.collection('app.bsky.graph.listblock')).toBeNull();
    expect(r.collection('APP.BSKY.FEED.POST')).toBeNull();
    expect(r.collection('')).toBeNull();
    expect(r.collection('__proto__')).toBeNull();
    expect(r.collection('constructor')).toBeNull();
  });

  it('analysedCollections() is data.collections', () => {
    expect(r.analysedCollections()).toBe(r.data.collections);
  });

  it('inventory([]) → all absent', () => {
    const inv = r.inventory([]);
    expect(inv.present).toEqual([]);
    expect(inv.absent).toEqual(NSIDS);
    expect(inv.presentNotAnalysed).toEqual([]);
  });

  it('inventory splits present / absent / presentNotAnalysed', () => {
    const inv = r.inventory(['site.standard.document', 'chat.bsky.actor.declaration', 'app.bsky.feed.post', 'app.bsky.graph.listblock']);
    expect(inv.present).toEqual(['app.bsky.feed.post', 'site.standard.document']);
    expect(inv.presentNotAnalysed).toEqual(['app.bsky.graph.listblock', 'chat.bsky.actor.declaration']);
    expect(inv.absent).toHaveLength(8);
    expect(inv.absent).toEqual(NSIDS.filter((n) => n !== 'app.bsky.feed.post' && n !== 'site.standard.document'));
  });

  it('inventory ignores duplicates and invalid strings', () => {
    const inv = r.inventory(['app.bsky.feed.like', 'app.bsky.feed.like', 'not an nsid', '', 'a.b.c', 'a.b.c', 'a.b']);
    expect(inv.present).toEqual(['app.bsky.feed.like']);
    expect(inv.presentNotAnalysed).toEqual(['a.b.c']);
    expect(inv.absent).toHaveLength(9);
  });

  it('inventory never throws on junk input', () => {
    expect(() => r.inventory([null, undefined, 5, {}] as unknown as string[])).not.toThrow();
  });
});
