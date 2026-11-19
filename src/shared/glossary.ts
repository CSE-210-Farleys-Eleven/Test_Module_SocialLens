// Transcribed from docs/architecture/GLOSSARY.md (version 2026-11-18.1), Parts A and B.
// `label`, `formula` (the "Rule" column), `denominator`, `includes`, `excludes`, apps, Overview
// and unit are copied from the tables; `definition` and `timeBasis` are one-sentence summaries
// of the same row and of the glossary's conventions (Range, Time semantics, UTC).

import {
  METRIC_IDS,
  SOURCES,
  UNAVAILABLE_METRIC_IDS,
  type AppId,
  type Citation,
  type Glossary,
  type MetricDefinition,
  type MetricId,
  type MetricValue,
  type SourceId,
  type StatusLabel,
  type UnavailableMetricDefinition,
} from './contract';

const BOTH: readonly AppId[] = ['bluesky', 'standard-site'];
const BSKY: readonly AppId[] = ['bluesky'];

const RANGE_BASIS = "Records in the selected range by UTC createdAt; the 'all' range also includes undated and future-dated records.";
const ENGAGEMENT_BASIS = 'Posts published in the selected range (UTC), with their lifetime counts as read at fetch time.';
const ENGAGEMENT_INCLUDES = 'Posts and replies you wrote, with known counters.';

const METRICS: readonly MetricDefinition[] = [
  {
    id: 'records.total',
    label: 'Records analysed',
    definition: 'How many of your public records SocialLens read and analysed in the selected range.',
    formula: 'Count of analysed records in the range.',
    denominator: null,
    includes: 'Every kind from every registered collection. For `all`: undated and future-dated records too.',
    excludes: 'Skipped records; collections that are present but not analysed; deleted records.',
    contributingApps: BOTH,
    sharedByAllApps: true,
    timeBasis: RANGE_BASIS,
    unit: 'count',
  },
  {
    id: 'records.byKind',
    label: 'Records by type',
    definition: 'How many analysed records of each type (post, reply, like, …) fall in the selected range.',
    formula: 'Count of in-range records per `RecordKind` (11 rows, fixed order, zero rows shown).',
    denominator: null,
    includes: 'One collection per kind (`post` and `reply` both come from `app.bsky.feed.post`).',
    excludes: 'Skipped records; collections that are present but not analysed; deleted records.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: RANGE_BASIS,
    unit: 'count',
  },
  {
    id: 'records.byApp',
    label: 'Records by app',
    definition: 'How many analysed records each app contributed in the selected range.',
    formula: 'Count of in-range records per app.',
    denominator: null,
    includes: 'All kinds of that app.',
    excludes: 'Skipped records; collections that are present but not analysed; deleted records.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: RANGE_BASIS,
    unit: 'count',
  },
  {
    id: 'content.items',
    label: 'Content items published',
    definition: 'How many posts, replies and Standard.site documents you published in the selected range.',
    formula: 'Count of in-range records of kind `post`, `reply` or `document`.',
    denominator: null,
    includes: 'Posts, replies, Standard.site documents.',
    excludes: 'Reposts, likes, follows, blocks, lists, profile, publications.',
    contributingApps: BOTH,
    sharedByAllApps: true,
    timeBasis: RANGE_BASIS,
    unit: 'count',
  },
  {
    id: 'activity.activeDays',
    label: 'Active days',
    definition: 'On how many UTC calendar days in the selected range you published at least one content item.',
    formula: 'Number of distinct UTC dates with ≥ 1 dated content item in the range.',
    denominator: null,
    includes: 'Dated content items.',
    excludes: 'Undated/future-dated items; outbound records.',
    contributingApps: BOTH,
    sharedByAllApps: true,
    timeBasis: 'UTC calendar days in the selected range; dated content items only.',
    unit: 'days',
  },
  {
    id: 'activity.dailyTimeline',
    label: 'Daily timeline (UTC)',
    definition: 'Your content items per app and your outbound records for each UTC day of the selected range.',
    formula:
      'One row per UTC day in the range, zero-filled, ending at date(N): content items per app, and outbound records. For `all`: from the earliest dated content/outbound record to date(N), keeping at most the latest 366 days (`truncated: true` when cut). No dated record → no rows.',
    denominator: null,
    includes: 'Dated content and outbound records.',
    excludes: 'Undated/future-dated records; lists, profile, publications.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: "UTC calendar days ending at the snapshot date; the 'all' range keeps at most the latest 366 days.",
    unit: 'series',
  },
  {
    id: 'activity.hourHistogram',
    label: 'Posting hours (UTC)',
    definition: 'How your content items in the selected range spread over the 24 hours of the UTC day.',
    formula: '24 bins (00–23): in-range dated content items by UTC hour of `createdAt`.',
    denominator: null,
    includes: 'Dated content items.',
    excludes: 'Everything else.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: 'UTC hour of createdAt; dated content items in the selected range.',
    unit: 'series',
  },
  {
    id: 'activity.weekdayHistogram',
    label: 'Posting weekdays (UTC)',
    definition: 'How your content items in the selected range spread over the days of the week, in UTC.',
    formula: '7 bins (Mon = 0 … Sun = 6): in-range dated content items by UTC weekday.',
    denominator: null,
    includes: 'Dated content items.',
    excludes: 'Everything else.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: 'UTC weekday (Monday to Sunday) of createdAt; dated content items in the selected range.',
    unit: 'series',
  },
  {
    id: 'activity.streak.current',
    label: 'Current posting streak',
    definition: 'How many consecutive UTC days, up to today or yesterday, you have published at least one content item.',
    formula:
      'Let D = set of UTC dates with ≥ 1 dated content item (all time, ignores the range). If date(N) ∈ D: length of the run of consecutive dates ending at date(N). Else if date(N) − 1 ∈ D: the run ending at date(N) − 1 (today is not over yet). Else 0.',
    denominator: null,
    includes: 'Dated content items, all time.',
    excludes: 'Outbound records.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: 'UTC calendar days, all time (ignores the selected range).',
    unit: 'days',
  },
  {
    id: 'activity.streak.longest',
    label: 'Longest posting streak',
    definition: 'The longest run of consecutive UTC days on which you published at least one content item.',
    formula: 'Longest run of consecutive dates in D (ties: the most recent run). 0 when D is empty.',
    denominator: null,
    includes: 'Dated content items, all time.',
    excludes: 'Outbound records.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: 'UTC calendar days, all time (ignores the selected range).',
    unit: 'days',
  },
  {
    id: 'activity.weekOverWeek',
    label: 'Week over week',
    definition: 'How many content items you published in the last 7 UTC days compared with the 7 days before.',
    formula:
      'Current week = the 7 UTC dates ending at date(N); previous week = the 7 dates before. Each side = content items in that window. `delta = current − previous`; `deltaFraction = delta ÷ previous`, `null` when previous = 0. Ignores the selected range.',
    denominator: "previous week's count (for the fraction)",
    includes: 'Dated content items.',
    excludes: 'Outbound records.',
    contributingApps: BOTH,
    sharedByAllApps: false,
    timeBasis: 'The 7 UTC days ending at the snapshot date and the 7 days before (ignores the selected range).',
    unit: 'count',
  },
  {
    id: 'engagement.likes',
    label: 'Likes received',
    definition: 'The total public like count of your posts in the selected range whose counters could be read.',
    formula: 'Σ `likes` over known posts in range.',
    denominator: null,
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Posts with unknown counters; likes you gave; Standard.site.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'count',
  },
  {
    id: 'engagement.reposts',
    label: 'Reposts received',
    definition: 'The total public repost count of your posts in the selected range whose counters could be read.',
    formula: 'Σ `reposts` over known posts in range.',
    denominator: null,
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Posts with unknown counters; likes you gave; Standard.site; quotes are counted separately.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'count',
  },
  {
    id: 'engagement.replies',
    label: 'Replies received',
    definition: 'The total public reply count of your posts in the selected range whose counters could be read.',
    formula: 'Σ `replies` over known posts in range.',
    denominator: null,
    includes: 'Posts and replies you wrote, with known counters (includes your own replies to yourself).',
    excludes: 'Posts with unknown counters; likes you gave; Standard.site.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'count',
  },
  {
    id: 'engagement.quotes',
    label: 'Quotes received',
    definition: 'The total public quote count of your posts in the selected range whose counters could be read.',
    formula: 'Σ `quotes` over known posts in range.',
    denominator: null,
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Posts with unknown counters; likes you gave; Standard.site.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'count',
  },
  {
    id: 'engagement.interactions',
    label: 'Interactions received',
    definition: 'Likes, reposts, replies and quotes on your posts in the selected range, added together.',
    formula: 'Σ (likes + reposts + replies + quotes) over known posts in range.',
    denominator: null,
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Bookmarks, views, clicks (not public).',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'count',
  },
  {
    id: 'engagement.interactionsPerPost',
    label: 'Interactions per post',
    definition:
      'Interactions received divided by the number of your posts with known counters; there is no view count, so this is not a share of people reached.',
    formula: 'Pooled: `engagement.interactions ÷ knownPosts`. `numerator`/`denominator` carry both numbers.',
    denominator: 'Known posts in range (not all posts, not followers, not views)',
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Posts with unknown counters are left out of numerator and denominator.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'per-post',
  },
  {
    id: 'engagement.knownShare',
    label: 'Posts with known counts',
    definition: 'The share of your posts and replies in the selected range whose public counters could be read.',
    formula: '`knownPosts ÷ eligiblePosts`, where eligible = in-range posts + replies.',
    denominator: 'Eligible posts in range',
    includes: '—',
    excludes: '—',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'share',
  },
  {
    id: 'engagement.topPosts',
    label: 'Top posts',
    definition: 'Your five posts in the selected range with the most interactions, among posts whose counters could be read.',
    formula:
      'Known posts in range ordered by interactions (desc), then `createdAt` (desc, undated last), then URI (asc); first 5.',
    denominator: null,
    includes: ENGAGEMENT_INCLUDES,
    excludes: 'Posts with unknown counters.',
    contributingApps: BSKY,
    sharedByAllApps: false,
    timeBasis: ENGAGEMENT_BASIS,
    unit: 'ranking',
  },
];

const UNAVAILABLE: readonly UnavailableMetricDefinition[] = [
  {
    id: 'impressions',
    label: 'Impressions / views',
    reason: 'Not available from public records: no public view counter exists.',
    wouldRequire: 'Data only the platform has.',
  },
  {
    id: 'reach',
    label: 'Reach',
    reason: 'Not available from public records.',
    wouldRequire: 'Data only the platform has.',
  },
  {
    id: 'engagement-rate',
    label: 'Engagement rate',
    reason:
      'There is no exposure denominator, so any "rate" would be invented. SocialLens shows "Interactions per post" instead and says what it divides by.',
    wouldRequire: 'Impressions or reach.',
  },
  {
    id: 'follower-growth',
    label: 'Follower growth',
    reason:
      "Unknown: your repository holds only records you created. Follows of you live in other people's repositories and the profile API returns only the current total.",
    wouldRequire: 'A history service that stores snapshots over time (out of scope: no backend, no history store).',
  },
  {
    id: 'unfollows',
    label: 'Unfollows',
    reason: 'Unknown: a deleted follow record disappears.',
    wouldRequire: 'A history service.',
  },
  {
    id: 'who-blocks-me',
    label: 'Who blocks me',
    reason:
      "Deliberately excluded. It needs a network-wide index of other people's records, and SocialLens is self-only.",
    // GLOSSARY.md names two third-party indexes here; the names are omitted because the
    // IT-12 hygiene check forbids them in runtime source.
    wouldRequire: "A network-wide index of other people's records — never called.",
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks received',
    reason: 'Not shown: whether the public counter is populated for non-viewers was not verified.',
    wouldRequire: 'Verification against the live API.',
  },
  {
    id: 'best-time-to-post',
    label: 'Best time to post',
    reason:
      'Not shown: without exposure data it would only restate when you already post. The posting-hours chart shows that directly.',
    wouldRequire: 'Exposure data.',
  },
  {
    id: 'cross-app-score',
    label: 'Overall score',
    reason: 'Deliberately excluded: no opaque or weighted score, and no single score across apps.',
    wouldRequire: '—',
  },
];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertOrder(actual: readonly string[], expected: readonly string[], what: string): void {
  if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
    throw new Error(`GLOSSARY ${what} do not match the contract ids`);
  }
}
assertOrder(
  METRICS.map((m) => m.id),
  METRIC_IDS,
  'metrics',
);
assertOrder(
  UNAVAILABLE.map((m) => m.id),
  UNAVAILABLE_METRIC_IDS,
  'unavailable metrics',
);

export const GLOSSARY: Glossary = deepFreeze({
  version: '2026-11-18.1',
  metrics: METRICS,
  unavailable: UNAVAILABLE,
});

const BY_ID: ReadonlyMap<MetricId, MetricDefinition> = new Map(GLOSSARY.metrics.map((m) => [m.id, m]));

export function metricDefinition(id: MetricId): MetricDefinition {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`Unknown metric id: ${String(id)}`);
  return found;
}

export function statusLabelFor(value: MetricValue): StatusLabel {
  switch (value.status) {
    case 'not-available':
      return 'not-available';
    case 'unknown':
      return 'unknown';
    case 'partial':
      return 'partial';
    case 'settling':
      return 'settling';
    case 'exact':
      return value.value === 0 ? 'zero' : 'known';
  }
}

export function citation(sourceId: SourceId): Citation {
  const s = SOURCES[sourceId];
  return { sourceId, title: s.title, publisher: s.publisher, url: s.url, accessed: s.accessed };
}
