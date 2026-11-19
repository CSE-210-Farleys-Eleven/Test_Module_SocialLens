// Activity: hour / weekday histograms, daily timeline, posting streak, week over week. All UTC.
import { APP_IDS, CONTENT_KINDS, OUTBOUND_KINDS } from '../shared/contract';
import type { AppId, IsoDate, RecordKind, ValueStatus } from '../shared/contract';
import { isoDateOf } from '../shared/index';
import type { Histogram, HistogramBin, Streak, Timeline, TimelineDay, WeekOverWeek, WeekWindow } from './contract';
import { assessCoverage, collectionsForKinds, countValue, type Assessment } from './certainty';
import { addDays, dayMs, daysBetween, isDated, MS_PER_DAY, type AnalysisContext } from './window';

const CONTENT: readonly RecordKind[] = CONTENT_KINDS;
const OUTBOUND: readonly RecordKind[] = OUTBOUND_KINDS;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Series carry only exact / partial / unknown. */
function seriesStatus(a: Assessment): ValueStatus {
  return a.status === 'not-available' ? 'unknown' : a.status;
}

function emptyContent(): Record<AppId, number> {
  const out = {} as Record<AppId, number>;
  for (const id of APP_IDS) out[id] = 0;
  return out;
}

export interface ActivityResult {
  readonly hourHistogram: Histogram;
  readonly weekdayHistogram: Histogram;
  readonly timeline: Timeline;
  readonly streak: Streak;
  readonly weekOverWeek: WeekOverWeek;
}

export function computeActivity(ctx: AnalysisContext): ActivityResult {
  const { snapshot, registry } = ctx;
  const contentAssessment = assessCoverage(snapshot, registry, collectionsForKinds(registry, CONTENT));
  const timelineAssessment = assessCoverage(snapshot, registry, collectionsForKinds(registry, [...CONTENT, ...OUTBOUND]));
  const histograms = computeHistograms(ctx, seriesStatus(contentAssessment));
  return {
    ...histograms,
    timeline: computeTimeline(ctx, seriesStatus(timelineAssessment)),
    streak: computeStreak(ctx, contentAssessment),
    weekOverWeek: computeWeekOverWeek(ctx, contentAssessment),
  };
}

function computeHistograms(ctx: AnalysisContext, status: ValueStatus) {
  const N = ctx.snapshot.fetchedAt;
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  let total = 0;
  for (const r of ctx.inRange) {
    if (!CONTENT.includes(r.kind) || !isDated(r.createdAt, N)) continue;
    total += 1;
    hours[Number(r.createdAt.slice(11, 13))]! += 1;
    // getUTCDay: 0 = Sunday … 6 = Saturday → shift so Monday = 0.
    weekdays[(new Date(dayMs(isoDateOf(r.createdAt))).getUTCDay() + 6) % 7]! += 1;
  }
  const hourBins: HistogramBin[] = hours.map((count, index) => ({ index, label: String(index).padStart(2, '0'), count }));
  const weekdayBins: HistogramBin[] = weekdays.map((count, index) => ({ index, label: WEEKDAYS[index]!, count }));
  return {
    hourHistogram: { metricId: 'activity.hourHistogram', timezone: 'UTC', bins: hourBins, total, status } satisfies Histogram,
    weekdayHistogram: { metricId: 'activity.weekdayHistogram', timezone: 'UTC', bins: weekdayBins, total, status } satisfies Histogram,
  };
}

function computeTimeline(ctx: AnalysisContext, status: ValueStatus): Timeline {
  const { snapshot, options, rangeWindow } = ctx;
  const N = snapshot.fetchedAt;
  const endDate = rangeWindow.endDate;
  const content = new Map<IsoDate, Record<AppId, number>>();
  const outbound = new Map<IsoDate, number>();
  let earliest: IsoDate | null = null;
  for (const r of ctx.inRange) {
    const isContent = CONTENT.includes(r.kind);
    if ((!isContent && !OUTBOUND.includes(r.kind)) || !isDated(r.createdAt, N)) continue;
    const d = isoDateOf(r.createdAt);
    if (earliest === null || d < earliest) earliest = d;
    if (isContent) {
      const row = content.get(d) ?? emptyContent();
      row[r.app] = (row[r.app] ?? 0) + 1;
      content.set(d, row);
    } else {
      outbound.set(d, (outbound.get(d) ?? 0) + 1);
    }
  }

  const startDate = rangeWindow.startDate ?? earliest;
  if (startDate === null) return { metricId: 'activity.dailyTimeline', timezone: 'UTC', days: [], truncated: false, status };

  const fullLength = daysBetween(startDate, endDate) + 1;
  const max = Number.isFinite(options.timelineMaxDays) ? Math.max(0, Math.floor(options.timelineMaxDays)) : 0;
  const length = Math.min(fullLength, max);
  const firstMs = dayMs(endDate) - (length - 1) * MS_PER_DAY;
  const days: TimelineDay[] = [];
  for (let i = 0; i < length; i++) {
    const date = new Date(firstMs + i * MS_PER_DAY).toISOString().slice(0, 10) as IsoDate;
    days.push({ date, content: { ...(content.get(date) ?? emptyContent()) }, outbound: outbound.get(date) ?? 0 });
  }
  return { metricId: 'activity.dailyTimeline', timezone: 'UTC', days, truncated: length < fullLength, status };
}

/** Distinct UTC dates with ≥ 1 dated content item, all time (ignores the range). */
function contentDates(ctx: AnalysisContext): Set<IsoDate> {
  const N = ctx.snapshot.fetchedAt;
  const out = new Set<IsoDate>();
  for (const r of ctx.snapshot.records) {
    if (CONTENT.includes(r.kind) && isDated(r.createdAt, N)) out.add(isoDateOf(r.createdAt));
  }
  return out;
}

function computeStreak(ctx: AnalysisContext, a: Assessment): Streak {
  const D = contentDates(ctx);
  const today = ctx.rangeWindow.endDate;
  const runEndingAt = (end: IsoDate): number => {
    let n = 0;
    let d = end;
    while (D.has(d)) {
      n += 1;
      d = addDays(d, -1);
    }
    return n;
  };

  let current = 0;
  let currentEnd: IsoDate | null = null;
  if (D.has(today)) currentEnd = today;
  else if (D.has(addDays(today, -1))) currentEnd = addDays(today, -1);
  if (currentEnd !== null) current = runEndingAt(currentEnd);

  // Longest run; '>=' over ascending dates keeps the most recent run on a tie.
  const sorted = [...D].sort();
  let longest = 0;
  let longestStart: IsoDate | null = null;
  let longestEnd: IsoDate | null = null;
  let runStart: IsoDate | null = null;
  let runLength = 0;
  let prev: IsoDate | null = null;
  for (const d of sorted) {
    if (prev !== null && daysBetween(prev, d) === 1) runLength += 1;
    else {
      runStart = d;
      runLength = 1;
    }
    if (runLength >= longest) {
      longest = runLength;
      longestStart = runStart;
      longestEnd = d;
    }
    prev = d;
  }

  const hasValue = a.status === 'exact' || a.status === 'partial';
  return {
    current: countValue('activity.streak.current', current, a),
    longest: countValue('activity.streak.longest', longest, a),
    currentStart: hasValue && currentEnd !== null ? addDays(currentEnd, -(current - 1)) : null,
    currentEnd: hasValue ? currentEnd : null,
    longestStart: hasValue ? longestStart : null,
    longestEnd: hasValue ? longestEnd : null,
  };
}

function computeWeekOverWeek(ctx: AnalysisContext, a: Assessment): WeekOverWeek {
  const N = ctx.snapshot.fetchedAt;
  const today = ctx.rangeWindow.endDate;
  const curStart = addDays(today, -6);
  const prevStart = addDays(today, -13);
  const prevEnd = addDays(today, -7);
  let cur = 0;
  let prev = 0;
  for (const r of ctx.snapshot.records) {
    if (!CONTENT.includes(r.kind) || !isDated(r.createdAt, N)) continue;
    const d = isoDateOf(r.createdAt);
    if (d >= curStart && d <= today) cur += 1;
    else if (d >= prevStart && d <= prevEnd) prev += 1;
  }
  const current: WeekWindow = { startDate: curStart, endDate: today, contentItems: countValue('activity.weekOverWeek', cur, a) };
  const previous: WeekWindow = { startDate: prevStart, endDate: prevEnd, contentItems: countValue('activity.weekOverWeek', prev, a) };
  const c = current.contentItems.value;
  const p = previous.contentItems.value;
  const delta = c !== null && p !== null ? c - p : null;
  return { current, previous, delta, deltaFraction: delta !== null && p !== null && p > 0 ? delta / p : null };
}
