import { describe, expect, it } from 'vitest';
import { computeAnalytics } from './index';
import { makeInput, NSID, rec } from './testkit';

const p = (createdAt: string | null) => rec('post', { createdAt });

describe('histograms', () => {
  it('hour histogram: 24 zero-filled bins, 18:30Z → bin 18', () => {
    const h = computeAnalytics(makeInput({ records: [p('2026-11-09T18:30:00.000Z')] })).hourHistogram;
    expect(h.metricId).toBe('activity.hourHistogram');
    expect(h.timezone).toBe('UTC');
    expect(h.bins).toHaveLength(24);
    expect(h.bins.map((b) => b.index)).toEqual([...Array(24).keys()]);
    expect(h.bins[0]!.label).toBe('00');
    expect(h.bins[23]!.label).toBe('23');
    expect(h.bins[18]!.count).toBe(1);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(1);
    expect(h.total).toBe(1);
    expect(h.status).toBe('exact');
  });

  it('weekday histogram: Monday 2026-11-09 → 0, Sunday 2026-11-08 → 6', () => {
    const w = computeAnalytics(makeInput({ records: [p('2026-11-09T00:00:00.000Z'), p('2026-11-08T23:59:59.999Z')] })).weekdayHistogram;
    expect(w.metricId).toBe('activity.weekdayHistogram');
    expect(w.bins.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(w.bins[0]!.count).toBe(1);
    expect(w.bins[6]!.count).toBe(1);
  });

  it('only dated content items count (likes, undated, future ignored); range applies', () => {
    const recs = [
      p('2026-11-09T05:00:00.000Z'),
      rec('document', { createdAt: '2026-11-09T05:30:00.000Z' }),
      rec('like', { createdAt: '2026-11-09T05:00:00.000Z' }),
      p(null),
      p('2026-11-12T05:00:00.000Z'),
      p('2026-10-01T05:00:00.000Z'),
    ];
    expect(computeAnalytics(makeInput({ records: recs }, 'all')).hourHistogram.total).toBe(3);
    const h7 = computeAnalytics(makeInput({ records: recs }, '7d')).hourHistogram;
    expect(h7.total).toBe(2);
    expect(h7.bins[5]!.count).toBe(2);
  });

  it('status follows content coverage', () => {
    const r = computeAnalytics(makeInput({ records: [], coverage: { [NSID.document]: 'partial' } }));
    expect(r.hourHistogram.status).toBe('partial');
    const u = computeAnalytics(makeInput({ records: [], coverage: { [NSID.document]: 'unavailable', [NSID.post]: 'unavailable' } }));
    expect(u.weekdayHistogram.status).toBe('unknown');
  });
});

describe('timeline', () => {
  it('7d: exactly 7 consecutive zero-filled days ending 2026-11-10, both app keys', () => {
    const t = computeAnalytics(makeInput({ records: [p('2026-11-09T10:00:00.000Z')] }, '7d')).timeline;
    expect(t.metricId).toBe('activity.dailyTimeline');
    expect(t.days.map((d) => d.date)).toEqual([
      '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10',
    ]);
    expect(t.days[0]).toEqual({ date: '2026-11-04', content: { bluesky: 0, 'standard-site': 0 }, outbound: 0 });
    expect(t.days[5]!.content).toEqual({ bluesky: 1, 'standard-site': 0 });
    expect(t.truncated).toBe(false);
    expect(t.status).toBe('exact');
  });

  it('outbound counts likes/reposts/follows/blocks/list-items by their own createdAt; lists and profiles ignored', () => {
    const d = '2026-11-10T01:00:00.000Z';
    const recs = [
      rec('like', { createdAt: d }),
      rec('repost', { createdAt: d }),
      rec('follow', { createdAt: d }),
      rec('block', { createdAt: d }),
      rec('list-item', { createdAt: d }),
      rec('list', { createdAt: d }),
      rec('profile', { createdAt: d }),
      rec('document', { createdAt: d }),
    ];
    const t = computeAnalytics(makeInput({ records: recs }, '7d')).timeline;
    expect(t.days[6]).toEqual({ date: '2026-11-10', content: { bluesky: 0, 'standard-site': 1 }, outbound: 5 });
  });

  it('all: starts at earliest dated record; truncated to latest days; none → []', () => {
    const recs = [rec('like', { createdAt: '2026-11-01T00:00:00.000Z' }), p('2026-11-05T00:00:00.000Z'), p(null)];
    const t = computeAnalytics(makeInput({ records: recs }, 'all')).timeline;
    expect(t.days[0]!.date).toBe('2026-11-01');
    expect(t.days).toHaveLength(10);
    expect(t.days[0]!.outbound).toBe(1);
    const cut = computeAnalytics(makeInput({ records: recs }, 'all', { timelineMaxDays: 4 })).timeline;
    expect(cut.truncated).toBe(true);
    expect(cut.days.map((d) => d.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    const none = computeAnalytics(makeInput({ records: [p(null)] }, 'all')).timeline;
    expect(none.days).toEqual([]);
    expect(none.truncated).toBe(false);
  });
});

describe('streak', () => {
  const streakOf = (dates: string[], range: '7d' | 'all' = 'all', coverage = {}) =>
    computeAnalytics(makeInput({ records: dates.map((d) => p(`${d}T12:00:00.000Z`)), coverage }, range)).streak;

  it('posts on Nov 8, 9, 10 → current 3', () => {
    const s = streakOf(['2026-11-08', '2026-11-09', '2026-11-10']);
    expect(s.current).toMatchObject({ metricId: 'activity.streak.current', value: 3, status: 'exact' });
    expect(s.currentStart).toBe('2026-11-08');
    expect(s.currentEnd).toBe('2026-11-10');
  });

  it('nothing today: run ending yesterday counts; older run → 0 with null dates', () => {
    const s = streakOf(['2026-11-08', '2026-11-09']);
    expect(s.current.value).toBe(2);
    expect(s.currentEnd).toBe('2026-11-09');
    const z = streakOf(['2026-11-08']);
    expect(z.current).toMatchObject({ value: 0, status: 'exact' });
    expect(z.currentStart).toBeNull();
    expect(z.currentEnd).toBeNull();
  });

  it('longest picks the longest run; ties → most recent; empty → 0', () => {
    const s = streakOf(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-11-10']);
    expect(s.longest).toMatchObject({ metricId: 'activity.streak.longest', value: 3 });
    expect([s.longestStart, s.longestEnd]).toEqual(['2026-10-01', '2026-10-03']);
    const tie = streakOf(['2026-10-01', '2026-10-02', '2026-10-20', '2026-10-21']);
    expect([tie.longestStart, tie.longestEnd]).toEqual(['2026-10-20', '2026-10-21']);
    const e = streakOf([]);
    expect(e.longest.value).toBe(0);
    expect(e.longestStart).toBeNull();
  });

  it('ignores the selected range', () => {
    const d = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-09', '2026-11-10'];
    expect(streakOf(d, '7d')).toEqual(streakOf(d, 'all'));
  });

  it('partial post coverage → partial, lower bound', () => {
    const s = streakOf(['2026-11-10'], 'all', { [NSID.post]: 'partial' });
    expect(s.current).toMatchObject({ value: 1, status: 'partial', isLowerBound: true });
    expect(s.longest).toMatchObject({ status: 'partial', isLowerBound: true });
  });
});

describe('week over week', () => {
  it('5 vs 2 → delta 3, fraction 1.5', () => {
    const recs = [
      ...['04', '05', '07', '10', '10'].map((d) => p(`2026-11-${d}T08:00:00.000Z`)),
      p('2026-10-28T00:00:00.000Z'),
      p('2026-11-03T23:59:59.999Z'),
      p('2026-10-27T23:59:59.999Z'),
    ];
    const w = computeAnalytics(makeInput({ records: recs }, '90d')).weekOverWeek;
    expect(w.current).toMatchObject({ startDate: '2026-11-04', endDate: '2026-11-10' });
    expect(w.previous).toMatchObject({ startDate: '2026-10-28', endDate: '2026-11-03' });
    expect(w.current.contentItems).toMatchObject({ metricId: 'activity.weekOverWeek', value: 5, status: 'exact' });
    expect(w.previous.contentItems.value).toBe(2);
    expect(w.delta).toBe(3);
    expect(w.deltaFraction).toBe(1.5);
  });

  it('previous 0 → fraction null', () => {
    const w = computeAnalytics(makeInput({ records: [p('2026-11-10T00:00:00.000Z')] })).weekOverWeek;
    expect(w.delta).toBe(1);
    expect(w.deltaFraction).toBeNull();
  });

  it('unknown side → delta null', () => {
    const w = computeAnalytics(makeInput({ records: [], coverage: { [NSID.post]: 'unavailable', [NSID.document]: 'unavailable' } })).weekOverWeek;
    expect(w.current.contentItems).toMatchObject({ value: null, status: 'unknown' });
    expect(w.delta).toBeNull();
    expect(w.deltaFraction).toBeNull();
  });
});
