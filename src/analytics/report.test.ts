import { describe, expect, it } from 'vitest';
import type { ActivityRecord, RecordKind } from '../shared/contract';
import { computeAnalytics } from './index';
import { known, makeInput, NSID, rec, skip, unknownEng } from './testkit';

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function walk(v: unknown, path: string, bad: string[]): void {
  if (v === undefined) bad.push(`${path}: undefined`);
  else if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${path}: ${v}`);
  else if (typeof v === 'function') bad.push(`${path}: function`);
  else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) bad.push(`${path}[${i}]: hole`);
      walk(v[i], `${path}[${i}]`, bad);
    }
  } else if (v !== null && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) bad.push(`${path}: non-plain object`);
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, bad);
  }
}

const KINDS: RecordKind[] = ['post', 'reply', 'like', 'repost', 'follow', 'document', 'block', 'list-item'];
function synthetic(n: number): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  const base = Date.UTC(2025, 10, 10);
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length]!;
    const createdAt = i % 97 === 0 ? null : new Date(base + ((i * 7_919_000) % (366 * 86_400_000))).toISOString();
    const engagement = kind === 'post' || kind === 'reply' ? (i % 5 === 0 ? unknownEng() : known(i % 7, i % 3, i % 2, 0)) : undefined;
    out.push(rec(kind, engagement ? { createdAt, engagement, text: `post ${i}` } : { createdAt }));
  }
  return out;
}

const busy = () =>
  makeInput(
    {
      records: [
        rec('post', { createdAt: '2026-11-10T13:00:00.000Z', engagement: known(1, 2, 3, 4), text: 'hi' }),
        rec('reply', { createdAt: '2026-11-01T13:00:00.000Z', engagement: unknownEng() }),
        rec('like', { createdAt: '2026-11-02T13:00:00.000Z' }),
        rec('document', { createdAt: null }),
        rec('post', { createdAt: '2027-01-01T00:00:00.000Z', engagement: known(0, 0, 0, 0) }),
      ],
      coverage: { [NSID.block]: 'unavailable', [NSID.like]: 'partial' },
    },
    '30d',
  );

describe('report-level', () => {
  it('coverageComplete: true only when all complete and nothing skipped', () => {
    expect(computeAnalytics(makeInput()).coverageComplete).toBe(true);
    expect(computeAnalytics(makeInput({ coverage: { [NSID.like]: 'partial' } })).coverageComplete).toBe(false);
    expect(computeAnalytics(makeInput({ skipped: [skip(NSID.post)] })).coverageComplete).toBe(false);
    expect(computeAnalytics(makeInput({ coverage: { [NSID.like]: null } })).coverageComplete).toBe(false);
  });

  it('copies identity fields and window', () => {
    const input = busy();
    const r = computeAnalytics(input);
    expect(r.schemaVersion).toBe(1);
    expect(r.did).toBe(input.snapshot.account.did);
    expect(r.fetchedAt).toBe(input.snapshot.fetchedAt);
    expect(r.mode).toBe('demo');
    expect(r.window.range).toBe('30d');
  });

  it('no NaN, Infinity, undefined, holes or non-plain objects anywhere (incl. empty and degenerate inputs)', () => {
    for (const input of [busy(), makeInput(), makeInput({}, '7d', { topPosts: 0, timelineMaxDays: 0, textPreviewChars: 0 })]) {
      const bad: string[] = [];
      walk(computeAnalytics(input), 'report', bad);
      expect(bad).toEqual([]);
    }
  });

  it('value === null iff unknown / not-available; isLowerBound only with partial', () => {
    const r = computeAnalytics(busy());
    const values: { value: number | null; status: string; isLowerBound: boolean }[] = [];
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') {
        if ('metricId' in v && 'status' in v && 'value' in v && 'isLowerBound' in v) values.push(v as never);
        Object.values(v).forEach(collect);
      }
    };
    collect(r);
    expect(values.length).toBeGreaterThan(20);
    for (const m of values) {
      expect(m.value === null).toBe(m.status === 'unknown' || m.status === 'not-available');
      if (m.isLowerBound) expect(m.status).toBe('partial');
    }
  });

  it('no forbidden metric names appear in the report (I-11)', () => {
    const json = JSON.stringify(computeAnalytics(busy())).toLowerCase();
    for (const word of ['impression', 'reach', 'engagement-rate', 'engagementrate', 'follower', 'score']) {
      expect(json).not.toContain(word);
    }
  });

  it('survives structuredClone and JSON round-trip unchanged', () => {
    const r = computeAnalytics(busy());
    expect(structuredClone(r)).toEqual(r);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('deterministic and does not mutate a deep-frozen input', () => {
    const input = deepFreeze(busy());
    const a = computeAnalytics(input);
    const b = computeAnalytics(input);
    expect(a).toEqual(b);
  });

  it('works on an input that went through structuredClone (Worker boundary)', () => {
    const input = busy();
    expect(computeAnalytics(structuredClone(input))).toEqual(computeAnalytics(input));
  });

  it('10,000 synthetic records within the smoke budget', () => {
    const input = makeInput({ records: synthetic(10_000) }, 'all');
    computeAnalytics(input); // warm-up
    const t0 = performance.now();
    const r = computeAnalytics(input);
    const ms = performance.now() - t0;
    console.log(`computeAnalytics(10,000 records): ${ms.toFixed(1)} ms`);
    expect(r.overview.recordsTotal.value).toBe(10_000);
    expect(ms).toBeLessThan(200);
  });
});
