/**
 * M6 `analytics/` — FROZEN CONTRACT.
 * Pure activity and engagement calculations over a Snapshot.
 * Input and output are plain structured-cloneable data (they cross the Worker boundary):
 * no functions, classes, Map, Set or Date. Types only.
 */
import type {
  AppId,
  AtUri,
  Did,
  EngagementCounts,
  IsoDate,
  IsoDateTime,
  MetricValue,
  RangeId,
  RecordKind,
  Snapshot,
  ValueStatus,
} from '../shared/contract';
import type { RegistryData } from '../registry/contract';

export interface AnalyticsOptions {
  readonly range: RangeId;
  /** Number of top posts to return (LIMITS.topPosts). */
  readonly topPosts: number;
  /** Posts younger than this many hours at `snapshot.fetchedAt` are "settling" (LIMITS.settlingHours). */
  readonly settlingHours: number;
  /** Maximum number of days in the daily timeline (LIMITS.timelineMaxDays). */
  readonly timelineMaxDays: number;
  /** Maximum characters of post text copied into a TopPost (LIMITS.textPreviewChars). */
  readonly textPreviewChars: number;
}

export interface AnalyticsInput {
  readonly snapshot: Snapshot;
  readonly registry: RegistryData;
  readonly options: AnalyticsOptions;
}

/** The selected date range, resolved against `snapshot.fetchedAt`. Always UTC. */
export interface RangeWindow {
  readonly range: RangeId;
  readonly timezone: 'UTC';
  /** 00:00:00.000Z of the first day in range; null for 'all'. */
  readonly start: IsoDateTime | null;
  /** `snapshot.fetchedAt`. */
  readonly end: IsoDateTime;
  readonly startDate: IsoDate | null;
  readonly endDate: IsoDate;
  /** Number of UTC calendar days in the range (7 / 30 / 90); null for 'all'. */
  readonly days: number | null;
}

export interface KindTotal {
  readonly kind: RecordKind;
  readonly appId: AppId;
  /** metricId 'records.byKind'. */
  readonly count: MetricValue;
}

export interface AppTotal {
  readonly appId: AppId;
  /** metricId 'records.byApp'. */
  readonly records: MetricValue;
  /** metricId 'content.items', restricted to this app. */
  readonly contentItems: MetricValue;
}

/** Only metrics every supported app contributes to. The Overview shows nothing else. */
export interface OverviewMetrics {
  /** Apps included in these numbers, for the "includes: …" note. */
  readonly includedApps: readonly AppId[];
  /** metricId 'content.items'. */
  readonly contentItems: MetricValue;
  /** metricId 'activity.activeDays'. */
  readonly activeDays: MetricValue;
  /** metricId 'records.total'. */
  readonly recordsTotal: MetricValue;
  /** Latest dated content item at or before `fetchedAt`, any range; null when none. */
  readonly lastContentAt: IsoDateTime | null;
}

export interface AppEngagementAvailability {
  readonly appId: AppId;
  readonly available: boolean;
  /** Why not, when `available` is false; null otherwise. */
  readonly reason: string | null;
}

export interface EngagementSummary {
  /** Posts + replies in range whose collection has a count source. */
  readonly eligiblePosts: number;
  /** Of those, posts with `engagement.status === 'known'`. The denominator of every per-post value. */
  readonly knownPosts: number;
  readonly unknownPosts: number;
  /** Known posts younger than `settlingHours`. Included in totals, and flagged. */
  readonly settlingPosts: number;
  /** metricIds 'engagement.likes' | '.reposts' | '.replies' | '.quotes' | '.interactions'. */
  readonly likes: MetricValue;
  readonly reposts: MetricValue;
  readonly replies: MetricValue;
  readonly quotes: MetricValue;
  readonly interactions: MetricValue;
  /** metricId 'engagement.interactionsPerPost' — POOLED: Σ interactions ÷ knownPosts. */
  readonly interactionsPerPost: MetricValue;
  /** metricId 'engagement.knownShare' — knownPosts ÷ eligiblePosts. */
  readonly knownShare: MetricValue;
  /** One row per app in registry order. */
  readonly perApp: readonly AppEngagementAvailability[];
}

export interface TopPost {
  /** 1-based. */
  readonly rank: number;
  readonly uri: AtUri;
  readonly kind: RecordKind;
  readonly createdAt: IsoDateTime | null;
  /** Source text, truncated. Render as text only. */
  readonly textPreview: string | null;
  readonly counts: EngagementCounts;
  /** likes + reposts + replies + quotes. */
  readonly interactions: number;
  readonly settling: boolean;
}

export interface HistogramBin {
  /** 0–23 for hours; 0–6 for weekdays (0 = Monday). */
  readonly index: number;
  /** "00".."23" or "Mon".."Sun". */
  readonly label: string;
  readonly count: number;
}

export interface Histogram {
  readonly metricId: 'activity.hourHistogram' | 'activity.weekdayHistogram';
  readonly timezone: 'UTC';
  /** Always 24 or 7 bins, zero-filled, ascending index. */
  readonly bins: readonly HistogramBin[];
  /** Dated content items counted. */
  readonly total: number;
  /** 'exact' | 'partial' | 'unknown' (never 'settling' / 'not-available'). */
  readonly status: ValueStatus;
}

export interface TimelineDay {
  readonly date: IsoDate;
  /** Content items published that UTC day, per app. */
  readonly content: Readonly<Record<AppId, number>>;
  /** Outbound interaction records (repost, like, follow, block, list-item) created that UTC day. */
  readonly outbound: number;
}

export interface Timeline {
  readonly metricId: 'activity.dailyTimeline';
  readonly timezone: 'UTC';
  /** Consecutive UTC days, ascending, zero-filled, ending at the `fetchedAt` day. */
  readonly days: readonly TimelineDay[];
  /** True when the range was longer than `timelineMaxDays` and the oldest days were cut. */
  readonly truncated: boolean;
  /** 'exact' | 'partial' | 'unknown'. */
  readonly status: ValueStatus;
}

export interface Streak {
  /** metricId 'activity.streak.current' (unit: days). */
  readonly current: MetricValue;
  /** metricId 'activity.streak.longest' (unit: days). */
  readonly longest: MetricValue;
  readonly currentStart: IsoDate | null;
  readonly currentEnd: IsoDate | null;
  readonly longestStart: IsoDate | null;
  readonly longestEnd: IsoDate | null;
}

export interface WeekWindow {
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  /** Content items published in this 7-day UTC window (metricId 'activity.weekOverWeek'). */
  readonly contentItems: MetricValue;
}

export interface WeekOverWeek {
  /** The 7 UTC days ending on the `fetchedAt` day (inclusive). */
  readonly current: WeekWindow;
  /** The 7 UTC days before that. */
  readonly previous: WeekWindow;
  /** current − previous; null when either side is unknown. */
  readonly delta: number | null;
  /** delta ÷ previous as a fraction; null when previous is 0 or unknown. */
  readonly deltaFraction: number | null;
}

export interface AnalyticsReport {
  readonly schemaVersion: 1;
  readonly did: Did;
  /** Copied from the snapshot; the reference "now". */
  readonly fetchedAt: IsoDateTime;
  readonly mode: 'live' | 'demo';
  readonly window: RangeWindow;
  /** True when every collection's coverage is 'complete' and nothing was skipped. */
  readonly coverageComplete: boolean;
  readonly overview: OverviewMetrics;
  /** One row per RecordKind in RECORD_KINDS order (zero rows included). */
  readonly byKind: readonly KindTotal[];
  /** One row per app in registry order. */
  readonly byApp: readonly AppTotal[];
  /** Records with no valid timestamp: counted only when range is 'all'. */
  readonly undated: number;
  /** Records dated after `fetchedAt`: treated like undated. */
  readonly futureDated: number;
  readonly engagement: EngagementSummary;
  readonly topPosts: readonly TopPost[];
  readonly hourHistogram: Histogram;
  readonly weekdayHistogram: Histogram;
  readonly timeline: Timeline;
  /** Computed over all dated content items, independent of the selected range. */
  readonly streak: Streak;
  /** Independent of the selected range. */
  readonly weekOverWeek: WeekOverWeek;
}

/** Pure, deterministic, synchronous, total: never throws for any well-typed input, never reads a clock. */
export type ComputeAnalytics = (input: AnalyticsInput) => AnalyticsReport;
