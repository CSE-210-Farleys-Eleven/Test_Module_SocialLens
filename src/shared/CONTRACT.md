# M8 `shared/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md). Glossary content: [`docs/architecture/GLOSSARY.md`](../../docs/architecture/GLOSSARY.md).

## Purpose
The small pieces every module uses: branded identifier types, failures as data, the cross-module data model, one bounded HTTP client, the metric glossary, cited sources and limits.

## Contribution to the whole
`shared/` is the only module whose **runtime** code other modules may import. It is therefore the vocabulary that lets 13 modules plug together: if two modules disagree about what a `Did`, a `Coverage` or a `Failure` is, the app does not compose. It also owns the one network path for public data (`createHttpClient`), which is where "bounded, read-only, unauthenticated" is enforced.

## What to optimise for (ranked)
1. **Correctness and strictness of validation** — a branded value must really be valid; a blocked origin must really send nothing.
2. **Bounded waits** — every request has a deterministic worst case.
3. **Zero surprises for consumers** — pure functions, no hidden state, no throwing for expected failures.

## Public API
`src/shared/index.ts` must `export * from './contract'` and export one value per member of `SharedApi`, with exactly those names and types. End the file with a `satisfies SharedApi` check over an object of all the exports.

| Export | Behaviour |
|---|---|
| `ok(value)` / `err(failure)` | Build a `Result`. |
| `makeFailure(kind, message, extra?)` | Build a `Failure`; unspecified `status`, `xrpcError`, `retryAfterMs`, `origin` are `null`. |
| `isAbortError(e)` | True for `DOMException` named `AbortError` or `TimeoutError`, and for any error whose `name` is `'AbortError'`. |
| `parseDid(v)` | `did:plc:` + exactly 24 chars of `[a-z2-7]`; or `did:web:` + a hostname that passes the `parseHttpsOrigin` host rules, with **no** `:` path segments and no `%3A` port. Anything else → `null`. Max length 2048. |
| `didMethodOf(did)` | `'plc'` or `'web'`. |
| `parseHandle(v)` | Trim, lower-case, then handle syntax (labels of `[a-z0-9-]`, 1–63 chars, no leading/trailing hyphen, ≥ 2 labels, TLD starts with a letter, ≤ 253 chars). No leading `@`. Syntax only: `handle.invalid` parses; TLD policy is not applied. |
| `parseNsid(v)`, `parseRecordKey(v)` | Per the atproto syntax rules (record key: 1–512 chars of `[A-Za-z0-9._:~-]`, not `.` or `..`). |
| `parseCid(v)` | Lenient: 8–256 chars of `[A-Za-z0-9]`. Not a multihash check. |
| `parseAtUri(v)` | Exactly `at://<did>/<nsid>/<rkey>`; DID authority only; no query or fragment; ≤ 8 KB. Returns the parts. |
| `makeAtUri(did, collection, rkey)` | Concatenate. |
| `parseHttpsOrigin(v)` | Accept a string that parses as a URL with protocol `https:`, no username/password, no explicit port, path `""` or `/`, no query, no fragment. Reject hostnames that are: single-label, `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`, an IPv4 literal, or a bracketed IPv6 literal. Return `ok('https://<lower-case host>')` or `err('blocked-origin')` with `origin` set to the input when it is a string. |
| `parseIsoDateTime(v)` | Accept only `YYYY-MM-DDTHH:mm:ss(.fraction)?(Z|±HH:mm)` with a real calendar date (reject Feb 30, month 13, hour 24) and year 1970–9999; return `new Date(ms).toISOString()`. No zone → `null`. |
| `isoDateOf(instant)` | First 10 characters. |
| `tidToIsoDateTime(rkey)` | If `rkey` is 13 chars of `234567abcdefghijklmnopqrstuvwxyz`: decode the first 11 chars as a base-32-sortable integer of **microseconds** since the epoch → instant. Return `null` when not a TID or outside 2005-01-01…2100-01-01. |
| `checkSelf(session, target)` | `ok(target)` iff `session !== null && session.did === target`; else `err('access-denied')` with message "Analysis is limited to the signed-in account." |
| `createHttpClient(deps)` | See below. |
| `buildXrpcUrl(origin, method, params)` | `<origin>/xrpc/<method>?…` via `URLSearchParams`, parameters in insertion order, arrays as repeated keys, numbers/booleans stringified. No trailing `?` when there are no params. |
| `citation(sourceId)` | Copy of the `SOURCES` entry plus `sourceId`. |
| `statusLabelFor(value)` | `not-available`→`'not-available'`; `unknown`→`'unknown'`; `partial`→`'partial'`; `settling`→`'settling'`; `exact` with `value === 0`→`'zero'`; else `'known'`. |
| `GLOSSARY`, `metricDefinition(id)` | Data transcribed from GLOSSARY.md Parts A and B; one definition per `METRIC_IDS` / `UNAVAILABLE_METRIC_IDS` entry, same order. |
| `systemClock`, `realSleep` | `Date`-based clock (`nowMs` may use `performance.now()`); `setTimeout`-based abortable sleep. The only impure exports. |

### `createHttpClient(deps).getJson({ url, signal })`
1. `signal.throwIfAborted()`.
2. Parse `url`. Refuse (`err('blocked-origin')`, **`fetch` not called**) unless: protocol `https:`, no credentials, no fragment, and `URL.origin` is in `deps.fixedOrigins` or was passed to `permitOrigin`.
3. Up to `1 + maxRetries` attempts. Per attempt, an `AbortController` that aborts when the caller's signal aborts **or** when `deps.sleep(timeoutMs, attemptSignal)` resolves (build the timeout from the injected `sleep`, never `AbortSignal.timeout`, so tests control time). Call `deps.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal })`.
4. Fetch rejected: caller aborted → rethrow the caller's `signal.reason`; our timeout → `err('timeout')`; otherwise `err('network')`. **No retry** for network errors or timeouts.
5. `2xx`: read the body through the stream, stopping with `err('too-large')` once `maxResponseBytes` is exceeded; `JSON.parse` failure → `err('invalid-response')`; else `ok(json)`.
6. `429` or `5xx` with attempts left: wait = `Retry-After` (delta-seconds or HTTP-date, relative to `deps.nowMs()`), else `backoffBaseMs × 2^attempt`. If wait > `retryAfterCapMs`: stop now with `err('rate-limited')` for 429 / `err('http')` for 5xx, `retryAfterMs` set, **no early retry**. Else `await deps.sleep(wait, signal)` and retry. Attempts exhausted → same failures.
7. Any other non-2xx: read at most 64 KB; if it is JSON with a string `error` → `err('xrpc')` with `xrpcError`; else `err('http')`. Always set `status` and `origin`. The server's `message` text is **not** copied into `Failure.message`.
8. Always cancel an unread body. Never set an `Authorization` header or any cookie.

Worst case per request with default `LIMITS`: 3 × 10 s + 2 × 5 s = 40 s.

`permitOrigin(origin, basis)` adds to an internal set (idempotent). `permittedOrigins()` returns fixed + permitted, de-duplicated, in insertion order.

## Data received / sent
Receives: unknown input to validate; `fetch`, `sleep`, `nowMs` ports. Sends: branded values, `Result`s, parsed JSON (`JsonValue`, still untrusted in shape).

## Error behaviour
Parsers return `null` (or `err` for `parseHttpsOrigin`); they never throw. `getJson` resolves `err(...)` for every expected failure and rejects only on caller abort. Nothing logs response bodies.

## Invariants this module must enforce
- I-1 (part): `checkSelf` is the single definition of "self".
- I-3: a refused origin produces zero `fetch` calls.
- I-4: requests are `GET`, `credentials: 'omit'`, no `Authorization`, `redirect: 'error'`.
- I-9: every wait is bounded (timeout, retry count, retry-after cap, response size).
- The `as const` data in `contract.ts` is never mutated.

## Out of scope
OAuth traffic (the OAuth library uses its own fetch); DNS/DoH handle resolution; lexicon validation; caching; logging/telemetry; any `POST`.

## Dependencies
None. `shared/` imports from no other module. Do **not** add `@atproto/syntax` as an import (it is only a transitive dependency); adapt its rules instead and attribute them (see below). If the team later promotes it to a direct dependency, only `syntax.ts` changes.

## File layout
```
src/shared/
  contract.ts        (frozen)
  index.ts           re-exports + `satisfies SharedApi`
  result.ts          ok, err, makeFailure, isAbortError
  syntax.ts          parseDid … parseHttpsOrigin
  time.ts            parseIsoDateTime, isoDateOf, tidToIsoDateTime, systemClock, realSleep
  guards.ts          checkSelf
  http.ts            createHttpClient, buildXrpcUrl
  glossary.ts        GLOSSARY, metricDefinition, statusLabelFor, citation
  *.test.ts          one per file above
```

## Test plan (write these first)
**syntax**
- parseDid accepts a 24-char did:plc and a did:web hostname; rejects did:plc with 23 chars, upper case, `did:web:localhost`, `did:web:example.com:path`, `did:web:example.com%3A8080`, `did:key:…`, non-strings.
- parseHandle lower-cases and accepts `Alice.Example.COM`; accepts `handle.invalid`; rejects `@alice.test`, `alice`, `-a.com`, `a..com`, an email address, a URL, a 254-char string.
- parseNsid accepts `app.bsky.feed.post` and `site.standard.document`; rejects `app`, `app.bsky.`, `app.bsky.feed.post/x`.
- parseAtUri returns parts for `at://did:plc:…/app.bsky.feed.post/3k…`; rejects a handle authority, a missing rkey, an extra path segment, `?query`, `#fragment`.
- parseHttpsOrigin accepts `https://bsky.social`, `https://morel.us-east.host.bsky.network`, `https://pds.example.org/`, `https://pds.synthetic-demo.invalid`; rejects `http://…`, a port, a path, a query, credentials, `https://localhost`, `https://pds.local`, `https://10.0.0.1`, `https://[::1]`, `https://intranet`; each rejection is `blocked-origin`.
- parseCid accepts a 59-char `bafyrei…` string; rejects empty and 7-char strings.

**time**
- parseIsoDateTime normalises `2026-11-10T18:00:00+02:00` to `2026-11-10T16:00:00.000Z`; rejects a missing zone, `2026-02-30T…`, `2026-13-01T…`, a number.
- tidToIsoDateTime decodes a known TID (generate one from a fixed microsecond timestamp in the test) and returns null for `self`, a 12-char string, an invalid character.
- realSleep rejects with the abort reason when aborted mid-wait and does not resolve afterwards.

**guards / result / glossary**
- checkSelf: null session → access-denied; different DID → access-denied; same DID → ok.
- statusLabelFor covers all six labels, including exact 0 → `zero`.
- GLOSSARY has exactly one metric definition per `METRIC_IDS` entry and one unavailable definition per `UNAVAILABLE_METRIC_IDS` entry; `engagement.interactionsPerPost` names its denominator and is not `sharedByAllApps`; every `sharedByAllApps` metric lists both apps.
- citation returns the URL from `SOURCES` unchanged.

**http** (fake `fetch`, fake `sleep`, fake `nowMs`)
- Sends GET with `credentials: 'omit'`, `redirect: 'error'`, `Accept: application/json` and no `Authorization` header.
- Unpermitted origin → `blocked-origin` and the fake fetch was called 0 times; after `permitOrigin` the same URL is fetched.
- `http://` URL, URL with credentials → `blocked-origin`, 0 calls.
- 200 with valid JSON → ok; 200 with invalid JSON → `invalid-response`; body larger than the limit → `too-large` and the stream is cancelled.
- 429 with `Retry-After: 1` → sleeps 1000 ms then retries and succeeds (2 calls).
- 429 with `Retry-After: 60` → `rate-limited`, `retryAfterMs = 60000`, exactly 1 call, `sleep` not called for the retry.
- 503 three times → `http` with status 503 after exactly 3 calls; backoff waits are 500 then 1000 ms.
- 400 with `{ "error": "InvalidRequest" }` → `xrpc`, `xrpcError = 'InvalidRequest'`, no retry; 404 with HTML → `http`.
- fetch rejects with `TypeError` → `network`, 1 call.
- Timeout: fake sleep for the timeout resolves first → `timeout`; the attempt's signal is aborted.
- Caller aborts before the call → rejects, 0 calls. Caller aborts during the fetch → rejects with the caller's reason (not a `Failure`). Caller aborts during a retry wait → rejects.
- buildXrpcUrl repeats array params (`uris=a&uris=b`) and percent-encodes values.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/shared.md` — one `fetchJson` with timeout, bounded retries, 429 backoff, typed errors; branded ids; versioned glossary; cited-source constants. No credentials in config.
- Adapt (do not import): `atproto/packages/syntax/src/{did,handle,nsid,recordkey,aturi_validation,datetime}.ts` and `atproto/packages/common-web/src/{tid,util}.ts` (`s32decode`) — **MIT**; put `// Adapted from bluesky-social/atproto (MIT), <path>` at the top of `syntax.ts` / `time.ts` and report it for `THIRD_PARTY_NOTICES.md`.
- Port ideas from the prototype (same project): `SocialLens/src/adapters/http.ts` (`retryDelay`, bounded body read, long `Retry-After` regression) and `SocialLens/src/domain/normalize.ts` (`validTimestamp`), `SocialLens/tests/http.test.mjs`.
- `pdsls/src/lib/api.ts` `proxyFetch` (0BSD) shows "retry on network error, never on abort"; SocialLens has no proxy, so only the abort rule applies.
