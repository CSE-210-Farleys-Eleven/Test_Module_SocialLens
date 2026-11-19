# M4a `adapters/atproto/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Read-only access to the signed-in person's own identity and repository: DID → DID document → PDS origin, `describeRepo`, and bounded, paginated `listRecords`.

## Contribution to the whole
This is where records enter the system and where three of the core promises are kept: **self-only** (nothing is read for a DID other than the session's), **missing is not zero** (every read reports `Coverage`), and **nothing is silently dropped** (every rejected item gets a reason). It is also the only module that may widen the HTTP origin allowlist, and only to origins derived from the authenticated DID's own identity chain.

## What to optimise for (ranked)
1. **Correctness of uncertainty** — coverage status, reason codes and counts must be exactly right in every failure path.
2. **Safety before I/O** — the self-only and origin checks run before any request.
3. **Bounded latency** — page cap, no unbounded loops, prompt cancellation.

## Public API (`src/adapters/atproto/index.ts`)
```ts
export const createAtprotoAdapter: CreateAtprotoAdapter;  // ({ http, clock }) => AtprotoAdapter
```

### `resolveIdentity({ session, did, signal })`
1. `checkSelf(session, did)`; on failure return it (`access-denied`) — **no request**.
2. `did:plc` → `GET https://plc.directory/<did>` (`ORIGINS.plcDirectory`; the DID is placed in the path as-is, it is already validated).
   `did:web` → host = the part after `did:web:`; `parseHttpsOrigin('https://' + host)` (failure → return it); `http.permitOrigin(origin, 'did-web-host')`; `GET https://<host>/.well-known/did.json`.
3. Validate the document: a JSON object whose `id === did`, else `invalid-response` ("The DID document does not match this account."). `service` must be an array containing an object with `type === 'AtprotoPersonalDataServer'` and `id` equal to `#atproto_pds` or `<did>#atproto_pds`, and a string `serviceEndpoint`; else `invalid-response` ("No PDS is listed for this account.").
4. `parseHttpsOrigin(serviceEndpoint)`; failure → `blocked-origin` ("This account's PDS address is not supported by SocialLens."). Success → `http.permitOrigin(pds, 'pds-from-did-document')`.
5. `claimedHandle` = `parseHandle` of the first `alsoKnownAs` string that starts with `at://` (prefix removed), else `null`.
6. HTTP failures are returned unchanged (a did:web CORS failure is `network`; the caller shows "could not verify").

### `describeRepo({ session, did, pdsOrigin, signal })`
`checkSelf` first. `GET <pds>/xrpc/com.atproto.repo.describeRepo?repo=<did>`. Require an object with `did === request.did` and an array `collections`; otherwise `invalid-response`. `handle` = `parseHandle(body.handle)` or `null`; `handleIsCorrect` = `body.handleIsCorrect === true`; `collections` = valid NSIDs, de-duplicated, sorted ascending; `invalidCollectionCount` = the rest. `didDoc` is ignored.

### `listCollection(request)` → always a `CollectionRead` (unless aborted)
Request URL: `<pds>/xrpc/com.atproto.repo.listRecords?repo=<did>&collection=<nsid>&limit=<pageSize>[&cursor=<cursor>]`. `reverse` is never sent (default order is newest first).

1. Guards, in order, each ending the call with **zero requests** and `coverage = { status: 'unavailable', reasonCode: 'first-page-failed', failure }`: `checkSelf` (`access-denied`); `pageSize` not an integer in 1–100 or `maxPages` not an integer in 1–`LIMITS.maxPagesPerCollection` (`validation`).
2. Loop for page = 1…`maxPages`; `signal.throwIfAborted()` before and after each request.
3. Page failure (`getJson` err, or body not `{ records: array, cursor?: string }`, or more than `pageSize` records → treat as `invalid-response`): stop. `pagesFetched > 0` → `partial` / `later-page-failed`; else `unavailable` / `first-page-failed`. Keep everything already accepted. Put the failure in `coverage.failure`.
4. For each item (`returned++`), first failing check wins, each producing a `SkippedRecord { stage: 'fetch' }` and `rejected++`:
   - not an object with string `uri`, string `cid` and a plain-object `value` → `malformed-envelope` (`uri` null unless it parses);
   - `parseAtUri(uri)` null → `invalid-uri`;
   - URI DID ≠ `request.did` → `foreign-owner`;
   - URI collection ≠ `request.collection` → `wrong-collection`;
   - `parseCid(cid)` null → `invalid-cid`.
   A URI already accepted in this read → `duplicates++` (not a rejection). Otherwise accept as `RawRecord` (`rkey` from the URI, `value` as received).
5. After a successful page: `onProgress` (if non-null). Then
   - no `cursor`, **or** the page had zero records → finished: `complete` / `ok` if `rejected === 0`, else `partial` / `records-rejected`;
   - `cursor` already seen in this read → `partial` / `repeated-cursor`;
   - page = `maxPages` and a cursor remains → `partial` / `page-cap`.
6. `coverage.reason` wording (exact, `{label}` is not available here, so use the NSID):
   - `ok`: "Pagination ended; every returned record was accepted."
   - `records-rejected`: "{rejected} returned record(s) failed checks and were set aside."
   - `page-cap`: "Stopped at the {maxPages}-page limit ({accepted} newest records read); older records were not read. Counts are lower bounds."
   - `repeated-cursor`: "The server repeated a page marker; reading stopped to avoid a loop. Counts are lower bounds."
   - `later-page-failed`: "A later page could not be read; {accepted} record(s) read before that are kept. Counts are lower bounds."
   - `first-page-failed`: "This collection could not be read. Its count is unknown, not zero."

(`not-present` coverage is created by the load controller, not here.)

## Data received / sent
Receives: `SessionRef`, `Did`, `HttpsOrigin`, `Nsid`, limits, an `AbortSignal`; untrusted JSON from `HttpClient`. Sends: `ResolvedIdentity`, `RepoDescription`, `CollectionRead { records: RawRecord[], rejected: SkippedRecord[], coverage: Coverage }`.

## Error behaviour
`resolveIdentity` / `describeRepo` resolve `Result`s. `listCollection` never fails — it reports through `coverage`. All three reject **only** when the caller's signal aborts (propagate the abort reason; publish nothing, call no callback afterwards). No method throws for malformed server data.

## Invariants this module must enforce
- I-1 self-only: every method checks `session.did === did` before any I/O.
- I-2 ownership: every accepted record's URI has the requested DID and the requested collection.
- I-5 a failed later page keeps accepted data and can never be `complete`.
- I-6 after abort: no resolve, no `onProgress`, no further request.
- I-3 origins: only `permitOrigin` values that came out of `parseHttpsOrigin` and out of this DID's document (or the did:web host itself).
- Read-only: only `GET` via `HttpClient`. There is no write method (open point 3).
- `returned === accepted + rejected + duplicates` always.

## Out of scope
Writes of any kind; authenticated requests; handle → DID resolution (DNS / well-known / `resolveHandle`); CAR export; record signature or CID verification; lexicon validation of record bodies (that is `normalize/`); caching; parallel page fetching; any DID other than the session's.

## Dependencies
Types: `shared/contract`. Runtime: `shared` (`checkSelf`, parsers, `buildXrpcUrl`, `makeFailure`, `ok`, `err`, `ORIGINS`, `LIMITS`). No other module. `http` and `clock` are injected.

## File layout
```
src/adapters/atproto/
  contract.ts          (frozen)
  index.ts             createAtprotoAdapter
  identity.ts          resolveIdentity + DID-document parsing
  repo.ts              describeRepo, listCollection
  identity.test.ts
  repo.test.ts
```
Tests use a hand-written fake `HttpClient` (a map from URL to queued `Result`s that records calls and `permitOrigin` calls). Do not import `adapters/fixtures` or the real `createHttpClient`.

## Test plan (write these first)
**resolveIdentity**
- rejects a target DID different from the session DID with `access-denied` and makes 0 requests.
- rejects a null-equivalent mismatch even when the PDS would be valid (0 requests).
- did:plc: requests `https://plc.directory/<did>` and returns the PDS origin and claimed handle.
- did:plc: permits the PDS origin with basis `pds-from-did-document`.
- did:web: permits `https://<host>` with basis `did-web-host`, then requests `/.well-known/did.json`.
- did:web network failure (CORS) is returned as `network` unchanged.
- document `id` mismatch → `invalid-response`.
- no `AtprotoPersonalDataServer` service → `invalid-response`; service with id `<did>#atproto_pds` is accepted.
- PDS endpoint `http://…`, with a port, an IP address, or `localhost` → `blocked-origin`, and `permitOrigin` is not called for it.
- `alsoKnownAs` missing, or without an `at://` entry, or with an invalid handle → `claimedHandle` null.
- abort during the request rejects with the abort reason.

**describeRepo**
- foreign DID → `access-denied`, 0 requests.
- returns handle, `handleIsCorrect`, sorted de-duplicated NSIDs.
- response `did` differs → `invalid-response`.
- `collections` not an array → `invalid-response`.
- invalid collection strings are counted in `invalidCollectionCount` and excluded.
- `handleIsCorrect` missing → false; handle `handle.invalid` is returned as a handle.

**listCollection**
- foreign DID → `unavailable` / `first-page-failed` with `access-denied`, 0 requests.
- `pageSize` 0 or 101, `maxPages` 0 or 11 → `unavailable` with `validation`, 0 requests.
- single page without cursor → `complete` / `ok`; counts add up.
- two pages (cursor then none) → second request carries `cursor`; `pagesFetched = 2`.
- request URL has `limit=<pageSize>` and no `reverse`.
- empty first page with no cursor → `complete`, 0 records (an observed zero).
- empty page **with** a cursor → `complete` (pagination ends).
- cap: 3 pages available, `maxPages: 2` → `partial` / `page-cap`, exactly 2 requests.
- repeated cursor → `partial` / `repeated-cursor`, no third request.
- page 1 fails (500) → `unavailable` / `first-page-failed`, `failure.kind = 'http'`, 0 records.
- page 2 fails after page 1 succeeded → `partial` / `later-page-failed`, page-1 records kept.
- page body without `records`, with a non-string cursor, or with more records than `pageSize` → treated as a failed page.
- item with missing `cid`, non-object `value` (string, array, null) → `malformed-envelope`.
- item whose URI has another DID → `foreign-owner`; another collection → `wrong-collection`; handle authority → `invalid-uri`; bad CID → `invalid-cid`.
- rejected items make a finished read `partial` / `records-rejected`, and `rejected.length === coverage.rejected`.
- duplicate URI across pages is counted in `duplicates`, kept once, and does not change `complete`.
- `returned === accepted + rejected + duplicates` in every case above.
- `onProgress` is called once per successful page with increasing `page`.
- abort between pages rejects; `onProgress` is not called afterwards and no further request is made.
- a rate-limited page (`rate-limited` failure from the client) on page 1 → `unavailable` with that failure preserved.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/adapters.md` — read records from the PDS (source of truth), 100 per page, explicit page cap, back off on 429 (the HTTP client does the backoff); no writes; no Clearsky or other network index. `accounts.md` — browser resolution can hit CORS for did:web; show "could not verify".
- Facts verified in the reference clones: `atproto/lexicons/com/atproto/repo/listRecords.json` (limit 1–100, default 50, `cursor`, `reverse`; output `{ cursor?, records: [{ uri, cid, value }] }`; "Does not require auth"), `describeRepo.json` (required `handle`, `did`, `didDoc`, `collections`, `handleIsCorrect`), `atproto/packages/pds/src/api/com/atproto/repo/listRecords.ts` (default order pages backwards = newest first), `atproto/packages/common-web/src/did-doc.ts` (`#atproto_pds`, `AtprotoPersonalDataServer`, `alsoKnownAs`), `atproto/packages/identity/src/did/web-resolver.ts` (`/.well-known/did.json`, did:web paths unsupported) — all **MIT**; adapt logic freely with a header comment.
- Port from the prototype (same project): `SocialLens/src/application/pagination.ts` (the loop, repeated-cursor guard, coverage wording) and `SocialLens/src/adapters/atproto.ts` (`discover`), plus the cases in `SocialLens/tests/pagination.test.mjs`.
- `pdsls/src/lib/api.ts` (0BSD) shows the same PDS-direct read pattern with atcute; do not add atcute.
