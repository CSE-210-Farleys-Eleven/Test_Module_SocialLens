// Engagement summary and top posts. Pooled ratios only; unknown counters are never counted as 0 (I-7).
// No exposure denominator exists, so nothing here is a "rate" (I-11).
import type { ActivityRecord, AppId, EngagementCounts, MetricId, MetricValue, ValueStatus } from '../shared/contract';
import type { AppEngagementAvailability, EngagementSummary, TopPost } from './contract';
import { assessCoverage } from './certainty';
import type { AnalysisContext } from './window';

const MS_PER_HOUR = 3_600_000;
const NO_KNOWN = 'No posts with known counters in this range.';
const NO_SOURCE = 'No supported app publishes interaction counters for these records.';
const NO_SOURCE_FOR_APP = 'This app has no public interaction counters.';

interface KnownPost {
  readonly record: ActivityRecord;
  readonly counts: EngagementCounts;
  readonly interactions: number;
  readonly settling: boolean;
}

interface Base {
  readonly status: ValueStatus;
  readonly reason: string | null;
}

function nonNegativeInt(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function value(
  metricId: MetricId,
  v: number,
  base: Base,
  apps: readonly AppId[],
  kind: 'count' | 'ratio',
  ratio: { numerator: number; denominator: number } | null = null,
): MetricValue {
  const hasValue = base.status !== 'unknown' && base.status !== 'not-available';
  return {
    metricId,
    value: hasValue ? v : null,
    status: base.status,
    isLowerBound: kind === 'count' && base.status === 'partial',
    reason: base.reason,
    numerator: hasValue && ratio ? ratio.numerator : null,
    denominator: hasValue && ratio ? ratio.denominator : null,
    contributingApps: [...apps],
  };
}

export interface EngagementResult {
  readonly engagement: EngagementSummary;
  readonly topPosts: TopPost[];
}

export function computeEngagement(ctx: AnalysisContext): EngagementResult {
  const { snapshot, registry, options, inRange } = ctx;
  const nowMs = Date.parse(snapshot.fetchedAt);
  const settlingMs = (Number.isFinite(options.settlingHours) ? options.settlingHours : 0) * MS_PER_HOUR;

  const sourceCollections = registry.collections.filter((c) => c.engagementSource !== null).map((c) => c.nsid);
  const countApps = registry.apps.filter((a) => a.capability.engagementCounts).map((a) => a.id);

  let eligible = 0;
  const knownPosts: KnownPost[] = [];
  const sum = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
  let settlingPosts = 0;
  for (const r of inRange) {
    if ((r.kind !== 'post' && r.kind !== 'reply') || !sourceCollections.includes(r.collection)) continue;
    eligible += 1;
    if (r.engagement.status !== 'known') continue;
    const c = r.engagement.counts;
    const age = r.createdAt === null ? Number.NaN : nowMs - Date.parse(r.createdAt);
    const settling = age >= 0 && age < settlingMs;
    if (settling) settlingPosts += 1;
    sum.likes += c.likes;
    sum.reposts += c.reposts;
    sum.replies += c.replies;
    sum.quotes += c.quotes;
    knownPosts.push({ record: r, counts: c, interactions: c.likes + c.reposts + c.replies + c.quotes, settling });
  }
  const known = knownPosts.length;
  const interactions = sum.likes + sum.reposts + sum.replies + sum.quotes;

  // "Status of a value" for engagement, first match wins (CONTRACT.md rules 1–6).
  let base: Base;
  const coverage = assessCoverage(snapshot, registry, sourceCollections);
  if (countApps.length === 0 || sourceCollections.length === 0) {
    base = { status: 'not-available', reason: NO_SOURCE };
  } else if (coverage.status === 'unknown') {
    base = { status: 'unknown', reason: coverage.reason };
  } else if (eligible > 0 && known === 0) {
    base = { status: 'unknown', reason: `None of the ${eligible} posts in this range has known counters.` };
  } else if (coverage.status === 'partial' || known < eligible) {
    const parts: string[] = [];
    if (coverage.reason !== null) parts.push(coverage.reason);
    if (known < eligible) parts.push(`Counters are unknown for ${eligible - known} of ${eligible} posts in this range.`);
    base = { status: 'partial', reason: parts.join(' ') };
  } else if (settlingPosts > 0) {
    base = {
      status: 'settling',
      reason: `${settlingPosts} post${settlingPosts === 1 ? ' is' : 's are'} younger than ${options.settlingHours} hours; counters may still change.`,
    };
  } else {
    base = { status: 'exact', reason: null };
  }

  const ratioBase = (denominator: number, reason: string): Base =>
    base.status === 'not-available' || base.status === 'unknown' || denominator > 0 ? base : { status: 'unknown', reason };

  const perPostBase = ratioBase(known, NO_KNOWN);
  const shareBase = ratioBase(eligible, 'No posts with a count source in this range.');

  const perApp: AppEngagementAvailability[] = registry.apps.map((app) => {
    if (app.capability.engagementCounts) return { appId: app.id, available: true, reason: null };
    const entry = app.capability.unavailable.find((u) => u.metricId === 'engagement.interactionsPerPost');
    return { appId: app.id, available: false, reason: entry && entry.reason.length > 0 ? entry.reason : NO_SOURCE_FOR_APP };
  });

  const engagement: EngagementSummary = {
    eligiblePosts: eligible,
    knownPosts: known,
    unknownPosts: eligible - known,
    settlingPosts,
    likes: value('engagement.likes', sum.likes, base, countApps, 'count'),
    reposts: value('engagement.reposts', sum.reposts, base, countApps, 'count'),
    replies: value('engagement.replies', sum.replies, base, countApps, 'count'),
    quotes: value('engagement.quotes', sum.quotes, base, countApps, 'count'),
    interactions: value('engagement.interactions', interactions, base, countApps, 'count'),
    interactionsPerPost: value(
      'engagement.interactionsPerPost',
      known > 0 ? interactions / known : 0,
      perPostBase,
      countApps,
      'ratio',
      { numerator: interactions, denominator: known },
    ),
    knownShare: value('engagement.knownShare', eligible > 0 ? known / eligible : 0, shareBase, countApps, 'ratio', {
      numerator: known,
      denominator: eligible,
    }),
    perApp,
  };

  return { engagement, topPosts: rankTopPosts(knownPosts, options.topPosts, options.textPreviewChars) };
}

function compareTop(a: KnownPost, b: KnownPost): number {
  if (a.interactions !== b.interactions) return b.interactions - a.interactions;
  const ta = a.record.createdAt;
  const tb = b.record.createdAt;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta > tb ? -1 : 1;
  }
  const ua = a.record.uri;
  const ub = b.record.uri;
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

function preview(text: string | null, chars: number): string | null {
  if (text === null) return null;
  // Truncate by code point so a surrogate pair is never split.
  return Array.from(text).slice(0, chars).join('');
}

function rankTopPosts(posts: readonly KnownPost[], limit: number, previewChars: number): TopPost[] {
  const n = nonNegativeInt(limit);
  const chars = nonNegativeInt(previewChars);
  return [...posts]
    .sort(compareTop)
    .slice(0, n)
    .map((p, i) => ({
      rank: i + 1,
      uri: p.record.uri,
      kind: p.record.kind,
      createdAt: p.record.createdAt,
      textPreview: preview(p.record.text, chars),
      counts: { likes: p.counts.likes, reposts: p.counts.reposts, replies: p.counts.replies, quotes: p.counts.quotes },
      interactions: p.interactions,
      settling: p.settling,
    }));
}
