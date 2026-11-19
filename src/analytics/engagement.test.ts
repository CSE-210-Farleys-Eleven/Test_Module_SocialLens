import { describe, expect, it } from 'vitest';
import type { EngagementSummary } from './contract';
import { computeAnalytics } from './index';
import { known, makeInput, makeRegistry, NSID, rec, STANDARD_SITE_ENGAGEMENT_REASON, unknownEng } from './testkit';

const OLD = '2026-11-05T12:00:00.000Z'; // well past settling
const totals = (e: EngagementSummary) => [e.likes, e.reposts, e.replies, e.quotes, e.interactions];
const all = (e: EngagementSummary) => [...totals(e), e.interactionsPerPost, e.knownShare];

describe('engagement summary', () => {
  it('2 known posts → interactions 10, per post 5 (10 / 2), exact', () => {
    const r = computeAnalytics(
      makeInput({ records: [rec('post', { createdAt: OLD, engagement: known(3, 1, 0, 0) }), rec('reply', { createdAt: OLD, engagement: known(5, 0, 1, 0) })] }),
    );
    const e = r.engagement;
    expect(e).toMatchObject({ eligiblePosts: 2, knownPosts: 2, unknownPosts: 0, settlingPosts: 0 });
    expect(e.likes).toMatchObject({ metricId: 'engagement.likes', value: 8, status: 'exact' });
    expect(e.reposts).toMatchObject({ metricId: 'engagement.reposts', value: 1 });
    expect(e.replies).toMatchObject({ metricId: 'engagement.replies', value: 1 });
    expect(e.quotes).toMatchObject({ metricId: 'engagement.quotes', value: 0, status: 'exact' });
    expect(e.interactions).toMatchObject({ metricId: 'engagement.interactions', value: 10, status: 'exact' });
    expect(e.interactionsPerPost).toMatchObject({
      metricId: 'engagement.interactionsPerPost',
      value: 5,
      numerator: 10,
      denominator: 2,
      status: 'exact',
      contributingApps: ['bluesky'],
    });
    expect(e.knownShare).toMatchObject({ metricId: 'engagement.knownShare', value: 1, numerator: 2, denominator: 2 });
  });

  it('pooled, not a mean of ratios', () => {
    // Nov 5: two posts with 0 interactions → that day's ratio 0/2 = 0.
    // Nov 6: one post with 9 interactions → that day's ratio 9/1 = 9.
    // Mean of the per-day ratios = (0 + 9) / 2 = 4.5. Pooled = (0 + 0 + 9) / 3 = 3.
    const r = computeAnalytics(
      makeInput({
        records: [
          rec('post', { createdAt: '2026-11-05T10:00:00.000Z', engagement: known(0, 0, 0, 0) }),
          rec('post', { createdAt: '2026-11-05T11:00:00.000Z', engagement: known(0, 0, 0, 0) }),
          rec('post', { createdAt: '2026-11-06T10:00:00.000Z', engagement: known(6, 2, 1, 0) }),
        ],
      }),
    );
    expect(r.engagement.interactionsPerPost).toMatchObject({ value: 3, numerator: 9, denominator: 3 });
  });

  it('2 known + 1 unknown → totals partial lower bound; ratio known-only, partial, not a lower bound; knownShare 2/3', () => {
    const r = computeAnalytics(
      makeInput({
        records: [
          rec('post', { createdAt: OLD, engagement: known(3, 1, 0, 0) }),
          rec('post', { createdAt: OLD, engagement: known(5, 0, 1, 0) }),
          rec('post', { createdAt: OLD, engagement: unknownEng() }),
        ],
      }),
    );
    const e = r.engagement;
    expect(e).toMatchObject({ eligiblePosts: 3, knownPosts: 2, unknownPosts: 1 });
    for (const v of totals(e)) expect(v).toMatchObject({ status: 'partial', isLowerBound: true });
    expect(e.interactions.value).toBe(10);
    expect(e.interactionsPerPost).toMatchObject({ value: 5, status: 'partial', isLowerBound: false });
    expect(e.knownShare).toMatchObject({ value: 2 / 3, numerator: 2, denominator: 3, isLowerBound: false });
  });

  it('eligible 3, known 0 → every engagement value unknown and null (never 0)', () => {
    const recs = [1, 2, 3].map(() => rec('post', { createdAt: OLD, engagement: unknownEng() }));
    const e = computeAnalytics(makeInput({ records: recs })).engagement;
    for (const v of all(e)) expect(v).toMatchObject({ value: null, status: 'unknown', isLowerBound: false });
  });

  it('eligible 0, complete coverage → totals exact 0, ratio and share unknown', () => {
    const e = computeAnalytics(makeInput({ records: [] })).engagement;
    for (const v of totals(e)) expect(v).toMatchObject({ value: 0, status: 'exact' });
    expect(e.interactionsPerPost).toMatchObject({ value: null, status: 'unknown', reason: 'No posts with known counters in this range.' });
    expect(e.knownShare).toMatchObject({ value: null, status: 'unknown' });
  });

  it('a known all-zero post contributes 0 and still counts in the denominator', () => {
    const e = computeAnalytics(
      makeInput({ records: [rec('post', { createdAt: OLD, engagement: known(4, 0, 0, 0) }), rec('post', { createdAt: OLD, engagement: known(0, 0, 0, 0) })] }),
    ).engagement;
    expect(e.interactionsPerPost).toMatchObject({ value: 2, numerator: 4, denominator: 2, status: 'exact' });
  });

  it('settling: 10 h old → settling; exactly 36 h → not', () => {
    const young = computeAnalytics(makeInput({ records: [rec('post', { createdAt: '2026-11-10T13:59:59.000Z', engagement: known(1, 0, 0, 0) })] })).engagement;
    expect(young.settlingPosts).toBe(1);
    for (const v of all(young)) expect(v.status).toBe('settling');
    expect(young.interactions).toMatchObject({ value: 1, isLowerBound: false });
    const edge = computeAnalytics(makeInput({ records: [rec('post', { createdAt: '2026-11-09T11:59:59.000Z', engagement: known(1, 0, 0, 0) })] })).engagement;
    expect(edge.settlingPosts).toBe(0);
    expect(edge.interactions.status).toBe('exact');
  });

  it('partial coverage plus a settling post → partial wins', () => {
    const e = computeAnalytics(
      makeInput({ records: [rec('post', { createdAt: '2026-11-10T20:00:00.000Z', engagement: known(1, 0, 0, 0) })], coverage: { [NSID.post]: 'partial' } }),
    ).engagement;
    expect(e.settlingPosts).toBe(1);
    expect(e.interactions).toMatchObject({ status: 'partial', isLowerBound: true });
  });

  it('post collection unavailable → unknown', () => {
    const e = computeAnalytics(makeInput({ records: [], coverage: { [NSID.post]: 'unavailable' } })).engagement;
    for (const v of all(e)) expect(v).toMatchObject({ value: null, status: 'unknown' });
  });

  it('documents are never eligible; registry without a count source → not-available', () => {
    const docs = computeAnalytics(makeInput({ records: [rec('document', { createdAt: OLD })] })).engagement;
    expect(docs.eligiblePosts).toBe(0);
    const registry = makeRegistry({ engagement: false });
    const e = computeAnalytics(
      makeInput({ registry, records: [rec('post', { createdAt: OLD, engagement: { status: 'not-available' } })] }),
    ).engagement;
    expect(e.eligiblePosts).toBe(0);
    for (const v of all(e)) expect(v).toMatchObject({ value: null, status: 'not-available', contributingApps: [] });
  });

  it('perApp: bluesky available, standard-site unavailable with a reason', () => {
    const e = computeAnalytics(makeInput()).engagement;
    expect(e.perApp).toEqual([
      { appId: 'bluesky', available: true, reason: null },
      { appId: 'standard-site', available: false, reason: STANDARD_SITE_ENGAGEMENT_REASON },
    ]);
  });

  it('range filter: a known post outside 7d is in all but not in 7d', () => {
    const recs = [
      rec('post', { createdAt: '2026-10-01T00:00:00.000Z', engagement: known(7, 0, 0, 0) }),
      rec('post', { createdAt: OLD, engagement: known(1, 0, 0, 0) }),
    ];
    expect(computeAnalytics(makeInput({ records: recs }, '7d')).engagement.interactions.value).toBe(1);
    expect(computeAnalytics(makeInput({ records: recs }, 'all')).engagement.interactions.value).toBe(8);
  });
});

describe('top posts', () => {
  const u = (k: string) => `at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/${k}`;
  const recs = [
    rec('post', { uri: u('a'), createdAt: '2026-11-05T00:00:00.000Z', engagement: known(1, 0, 0, 0) }),
    rec('post', { uri: u('b'), createdAt: '2026-11-06T00:00:00.000Z', engagement: known(10, 0, 0, 0) }),
    rec('post', { uri: u('c'), createdAt: '2026-11-07T00:00:00.000Z', engagement: known(3, 0, 0, 0) }),
    rec('post', { uri: u('d'), createdAt: '2026-11-04T00:00:00.000Z', engagement: known(3, 0, 0, 0) }),
    rec('post', { uri: u('f'), createdAt: '2026-11-04T00:00:00.000Z', engagement: known(3, 0, 0, 0) }),
    rec('post', { uri: u('e'), createdAt: '2026-11-04T00:00:00.000Z', engagement: known(3, 0, 0, 0) }),
    rec('post', { uri: u('z'), createdAt: '2026-11-08T00:00:00.000Z', engagement: unknownEng() }),
    rec('reply', { uri: u('g'), createdAt: '2026-11-10T20:00:00.000Z', engagement: known(0, 0, 0, 0), text: 'x'.repeat(400) }),
  ];

  it('ordered by interactions, then newer, then URI; limited; unknown excluded; rank from 1', () => {
    const top = computeAnalytics(makeInput({ records: recs }, 'all', { topPosts: 5 })).topPosts;
    expect(top.map((p) => p.uri)).toEqual([u('b'), u('c'), u('d'), u('e'), u('f')]);
    expect(top.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(top[0]).toMatchObject({ kind: 'post', interactions: 10, counts: { likes: 10, reposts: 0, replies: 0, quotes: 0 }, settling: false });
  });

  it('textPreview truncated; settling flagged; null text stays null', () => {
    const top = computeAnalytics(makeInput({ records: recs }, 'all', { topPosts: 10, textPreviewChars: 20 })).topPosts;
    expect(top).toHaveLength(7);
    const g = top.find((p) => p.uri === u('g'))!;
    expect(g.textPreview).toBe('x'.repeat(20));
    expect(g.settling).toBe(true);
    expect(top[0]!.textPreview).toBeNull();
  });

  it('undated known posts sort last among equal interactions', () => {
    const r = computeAnalytics(
      makeInput({
        records: [
          rec('post', { uri: u('a'), createdAt: null, engagement: known(1, 0, 0, 0) }),
          rec('post', { uri: u('b'), createdAt: OLD, engagement: known(1, 0, 0, 0) }),
        ],
      }),
    );
    expect(r.topPosts.map((p) => p.uri)).toEqual([u('b'), u('a')]);
  });
});
