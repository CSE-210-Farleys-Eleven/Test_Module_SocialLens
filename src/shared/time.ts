// Adapted from bluesky-social/atproto (MIT), packages/syntax/src/datetime.ts and packages/common-web/src/{tid,util}.ts (s32decode)

import type { Clock, IsoDate, IsoDateTime, Sleep } from './contract';

// YYYY-MM-DDTHH:mm:ss(.fraction)?(Z|±HH:mm) — upper-case T and Z only, zone required.
const DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
}

/** Strict RFC 3339 subset → normalised UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, else null. */
export function parseIsoDateTime(value: unknown): IsoDateTime | null {
  if (typeof value !== 'string') return null;
  const m = DATETIME_REGEX.exec(value);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fraction = m[7] ?? '';
  if (year < 1970 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (m[8] !== 'Z') {
    const sign = m[9] === '-' ? -1 : 1;
    const oh = Number(m[10]);
    const om = Number(m[11]);
    if (oh > 23 || om > 59) return null;
    if (sign === -1 && oh === 0 && om === 0) return null; // "-00:00" (unknown offset) is rejected, as in atproto
    offsetMinutes = sign * (oh * 60 + om);
  }
  const millis = Number(fraction.slice(0, 3).padEnd(3, '0'));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_INSTANT_MS) return null;
  return new Date(ms).toISOString() as IsoDateTime;
}

export function isoDateOf(instant: IsoDateTime): IsoDate {
  return instant.slice(0, 10) as IsoDate;
}

const S32_CHAR = '234567abcdefghijklmnopqrstuvwxyz';
const TID_REGEX = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/;
const TID_MIN_MS = Date.UTC(2005, 0, 1);
const TID_MAX_MS = Date.UTC(2100, 0, 1);

/** Decode the 11-char microsecond timestamp of a TID record key; null if not a TID or out of range. */
export function tidToIsoDateTime(rkey: string): IsoDateTime | null {
  if (typeof rkey !== 'string' || !TID_REGEX.test(rkey)) return null;
  // BigInt: 11 base-32 digits are 55 bits, beyond Number's exact integer range.
  let micros = 0n;
  for (const c of rkey.slice(0, 11)) {
    micros = micros * 32n + BigInt(S32_CHAR.indexOf(c));
  }
  const ms = Number(micros / 1000n);
  if (ms < TID_MIN_MS || ms > TID_MAX_MS) return null;
  return new Date(ms).toISOString() as IsoDateTime;
}

/**
 * Wall-clock implementation. `nowMs` uses `Date.now()` (not `performance.now()`)
 * because the HTTP client compares it with `Retry-After` HTTP-dates.
 */
export const systemClock: Clock = {
  now: () => new Date().toISOString() as IsoDateTime,
  nowMs: () => Date.now(),
};

/** `setTimeout`-based sleep that rejects with `signal.reason` when aborted, and never settles twice. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal.addEventListener('abort', onAbort, { once: true });
  });
