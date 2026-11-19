# M6 `analytics/` — contract

Frozen types: [`contract.ts`](contract.ts). Rules for every number: [`docs/architecture/GLOSSARY.md`](../../docs/architecture/GLOSSARY.md) (binding). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md).

> This contract covers only the files directly in `src/analytics/`. The sub-folders `privacy/`, `worker/` and `state/` are separate modules with their own contracts; do not import their code.

## Purpose
Pure calculations over one `Snapshot`: totals by kind and app, interactions per post, top posts, hour and weekday histograms, a daily timeline, posting streaks and a week-over-week delta — each carrying an honest status.

## Contribution to the whole
This module produces every number the Overview, Activity and Engagement views show. Because each value is a `MetricValue` with a glossary id, a status and a reason, the UI can label it correctly without recomputing anything, and the user can check any number against its published definition.

## What to optimise for (ranked)
1. **Correctness against the glossary** — every formula, denominator and status rule exactly as written.
2. **Determinism** — pure, no clock, no locale, no randomness; identical input → identical output.
3. Speed on one repository (≤ ~10,000 records): single passes, no quadratic work.

## Public API (`src/analytics/index.ts`)
```ts
export const computeAnalytics: ComputeAnalytics;   // (input: AnalyticsInput) => AnalyticsReport
```

### Rules (summary — the glossary is authoritative)
Let **N** = `snapshot.fetchedAt`; all dates and hours are UTC.

- **Window**: `7d`/`30d`/`90d` → `start` = 00:00:00.000Z of `date(N) − (days − 1)`, `end` = N, `days` set. `all` → `start: null`, `startDate: null`, `days: null`.
- **In range**: bounded → dated records with `start ≤ createdAt ≤ N`. `all` → every record. `undated` = records with `createdAt === null`; `futureDated` = records with `createdAt > N` (both reported for the whole snapshot, whatever the range).
- **Status of a value**: implement the table "Status of a value" in the glossary once (a helper taking the contributing collection NSIDs) and reuse it. Contributing collections come from `registry.collections` (kind → collection via `kinds`). Coverage row missing → treat as `unavailable`. "Has skipped" = any `snapshot.skipped` entry with that collection.
- **`byKind`**: 11 rows in `RECORD_KINDS` order; `appId` from the registry.
- **`byApp`**: one row per `registry.apps` entry, in order.
- **`overview`**: `includedApps` = all registry app ids; the three metrics per the glossary; `lastContentAt` = max `createdAt` over dated content items (all time).
- **Engagement**: eligible = in-range records whose collection has a non-null `engagementSource` and kind `post` or `reply`. Known/unknown by `engagement.status`. Settling = known and `0 ≤ N − createdAt < settlingHours × 3 600 000 ms`. Totals are sums over known posts. Status, first match:
  1. no app in the registry has `engagementCounts: true` → `not-available`;
  2. the post collection's coverage is `unavailable` → `unknown`;
  3. eligible > 0 and known = 0 → `unknown`;
  4. coverage `partial`, skipped records in that collection, or known < eligible → `partial` (`isLowerBound: true` for the five totals; `false` for `interactionsPerPost` and `knownShare`);
  5. settlingPosts > 0 → `settling`;
  6. else `exact` (eligible = 0 with complete coverage gives exact 0 totals).
  `interactionsPerPost`: `value = interactions ÷ knownPosts`, `numerator`/`denominator` set; knownPosts = 0 → `unknown`, value null, reason "No posts with known counters in this range.". `knownShare`: `knownPosts ÷ eligiblePosts`; eligible = 0 → `unknown`. Values are **not rounded** (the UI formats).
  `contributingApps` for every engagement value = apps with `engagementCounts: true`. `perApp`: one row per app; unavailable apps carry the reason from the registry's `unavailable` entry for `engagement.interactionsPerPost`.
- **`topPosts`**: known eligible posts in range, sorted by interactions desc, `createdAt` desc (null last), URI asc; first `options.topPosts`; `textPreview` = first `textPreviewChars` characters of `text` (null stays null).
- **Histograms**: in-range dated content items. Hours `00`…`23`; weekdays `Mon`…`Sun` with Monday = index 0.
- **Timeline**: per glossary; `content` has a key for every `AppId` (zero-filled).
- **Streak** and **week over week**: per glossary; independent of the range.

## Data received / sent
Receives `AnalyticsInput { snapshot, registry: RegistryData, options }` — plain data, possibly structured-cloned into a Worker. Sends `AnalyticsReport` — plain data (no `Date`, `Map`, `Set`, functions, `undefined` holes, `NaN` or `Infinity`).

## Error behaviour
Total: never throws for any well-typed input, including empty records, empty coverage, zero-length ranges and a registry with no engagement source. Never divides by zero (returns `unknown`). Never returns `NaN`.

## Invariants this module must enforce
- I-7 missing ≠ zero: unknown engagement is excluded from numerators and denominators, never counted as 0; an unavailable collection yields `null`, never 0.
- I-11: no impressions, reach, follower counts, "engagement rate" or composite score appears anywhere in the report.
- I-13: only metrics every app shares are in `overview`.
- Every `MetricValue.metricId` is the id named in the contract comment for that field; `value === null` iff status is `unknown` or `not-available`; `isLowerBound` is true only with status `partial` on counts.
- Date filtering never rewrites coverage: status depends on fetch coverage, not on the range.
- No `Date.now()`, `new Date()` without an argument, `Intl`, `toLocale*`, `Math.random`, DOM or `fetch` in this module.

## Out of scope
Fetching; normalising; privacy observations; formatting or rounding for display; best-time-to-post; hashtag/mention/link breakdowns; unique-actor counts; period selection other than the four ranges; caching or memoisation across calls.

## Dependencies
Types: `shared/contract`, `registry/contract` (`RegistryData`). Runtime: `shared` constants only (`RECORD_KINDS`, `CONTENT_KINDS`, `OUTBOUND_KINDS`, `APP_IDS`) and, if wanted, `isoDateOf`. No other module. Tests build snapshots with a small local factory; do not import `adapters/fixtures`, `normalize/` or `registry/` implementations.

## File layout
```
src/analytics/
  contract.ts            (frozen)
  index.ts               computeAnalytics (assembles the report)
  window.ts              range window, in-range filter, UTC day arithmetic
  certainty.ts           status-of-a-value helper
  totals.ts              byKind, byApp, overview
  engagement.ts          summary + top posts
  activity.ts            histograms, timeline, streak, week over week
  testkit.ts             snapshot/record/coverage builders for tests (test-only)
  *.test.ts              one per file above + report.test.ts
```

## Test plan (write these first)
Use a fixed N = `2026-11-10T23:59:59.000Z` and a tiny hand-built registry (post collection with a count source, like collection, document collection without).

**window**
- 7d window starts at `2026-11-04T00:00:00.000Z`; 30d at `2026-10-12T00:00:00.000Z`; `all` has null start.
- a record at exactly `start` and one at exactly N are in range; one 1 ms before `start` is not.
- undated and future-dated records are excluded from bounded ranges, included in `all`, and counted in `undated` / `futureDated`.

**totals and status**
- complete coverage, 3 posts + 1 reply + 2 likes in range → byKind rows `post: 3 exact`, `reply: 1 exact`, `like: 2 exact`, all other kinds `0 exact`.
- byKind always has 11 rows in `RECORD_KINDS` order.
- like coverage `partial` → like count `partial` with `isLowerBound: true` and a reason; post count still `exact`.
- block coverage `unavailable` → block count `value: null`, `unknown`.
- a skipped record in the post collection → post and reply counts `partial`.
- missing coverage row → treated as `unavailable`.
- `content.items` = posts + replies + documents; documents `unavailable` and posts complete → `partial`, lower bound; both unavailable → `unknown`.
- `records.total` with one unavailable collection → `partial` (sum of the rest).
- empty snapshot with complete coverage everywhere → every count is exact 0 (observed zero).
- `activeDays` counts distinct UTC dates (two posts on one day = 1; a post at 23:59Z and one at 00:01Z next day = 2).
- `byApp` has one row per app; standard-site content = documents only.
- `overview.includedApps` lists both apps; `lastContentAt` ignores likes and future-dated posts.

**engagement**
- 2 known posts (3+1+0+0 and 5+0+1+0) → interactions 10, `interactionsPerPost` = 5 with numerator 10, denominator 2, `exact`.
- pooled, not mean of ratios: assert on a case where both would differ if weights existed (document the arithmetic in the test).
- 2 known + 1 unknown → totals `partial` lower bound, `interactionsPerPost` = known-only ratio, `partial`, `isLowerBound: false`, `knownShare` = 2/3.
- eligible 3, known 0 → every engagement value `unknown`, value null (never 0).
- eligible 0 with complete coverage → totals exact 0, `interactionsPerPost` `unknown` (no denominator), `knownShare` `unknown`.
- a known post with all-zero counters contributes 0 and still counts in the denominator.
- one known post 10 hours old → `settlingPosts = 1`, status `settling`; at exactly 36 h → not settling.
- partial coverage and a settling post → `partial` wins.
- documents never count as eligible; registry without any count source → every engagement value `not-available`.
- `perApp`: bluesky available, standard-site unavailable with a non-empty reason.
- top posts: ordered by interactions desc; tie broken by newer `createdAt`; then by URI asc; limited to `topPosts`; unknown posts excluded; `textPreview` truncated; `rank` starts at 1.
- range filter applies: a known post outside the 7d window is not in the 7d totals but is in `all`.

**activity**
- hour histogram has 24 zero-filled bins; a post at `18:30:00.000Z` lands in bin 18.
- weekday histogram: `2026-11-09` (a Monday) → index 0; `2026-11-08` (Sunday) → index 6.
- histograms count content items only (likes ignored) and only dated ones.
- timeline for 7d has exactly 7 consecutive days ending `2026-11-10`, zero-filled, `content` has both app keys.
- timeline `outbound` counts likes/reposts/follows/blocks/list-items by their own `createdAt`.
- timeline for `all` starts at the earliest dated record; longer than `timelineMaxDays` → truncated to the latest days with `truncated: true`; no dated record → `days: []`.
- streak: posts on Nov 8, 9, 10 → current 3 (`currentStart` Nov 8, `currentEnd` Nov 10).
- streak: nothing today, posts on Nov 8 and 9 → current 2 ending Nov 9; last post Nov 8 → current 0, null dates.
- longest streak picks the longest run; on a tie the most recent; empty → 0.
- streak ignores the selected range (same result for 7d and all).
- streak with partial post coverage → `partial`, `isLowerBound: true`.
- week over week: 5 items in Nov 4–10 and 2 in Oct 28–Nov 3 → delta 3, fraction 1.5; previous 0 → fraction null; unknown side → delta null.

**report-level**
- `coverageComplete` is false when any coverage is not complete or anything was skipped.
- no value anywhere in the report is `NaN`, `Infinity` or `undefined` (walk the object).
- output equals itself after `structuredClone` and after JSON round-trip.
- same input twice → deep-equal output; input is not mutated (deep-freeze the input first).
- 10,000 synthetic records compute in under 200 ms on the test machine (log the measured time; treat as a smoke budget, not a benchmark).

## Hints and reuse
- Research: `SocialLens/docs/research/modules/analytics.md` — ship the table stakes (totals, per-post interactions, top posts, hour/weekday histograms, streak, week-over-week); keep a metric-definition registry and show it; choose pooled vs mean-of-ratios explicitly and say which; never the name "engagement rate"; no opaque scores; impressions/reach/follower growth are "not available"; keep `analytics/` free of DOM and `fetch` so the same code runs in a Worker and in unit tests.
- Port from the prototype (same project): `SocialLens/src/domain/analytics.ts` (`inWindow`, `contentTimeline`, `engagementSummary`, `summary`) and `SocialLens/tests/domain.test.mjs`.
- Ideas only (no code needed): `BS/bsky-analytics-app` (**MIT**) for period-over-period and top-content presentation — it publishes no formulas, which is the gap this module fills.
