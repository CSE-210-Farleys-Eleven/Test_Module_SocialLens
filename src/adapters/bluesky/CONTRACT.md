# M4b `adapters/bluesky/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Fetch public interaction counters (likes, reposts, replies, quotes) for the person's **own** posts from the public Bluesky AppView, in batches of 25.

## Contribution to the whole
It is the only source of engagement numbers, and the AppView is an external dependency that can fail. This module turns every way that lookup can go wrong into an explicit `unknown` with a reason, so downstream code never mistakes a failed fetch for zero interactions.

## What to optimise for (ranked)
1. **Correctness of uncertainty** — unknown is never 0; one result per requested URI, always.
2. **Bounded latency** — sequential batches, circuit breaker after repeated failures.
3. Minimal data sent — only own post URIs leave the browser.

## Public API (`src/adapters/bluesky/index.ts`)
```ts
export const createBlueskyAdapter: CreateBlueskyAdapter;  // ({ http, clock }) => EngagementSource
```

### `getCounts({ session, uris, signal, onProgress })`
1. De-duplicate `uris`, keeping first-occurrence order. `requested` = number of distinct URIs.
2. Classify each: `parseAtUri` ok **and** DID === `session.did` **and** collection === `app.bsky.feed.post` → *sendable*; everything else → result `unknown / rejected-not-self` and it is never placed in any request URL.
3. Split the sendable URIs into consecutive batches of `LIMITS.getPostsBatchSize` (25). For each batch, in order: `signal.throwIfAborted()`; `GET https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=<u1>&uris=<u2>…` (`ORIGINS.appView`, built with `buildXrpcUrl`).
4. Batch success = `ok` body that is an object with an array `posts`. For each element that is an object with a string `uri` belonging to this batch (first occurrence wins; anything else is ignored): if `likeCount`, `repostCount`, `replyCount`, `quoteCount` are all non-negative safe integers → `known` with those counts and `observedAt = clock.now()`; otherwise `unknown / invalid-counts`. Batch URIs absent from `posts` → `unknown / not-returned`. `bookmarkCount`, `viewer`, `author`, `record` are ignored.
5. Batch failure (err, or malformed body): its URIs → `unknown / lookup-failed`; `batchesFailed++`. After `LIMITS.maxConsecutiveCountFailures` (2) consecutive failures stop: every URI in the remaining batches → `unknown / not-requested`, and those batches are not counted in `batches`. A success resets the consecutive counter.
6. `onProgress({ batch, batches })` after each attempted batch (not after abort).
7. Coverage: `known` / `unknown` counts over the distinct URIs; `batches` = attempted;
   - `requested === 0` → `complete`, reason "No posts to look up." (no request);
   - `known === requested` → `complete`, reason "Counters were read for every post.";
   - at least one batch succeeded → `partial`, reason "Counters are known for {known} of {requested} posts; the rest are unknown, not zero.";
   - otherwise → `unavailable`, reason "Counters could not be read. They are unknown, not zero.";
   - `failure` = the most recent batch failure, or `null`.

## Data received / sent
Receives own post `AtUri`s. Sends `EngagementLookup { results, coverage }` — exactly one `EngagementResult` per distinct requested URI, in request order; `engagement.status` is `'known'` or `'unknown'` (never `'not-available'`).

## Error behaviour
Never returns a failure and never throws for server data; rejects only when the caller aborts (no partial result is returned, no callback fires afterwards).

## Invariants this module must enforce
- I-1 self-only: a URI that is not the session DID's own post never appears in a request.
- I-7 missing ≠ zero: a counter that was not observed is `unknown`; `0` appears only when the AppView returned `0`.
- I-9 bounded: ≤ ⌈n / 25⌉ sequential requests, circuit breaker at 2 consecutive failures.
- I-12: only `app.bsky.feed.getPosts` on `ORIGINS.appView`. No `getProfile`, no follower counts, no `getLikes`/`getRepostedBy` (who interacted), no Clearsky / Constellation.
- `results.length === requested` and `known + unknown === requested`.

## Out of scope
Authenticated AppView calls; view/impression counts (none exist); bookmark counts; who liked/reposted; counts for other people's posts; counts for Standard.site documents; retries beyond what `HttpClient` already does; caching.

## Dependencies
Types: `shared/contract`. Runtime: `shared` (`parseAtUri`, `buildXrpcUrl`, `ORIGINS`, `LIMITS`). `http`, `clock` injected. No other module.

## File layout
```
src/adapters/bluesky/
  contract.ts        (frozen)
  index.ts           createBlueskyAdapter
  counts.ts          batching, parsing, coverage
  counts.test.ts
```
Tests use a hand-written fake `HttpClient`; do not import `adapters/fixtures`.

## Test plan (write these first)
- empty `uris` → 0 requests, `complete`, `requested = 0`.
- 1 own post URI → one request to `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts` with one `uris` param.
- 26 URIs → 2 requests of 25 and 1; 50 → 2; 51 → 3.
- counters `0,0,0,0` → `known` with zeros (an observed zero).
- `observedAt` equals the injected clock value.
- post missing `quoteCount` → `unknown / invalid-counts` (not zero).
- negative, fractional, string, or > `Number.MAX_SAFE_INTEGER` counter → `invalid-counts`.
- requested URI absent from `posts` → `not-returned`.
- response contains a URI that was not requested → ignored, no extra result.
- response repeats a URI → first occurrence wins.
- a URI of another DID → `rejected-not-self`, and no request URL contains it.
- a like URI of the own DID (`app.bsky.feed.like`) → `rejected-not-self`.
- all URIs foreign → 0 requests; every result is `rejected-not-self`; coverage is `unavailable` with `requested = n`, `known = 0`, `batches = 0`.
- duplicate URIs in the request → one result, one occurrence in the URL.
- results are in first-occurrence request order regardless of response order.
- batch 2 of 3 fails → its 25 are `lookup-failed`, batch 3 still requested; coverage `partial`, `batchesFailed = 1`, `failure` set.
- batches 1 and 2 fail → batch 3 is not requested; its URIs are `not-requested`; coverage `unavailable`; `batches = 2`.
- fail, succeed, fail, succeed → all four requested (consecutive counter resets).
- body without `posts` array → treated as a failed batch.
- `known + unknown === requested` and `results.length === requested` in every case.
- `onProgress` fires once per attempted batch with the right totals.
- abort before batch 2 → rejects, batch 2 never requested, no `onProgress` after abort.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/adapters.md` — batch `getPosts` in groups of 25; map AppView failure to "unknown", never 0; treat the AppView as an external dependency that can fail; do not call Clearsky; Constellation only ever behind a default-OFF flag (not in the MVP at all).
- Facts verified: `atproto/packages/api/lexicons/app/bsky/feed/getPosts.json` (`uris` maxLength 25; output `{ posts: postView[] }`) and `feed/defs.json#postView` (`likeCount`, `repostCount`, `replyCount`, `quoteCount`, `bookmarkCount` are all optional integers) — **MIT**. AppView rate limits and `bookmarkCount` population are **not verified**; hence the circuit breaker and the exclusion of bookmarks.
- Port from the prototype: `enrich` in `SocialLens/src/adapters/atproto.ts` and `readEngagement` in `SocialLens/src/domain/normalize.ts` (the prototype stops at the first failed batch; this contract continues until two consecutive failures).
- `BS/bsky-analytics-app` (MIT) is a source of stat ideas only; it authenticates with an app password — never do that.
