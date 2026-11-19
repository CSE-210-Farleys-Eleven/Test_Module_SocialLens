# M4c `adapters/fixtures/` — contract

Frozen types and constants: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Fully synthetic sample data, shaped exactly like real `listRecords`, `describeRepo`, `getPosts` and DID-document responses, served through a `fetch` replacement. It powers demo mode and the integration tests.

## Contribution to the whole
Demo mode runs the **same** pipeline as live mode — the only difference is which `fetch` the HTTP client gets. That makes the demo honest (it exercises real pagination, coverage and failure handling) and makes end-to-end tests possible without the network. The fixture server also proves the negative: any request it does not recognise is recorded as `unexpected`, so "the demo makes no external request" is testable.

## What to optimise for (ranked)
1. **Fidelity of response shapes** — a client that works against the fixtures must work against a real PDS / AppView.
2. **Determinism** — same scenario → byte-identical responses; a manifest that is the ground truth.
3. Obvious syntheticness — no real handle, DID, text or person.

## Public API (`src/adapters/fixtures/index.ts`)
```ts
export const createFixtures: CreateFixtures;   // () => Fixtures
export { DEMO_ACCOUNT, DEMO_SCENARIO_IDS } from './contract';
```
- `fixtures.session` = `{ did: DEMO_ACCOUNT.did, source: 'demo' }`; `fixtures.now` = `DEMO_ACCOUNT.now`.
- `fixtures.scenarios` = three `DemoScenarioInfo` rows: `complete` "Complete sample", `partial` "Partial and unavailable reads", `empty` "Empty account" (each with a one-sentence description).
- `fixtures.manifest(scenario)` — ground truth, **computed from the same generator** that builds the responses (never hard-coded separately).
- `fixtures.createServer(scenario, options)` — a fresh, independent `FixtureServer` (own request log, own failure counters).

### Routes served by `FixtureServer.fetch(url, init)`
Only `GET` (or no method). If `init.signal` is aborted (before or during `latencyMs`) reject with `signal.reason`. Responses are real `Response` objects with `content-type: application/json`.

| URL | Response |
|---|---|
| `https://plc.directory/did:plc:demosyntheticaccount2222` | 200 DID document: `{ "@context": […], "id": <did>, "alsoKnownAs": ["at://synthetic-demo.example"], "verificationMethod": [synthetic], "service": [{ "id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": "https://pds.synthetic-demo.invalid" }] }` |
| `https://plc.directory/<any other did>` | 404 `{ "message": "DID not registered" }` |
| `<pds>/xrpc/com.atproto.repo.describeRepo?repo=<did>` | 200 `{ handle, did, didDoc, collections, handleIsCorrect }`; another repo → 400 `{ "error": "RepoNotFound" }` |
| `<pds>/xrpc/com.atproto.repo.listRecords?repo&collection&limit[&cursor]` | 200 `{ records: [{ uri, cid, value }], cursor? }`, newest first, honouring `limit` (1–100, default 50); cursor is an opaque string; no cursor on the last page; unknown collection → 200 `{ "records": [] }`; `limit` out of range → 400 `{ "error": "InvalidRequest" }` |
| `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=…` | 200 `{ posts: [postView] }` with `uri`, `cid`, `author: { did, handle }`, `record`, `likeCount`, `repostCount`, `replyCount`, `quoteCount`, `indexedAt`; unknown URIs are omitted; more than 25 `uris` → 400 `{ "error": "InvalidRequest" }` |
| anything else (other origin, other path, non-GET) | log `{ unexpected: true, status: null }` and **reject** with `TypeError('Fixture fetch: unexpected request')` |

Every call is appended to the log with `url`, `method`, `credentials` (as passed), `hadAuthorization`, `status`, `unexpected`.

### Scenarios (the manifest must match exactly)
Record bodies carry `$type`. Record keys are valid TIDs derived from each record's timestamp. CIDs are `bafyrei` + 52 chars of `[a-z2-7]` built from a counter. Subject DIDs are synthetic `did:plc:` values (24 chars of `[a-z2-7]`, e.g. prefixed `synthetic`). All text is invented, short and neutral; no names, no real handles, no links to real sites. All timestamps are ≤ `DEMO_ACCOUNT.now`.

**`complete`** — `handleIsCorrect: true`; advertises all 10 registered collections plus `app.bsky.graph.listblock` and `chat.bsky.actor.declaration` (→ `presentNotAnalysed`, sorted).

| Collection | Valid | Invalid | Pages (limit 100; 50 for documents) | Expected |
|---|---|---|---|---|
| `app.bsky.feed.post` | 120 (90 posts, 30 replies) | 0 | 2 | complete / ok |
| `app.bsky.feed.repost` | 12 | 0 | 1 | complete / ok |
| `app.bsky.feed.like` | 40 | 0 | 1 | complete / ok |
| `app.bsky.graph.follow` | 25 | 0 | 1 | complete / ok |
| `app.bsky.graph.block` | 3 | 0 | 1 | complete / ok |
| `app.bsky.graph.list` | 2 | 0 | 1 | complete / ok |
| `app.bsky.graph.listitem` | 6 | 0 | 1 | complete / ok |
| `app.bsky.actor.profile` | 1 (rkey `self`) | 0 | 1 | complete / ok |
| `site.standard.document` | 4 | 0 | 1 | complete / ok |
| `site.standard.publication` | 1 | 0 | 1 | complete / ok |

Total 214 records. Posts are spread over the 60 days ending at `now`, at least one per day for the last 5 days (a current streak ≥ 5), with ≥ 50 % of content items between 18:00 and 23:59 UTC (so the posting-time observation triggers), and exactly 2 posts within 36 h of `now` (settling). Some posts carry `#tags` (facets and/or `tags`). Exactly one post (the newest non-settling one) has the text `Is <b>this</b> shown as text? <img src=x onerror=alert(1)>` so the integration suite can prove text-only rendering. `getPosts` returns counters for all 120 (5 batches: 25, 25, 25, 25, 20); counters come from a simple arithmetic generator and include some genuine zeros. `expectedNormalizeSkips: 0`.

**`partial`** — `handleIsCorrect: false`; advertises post, repost, like, follow, block, profile, document, publication, plus `app.bsky.graph.listblock`. Lists and list-items are not advertised (→ `not-present`).

| Collection | Behaviour | Expected |
|---|---|---|
| `app.bsky.feed.post` | 1 page of 62 items: 60 valid envelopes (the 30th has no `text`) followed by 2 invalid items (one with another DID in its URI, one whose `value` is a string) | partial / records-rejected; accepted 60, rejected 2 |
| `app.bsky.feed.repost` | first request → 429 with `Retry-After: 0`, then 200 with 8 records | complete / ok |
| `app.bsky.feed.like` | page 1: 100 records + cursor; page 2: always 500 (`Retry-After: 0`) | partial / later-page-failed; accepted 100 |
| `app.bsky.graph.follow` | 1,050 records (11 pages of 100) | partial / page-cap at 10 pages; accepted 1,000 |
| `app.bsky.graph.block` | always 500 (`Retry-After: 0`) | unavailable / first-page-failed |
| `app.bsky.actor.profile` | 1 record | complete / ok |
| `site.standard.document` | 2 records | complete / ok |
| `site.standard.publication` | 1 record | complete / ok |

Scripted 5xx responses carry `Retry-After: 0` so the demo does not sit in backoff (backoff timing is unit-tested in `shared/`); a correct client therefore sends each failing request 3 times.

`getPosts`: 60 URIs → 3 batches (25, 25, 10). Batch 2 → always 500 with `Retry-After: 0` (25 `lookup-failed`, including the text-less post). Batch 3 → 200 but omits one post (`not-returned`). So `postsWithCounts: 34`, `postsWithUnknownCounts: 26`, `expectedCountBatches: 3`. `expectedNormalizeSkips: 1`.

**`empty`** — `handleIsCorrect: true`; `collections: []`. A correct client makes no `listRecords` and no `getPosts` request. Every count is an observed zero. `expectedCountBatches: 0`.

## Data received / sent
Receives a scenario id and options. Sends a `FetchLike`, a request log and a manifest. Emits nothing else — no timers except `latencyMs`, no real network, no storage.

## Error behaviour
`createServer` never throws for a valid scenario id. The fetch rejects only for aborted signals and unexpected requests (by design).

## Invariants this module must enforce
- I-10: no real personal record, handle or DID anywhere in this folder; the demo identity is exactly `DEMO_ACCOUNT`.
- The fixture fetch performs **no** real network I/O and never falls through to `globalThis.fetch`.
- Determinism: two servers for the same scenario return deep-equal JSON for the same request sequence.
- The manifest is derived from the same data the server serves.
- Shapes match the lexicons listed under "Hints".

## Out of scope
OAuth flows or token endpoints; a real PDS (`@atproto/dev-env` needs Docker — optional later); recorded real-account data (project rule); analytics expectations (the manifest states record/count ground truth only — tests of analytics rules live in `analytics/`).

## Dependencies
Types: `shared/contract`. Runtime: `shared` only if convenient (`parseIsoDateTime` for `fixtures.now`, `makeAtUri`); otherwise self-contained (it needs its own TID **encoder**, since `shared` only decodes). No other module — in particular do not import `registry/`; the collection list is written out here on purpose, so a registry change that forgets the fixtures fails an integration test.

## File layout
```
src/adapters/fixtures/
  contract.ts          (frozen)
  index.ts             createFixtures
  generator.ts         deterministic record / counter generation per scenario
  server.ts            routing, failure scripts, request log
  manifest.ts          manifest derived from generator output
  generator.test.ts
  server.test.ts
```

## Test plan (write these first)
**generator / manifest**
- every generated record URI is `at://<DEMO did>/<collection>/<rkey>` and every rkey decodes (via `tidToIsoDateTime`) to its `createdAt` second, except the profile's `self`.
- no generated string contains `bsky.social`, an `@` handle, or a host other than `*.example` / `*.invalid`.
- every timestamp is ≤ `DEMO_ACCOUNT.now` and parses with `parseIsoDateTime`.
- `complete` manifest totals: 214 valid records, 0 invalid, 120 posts with counts, 5 expected batches, `presentNotAnalysed` = the two extra NSIDs sorted.
- `complete`: exactly one post contains the markup-looking probe text; exactly 2 posts within 36 h of `now`; ≥ 50 % of content items in 18:00–23:59 UTC; a post on each of the last 5 UTC days.
- `partial` manifest: statuses and reason codes exactly as the table; 34 with counts, 26 unknown; `handleIsCorrect` false.
- `empty` manifest: no advertised collections, zero everywhere.
- `countTotals` equals the sum of the counters the server actually returns.
- generating twice yields deep-equal output.

**server**
- DID-document route returns the PDS service and `alsoKnownAs`.
- `describeRepo` returns all five required fields.
- `listRecords` for posts in `complete`: page 1 has 100 records and a cursor; page 2 (with that cursor) has 20 and no cursor; no URI repeats; order is newest first.
- `listRecords` honours `limit=50` (documents) and rejects `limit=101` with 400.
- `getPosts` with 25 URIs returns 25 post views each with the four counters; with 26 URIs → 400.
- `partial`: repost route returns 429 with `Retry-After: 0` once, then 200; like page 2 returns 500 every time; block route returns 500 every time; follow route serves 11 pages.
- `partial`: second `getPosts` call returns 500; third omits exactly one requested URI.
- a request to `https://example.org/`, to an unknown path on the PDS, or with `method: 'POST'` rejects with `TypeError` and is logged as `unexpected`.
- the log records `credentials: 'omit'` when passed and `hadAuthorization: true` if a header is sent.
- an aborted signal rejects with the signal's reason; with `latencyMs: 50` and fake timers, aborting at 10 ms rejects and nothing is served.
- two servers have independent logs and independent failure counters.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/adapters.md` (M4c) — replay real response *shapes* through a `fetch` mock, social-app style; no real personal records; keep `@atproto/dev-env` for optional Docker integration tests later.
- Pattern to adapt: `BS/social-app/src/state/session/__tests__/mock-fetch.ts` (**MIT**) — a routed `fetch` mock; adapt the idea, add a header comment if code is copied.
- Shapes to mirror (all **MIT**): `atproto/lexicons/com/atproto/repo/listRecords.json`, `describeRepo.json`; `atproto/packages/api/lexicons/app/bsky/feed/{getPosts,defs,post,like,repost}.json`, `graph/{follow,block,list,listitem}.json`, `actor/profile.json`; `BS/social-app/lexicons/site/standard/{document,publication}.json` (document requires `site`, `title`, `publishedAt`; publication requires `url`, `name`); `atproto/packages/common-web/src/tid.ts` and `util.ts` (`s32encode`) for the TID encoder.
- Prototype equivalent: `SocialLens/src/adapters/demo.ts` (builds a snapshot directly; this module instead serves HTTP-shaped responses).
