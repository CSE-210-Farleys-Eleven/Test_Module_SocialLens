// Range window, in-range filter and UTC calendar-day arithmetic. Pure: no clock, no locale.
import type { ActivityRecord, IsoDate, IsoDateTime, RangeId, Snapshot } from '../shared/contract';
import type { RegistryData } from '../registry/contract';
import { isoDateOf } from '../shared/index';
import type { AnalyticsOptions, RangeWindow } from './contract';

export const MS_PER_DAY = 86_400_000;

const RANGE_DAYS: Readonly<Record<Exclude<RangeId, 'all'>, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** Milliseconds since the epoch of 00:00:00.000Z on `date`. */
export function dayMs(date: IsoDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

export function dateOfMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

/** `date` shifted by `days` UTC calendar days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return dateOfMs(dayMs(date) + days * MS_PER_DAY);
}

/** Whole UTC days from `a` to `b` (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((dayMs(b) - dayMs(a)) / MS_PER_DAY);
}

export function resolveWindow(range: RangeId, fetchedAt: IsoDateTime): RangeWindow {
  const endDate = isoDateOf(fetchedAt);
  if (range === 'all') {
    return { range, timezone: 'UTC', start: null, end: fetchedAt, startDate: null, endDate, days: null };
  }
  const days = RANGE_DAYS[range];
  const startDate = addDays(endDate, -(days - 1));
  const start = `${startDate}T00:00:00.000Z` as IsoDateTime;
  return { range, timezone: 'UTC', start, end: fetchedAt, startDate, endDate, days };
}

/**
 * Bounded ranges: dated records with start ≤ createdAt ≤ end. `all`: every record.
 * IsoDateTime is normalised to a fixed-width UTC form, so string order equals time order.
 */
export function isInRange(createdAt: IsoDateTime | null, rangeWindow: RangeWindow): boolean {
  if (rangeWindow.start === null) return true;
  return createdAt !== null && createdAt >= rangeWindow.start && createdAt <= rangeWindow.end;
}

/** Dated = has a time at or before the reference "now". */
export function isDated(createdAt: IsoDateTime | null, fetchedAt: IsoDateTime): createdAt is IsoDateTime {
  return createdAt !== null && createdAt <= fetchedAt;
}

/** Everything the calculators need, resolved once per call. Internal to `analytics/`. */
export interface AnalysisContext {
  readonly snapshot: Snapshot;
  readonly registry: RegistryData;
  readonly options: AnalyticsOptions;
  readonly rangeWindow: RangeWindow;
  /** Records in the selected range (see `isInRange`), snapshot order. */
  readonly inRange: readonly ActivityRecord[];
}
