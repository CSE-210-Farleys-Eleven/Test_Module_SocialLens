# SocialLens mini MVP — metric glossary and privacy observation catalogue

Glossary version: **`2026-11-18.1`** (use this string as `Glossary.version`; bump it on any wording or formula change).

This file is the single source for:

- `GLOSSARY` in `src/shared/` (the `shared` implementer transcribes Part A and Part B into `Glossary` data, one `MetricDefinition` per row, ids exactly as in `METRIC_IDS` / `UNAVAILABLE_METRIC_IDS`);
- the calculation rules `src/analytics/` must implement (Part A, "Rule");
- the catalogue `src/analytics/privacy/` must implement (Part C);
- the wording `src/ui/` shows.

Source ids (`bsky-docs-following`, …) refer to `SOURCES` in `src/shared/contract.ts`; the URLs come from `SocialLens/docs/research/modules/*.md` (checked 2026-11-18; see Part D for two file-level refinements).

## Conventions used by every metric

| Term | Meaning |
|---|---|
| **N** | `snapshot.fetchedAt`, the single reference "now". Nothing reads a clock. |
| **UTC** | Every day, hour and weekday is computed in UTC and labelled "UTC". No timezone is inferred. |
| **Dated record** | `createdAt !== null` and `createdAt <= N`. |
| **Undated record** | `createdAt === null`. **Future-dated**: `createdAt > N`. Both are treated as "no usable time". |
| **Content item** | A record of kind `post`, `reply` or `document` (`CONTENT_KINDS`). |
| **Outbound record** | A record of kind `repost`, `like`, `follow`, `block` or `list-item` (`OUTBOUND_KINDS`). |
| **Range** | `7d` / `30d` / `90d`: from 00:00:00.000Z of the day `(date(N) − (days − 1))` up to and including N. `all`: every analysed record, including undated and future-dated ones. Bounded ranges contain dated records only. |
| **Time semantics** | "Posts published in the range, with their lifetime counts". Interactions are **not** attributed to the day they happened (that would need other people's records). |
| **Pooled** | Ratios are Σ numerator ÷ Σ denominator over the whole set — never a mean of per-post ratios. |
| **Interactions** | `likes + reposts + replies + quotes` of one post, as reported by the public AppView. Bookmarks are excluded. Your own replies/likes on your own posts are included, because public counters cannot separate them. |
| **Known post** | A post/reply whose `engagement.status === 'known'` (all four counters observed as non-negative integers). |
| **Settling post** | A known post with `0 <= N − createdAt < 36 h` (`LIMITS.settlingHours`). A heuristic borrowed from X's documented settling period (source `x-post-settling`); it is not an AT Protocol guarantee. |

### Status of a value (`MetricValue.status`)

For a metric whose contributing collections are the set **C** (each collection has one `Coverage` row; a missing row counts as `unavailable`; "has skipped" means at least one `SkippedRecord` for that collection):

| Status | Rule (first match wins) | Printed as |
|---|---|---|
| `not-available` | No app with a source for this metric has any analysed collection (engagement on Standard.site). | "Not available on this app" |
| `unknown` | Every collection in C is `unavailable`; or the metric is a ratio whose denominator is 0; or it is an engagement total with eligible posts > 0 and known posts = 0. `value` is `null`. | "Unknown" |
| `partial` | Any collection in C is `partial` or `unavailable`, or has skipped records; for engagement metrics also when known posts < eligible posts. Counts get `isLowerBound: true` ("At least N"); ratios and shares get `isLowerBound: false` ("N", label "Partial"). | "At least N" / "N · Partial" |
| `settling` | Engagement metrics only: none of the above, and at least one settling post contributed. | "N · Settling" |
| `exact` | Otherwise. An exact `0` is an observed zero. | "N" (label "Observed zero" when N = 0) |

`reason` is a plain sentence naming the cause (e.g. "Likes stopped at the 10-page limit; older records were not read."). `contributingApps` lists apps that own at least one collection in C.

Refinement deliberately **not** done in the MVP: a bounded range could be exact even when a collection hit the page cap (records arrive newest-first), if the oldest fetched record is older than the range start. The MVP labels it `partial` anyway (simple, never over-claims). Open point for issue #3.

## Part A — metrics shown

`Apps` = contributing apps. `Overview` = shared by all supported apps, so allowed on the Overview.

| id | Label | Rule (formula) | Denominator | Includes | Excludes | Apps | Overview | Unit |
|---|---|---|---|---|---|---|---|---|
| `records.total` | Records analysed | Count of analysed records in the range. | — | Every kind from every registered collection. For `all`: undated and future-dated records too. | Skipped records; collections that are present but not analysed; deleted records. | Bluesky, Standard.site | yes | count |
| `records.byKind` | Records by type | Count of in-range records per `RecordKind` (11 rows, fixed order, zero rows shown). | — | One collection per kind (`post` and `reply` both come from `app.bsky.feed.post`). | As above. | Bluesky, Standard.site | no | count |
| `records.byApp` | Records by app | Count of in-range records per app. | — | All kinds of that app. | As above. | Bluesky, Standard.site | no | count |
| `content.items` | Content items published | Count of in-range records of kind `post`, `reply` or `document`. | — | Posts, replies, Standard.site documents. | Reposts, likes, follows, blocks, lists, profile, publications. | Bluesky, Standard.site | yes | count |
| `activity.activeDays` | Active days | Number of distinct UTC dates with ≥ 1 dated content item in the range. | — | Dated content items. | Undated/future-dated items; outbound records. | Bluesky, Standard.site | yes | days |
| `activity.dailyTimeline` | Daily timeline (UTC) | One row per UTC day in the range, zero-filled, ending at date(N): content items per app, and outbound records. For `all`: from the earliest dated content/outbound record to date(N), keeping at most the latest 366 days (`truncated: true` when cut). No dated record → no rows. | — | Dated content and outbound records. | Undated/future-dated records; lists, profile, publications. | Bluesky, Standard.site | no | series |
| `activity.hourHistogram` | Posting hours (UTC) | 24 bins (00–23): in-range dated content items by UTC hour of `createdAt`. | — | Dated content items. | Everything else. | Bluesky, Standard.site | no | series |
| `activity.weekdayHistogram` | Posting weekdays (UTC) | 7 bins (Mon = 0 … Sun = 6): in-range dated content items by UTC weekday. | — | Dated content items. | Everything else. | Bluesky, Standard.site | no | series |
| `activity.streak.current` | Current posting streak | Let D = set of UTC dates with ≥ 1 dated content item (all time, ignores the range). If date(N) ∈ D: length of the run of consecutive dates ending at date(N). Else if date(N) − 1 ∈ D: the run ending at date(N) − 1 (today is not over yet). Else 0. | — | Dated content items, all time. | Outbound records. | Bluesky, Standard.site | no | days |
| `activity.streak.longest` | Longest posting streak | Longest run of consecutive dates in D (ties: the most recent run). 0 when D is empty. | — | As above. | As above. | Bluesky, Standard.site | no | days |
| `activity.weekOverWeek` | Week over week | Current week = the 7 UTC dates ending at date(N); previous week = the 7 dates before. Each side = content items in that window. `delta = current − previous`; `deltaFraction = delta ÷ previous`, `null` when previous = 0. Ignores the selected range. | previous week's count (for the fraction) | Dated content items. | Outbound records. | Bluesky, Standard.site | no | count |
| `engagement.likes` | Likes received | Σ `likes` over known posts in range. | — | Posts and replies you wrote, with known counters. | Posts with unknown counters; likes you gave; Standard.site. | Bluesky | no | count |
| `engagement.reposts` | Reposts received | Σ `reposts` over known posts in range. | — | As above. | As above; quotes are counted separately. | Bluesky | no | count |
| `engagement.replies` | Replies received | Σ `replies` over known posts in range. | — | As above (includes your own replies to yourself). | As above. | Bluesky | no | count |
| `engagement.quotes` | Quotes received | Σ `quotes` over known posts in range. | — | As above. | As above. | Bluesky | no | count |
| `engagement.interactions` | Interactions received | Σ (likes + reposts + replies + quotes) over known posts in range. | — | As above. | Bookmarks, views, clicks (not public). | Bluesky | no | count |
| `engagement.interactionsPerPost` | Interactions per post | **Pooled**: `engagement.interactions ÷ knownPosts`. `numerator`/`denominator` carry both numbers. | Known posts in range (not all posts, not followers, not views) | Posts and replies with known counters. | Posts with unknown counters are left out of numerator **and** denominator. | Bluesky | no | per-post |
| `engagement.knownShare` | Posts with known counts | `knownPosts ÷ eligiblePosts`, where eligible = in-range posts + replies. | Eligible posts in range | — | — | Bluesky | no | share |
| `engagement.topPosts` | Top posts | Known posts in range ordered by interactions (desc), then `createdAt` (desc, undated last), then URI (asc); first 5. | — | Posts and replies with known counters. | Posts with unknown counters. | Bluesky | no | ranking |

Notes the UI must show next to engagement numbers:

- "Interactions per post" is **not** an engagement rate: there is no exposure number (views, reach) to divide by.
- Counters are a point-in-time read of a public cache; they can differ slightly from the Bluesky app.
- Standard.site rows say "Not available on this app" — never 0.

### Display aliases

| Kind | Bluesky | Standard.site |
|---|---|---|
| `post` | Post | — |
| `reply` | Reply | — |
| `repost` | Repost | — |
| `like` | Like given | — |
| `follow` | Follow | — |
| `block` | Block | — |
| `list` | List | — |
| `list-item` | List membership you created | — |
| `profile` | Profile | — |
| `document` | — | Document |
| `publication` | — | Publication |

## Part B — metrics deliberately not shown

| id | Label | Reason | Would require |
|---|---|---|---|
| `impressions` | Impressions / views | Not available from public records: no public view counter exists. | Data only the platform has. |
| `reach` | Reach | Not available from public records. | Data only the platform has. |
| `engagement-rate` | Engagement rate | There is no exposure denominator, so any "rate" would be invented. SocialLens shows "Interactions per post" instead and says what it divides by. | Impressions or reach. |
| `follower-growth` | Follower growth | Unknown: your repository holds only records you created. Follows of you live in other people's repositories and the profile API returns only the current total. | A history service that stores snapshots over time (out of scope: no backend, no history store). |
| `unfollows` | Unfollows | Unknown: a deleted follow record disappears. | A history service. |
| `who-blocks-me` | Who blocks me | Deliberately excluded. It needs a network-wide index of other people's records, and SocialLens is self-only. | A network index (Clearsky, Constellation) — never called. |
| `bookmarks` | Bookmarks received | Not shown: whether the public counter is populated for non-viewers was not verified. | Verification against the live API. |
| `best-time-to-post` | Best time to post | Not shown: without exposure data it would only restate when you already post. The posting-hours chart shows that directly. | Exposure data. |
| `cross-app-score` | Overall score | Deliberately excluded: no opaque or weighted score, and no single score across apps. | — |

## Part C — privacy observation catalogue

Every observation has **evidence** (count, up to 3 sample AT-URIs of the person's *own* records, earliest/latest timestamp), a **source**, a **limitation** and an **action**. Rules common to all:

- Evidence uses all fetched records (it ignores the date range).
- `evidence.count` certainty: `exact` when every contributing collection is `complete` with nothing skipped; `lower-bound` when any is `partial`, `unavailable` or has skipped records; `unknown` (count `null`) only for `handle-validity`, which has no record count.
- Sample URIs: newest first by `createdAt` (undated last), ties by URI ascending; at most `LIMITS.sampleUris` (3).
- Sample URIs are the person's own record URIs. The **subject** of a follow, block or list-item (another account's DID or handle) is never shown, listed or counted per account.
- `summary` starts with "In this synthetic example, " in demo mode and "In the records fetched, " in live mode.
- An observation whose trigger is false appears in `notTriggered` with the stated reason. `observations.length + notTriggered.length === 8` always.
- For the four record observations (`public-likes`, `public-follows`, `public-blocks`, `public-lists`): if **every** contributing collection is `unavailable`, the observation is **not triggered** with reason "The <label> collection could not be read, so this was not assessed." (`<label>` = the registry label of the first contributing collection; the gap is reported by `incomplete-coverage` instead). If only some are unavailable (possible for `public-lists` only), it is evaluated on what was read and its count is a `lower-bound`.
- `cross-app-identity` and `posting-time-pattern` are evaluated on whatever was read; they never claim more than the fetched records show.

| id | Title | Trigger | Evidence | Source id | Limitation | Action |
|---|---|---|---|---|---|---|
| `public-likes` | Your likes are public records | ≥ 1 record of kind `like`. | count = like records; samples; earliest/latest; collections = `app.bsky.feed.like`. | `bsky-privacy-policy` | "The Bluesky app does not show other people a list of your likes, but each like is a public record that any software can read. SocialLens shows only what it fetched and cannot tell who has read these records. Removing a like deletes the record; copies may remain in third-party indexes." | "Open a sample record to see exactly what is published. Unlike anything you would not want publicly tied to this account." |
| `public-follows` | Your follows are public records | ≥ 1 record of kind `follow`. | count = follow records; samples; earliest/latest; collections = `app.bsky.graph.follow`. | `bsky-privacy-policy` | "This counts follow records you created. It says nothing about who follows you, and the date on each record shows when you followed." | "Review who you follow if the list itself could reveal something you want to keep private; unfollowing deletes the record." |
| `public-blocks` | Your blocks are public records | ≥ 1 record of kind `block`. | count = block records; samples; earliest/latest; collections = `app.bsky.graph.block`. | `bsky-docs-following` | "This is only about blocks you created. SocialLens does not look up who blocks you. Blocking an account does not hide the fact that you blocked it." | "If you want to stop seeing an account without publishing that fact, unblock and mute instead: mutes are private and are not stored in your public repository." |
| `public-lists` | Lists you created are public records | ≥ 1 record of kind `list` or `list-item`. | count = list + list-item records; details: "Lists" → n, "List memberships you created" → m; samples drawn from both; collections = the two list collections. | `atproto-blog-spaces` | "This covers lists you made and the accounts you added to them. Lists that other people put you on are not looked up." | "Check list names and descriptions: they are public text. Remove entries or delete lists you no longer want published." |
| `cross-app-identity` | One identity links your activity across apps | Records from ≥ 2 distinct apps are present. | count = number of apps (exact); details: one row per app "→ n records"; samples: the newest record of each app; collections = all collections with ≥ 1 record. | `atproto-blog-spaces` | "The shared repository links these records to each other. It does not link them to other accounts or to a real-world identity." | "Use a separate account when you need a separate public context; using a different app with the same account does not separate anything." |
| `posting-time-pattern` | Your posting times form a visible pattern | ≥ 10 dated content items (`patternMinItems`) **and** the busiest 6-hour UTC band (00–05, 06–11, 12–17, 18–23; ties → earliest band) holds ≥ 40 % of them (`patternShareThreshold`). | count = items in the busiest band; details: "Busiest band" → "18:00–23:59 UTC", "Share" → "62% of 54 dated items"; samples from that band; collections = content collections. | `atproto-blog-spaces` | "Timestamps are written by the app you post with and can be scheduled or imported. This pattern is not evidence of a time zone, location, sleep schedule or job." | "Treat post times as part of what you publish. Do not rely on timing to hide where you are." |
| `handle-validity` | Your handle could not be confirmed | `account.handleStatus !== 'valid'`. | count = `null` (`unknown`); no samples; details: "Handle" → handle or "none", "Status" → "invalid" / "unverified", "Checked by" → "your PDS (describeRepo)" / "not checked". | `atproto-spec-handle` | "SocialLens relies on your PDS's own check and did not query DNS itself. Your DID, not your handle, is what identifies the account." | "Check the handle's DNS or well-known setup in your account settings, then reload." |
| `incomplete-coverage` | This view is not your whole footprint | Any collection coverage is not `complete`, **or** engagement coverage is not `complete`, **or** ≥ 1 record was skipped, **or** `inventoryStatus === 'unknown'`, **or** ≥ 1 collection is present but not analysed. | count = number of affected collections (exact); details: one row per affected collection "→ <coverage.reason>", plus "Skipped records" → n, "Present, not analysed" → n; no samples; collections = affected collections. | `lexicon-list-records` | "An absence here is not evidence that a record is private or does not exist. Other apps, deleted records and copies held elsewhere are not evaluated." | "Read the coverage table on the Accounts view and reload to retry a failed read." |

Not-triggered reasons (exact wording): `public-likes` "No like records were fetched." · `public-follows` "No follow records were fetched." · `public-blocks` "No block records were fetched." · `public-lists` "No list records were fetched." · `cross-app-identity` "Records from only one app were fetched." · `posting-time-pattern` "Fewer than 10 dated content items were fetched." or "No 6-hour UTC band holds 40% or more of your dated content items." · `handle-validity` "Your PDS confirms the handle resolves to this account." · `incomplete-coverage` "Every analysed collection was read completely."

Things the Privacy view lists as **not assessed** (from `RegistryData.nonRepoData`): mutes (`private-app`, source `bsky-docs-following`), direct messages (`private-service`, source `bsky-privacy-policy`), permissioned spaces (`future-permissioned`, source `atproto-blog-spaces`).

What the catalogue never contains: who blocks or follows the person, any score, any inference about location, identity, health or personality, any statement that "users do not know" something (unproven; a hypothesis for the user study).

## Part D — cited sources (`SOURCES`)

URLs are taken from `SocialLens/docs/research/modules/*.md` (checked by the research on 2026-11-18). Two are file-level refinements of a folder the research links (`lexicon-list-records`, `lexicon-describe-repo`): the files were verified in the local `atproto` clone at that path, but those exact URLs were not fetched. `src/shared/contract.ts` is authoritative; this table is a readable copy.

| Source id | Title | Publisher | URL |
|---|---|---|---|
| `atproto-blog-blocks` | Block implementation (2023-06-08) | AT Protocol blog | https://atproto.com/blog/block-implementation |
| `atproto-discussion-private-blocks` | Discussion #1131: public blocks | bluesky-social/atproto | https://github.com/bluesky-social/atproto/discussions/1131 |
| `bsky-docs-following` | Bluesky API: following, blocks and mutes | Bluesky documentation | https://bsky.network/docs/bluesky-api/following |
| `bsky-privacy-policy` | Privacy Policy (updated 2025-08-14) | Bluesky Social PBC | https://bsky.social/about/support/privacy-policy |
| `atproto-blog-spaces` | AT Protocol Spaces alpha (2026-08-20) | AT Protocol blog | https://atproto.com/blog/atproto-spaces-alpha |
| `atproto-spec-handle` | Handle specification | AT Protocol | https://atproto.com/specs/handle |
| `atproto-spec-oauth` | OAuth specification | AT Protocol | https://atproto.com/specs/oauth |
| `oauth-client-browser-readme` | @atproto/oauth-client-browser README (handle resolver caution) | bluesky-social/atproto | https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client-browser |
| `bsky-rate-limits` | Rate limits | Bluesky documentation | https://bsky.network/docs/rate-limits |
| `lexicon-list-records` | Lexicon com.atproto.repo.listRecords | bluesky-social/atproto | https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/listRecords.json |
| `lexicon-describe-repo` | Lexicon com.atproto.repo.describeRepo | bluesky-social/atproto | https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/describeRepo.json |
| `lexicon-get-posts` | Lexicon app.bsky.feed.getPosts | bluesky-social/atproto | https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/getPosts.json |
| `standard-site` | Standard.site lexicons | standard.site | https://standard.site |
| `x-post-settling` | Post activity dashboard (metrics settle within 36 hours) | X Business Help | https://business.x.com/en/help/campaign-measurement-and-analytics/tweet-activity-dashboard |
