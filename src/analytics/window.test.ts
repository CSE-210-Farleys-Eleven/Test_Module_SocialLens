import { describe, expect, it } from 'vitest';
import type { IsoDateTime } from '../shared/contract';
import { computeAnalytics } from './index';
import { makeInput, N, rec } from './testkit';
import { addDays, isInRange, resolveWindow } from './window';

const t = (s: string) => s as IsoDateTime;

describe('window', () => {
  it('7d starts 6 days before date(N) at midnight UTC', () => {
    const w = resolveWindow('7d', N);
    expect(w).toEqual({
      range: '7d',
      timezone: 'UTC',
      start: '2026-11-04T00:00:00.000Z',
      end: N,
      startDate: '2026-11-04',
      endDate: '2026-11-10',
      days: 7,
    });
  });

  it('30d and 90d starts', () => {
    expect(resolveWindow('30d', N).start).toBe('2026-10-12T00:00:00.000Z');
    expect(resolveWindow('90d', N).days).toBe(90);
    expect(resolveWindow('90d', N).startDate).toBe('2026-08-13');
  });

  it('all has null start, startDate and days', () => {
    const w = resolveWindow('all', N);
    expect(w.start).toBeNull();
    expect(w.startDate).toBeNull();
    expect(w.days).toBeNull();
    expect(w.endDate).toBe('2026-11-10');
  });

  it('addDays crosses month and year boundaries in UTC', () => {
    expect(addDays('2026-03-01' as never, -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31' as never, 1)).toBe('2027-01-01');
  });

  it('boundaries: exactly start and exactly N are in, 1 ms before start is out', () => {
    const w = resolveWindow('7d', N);
    expect(isInRange(t('2026-11-04T00:00:00.000Z'), w)).toBe(true);
    expect(isInRange(N, w)).toBe(true);
    expect(isInRange(t('2026-11-03T23:59:59.999Z'), w)).toBe(false);
    expect(isInRange(t('2026-11-11T00:00:00.000Z'), w)).toBe(false);
  });

  it('undated and future-dated: out of bounded ranges, in all, counted on the report', () => {
    const records = [
      rec('post', { createdAt: null }),
      rec('like', { createdAt: '2026-11-11T00:00:00.000Z' }),
      rec('post', { createdAt: '2026-11-09T00:00:00.000Z' }),
    ];
    const w7 = resolveWindow('7d', N);
    expect(isInRange(null, w7)).toBe(false);
    expect(isInRange(null, resolveWindow('all', N))).toBe(true);
    expect(isInRange(t('2027-01-01T00:00:00.000Z'), resolveWindow('all', N))).toBe(true);

    const r7 = computeAnalytics(makeInput({ records }, '7d'));
    expect(r7.overview.recordsTotal.value).toBe(1);
    expect(r7.undated).toBe(1);
    expect(r7.futureDated).toBe(1);
    const rAll = computeAnalytics(makeInput({ records }, 'all'));
    expect(rAll.overview.recordsTotal.value).toBe(3);
    expect(rAll.undated).toBe(1);
    expect(rAll.futureDated).toBe(1);
  });
});
