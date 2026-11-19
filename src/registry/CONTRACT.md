# M3 `registry/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md).

## Purpose
A static, versioned list of the apps SocialLens supports, the collections (NSIDs) each one writes, how each collection is normalised, how visible it is (with a citation), and what each app can and cannot tell us.

## Contribution to the whole
The registry is the single place that says what is analysed. Adapters read exactly the collections it lists; `normalize/` picks a mapper by `normalizerId`; analytics and the UI use the capability rows to say "not available on this app" instead of showing 0; privacy uses the visibility class and citation; and anything a repository advertises that is not listed surfaces as "present, not analysed" instead of being ignored.

## What to optimise for (ranked)
1. **Accuracy of every claim** — each visibility class has a real citation; no capability is overstated.
2. **Stability** — fixed order, fixed ids; a change bumps `version`.
3. Simplicity — plain data plus four lookups.

## Public API (`src/registry/index.ts`)
```ts
export const createRegistry: CreateRegistry;   // () => Registry
```
`createRegistry()` returns the same frozen data every time (`Object.freeze` deeply; calls may share one instance).

### The data (version `2026-11-18.1`)
Collections, **in this order** (it is the read order and the coverage-row order):

| # | nsid | app | label | normalizerId | kinds | timestampField | engagementSource | pageSize | visibilitySource |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `app.bsky.feed.post` | bluesky | Posts & replies | `bsky.post` | post, reply | createdAt | `bluesky-appview` | 100 | `bsky-privacy-policy` |
| 2 | `app.bsky.feed.repost` | bluesky | Reposts | `bsky.repost` | repost | createdAt | null | 100 | `atproto-blog-spaces` |
| 3 | `app.bsky.feed.like` | bluesky | Likes given | `bsky.like` | like | createdAt | null | 100 | `bsky-privacy-policy` |
| 4 | `app.bsky.graph.follow` | bluesky | Follows | `bsky.follow` | follow | createdAt | null | 100 | `bsky-privacy-policy` |
| 5 | `app.bsky.graph.block` | bluesky | Blocks | `bsky.block` | block | createdAt | null | 100 | `bsky-docs-following` |
| 6 | `app.bsky.graph.list` | bluesky | Lists | `bsky.list` | list | createdAt | null | 100 | `atproto-blog-spaces` |
| 7 | `app.bsky.graph.listitem` | bluesky | List memberships you created | `bsky.listitem` | list-item | createdAt | null | 100 | `atproto-blog-spaces` |
| 8 | `app.bsky.actor.profile` | bluesky | Profile | `bsky.profile` | profile | createdAt | null | 100 | `atproto-blog-spaces` |
| 9 | `site.standard.document` | standard-site | Documents | `standard.document` | document | publishedAt | null | 50 | `atproto-blog-spaces` |
| 10 | `site.standard.publication` | standard-site | Publications | `standard.publication` | publication | null | null | 100 | `atproto-blog-spaces` |

All ten are `visibility: 'public-repo'`. Documents use page size 50 because their bodies can be large (keeps a page under `LIMITS.httpMaxResponseBytes`).

Apps, in this order:

| id | displayName | source | engagementCounts | metrics | unavailable (each with reason) |
|---|---|---|---|---|---|
| `bluesky` | Bluesky | `bsky-privacy-policy` | true | every id in `METRIC_IDS` | `impressions`, `reach`, `follower-growth`, `unfollows`, `who-blocks-me`, `bookmarks` (reasons from GLOSSARY.md Part B) |
| `standard-site` | Standard.site | `standard-site` | false | all `records.*`, `content.items`, all `activity.*` | every `engagement.*` id: "Standard.site has no public interaction counters, and SocialLens does not query network indexes."; plus `impressions`, `reach` |

`history` (both): "Records that are in your repository now, newest first, up to 1,000 per collection. Deleted records are gone." `freshness`: Bluesky — "Records are read live from your PDS. Counters come from the public Bluesky API (cached for about 30 seconds) and are flagged 'settling' for posts under 36 hours old."; Standard.site — "Records are read live from your PDS."

`kindLabels`: the alias table in GLOSSARY.md.

`nonRepoData` (3 rows): Mutes — `private-app`, `bsky-docs-following`, "Mutes are stored by the Bluesky app, not in your public repository, so SocialLens cannot and does not read them."; Direct messages — `private-service`, `bsky-privacy-policy`, "Direct messages are not public records (and are not end-to-end encrypted)."; Permissioned spaces — `future-permissioned`, `atproto-blog-spaces`, "Access-controlled data is in alpha; SocialLens reads only public records."

### Lookups
- `app(id)` — the definition (total: `AppId` is a closed union).
- `collection(nsid)` — exact, case-sensitive match; `null` otherwise (any string is accepted).
- `analysedCollections()` — `data.collections`.
- `inventory(advertised)` — keep strings that are syntactically valid NSIDs (use `parseNsid` from `shared`), de-duplicate; `present` = registered ∩ advertised in registry order; `absent` = registered − advertised in registry order; `presentNotAnalysed` = advertised − registered, sorted ascending.

## Data received / sent
Receives nothing but lookups. Sends `RegistryData` (plain, structured-cloneable; it is posted to the Worker) and the `Registry` port.

## Error behaviour
Never throws. Unknown NSID → `null`. Invalid advertised strings are dropped from `inventory` (the adapter already counts them).

## Invariants
- Every `CollectionDefinition.appId` exists in `apps`, and every app's `collections` lists exactly its definitions' NSIDs in order.
- Every `visibilitySource` / `source` is a key of `SOURCES`; every `metricId` is in `METRIC_IDS` or `UNAVAILABLE_METRIC_IDS`.
- `normalizerId` values are unique; `pageSize` is 1–100; NSIDs are unique.
- No collection for anything that is not a public repo record; `app.bsky.graph.listblock` is **not** registered (it then shows as "present, not analysed").
- I-12: the data contains no network index or "who blocks me" source.

## Out of scope
Dynamic lexicon resolution; reading lexicon JSON; more apps (needs an ADR-001 scope decision); writes; schema validation of records.

## Dependencies
Types from `shared/contract`. Runtime: `parseNsid` from `shared`. No other module.

## File layout
```
src/registry/
  contract.ts       (frozen)
  index.ts          createRegistry
  data.ts           the frozen RegistryData literal
  registry.test.ts
```

## Test plan (write these first)
- data lists exactly the 10 collections above in order, 8 for bluesky and 2 for standard-site.
- every collection is `public-repo` and cites an existing `SOURCES` key.
- only `app.bsky.feed.post` has an engagement source.
- `site.standard.document` uses `publishedAt` and page size 50; `site.standard.publication` has no timestamp field.
- every `METRIC_IDS` entry appears in bluesky's `metrics`; no `engagement.*` id appears in standard-site's `metrics`; every `engagement.*` id appears in standard-site's `unavailable` with a non-empty reason.
- `collection('app.bsky.feed.post')` returns the definition; `collection('app.bsky.graph.listblock')`, `collection('APP.BSKY.FEED.POST')` and `collection('')` return null.
- `inventory([])` → all 10 absent, nothing present.
- `inventory(['app.bsky.feed.post', 'app.bsky.graph.listblock', 'chat.bsky.actor.declaration', 'site.standard.document'])` → present = [post, document] in registry order; presentNotAnalysed = the two unregistered NSIDs sorted; absent = the other 8.
- `inventory` ignores duplicates and invalid strings (`'not an nsid'`, `''`).
- data is deeply frozen (assigning to a nested field throws in strict mode) and JSON-round-trips unchanged (structured-cloneable).
- `nonRepoData` has the three rows and none is `public-repo`.
- two `createRegistry()` calls return equal data.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/registry.md` — static versioned entry `{appId, displayName, collections, normalizerId}`; `site.standard.*` as one long-form group; a capability row per app to hide unsupported cards rather than show 0; visibility class + citation per collection; discover with `describeRepo` and show unregistered collections as "present, not analysed". Avoid dynamic lexicon resolution, silent coverage caps, and WhiteWind's AGPL code.
- Shapes verified in the reference clones: `atproto/packages/api/lexicons/app/bsky/{feed,graph,actor}/*.json` (MIT) and `BS/social-app/lexicons/site/standard/{document,publication}.json` (MIT). Nothing needs to be copied; the registry stores NSIDs and labels only.
- Prototype equivalent: the `COLLECTIONS` map in `SocialLens/src/domain/model.ts`.
