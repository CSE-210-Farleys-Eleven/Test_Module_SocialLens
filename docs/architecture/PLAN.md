# SocialLens mini MVP — architecture plan

Status: plan and frozen contracts for a proof-of-concept. Date: 2026-11-18. Glossary: [`GLOSSARY.md`](GLOSSARY.md). Per-module contracts: `src/<module>/CONTRACT.md` + `contract.ts`.

This plan follows the module tree proposed in `SocialLens/docs/research/architecture-raw.md` without reorganising it. Where the tree left something open, the MVP choice is stated in §13 and what is left for team issue #3 in §14.

---

## 1. Goals and non-goals

**Goals**

1. A browser-only, read-only dashboard over **the signed-in person's own** public AT Protocol records: Bluesky (`app.bsky.*`) and Standard.site (`site.standard.*`).
2. Honest numbers: every value has a published definition, a status (known / observed zero / partial / settling / unknown / not available on this app) and per-collection coverage.
3. Evidence-backed privacy observations: evidence, official source, limitation, action.
4. A synthetic demo that runs the same pipeline as live mode, with no network.
5. Thirteen independently buildable modules plus `shared/`, connected only by frozen contracts, each with a test-first plan.

**Non-goals** (each is enforced, not just omitted — see §6)

- No backend, no history store, no persistence of records or analytics.
- No analysis of any account other than the signed-in one; no handle-lookup mode.
- No writes; OAuth scope `atproto` only; no app passwords.
- No impressions, views, reach, follower growth, "engagement rate", or composite score.
- No "who blocks me", no network indexes (Clearsky, Constellation).
- No React, no chart library, no extra runtime dependency (see §15).

## 2. The module rule

1. Every module folder has `contract.ts` (types, plus `as const` data that is itself contract) and `CONTRACT.md`.
2. A module's implementation imports **runtime** code only from itself and from `src/shared` (`../shared` index for functions; `../shared/contract` for types and constants). From any other module it may use **`import type … from '<module>/contract'`** only.
3. Everything a module needs from another module at runtime arrives by **dependency injection**: each module exports factory functions (typed by a `Create…` type in its contract) that take ports. Unit tests use hand-written fakes; no module's tests import another module's implementation (including `adapters/fixtures`).
4. Each module's `index.ts` exports exactly the values named under "Public API" in its `CONTRACT.md`, declared with the contract's function type, e.g. `export const createRegistry: CreateRegistry = () => …`.
5. Only the two composition roots import implementations: `src/main.ts` (page) and `src/worker-main.ts` (Worker entry).
6. Expected failures are **values** (`Result<T, Failure>`); the only thing a port may reject with is the caller's own abort.
7. Data that crosses a module boundary is immutable plain JSON (no `Date`, `Map`, `Set`, class instances); ports (objects with functions) never cross the Worker boundary.
8. Tests live next to the code as `*.test.ts`, run under Vitest's Node environment; UI test files start with `// @vitest-environment happy-dom`. Tests are written first, from the "Test plan" list in each `CONTRACT.md`.
9. Licences: copy no AGPL/GPL code (Clearsky, ClearskyUI, Constellation, WhiteWind are reference-only). Code adapted from a permissive source gets a header comment `// Adapted from <repo> (<licence>), <path>`; each implementer lists such files in their hand-back so the integrator can write `THIRD_PARTY_NOTICES.md` in one pass (parallel agents must not all edit that file).
10. No secrets exist in this app. Still: nothing reads `.env` except the optional public `VITE_OAUTH_CLIENT_ID`; `.env*`, `*.pem`, `credentials*.json` and `oauth-client-metadata.json` are git-ignored already.

## 3. Modules

| ID | Path | Contribution | Optimises for (ranked) | Depends on contracts of |
|---|---|---|---|---|
| M8 | `shared/` | Vocabulary: branded ids, `Failure`/`Result`, the data model, the one bounded HTTP client, glossary, sources, limits | validation correctness > bounded waits > no surprises | — |
| M1 | `auth/` | Proves "this DID is me" via official OAuth; discloses resolver and token storage | least privilege > truthful session state > small seam | shared |
| M2 | `accounts/` | Linked accounts keyed by DID; identity + handle status; local-only removal | ownership integrity > honest handle status > robust storage | shared, adapters/atproto |
| M3 | `registry/` | What is analysed, how visible it is (cited), what each app can tell us | accuracy of claims > stability > simplicity | shared |
| M4a | `adapters/atproto/` | DID → PDS, `describeRepo`, bounded `listRecords` with coverage | correctness of uncertainty > safety before I/O > bounded latency | shared |
| M4b | `adapters/bluesky/` | Public counters for own posts, batched by 25 | correctness of uncertainty > bounded latency > minimal data sent | shared |
| M4c | `adapters/fixtures/` | Synthetic HTTP-shaped data + fetch mock + ground-truth manifest | shape fidelity > determinism > obvious syntheticness | shared |
| M5 | `normalize/` | Raw records → `ActivityRecord`; skipped bucket | lose nothing silently > preserve uncertainty > determinism | shared, registry, adapters/bluesky |
| M6 | `analytics/` | Every activity/engagement number as a `MetricValue` | glossary correctness > determinism > speed | shared, registry |
| M6a | `analytics/privacy/` | Eight evidence-backed observations | evidence integrity > restraint > determinism | shared, registry |
| M6b | `analytics/worker/` | Off-main-thread execution with timeout and fallback | same result either way > bounded waits/cancellation > low overhead | shared, registry, analytics, privacy |
| M6c | `analytics/state/` | `AppState`, reducer, store, and the controller that sequences all ports | cancellation/isolation correctness > honest state > predictability | shared, auth, accounts, adapters/atproto, adapters/bluesky, adapters/fixtures, registry, normalize, analytics, privacy, worker |
| M7b | `ui/components/` | Text-only DOM building blocks; status labels; SVG chart; glossary popover | rendering safety > clarity of uncertainty > smallness | shared |
| M7a | `ui/views/` | Five views, shell, mount loop | truthful presentation > comprehension/accessibility > thinness | shared, registry, adapters/fixtures, state, components (and, through `AppState`, auth, accounts, analytics, privacy, worker) |

### Dependency graph (type-only edges between modules; every module also uses `shared` at runtime)

```
shared ◄── everything
registry ◄── normalize, analytics, privacy, worker, state, views
adapters/atproto ◄── accounts, state
adapters/bluesky ◄── normalize, state
adapters/fixtures ◄── state (DemoScenarioId), views (DemoScenarioInfo)
auth ◄── state
accounts ◄── state
normalize ◄── state
analytics ◄── worker, state
analytics/privacy ◄── worker, state
analytics/worker ◄── state
analytics/state ◄── ui/views
ui/components ◄── ui/views
composition roots: main.ts → all 14 index.ts ; worker-main.ts → analytics, privacy, worker
```
There are no cycles. Leaves (depend on `shared` only): auth, registry, adapters/atproto, adapters/bluesky, adapters/fixtures, ui/components.

## 4. Data model in one paragraph

`SessionRef {did, source}` proves who "me" is. `adapters/atproto` turns it into `ResolvedIdentity` → (`accounts`) `AccountIdentity`, and reads `RawRecord`s with one `Coverage` per collection and a list of rejected items. `adapters/bluesky` returns one `Engagement` per own post URI. `normalize` produces `ActivityRecord`s plus `SkippedRecord`s. The controller assembles an immutable `Snapshot` (records, skipped, coverage, engagement coverage, inventory, notices, `fetchedAt`). `analytics` and `privacy` map `Snapshot` + `RegistryData` to `AnalyticsReport` and `PrivacyReport` (together `AnalysisResult`). `AppState` holds the snapshot, the analysis and UI selections; views render it. All types: `src/shared/contract.ts` and the module contracts.

## 5. End-to-end data flow

```
                         ┌──────────────── main thread ─────────────────────────────────────────────┐
 person ─ handle ─► [M7a views] ─ AppActions ─► [M6c controller] ◄─ AppEvent ─ reducer ─► AppState ─► [M7a views]
                                                   │
        LIVE                                       │                                  DEMO
 [M1 auth] ── SessionRef(oauth) ──────────────────►│◄────────── SessionRef(demo) ── [M4c fixtures]
   (OAuth library: its own fetch, IndexedDB)       │
                                                   ▼
                                     [M2 accounts.verify]
                                        │ resolveIdentity / describeRepo
                                        ▼
            HttpClient(fetch = globalThis.fetch)  or  HttpClient(fetch = fixture server)      ← the ONLY difference
                 ▲            ▲             ▲
   [M4a atproto] │            │             │ [M4b bluesky]
   plc.directory / did:web    │ user's PDS  │ public.api.bsky.app
   DID document               │ describeRepo, listRecords ×N      getPosts ×⌈posts/25⌉
                                        │ RawRecord[] + Coverage[] + rejected[]          │ EngagementResult[]
                                        └──────────────┬─────────────────────────────────┘
                                                       ▼
                                   [M5 normalize] (uses [M3 registry])
                                        │ ActivityRecord[] + SkippedRecord[]
                                        ▼
                                    Snapshot ───────────────► AppState.snapshot
                                        │ AnalysisJob (plain data)
                                        ▼
                                 [M6b runner] ──postMessage──► ┌──── Worker (worker-main.ts) ────┐
                                        │  ◄── result ──────── │ [M6 analytics] + [M6a privacy]  │
                                        │                       └─────────────────────────────────┘
                                        └─ on unavailable / error / timeout: same function on the main thread
                                        ▼
                                  AnalysisResult ───────────► AppState.analysis ─► views
```

### Live path

1. **Start.** `main.ts` composes everything and calls `actions.start()`. The controller calls `auth.init()`: the OAuth library processes a redirect callback if the URL carries one, otherwise restores the last session. Outcome: a `SessionRef { did: session.sub, source: 'oauth' }`, or signed out.
2. **Sign-in** (if signed out): on the Accounts view the person reads the disclosure (handle + IP go to the handle resolver `bsky.social`; tokens stay in this browser; scope `atproto`), types a handle, and `auth.signIn(handle)` redirects to their authorization server. On return, step 1 yields the session. Local dev: `client_id` on `http://localhost`, page on `http://127.0.0.1:5173`.
3. **Verify the account.** `accounts.verify({ session })` → `atproto.resolveIdentity` (`checkSelf`, then DID document from `plc.directory` or the did:web host → PDS origin, which is added to the HTTP allowlist) → `atproto.describeRepo` on that PDS (handle, `handleIsCorrect`, advertised collections). Result: `AccountIdentity` with `handleStatus` and the `RepoDescription`. The account is upserted in the linked-accounts list (DID, handle, PDS — no tokens).
4. **Discover.** `registry.inventory(advertised)` splits collections into present (read them), absent (observed zero, no request) and present-not-analysed (shown, not read). If `describeRepo` failed, every registered collection is read and the inventory is "unknown".
5. **List records.** For each present registered collection, in registry order, sequentially: `atproto.listCollection` — `listRecords`, page size from the registry (100; 50 for documents), cursor pagination, page cap 10, envelope + ownership checks, `Coverage` per collection, rejected items with reasons. Requests are unauthenticated `GET`s with `credentials: 'omit'`; the HTTP client handles timeout and 429/5xx backoff.
6. **Counts.** URIs of accepted records from collections with a count source (`app.bsky.feed.post`) → `bluesky.getCounts`: `getPosts` in batches of 25 on `public.api.bsky.app`; failed batch → `unknown`; two consecutive failures stop the lookup.
7. **Normalise.** `normalizer.normalize({ did, records, engagement })` → `ActivityRecord[]` + skipped bucket. Standard.site records get `not-available` engagement.
8. **Snapshot.** The controller assembles the `Snapshot` (`fetchedAt = now`) with notices, checks it was not cancelled, and dispatches `load/snapshot-ready`.
9. **Analyse.** `runner.run(job)` posts `{ snapshot, registry data, options }` to a fresh Worker running `computeAnalytics` + `computePrivacy`; on missing Worker, error, bad message or 5 s timeout the same function runs on the main thread. `analysis/ready` stores the `AnalysisResult` with where it ran and how long it took.
10. **Render.** `mountApp` re-renders the shell from `AppState`; views show values through components with status labels and glossary definitions.
11. **Range change** re-runs step 9 only. **Reload** repeats 3–10. **Switch account** → `auth.restore(did)` → 3–10. **Session ended** (library hook) → data cleared, account marked "needs sign-in".

### Demo path

1. On the landing page the person picks a scenario; `actions.enterDemo(scenario)`.
2. The controller asks the composition root's `demo(scenario)` factory for a fresh set of ports: the **same** `createHttpClient`, `createAtprotoAdapter`, `createBlueskyAdapter` and `createAccounts` (memory-only storage), built over `fixtures.createServer(scenario).fetch`, plus `fixtures.session` (`source: 'demo'`) and the fixed clock `fixtures.now`.
3. Steps 3–10 of the live path run unchanged against the fixture server. The DID document names `https://pds.synthetic-demo.invalid`; identity, pagination, 429/5xx scripts and count failures are all exercised for real.
4. The snapshot has `mode: 'demo'` and the `demo-synthetic` notice; the shell shows the synthetic banner on every view. Auth, live accounts and browser storage are never touched. Any request the fixture server does not recognise is rejected and logged as `unexpected`.

## 6. Invariants — who enforces, which test proves

| # | Invariant | Enforced by | Proven by (test names are in the module's CONTRACT.md / §11) |
|---|---|---|---|
| I-1 | Live reads are only for the authenticated `session.sub`; any other target is rejected before I/O | `shared.checkSelf`; `adapters/atproto` (all three methods); `adapters/bluesky` (per URI); `accounts.verify` (no target parameter); `state` (session only from `auth`); `views` (no lookup field) | atproto "foreign DID → access-denied, 0 requests"; bluesky "a URI of another DID … no request URL contains it"; state "live load refuses a demo session"; views "exactly one text input"; IT-6 |
| I-2 | Every accepted record's URI belongs to that DID and the requested collection | `adapters/atproto.listCollection`; re-checked in `normalize` | atproto "foreign-owner / wrong-collection"; normalize "URI DID differs → skipped" |
| I-3 | A request to an origin that is neither fixed nor derived from the authenticated DID's identity chain is never sent | `shared.createHttpClient`; `adapters/atproto` (only caller of `permitOrigin`) | shared "unpermitted origin → blocked-origin, 0 calls"; atproto "PDS endpoint http/port/IP/localhost → blocked-origin" |
| I-4 | Public reads are unauthenticated, read-only `GET`s | `shared.createHttpClient` | shared "GET with credentials omit … no Authorization"; IT-1 request-log assertions |
| I-5 | A failed later page keeps accepted data and can never be `complete` | `adapters/atproto` | atproto "page 2 fails after page 1 → partial / later-page-failed" |
| I-6 | A cancelled or superseded request never publishes | `adapters/*` (reject on abort); `analytics/worker` (terminate, drop late messages); `state` (`throwIfAborted` + reducer `runId` guard) | state "cancel mid-read", "supersede", "sign-out mid-read"; worker "abort while waiting"; IT-4, IT-5 |
| I-7 | Missing is not zero: a failed fetch is `null`/unknown, never 0 | `adapters/bluesky`; `normalize`; `analytics` (status rules); `components.formatMetricValue`; `views` | bluesky "missing quoteCount → invalid-counts"; analytics "eligible 3, known 0 → unknown"; components "unknown shows Unknown (never 0)"; IT-2 |
| I-8 | Publications are not treated as timestamped articles | `normalize` | normalize "publication → createdAt null even if the body has one" |
| I-9 | Every wait is bounded (timeout, retries, retry-after cap, response size, page cap, batch circuit breaker, worker timeout) | `shared` http; `adapters/atproto`; `adapters/bluesky`; `analytics/worker` | shared "429 Retry-After 60 → rate-limited, 1 call"; atproto "cap"; bluesky "batches 1 and 2 fail → batch 3 not requested"; worker "timer fires → worker-timeout" |
| I-10 | Demo is always visibly synthetic; fixtures contain no real personal record | `adapters/fixtures`; `state` (notice); `views` (banner) | fixtures "no generated string contains bsky.social…"; views "demo-banner present … on each of the five views"; IT-8 |
| I-11 | No impressions/reach/follower growth/"engagement rate"/opaque score | `shared` glossary (unavailable list); `analytics`; `views` | shared "GLOSSARY has one definition per id"; views "not-available-metrics lists every entry"; IT-12 hygiene grep |
| I-12 | No "who blocks me", no network index | `registry` (no such source); `adapters/bluesky` (one endpoint); `privacy` (own records only) | bluesky endpoint tests; privacy "report contains none of the subjectDid values"; IT-12 |
| I-13 | Overview shows only metrics shared by all apps | `analytics.OverviewMetrics`; `views.overview` | views "contains no metric id starting with engagement."; IT-8 |
| I-14 | Every privacy observation has evidence, source, limitation, action | `analytics/privacy`; `views.privacy` | privacy "catalogue has eight ids each with …"; views "each card shows …" |
| I-15 | Source content is rendered as text, never as HTML/script/remote resource | `ui/components` (`h`, no innerHTML); `ui/views` (only via components) | components "`<img onerror>` produces a text node"; components hygiene test; IT-8 probe post |
| I-16 | OAuth scope is `atproto` only; no app passwords; tokens are owned by the library | `auth` | auth "no scope option is passed", "no token-like property"; IT-12 |
| I-17 | Nothing is silently dropped: every unusable record is in the skipped bucket with a reason | `adapters/atproto`; `normalize`; `state` (concatenates) | atproto "`returned === accepted + rejected + duplicates`"; normalize "sum equals input length"; IT-2 |
| I-18 | Linked accounts are only accounts the person signed in to; "remove" is local-only | `accounts`; `state` | accounts "demo session … setItem never called", "remove → scope local-only"; views "remove-scope-note" |

The eight invariants of the prototype (`SocialLens/docs/ARCHITECTURE.md`) map to I-1, I-2, I-7, I-8, I-5, I-6, I-15, I-10.

## 7. Error and uncertainty model

**Failures are data.** `Failure { kind, message, status, xrpcError, retryAfterMs, origin }` with 14 kinds (`src/shared/contract.ts`). Ports return `Result<T, Failure>` or embed the failure in `Coverage`; nothing throws for expected problems. `message` is a fixed plain sentence — never server text, tokens or bodies. (The research note suggested error classes; plain data was chosen because failures must cross the Worker boundary and module boundaries without `instanceof` — see §14.)

**Uncertainty has four layers, each explicit:**

| Layer | Type | Values |
|---|---|---|
| A read of one collection | `Coverage` | `complete` / `partial` / `unavailable` + reason code (`ok`, `not-present`, `page-cap`, `repeated-cursor`, `records-rejected`, `later-page-failed`, `first-page-failed`) + counts |
| One record | skipped bucket | `SkippedRecord { stage, reasonCode, detail }` |
| One post's counters | `Engagement` | `known` (observed, 0 is real) / `unknown` + reason / `not-available` |
| One displayed number | `MetricValue` | `exact` / `partial` (+ `isLowerBound` → "At least N") / `settling` / `unknown` / `not-available`, with a reason |

Rules that turn the first three into the fourth are in GLOSSARY.md ("Status of a value"). The UI's six labels derive from `MetricValue` via `statusLabelFor`.

**What is known to be approximate and is said so:** reads are sequential, not an atomic snapshot (notice); timestamps are author-supplied (labelled); the page cap cuts the *oldest* records (reference PDS returns newest first); counters are a cached point-in-time read, and the reference AppView itself reports a missing aggregate as 0 (outside our control); "settling" is a 36-hour heuristic.

## 8. Cancellation model

- One `AbortController` per load, owned by the controller; its signal is passed to every port call. A second, shorter-lived controller covers a range-change re-analysis.
- Ports **reject only with the caller's abort reason**; they return no partial result and fire no callback after abort. The HTTP client aborts the in-flight `fetch` and any retry wait. The runner terminates the Worker.
- The controller calls `signal.throwIfAborted()` after every `await`; the action that aborted (cancel, new load, sign-out, session ended, clear) has already dispatched the state change, so the aborted pipeline dispatches nothing.
- Second line of defence: every load event carries `runId`; the reducer returns the same state for any event whose `runId` is not current. `analysis/ready` additionally requires the range it was computed for to still be selected.
- A cancelled load keeps nothing: `load.status = 'cancelled'`, no snapshot.

## 9. Security notes

- **Text-only rendering.** All DOM is built by `ui/components.h` with text nodes; `innerHTML` and friends are banned and tested for; the only hyperlinks are `citationLink`s to `https:` URLs from `SOURCES`; AT-URIs are shown as text in `<code>`; no `<img>`/`<iframe>`; no inline styles.
- **Suggested CSP** for the built site (as an HTTP header on the static host; a `<meta>` fallback works except for `frame-ancestors`). Not applied in `vite dev`, which needs inline scripts and a WebSocket:
  `default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  `connect-src https:` is deliberately broad — see the origin stance below. Also send `Referrer-Policy: no-referrer` (already a `<meta>` in `index.html`) and `X-Content-Type-Options: nosniff`.
- **Token storage** is left entirely to `@atproto/oauth-client-browser` (IndexedDB + one `localStorage` key for the last active `sub`). SocialLens code never reads or writes tokens. The app's own `localStorage` use is one key, `sociallens:accounts:v1` (DID, last handle, PDS origin, timestamps).
- **Two network paths, kept apart.** (1) The OAuth library's own traffic: handle resolver, authorization-server metadata, PAR/token endpoints, PLC — only during sign-in/refresh. (2) `shared.createHttpClient`: unauthenticated `GET`s with `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`, bounded size and time. The session's DPoP `fetchHandler` is never used, so a bug in the read path cannot spend the user's token.
- **Origin allowlist stance (changes prototype ADR-005).** ADR-005 allowed `did:plc` only and a hard-coded list of PDS hosts, which rejects self-hosted PDS accounts. The MVP stance is **"fixed origins + identity-derived origins"**:
  - Fixed: `https://public.api.bsky.app`, `https://plc.directory`.
  - Derived, per page session, only by `adapters/atproto` and only for the authenticated DID: the PDS origin named in that DID's document (`pds-from-did-document`), and for `did:web` the DID's own host (`did-web-host`).
  - Every origin must pass `parseHttpsOrigin`: `https` only, no credentials, no explicit port, no path; not `localhost`, `*.local`, `*.localhost`, `*.internal`, `*.lan`, `*.home.arpa`, single-label, or an IP literal. Redirects are errors.
  - Result: a `bsky.social`-hosted account (PDS `*.host.bsky.network`) and a self-hosted PDS on its own domain both work; `did:web:<hostname>` is accepted (no path segments, no port). A did:web host or PDS that does not send CORS headers yields "could not verify" / `unavailable` — there is no proxy.
  - Cost: the deployment CSP cannot enumerate hosts (`connect-src https:`), so the application-level allowlist is the control, not the CSP. This is a deliberate widening and must be confirmed in issue #3.
- **Self-only** is enforced at the adapter boundary (I-1), not just in the UI.
- **Privacy of third parties:** follow/block/list subjects are stored in `ActivityRecord.subjectDid` but never displayed, listed or exported; observations show the person's own record URIs only.
- **Disclosure:** the sign-in form states that the typed handle and the device's IP address go to `bsky.social` for handle resolution (source: the OAuth package README).
- **Dependencies:** one runtime dependency; lockfile committed; no CDN scripts.

## 10. Composition roots

### `src/main.ts` (page) — construction order

| # | Construct | From | Receives |
|---|---|---|---|
| 1 | `registry` | `createRegistry()` | — |
| 2 | `fixtures` | `createFixtures()` | — |
| 3 | `normalizer` | `createNormalizer` | `{ registry }` |
| 4 | `compute` | `createComputeAnalysis` | `{ computeAnalytics, computePrivacy }` |
| 5 | `runner` | `createAnalysisRunner` | `{ spawnWorker: typeof Worker === 'undefined' ? null : () => adaptWorker(new Worker(new URL('./worker-main.ts', import.meta.url), { type: 'module' })), compute, timeoutMs: LIMITS.analysisTimeoutMs, nowMs: systemClock.nowMs, timers: { setTimeout, clearTimeout } }` |
| 6 | `buildPorts(fetchImpl, storage, now)` helper → `DataPorts` | — | inside: `http = createHttpClient({ fetch: fetchImpl, sleep: realSleep, nowMs: systemClock.nowMs, fixedOrigins: [ORIGINS.appView, ORIGINS.plcDirectory], limits: null })`; `clock = { now, nowMs: systemClock.nowMs }`; `atproto = createAtprotoAdapter({ http, clock })`; `engagement = createBlueskyAdapter({ http, clock })`; `accounts = createAccounts({ identity: atproto, repo: atproto, storage, clock })`; returns `{ accounts, repo: atproto, engagement, now }` |
| 7 | `live` | `buildPorts((u, i) => globalThis.fetch(u, i), safeLocalStorage(), systemClock.now)` | `safeLocalStorage()` returns `localStorage` or `null` if accessing it throws |
| 8 | `demo` | `(scenario) => ({ ...buildPorts(fixtures.createServer(scenario, null).fetch, null, () => fixtures.now), session: fixtures.session })` | a **new** HTTP client and fixture server per call |
| 9 | `auth` | `cfg = resolveAuthConfig(window.location, import.meta.env.VITE_OAUTH_CLIENT_ID ?? null)`; `cfg.ok ? createAuth({ config: cfg.value, createClient: createBrowserOAuthClient }) : null` | — |
| 10 | `store` | `createAppStore(createInitialState())` | — |
| 11 | `actions` | `createAppController` | `{ store, auth, live, demo, registry, normalizer, runner, analytics: { topPosts, settlingHours, timelineMaxDays, textPreviewChars } from LIMITS, privacy: { sampleUris, patternMinItems, patternBandHours, patternShareThreshold } from LIMITS, maxPagesPerCollection: LIMITS.maxPagesPerCollection, nowMs: systemClock.nowMs }` |
| 12 | `components` | `createComponents` | `{ document, glossary: GLOSSARY }` |
| 13 | `views` | `createViews` | `{ components, registry: registry.data, glossary: GLOSSARY, demoScenarios: fixtures.scenarios, document }` |
| 14 | mount | `mountApp({ root: document.getElementById('app'), store, actions, views })` | — |
| 15 | start | `void actions.start()` | — |

`main.ts` also imports the stylesheet. It contains no branching logic beyond the two null checks above. This exact wiring was type-checked against the contracts while writing the plan.

### `src/worker-main.ts` (Worker entry)

```ts
import { computeAnalytics } from './analytics';
import { computePrivacy } from './analytics/privacy';
import { createComputeAnalysis, installWorkerHandler } from './analytics/worker';
import type { WorkerScopeLike } from './analytics/worker/contract';
installWorkerHandler(self as unknown as WorkerScopeLike, createComputeAnalysis({ computeAnalytics, computePrivacy }));
```
The Worker bundle must not pull in DOM, auth or adapters; importing only these three modules guarantees it.

## 11. Integration tests on fixtures (`tests/integration/*.test.ts`, written at integration)

All use the real implementations wired as in §10 (with `spawnWorker: null`, a fake `sleep`/timers where noted, an in-memory `KeyValueStore`, and a **fake `AuthService`** — the real OAuth flow cannot run in a test).

| ID | Scenario | Assertions |
|---|---|---|
| IT-1 | Demo `complete`, range `all` | state `ready`; 214 records; 10 coverage rows all `complete`; `unanalysedCollections` = 2 NSIDs; engagement coverage `complete` 120/120; `records.total` = 214 exact; `content.items` = 124 exact; `engagement.interactions` = sum of `manifest.countTotals`; `interactionsPerPost` denominator 120, status `settling`; observations: likes 40, follows 25, blocks 3, lists 8 (all `exact`), cross-app (2 apps), posting-time pattern, **and** `incomplete-coverage` (because two collections are present but not analysed); `handle-validity` not triggered. Request log: 18 requests (1 DID doc, 1 describeRepo, 11 listRecords, 5 getPosts), none `unexpected`, all `credentials: 'omit'`, none with `Authorization`, origins ⊆ {plc.directory, pds.synthetic-demo.invalid, public.api.bsky.app} |
| IT-2 | Demo `partial` | coverage per manifest (post `records-rejected`, like `later-page-failed` with 100, follow `page-cap` with 1,000, block `first-page-failed`, list/listitem `not-present` with **no** listRecords request); `byKind.block` value `null` / `unknown`; like count `partial` lower bound 100; skipped bucket = 2 fetch + 1 normalize; engagement known 34 of 59 eligible → `partial`; notices `coverage-incomplete`, `engagement-incomplete`, `records-skipped`, `handle-not-valid`; `public-blocks` not triggered with the "could not be read" reason; `handle-validity` triggered |
| IT-3 | Demo `empty` | exactly 2 requests; every count exact 0; `interactionsPerPost` `unknown`; 0 observations, 8 not-triggered |
| IT-4 | Cancel | fixture latency 50 ms + fake timers: `enterDemo('complete')`, advance 120 ms, `cancelLoad()` → `load.status === 'cancelled'`, `snapshot === null`; advancing time further adds no request and no state change |
| IT-5 | Supersede | `enterDemo('complete')` then immediately `enterDemo('empty')` → the only snapshot ever observed by a store subscriber is the empty one |
| IT-6 | Self-only | `atproto.listCollection` / `describeRepo` / `bluesky.getCounts` called with a session for DID A and a target or URIs of DID B → `access-denied` / `rejected-not-self`, and the fixture log is empty |
| IT-7 | Live path with a fake auth | fake `auth.init()` returns `{ did: DEMO_ACCOUNT.did, source: 'oauth' }`; `live` ports are built over a fixture server → `mode: 'live'`, no `demo-synthetic` notice, account persisted to the fake storage without any token-like key; emitting `session-ended` clears the data and marks the account `needs-sign-in` |
| IT-8 | UI (happy-dom) | real components + views on IT-1 state: `demo-banner` on all five views; Overview has no `engagement.*` metric card; Engagement shows "Not available on this app" for Standard.site; the probe post text appears verbatim as text and `document.querySelector('img')` is null; every `<a>` has an `https:` href and `rel="noopener noreferrer"`; Privacy shows 7 observation cards each with sample URIs in `<code>`; Accounts shows the remove-scope note and both disclosure sentences |
| IT-9 | Worker parity | `compute(structuredClone(job))` deep-equals `compute(job)`; the runner with `spawnWorker: null` returns the same result with `ranIn: 'main-thread'` |
| IT-10 | Determinism | two independent `enterDemo('complete')` runs give deep-equal snapshots and analysis results |
| IT-11 | Module boundaries (`tests/architecture/boundaries.test.ts`) | scan `src/**/*.ts` except tests and the two composition roots: every relative import that leaves the module's folder is either `import type` from a `contract`, or targets `shared`; every `contract.ts` has only `import type` statements; no file outside `src/auth/browser-client.ts` imports `@atproto/oauth-client-browser` |
| IT-12 | Hygiene | no runtime source contains `innerHTML`, `transition:generic`, `app password`/`appPassword`, `clearsky`, `constellation`, `getFollowers`, `engagement rate` (case-insensitive; `shared/glossary.ts` may contain "engagement rate" only inside the unavailable-metric text) |

**Manual live check (cannot be automated here; record the result honestly in the PR):** `npm run dev`, open `http://127.0.0.1:5173`, sign in with a test account on `bsky.social`; confirm the consent screen asks for no write permission; confirm the Accounts view shows the DID, handle "valid", the PDS origin, coverage rows and "analysis ran in a background worker"; confirm in DevTools that record requests carry no `Authorization` header and no cookies; sign out and confirm data is cleared. Repeat with a self-hosted-PDS account and a did:web account if available.

## 12. Build order and parallelism

| Wave | Work | Why |
|---|---|---|
| 0 | `shared/` | Its runtime (`parse*`, `checkSelf`, `createHttpClient`, `makeFailure`, `GLOSSARY`) is imported by every other module's implementation; nothing else can run its tests before it exists. Types and `as const` data are already usable from `shared/contract.ts`. |
| 1 | The other 13 modules, fully in parallel | They share only frozen contracts and `shared`. |
| 2 | Integrator: `src/main.ts`, `src/worker-main.ts`, stylesheet, `tests/integration/*`, `tests/architecture/*`, `THIRD_PARTY_NOTICES.md`, CI workflow, README | Needs all implementations. |

If Wave 0 and Wave 1 must start together, Wave-1 agents can write tests and code immediately, but `tsc` and their test runs stay red until `src/shared/index.ts` lands; they must not stub or re-implement `shared`.

Size and risk, to guide model assignment:

| Module | Size | Hardest part |
|---|---|---|
| `analytics/state` | L | controller concurrency: cancellation, supersession, range re-analysis, session-ended during load |
| `shared` | M–L | HTTP client retry/timeout/abort matrix; identifier syntax; blocks every other module |
| `adapters/atproto` | M | every coverage path exactly right; origin permitting |
| `analytics` | M–L | many rules; status precedence; UTC date arithmetic |
| `ui/views` | L | largest surface; many states per view |
| `adapters/fixtures` | M | manifest must equal what the server serves; failure scripts |
| `analytics/privacy` | M | exact wording + certainty rules |
| `analytics/worker` | S–M | event races (message vs timer vs abort) |
| `auth` | S–M | small code, but the seam to a real library that cannot be unit-tested |
| `normalize`, `accounts`, `ui/components`, `adapters/bluesky` | S–M | — |
| `registry` | S | data accuracy |

Things the scaffold still lacks and the integrator should add (the user's stated weak spots): a real CI workflow running `npm run check`; a README with more than headings.

## 13. Decisions on the five open points

| # | Open point | MVP choice | Left for issue #3 |
|---|---|---|---|
| 1 | Worker module name blank | `analytics/worker/` | Whether a Worker is needed at all: the runner reports `ranIn` and `durationMs`; decide with measurements on a large real repo. |
| 2 | `privacy/`, worker, `state/` nested under `analytics/` | Kept exactly as drawn | `state/` is application state **and**, in this MVP, the orchestrating controller — neither is analytics. Proposal: move to a top-level `state/` (or `app/`). Importers to change: `ui/views` and the composition root only. |
| 3 | "writes" in `adapters/atproto/` | Not implemented; the adapter is read-only and has no write method; scope stays `atproto` | Remove "writes" from the tree, or decide scope + privacy for a specific write feature first. |
| 4 | Linked accounts | Only accounts the person has signed in to (session DID = account DID). Multi-account by `auth.restore(did)`; the app persists DID/handle/PDS (no tokens) so it can offer them after a reload. "Remove" = sign out (best effort) + forget locally; nothing remote is deleted, and the UI says so. | Whether multi-account ships in the first sprint; whether persisting the DID list is acceptable under "persistence out" (ADR-001); cross-account comparison (not built). |
| 5 | Typo "lis of apps" | Just a typo: "list of apps". | — |

## 14. Deviations from the architecture and from the fixed decisions, and open points for #3

**Deviations (each small, each deliberate):**

1. **Orchestration lives in `analytics/state/`.** The tree has no application layer; the load controller had to live somewhere testable, and "what the app currently knows" is the closest fit. See open point 2.
2. **A second composition root, `src/worker-main.ts`.** The Worker entry must import the analytics and privacy implementations, which only a composition root may do; `analytics/worker/` therefore exports `installWorkerHandler` instead of containing the entry file.
3. **Typed errors are plain data** (`Failure` union + `Result`), not `NetworkError`/`XrpcError`/`ValidationError` classes as the research note sketches: the kinds exist (`network`, `xrpc`, `validation`, …) but as discriminated data, so they are structured-cloneable and need no `instanceof` across modules.
4. **Handle validity is PDS-attested**, using `describeRepo.handleIsCorrect` plus the DID document's `alsoKnownAs`, instead of an independent bidirectional resolution with atcute's `LocalActorResolver`. Reason: no new dependency, no DNS-over-HTTPS third party, no CORS failure mode. Cost: it trusts the person's own PDS; shown as "checked by your PDS".
5. **Origin policy replaces ADR-005's host allowlist** (§9): identity-derived origins, did:web accepted, CSP `connect-src https:`.
6. **Session invalidation uses the `onSessionDeleted` constructor hook**, not the `'deleted'` event named in the research note and the package README (verified against the installed 0.5.15).
7. **Four counters** (likes, reposts, replies, quotes) instead of the prototype's three; a post is "known" only if all four are observed.
8. **`as const` contract data in `contract.ts` files** (`LIMITS`, `ORIGINS`, `SOURCES`, id lists, label texts, `DEMO_ACCOUNT`, `TEST_IDS`) — allowed by the module rule, and it lets modules agree on ids and wording without importing each other.
9. **No consent checkbox** before sign-in (the prototype had one); the disclosure text beside the form replaces it.
10. **Response size cap 5 MB and page size 50 for documents** (prototype: 2 MB, 100 everywhere) — Standard.site documents can be large. Not measured against real data.
11. **`incomplete-coverage` also triggers when collections are present but not analysed**, so it appears even in the "complete" demo; that is accurate (the view is not the whole footprint).

**Open points to raise in issue #3:**

- Is the widened origin policy acceptable, or should the first release restrict to `did:plc` + Bluesky-hosted PDSs behind a default-OFF flag for "any PDS"? (A flag would be a small change inside `adapters/atproto`.)
- Should handle verification become independent (DoH + well-known) later, and with which disclosed third party?
- Sequential collection reads: keep, or allow limited concurrency once `acquisitionMs` has been measured on real accounts?
- Range-aware exactness under the page cap (GLOSSARY "Refinement deliberately not done").
- Page cap of 10 (1,000 records per collection): right default? A whole-repo CAR read would remove the cap at the cost of two dependencies.
- The 36-hour "settling" threshold is borrowed from X; is there a better-grounded value for the Bluesky AppView?
- `bookmarkCount`: verify whether it is populated for unauthenticated readers before adding it.
- Whether the user study should test the comprehension of the status labels and the observation wording (issue #7).
- Production hosting of `client-metadata.json` (issue #4/#8) and applying the CSP there.
- Licence for SocialLens itself (affects which references can become dependencies).

## 15. Dependency recommendation

Default kept: **no additional runtime dependency.** One candidate is worth recording, not adopting now: **`@atproto/syntax`** (MIT, already installed transitively as 0.7.7 via the OAuth client, 2 small dependencies) would replace the hand-adapted identifier validators in `shared/syntax.ts` with the reference ones. It is not adopted because depending on a transitive package without declaring it is fragile, and declaring it is a dependency decision for the team; `shared`'s API hides the choice, so switching later touches one file. No chart library, no DoH/identity library, no atcute.

## 16. What could not be verified while writing this plan

- The real OAuth loopback flow end to end (needs a browser and an account); the prototype's live auth was never verified either (issue #4).
- Browser CORS behaviour of `plc.directory`, of non-reference PDS implementations, and of did:web hosts. The reference PDS and AppView enable permissive CORS (`cors()` in `atproto/packages/pds/src/index.ts` and `packages/bsky/src/index.ts`).
- That real PDS responses never redirect (the client treats a redirect as an error).
- AppView rate limits; real response sizes for `site.standard.document` pages.
- Record order of `listRecords` on PDS implementations other than the reference one (newest first there).
- That a real `Worker` built by Vite 8 loads `worker-main.ts` (unit and integration tests run in Node without a real Worker; covered by the manual check).
- TypeScript 7 / Vitest 5 / Vite 8 behaviour beyond `tsc --noEmit` on the contract files.
