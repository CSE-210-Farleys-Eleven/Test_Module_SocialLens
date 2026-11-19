import { describe, expect, it } from 'vitest';
import { RECORD_KINDS } from '../shared/contract';
import type { AnalyticsReport } from './contract';
import { computeAnalytics } from './index';
import { makeInput, NSID, rec, skip } from './testkit';

const row = (r: AnalyticsReport, kind: string) => r.byKind.find((k) => k.kind === kind)!.count;
const day = (d: string, hm = '12:00') => `2026-11-${d}T${hm}:00.000Z`;

describe('totals and status', () => {
  const base = [
    rec('post', { createdAt: day('08') }),
    rec('post', { createdAt: day('09') }),
    rec('post', { createdAt: day('10') }),
    rec('reply', { createdAt: day('10') }),
    rec('like', { createdAt: day('10') }),
    rec('like', { createdAt: day('09') }),
  ];

  it('complete coverage: exact counts, zero rows exact 0', () => {
    const r = computeAnalytics(makeInput({ records: base }, '7d'));
    expect(row(r, 'post')).toMatchObject({ metricId: 'records.byKind', value: 3, status: 'exact', reason: null });
    expect(row(r, 'reply')).toMatchObject({ value: 1, status: 'exact' });
    expect(row(r, 'like')).toMatchObject({ value: 2, status: 'exact' });
    for (const k of ['repost', 'follow', 'block', 'list', 'list-item', 'profile', 'document', 'publication']) {
      expect(row(r, k)).toMatchObject({ value: 0, status: 'exact', isLowerBound: false });
    }
  });

  it('byKind has 11 rows in RECORD_KINDS order with the registry app', () => {
    const r = computeAnalytics(makeInput({ records: base }));
    expect(r.byKind.map((k) => k.kind)).toEqual([...RECORD_KINDS]);
    expect(r.byKind.find((k) => k.kind === 'document')!.appId).toBe('standard-site');
    expect(r.byKind.find((k) => k.kind === 'like')!.appId).toBe('bluesky');
  });

  it('like coverage partial → like partial lower bound with reason; post still exact', () => {
    const r = computeAnalytics(makeInput({ records: base, coverage: { [NSID.like]: 'partial' } }));
    expect(row(r, 'like')).toMatchObject({ value: 2, status: 'partial', isLowerBound: true });
    expect(row(r, 'like').reason).toBeTruthy();
    expect(row(r, 'post')).toMatchObject({ value: 3, status: 'exact' });
  });

  it('block coverage unavailable → null, unknown', () => {
    const r = computeAnalytics(makeInput({ records: base, coverage: { [NSID.block]: 'unavailable' } }));
    expect(row(r, 'block')).toMatchObject({ value: null, status: 'unknown', isLowerBound: false });
  });

  it('skipped record in the post collection → post and reply partial', () => {
    const r = computeAnalytics(makeInput({ records: base, skipped: [skip(NSID.post)] }));
    expect(row(r, 'post').status).toBe('partial');
    expect(row(r, 'reply').status).toBe('partial');
    expect(row(r, 'like').status).toBe('exact');
  });

  it('missing coverage row → treated as unavailable', () => {
    const r = computeAnalytics(makeInput({ records: base, coverage: { [NSID.follow]: null } }));
    expect(row(r, 'follow')).toMatchObject({ value: null, status: 'unknown' });
  });

  it('content.items = posts + replies + documents; documents unavailable → partial; both → unknown', () => {
    const recs = [...base, rec('document', { createdAt: day('09') })];
    const ok = computeAnalytics(makeInput({ records: recs }));
    expect(ok.overview.contentItems).toMatchObject({ metricId: 'content.items', value: 5, status: 'exact' });
    const p = computeAnalytics(makeInput({ records: base, coverage: { [NSID.document]: 'unavailable' } }));
    expect(p.overview.contentItems).toMatchObject({ value: 4, status: 'partial', isLowerBound: true });
    const u = computeAnalytics(
      makeInput({ records: [], coverage: { [NSID.document]: 'unavailable', [NSID.post]: 'unavailable' } }),
    );
    expect(u.overview.contentItems).toMatchObject({ value: null, status: 'unknown' });
  });

  it('records.total with one unavailable collection → partial sum of the rest', () => {
    const r = computeAnalytics(makeInput({ records: base, coverage: { [NSID.block]: 'unavailable' } }));
    expect(r.overview.recordsTotal).toMatchObject({ metricId: 'records.total', value: 6, status: 'partial', isLowerBound: true });
  });

  it('empty snapshot with complete coverage → every count exact 0', () => {
    const r = computeAnalytics(makeInput({ records: [] }));
    for (const k of r.byKind) expect(k.count).toMatchObject({ value: 0, status: 'exact' });
    for (const a of r.byApp) {
      expect(a.records).toMatchObject({ value: 0, status: 'exact' });
      expect(a.contentItems).toMatchObject({ value: 0, status: 'exact' });
    }
    expect(r.overview.recordsTotal).toMatchObject({ value: 0, status: 'exact' });
    expect(r.overview.contentItems).toMatchObject({ value: 0, status: 'exact' });
    expect(r.overview.activeDays).toMatchObject({ value: 0, status: 'exact' });
    expect(r.overview.lastContentAt).toBeNull();
  });

  it('activeDays counts distinct UTC dates', () => {
    const same = computeAnalytics(makeInput({ records: [rec('post', { createdAt: day('09', '01:00') }), rec('reply', { createdAt: day('09', '22:00') })] }));
    expect(same.overview.activeDays).toMatchObject({ metricId: 'activity.activeDays', value: 1, status: 'exact' });
    const two = computeAnalytics(
      makeInput({ records: [rec('post', { createdAt: day('08', '23:59') }), rec('post', { createdAt: day('09', '00:01') })] }),
    );
    expect(two.overview.activeDays.value).toBe(2);
    const likesOnly = computeAnalytics(makeInput({ records: [rec('like', { createdAt: day('09') })] }));
    expect(likesOnly.overview.activeDays.value).toBe(0);
  });

  it('byApp: one row per app; standard-site content = documents only', () => {
    const recs = [...base, rec('document', { createdAt: day('09') }), rec('publication', { createdAt: null })];
    const r = computeAnalytics(makeInput({ records: recs }));
    expect(r.byApp.map((a) => a.appId)).toEqual(['bluesky', 'standard-site']);
    const bs = r.byApp[0]!;
    const ss = r.byApp[1]!;
    expect(bs.records).toMatchObject({ metricId: 'records.byApp', value: 6, status: 'exact', contributingApps: ['bluesky'] });
    expect(bs.contentItems).toMatchObject({ metricId: 'content.items', value: 4 });
    expect(ss.records.value).toBe(2);
    expect(ss.contentItems).toMatchObject({ value: 1, contributingApps: ['standard-site'] });
  });

  it('overview: includedApps lists both apps; lastContentAt ignores likes and future posts', () => {
    const recs = [
      rec('post', { createdAt: day('08') }),
      rec('like', { createdAt: day('10', '20:00') }),
      rec('post', { createdAt: '2026-11-12T00:00:00.000Z' }),
      rec('document', { createdAt: day('09') }),
    ];
    const r = computeAnalytics(makeInput({ records: recs }, '7d'));
    expect(r.overview.includedApps).toEqual(['bluesky', 'standard-site']);
    expect(r.overview.lastContentAt).toBe(day('09'));
    expect(Object.keys(r.overview).sort()).toEqual(
      ['activeDays', 'contentItems', 'includedApps', 'lastContentAt', 'recordsTotal'],
    );
  });
});
