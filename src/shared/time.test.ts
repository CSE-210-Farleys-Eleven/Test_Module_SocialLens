import { describe, expect, it } from 'vitest';
import type { IsoDateTime } from './contract';
import { isoDateOf, parseIsoDateTime, realSleep, systemClock, tidToIsoDateTime } from './time';

const S32 = '234567abcdefghijklmnopqrstuvwxyz';
/** Independent test-side encoder: 11 chars of microseconds + 2 chars of clock id. */
function makeTid(micros: bigint, clockId = 0): string {
  let s = '';
  let v = micros;
  for (let i = 0; i < 11; i++) {
    s = S32[Number(v % 32n)] + s;
    v /= 32n;
  }
  return s + S32[Math.floor(clockId / 32)] + S32[clockId % 32];
}

describe('parseIsoDateTime', () => {
  it('normalises an offset to UTC', () => {
    expect(parseIsoDateTime('2026-11-10T18:00:00+02:00')).toBe('2026-11-10T16:00:00.000Z');
  });
  it('accepts Z, fractions and negative offsets', () => {
    expect(parseIsoDateTime('2026-11-10T16:00:00Z')).toBe('2026-11-10T16:00:00.000Z');
    expect(parseIsoDateTime('2026-11-10T16:00:00.5Z')).toBe('2026-11-10T16:00:00.500Z');
    expect(parseIsoDateTime('2026-11-10T16:00:00.123456789Z')).toBe('2026-11-10T16:00:00.123Z');
    expect(parseIsoDateTime('2026-11-10T11:30:00-04:30')).toBe('2026-11-10T16:00:00.000Z');
    expect(parseIsoDateTime('2024-02-29T00:00:00+00:00')).toBe('2024-02-29T00:00:00.000Z');
  });
  it.each([
    ['missing zone', '2026-11-10T18:00:00'],
    ['Feb 30', '2026-02-30T00:00:00Z'],
    ['Feb 29 non-leap', '2026-02-29T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['month 0', '2026-00-01T00:00:00Z'],
    ['day 0', '2026-01-00T00:00:00Z'],
    ['hour 24', '2026-01-01T24:00:00Z'],
    ['minute 60', '2026-01-01T00:60:00Z'],
    ['second 60', '2026-01-01T00:00:60Z'],
    ['offset hour 24', '2026-01-01T00:00:00+24:00'],
    ['-00:00', '2026-01-01T00:00:00-00:00'],
    ['year before 1970', '1969-12-31T23:59:59Z'],
    ['date only', '2026-01-01'],
    ['space separator', '2026-01-01 00:00:00Z'],
    ['lower-case z', '2026-01-01T00:00:00z'],
    ['offset without colon', '2026-01-01T00:00:00+0200'],
    ['no seconds', '2026-01-01T00:00Z'],
    ['empty fraction', '2026-01-01T00:00:00.Z'],
    ['extended year', '+002026-01-01T00:00:00Z'],
    ['trailing text', '2026-01-01T00:00:00Zx'],
    ['empty', ''],
  ])('rejects %s', (_l, v) => {
    expect(parseIsoDateTime(v)).toBeNull();
  });
  it('rejects non-strings', () => {
    expect(parseIsoDateTime(1731254400000)).toBeNull();
    expect(parseIsoDateTime(new Date())).toBeNull();
    expect(parseIsoDateTime(null)).toBeNull();
  });
  it('accepts year 9999 but not an instant past 9999 after normalisation', () => {
    expect(parseIsoDateTime('9999-12-31T23:59:59Z')).toBe('9999-12-31T23:59:59.000Z');
    expect(parseIsoDateTime('9999-12-31T23:59:59-01:00')).toBeNull();
  });
  it('rejects an instant before the epoch after normalisation', () => {
    expect(parseIsoDateTime('1970-01-01T00:30:00+01:00')).toBeNull();
    expect(parseIsoDateTime('1970-01-01T00:00:00Z')).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('isoDateOf', () => {
  it('returns the first 10 characters', () => {
    expect(isoDateOf('2026-11-10T16:00:00.000Z' as IsoDateTime)).toBe('2026-11-10');
  });
});

describe('tidToIsoDateTime', () => {
  it('decodes a TID generated from a fixed microsecond timestamp', () => {
    const micros = 1_731_254_400_123_456n; // 2024-11-10T16:00:00.123456Z
    const tid = makeTid(micros, 17);
    expect(tid).toHaveLength(13);
    expect(tidToIsoDateTime(tid)).toBe('2024-11-10T16:00:00.123Z');
  });
  it('decodes a real-world-shaped TID', () => {
    // 3jzfcijpj2z2a: a Bluesky post rkey from 2023
    const v = tidToIsoDateTime('3jzfcijpj2z2a');
    expect(v).not.toBeNull();
    expect(v?.startsWith('2023-')).toBe(true);
  });
  it('accepts the inclusive bounds and rejects outside 2005-01-01…2100-01-01', () => {
    const lo = BigInt(Date.UTC(2005, 0, 1)) * 1000n;
    const hi = BigInt(Date.UTC(2100, 0, 1)) * 1000n;
    expect(tidToIsoDateTime(makeTid(lo))).toBe('2005-01-01T00:00:00.000Z');
    expect(tidToIsoDateTime(makeTid(hi))).toBe('2100-01-01T00:00:00.000Z');
    expect(tidToIsoDateTime(makeTid(lo - 1n))).toBeNull();
    expect(tidToIsoDateTime(makeTid(hi + 1000n))).toBeNull();
    expect(tidToIsoDateTime('2222222222222')).toBeNull(); // epoch 0
  });
  it.each([
    ['self', 'self'],
    ['12 chars', '3jzfcijpj2z2'],
    ['14 chars', '3jzfcijpj2z2aa'],
    ['invalid character 1', '3jzfcijpj2z21'],
    ['upper case', '3JZFCIJPJ2Z2A'],
    ['dashes', '3jzf-cij-pj2z-2a'],
    ['empty', ''],
  ])('returns null for %s', (_l, v) => {
    expect(tidToIsoDateTime(v)).toBeNull();
  });
});

describe('systemClock', () => {
  it('now() is a normalised ISO instant and nowMs() is a finite number', () => {
    const now = systemClock.now();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isFinite(systemClock.nowMs())).toBe(true);
  });
});

describe('realSleep', () => {
  it('resolves after the delay', async () => {
    await expect(realSleep(5, new AbortController().signal)).resolves.toBeUndefined();
  });
  it('rejects with the abort reason when aborted mid-wait and does not resolve afterwards', async () => {
    const c = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    let settled: string | null = null;
    const p = realSleep(30, c.signal).then(
      () => {
        settled = 'resolved';
      },
      (e: unknown) => {
        settled = e === reason ? 'rejected-with-reason' : 'rejected-other';
      },
    );
    setTimeout(() => c.abort(reason), 5);
    await p;
    expect(settled).toBe('rejected-with-reason');
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe('rejected-with-reason');
  });
  it('rejects immediately when already aborted', async () => {
    const c = new AbortController();
    c.abort('why');
    await expect(realSleep(10_000, c.signal)).rejects.toBe('why');
  });
});
