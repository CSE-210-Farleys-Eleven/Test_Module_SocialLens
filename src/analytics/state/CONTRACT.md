# M6c `analytics/state/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Hold "what the app currently knows" as one immutable `AppState`, change it only through a pure reducer, and run the one controller that sequences the ports (auth → accounts → records → counts → normalise → analyse) and publishes results.

## Contribution to the whole
This is the module that makes the others an application. The UI renders `AppState` and calls `AppActions`; nothing else talks to adapters. Because every result passes through one reducer with a generation counter, a cancelled or superseded read can never overwrite newer state, and sign-out can never leave another account's data on screen. Demo and live runs use the same code path with different ports.

## What to optimise for (ranked)
1. **Correctness of cancellation and isolation** — stale, cancelled or other-account results never reach the state.
2. **Honest state** — failures, partial coverage and progress are represented, never swallowed.
3. Predictability — pure reducer, sequential pipeline, no hidden globals.

## Public API (`src/analytics/state/index.ts`)
```ts
export const createInitialState: CreateInitialState;   // () => AppState
export const reduce: Reduce;                           // (state, event) => AppState   (pure)
export const createAppStore: CreateAppStore;           // (initial | null) => AppStore
export const createAppController: CreateAppController; // (deps) => AppActions
```

### Initial state
`auth: { status: 'initialising', disclosure: null, failure: null, signInPending: false }`, `mode: 'none'`, `demoScenario: null`, `accounts: []`, `activeDid: null`, `view: 'overview'`, `range: '30d'`, `load: { status: 'idle', runId: 0, progress: null, failure: null, acquisitionMs: null }`, `snapshot: null`, `analysis: { status: 'idle', range: '30d', result: null, ranIn: null, fallbackReason: null, durationMs: null, failure: null }`, `notices: []`.

### Reducer rules
An event that fails its guard returns the **same state reference**.

| Event | Guard | Effect |
|---|---|---|
| `auth/ready` | — | `auth.status = 'ready'`, disclosure set, failure null. |
| `auth/unavailable` | — | `auth.status = 'unavailable'`, failure set, `signInPending = false`; add notice `auth-unavailable` (warning): "Live sign-in is unavailable. The synthetic demo still works." |
| `auth/sign-in-started` | `auth.status === 'ready'` | `signInPending = true`, `auth.failure = null`. |
| `auth/sign-in-failed` | — | `signInPending = false`, `auth.failure` set. |
| `accounts/changed` | — | Replace `accounts`. |
| `session/ended` | — | If `mode === 'live'` and `did === activeDid`: apply the `data/cleared` effect and, unless `reason === 'signed-out'`, add notice `session-ended` (info): "Your sign-in for this account ended, so its data was cleared. Sign in again to continue." Otherwise no change. |
| `load/started` | `runId === load.runId + 1` | `mode`, `activeDid = did`, `demoScenario` set; `load = { status: 'loading', runId, progress: null, failure: null, acquisitionMs: null }`; `snapshot = null`; `analysis` reset to idle with `range = state.range`; remove notices `session-ended` and `analysis-fallback`. |
| `load/progress` | `runId === load.runId` and loading | Set `progress`. |
| `load/snapshot-ready` | same | `snapshot` set; `load.status = 'ready'`, `progress = null`, `acquisitionMs` set. |
| `load/failed` | same | `load.status = 'failed'`, `failure` set, `progress = null`; snapshot stays null. |
| `load/cancelled` | same | `load.status = 'cancelled'`, `progress = null`; snapshot stays null. |
| `analysis/started` | `runId === load.runId` and `snapshot !== null` | `analysis = { status: 'running', range, result: null, … null }`. |
| `analysis/ready` | `runId === load.runId`, `snapshot !== null`, `range === state.range` | `analysis` = ready with result, `ranIn`, `fallbackReason`, `durationMs`. |
| `analysis/failed` | same as ready | `analysis.status = 'failed'`, failure set, result null. |
| `view/selected` | view differs | Set `view`. |
| `range/selected` | range differs | Set `range` (analysis is recomputed by the controller). |
| `data/cleared` | — | `mode = 'none'`, `demoScenario = null`, `activeDid = null`, `snapshot = null`, `analysis` idle, `load = { status: 'idle', runId: load.runId + 1, … null }`. Accounts, auth, view, range are kept. |
| `notice/added` | — | Replace the notice with the same code, else append. |
| `notice/dismissed` | code present | Remove it. |

The reducer never mutates its input (tests deep-freeze the state).

### Store
`createAppStore(initial)` (null → `createInitialState()`). `dispatch` runs `reduce`; if the reference changed, store it and call every listener synchronously with the new state, in subscription order. A listener that throws must not stop the others. `subscribe` returns an unsubscribe function. Dispatching from inside a listener is allowed (queue it until the current notification finishes).

### Controller
State kept in the closure: the current `AbortController`, the current `SessionRef`, and the unsubscribe handle for auth events. **No action ever rejects.**

`load(mode, session, ports, scenario)` — the only place that reads data:
1. Abort the previous run. `runId = store.getState().load.runId + 1`. Refuse (no-op) if `mode === 'live'` and `session.source !== 'oauth'`, or `mode === 'demo'` and `session.source !== 'demo'`. Dispatch `load/started`. `t0 = nowMs()`.
2. Progress `verifying-account`. `verified = await ports.accounts.verify({ session, signal })`. In live mode dispatch `accounts/changed` afterwards (success or failure). On `err` → `load/failed` and stop.
3. Inventory: `verified.repo !== null` → `registry.inventory(verified.repo.collections)` (`inventoryStatus: 'known'`); else `'unknown'` and every registered collection is read.
4. For each `registry.analysedCollections()` entry **in order** (progress `reading-records`, `collection`, `done`, `total`): if the inventory is known and lists it as absent → create `Coverage { collection, status: 'complete', reasonCode: 'not-present', reason: 'Your repository has no records in this collection (an observed zero).', pagesFetched: 0, returned: 0, accepted: 0, rejected: 0, duplicates: 0, failure: null }` **without a request**; otherwise `await ports.repo.listCollection({ session, did: session.did, pdsOrigin: identity.pdsOrigin, signal, collection, pageSize: def.pageSize, maxPages: deps.maxPagesPerCollection, onProgress: null })`.
5. Progress `reading-counts`. URIs = accepted raw records whose collection has a non-null `engagementSource`, in read order. `lookup = await ports.engagement.getCounts({ session, uris, signal, onProgress })` (forward batch progress as `load/progress`).
6. Progress `normalising`. `normalizer.normalize({ did: session.did, records: allRaw, engagement: lookup.results })`.
7. Build the `Snapshot`: `schemaVersion: 1`, `mode`, `demoScenario`, `account = verified.identity`, `fetchedAt = ports.now()`, `records`, `skipped = [...fetchRejected (read order), ...normalizeSkipped]`, `coverage` (registry order, exactly one per analysed collection), `engagementCoverage = lookup.coverage`, `inventoryStatus`, `unanalysedCollections = inventory.presentNotAnalysed` (or `[]`), and `notices` in this order when they apply:
   `demo-synthetic` (info, `DEMO_BANNER_TEXT`) in demo mode · `non-atomic-read` (info) "Live reads happen one after another, not as one atomic snapshot; records can change while reading." in live mode · `coverage-incomplete` (warning) "Some collections are partial or unavailable. Their numbers are lower bounds or unknown." · `inventory-unknown` (warning) "Your repository's collection list could not be read; collections that are present but not analysed cannot be listed." · `engagement-incomplete` (warning) "Some interaction counters could not be read. They are shown as unknown, not zero." · `records-skipped` (info) "{n} record(s) could not be interpreted and were set aside with a reason." · `handle-not-valid` (warning) "This account's handle could not be confirmed."
8. `signal.throwIfAborted()`; dispatch `load/snapshot-ready` with `acquisitionMs = nowMs() − t0`.
9. `analyse(runId)`: dispatch `analysis/started` with the current range; `job = { jobId: \`${runId}:${range}\`, snapshot, registry: registry.data, analytics: { ...deps.analytics, range }, privacy: deps.privacy }`; `outcome = await runner.run(job, signal)`; `ok` → `analysis/ready` (and, when `fallbackReason` is not null and not `worker-unavailable`, `notice/added` `analysis-fallback` (info): "Analysis ran on the main thread because the background worker did not answer."); `err` → `analysis/failed`.
10. Errors: after **every** `await`, `signal.throwIfAborted()`. Catch at the top of `load`: an abort error → dispatch nothing (the action that aborted has already dispatched); anything else → `load/failed` with `makeFailure('internal', 'Something went wrong while reading this account.')`.

Actions:

| Action | Behaviour |
|---|---|
| `start()` | `auth === null` → `auth/unavailable` (`unsupported`, "Live sign-in is not available in this build."). Else: subscribe `auth.onSessionEnded` → `{ live.accounts.markNeedsSignIn(did); dispatch accounts/changed; if did is the active live DID: abort the run; dispatch session/ended }`. `r = await auth.init()`; `err` → `auth/unavailable`; `ok` → `auth/ready` with `auth.disclosure`, and if `r.value.problem !== null` also `auth/sign-in-failed` with that problem (signed out, sign-in still usable). Dispatch `accounts/changed` with `live.accounts.list()`. If `live.accounts.storageFailure()` → notice `storage-unavailable` (warning). If a session was returned → `load('live', session, live, null)`. Calling `start` twice is a no-op the second time. |
| `signIn(handle)` | No auth or `auth.status !== 'ready'` → no-op. `auth/sign-in-started`; `r = await auth.signIn(handle)`; `err` → `auth/sign-in-failed`. |
| `switchAccount(did)` | `r = await auth.restore(did)`; `err` → `markNeedsSignIn`, `accounts/changed`, `auth/sign-in-failed`; `ok` → `load('live', r.value, live, null)`. |
| `signOut(did)` | Abort the run if `did` is active. `await auth.signOut(did)` (failure → `notice/added` is not needed; local data is cleared regardless). `markNeedsSignIn(did)`; `accounts/changed`; if active → `session/ended` with reason `signed-out`. |
| `removeAccount(did)` | As `signOut`, then `live.accounts.remove(did)` and `accounts/changed`. |
| `enterDemo(scenario)` | `ports = deps.demo(scenario)`; `load('demo', ports.session, ports, scenario)`. Never touches `live.accounts` or `auth`. |
| `exitDemo()` | If `mode === 'demo'`: abort; `data/cleared`. |
| `reload()` | Live with a current session → `load('live', …)`; demo → `enterDemo(state.demoScenario)`; else no-op. |
| `cancelLoad()` | If loading: read `runId`, abort, dispatch `load/cancelled`. |
| `selectView(view)` | Dispatch. |
| `selectRange(range)` | Dispatch `range/selected`; if a snapshot exists, abort only the previous analysis (not the snapshot) and run `analyse(runId)` again. No network. |
| `clearData()` | Abort; `data/cleared`. |
| `dismissNotice(code)` | Dispatch. |

## Data received / sent
Receives: results from every port (`VerifiedAccount`, `CollectionRead`, `EngagementLookup`, `NormalizeResult`, `AnalysisOutcome`), auth events, UI intents. Sends: `AppState` to subscribers; requests to ports. Nothing is persisted by this module.

## Error behaviour
Port failures become state (`load.failure`, `auth.failure`, coverage, notices). Aborts are swallowed after the triggering action has updated the state. Unexpected exceptions become an `internal` failure. Actions never reject and never throw synchronously.

## Invariants this module must enforce
- I-1 self-only: the DID that is read is always `session.did` of a session obtained from `auth` (live) or from the demo ports (demo). No action accepts a DID to *read* without going through `auth.restore`. There is no "look up a handle" action.
- I-6 cancelled never publishes: enforced twice — `throwIfAborted` after every await, and the reducer's `runId` guard.
- I-5 / I-7: coverage from the adapters is stored unchanged; the controller never invents a `complete` except the documented `not-present` case.
- Account isolation: `load/started` and `data/cleared` drop the previous snapshot and analysis before anything else is shown.
- Demo isolation: demo runs never read or write live accounts, storage or auth.
- `snapshot.coverage` has exactly one row per analysed collection, in registry order.
- `AppState` is plain data and is never mutated in place.

## Out of scope
Rendering; persistence of snapshots or analytics (no history store); background refresh or polling; retries (the user reloads); parallel collection reads (sequential by decision; measure `acquisitionMs` first); routing/URL state; undo.

## Dependencies
Types only from: `shared`, `auth`, `accounts`, `adapters/atproto`, `adapters/bluesky`, `adapters/fixtures` (`DemoScenarioId`), `registry`, `normalize`, `analytics`, `analytics/privacy`, `analytics/worker`. Runtime: `shared` (`makeFailure`, `isAbortError`, `DEMO_BANNER_TEXT`). Every port is injected; unit tests use hand-written fakes for all of them.

## File layout
```
src/analytics/state/
  contract.ts          (frozen)
  index.ts
  initial.ts           createInitialState
  reducer.ts           reduce
  store.ts             createAppStore
  controller.ts        createAppController
  pipeline.ts          the load() sequence (pure of DOM; takes ports)
  testkit.ts           fake ports / fake runner / sample snapshot (test-only)
  reducer.test.ts
  store.test.ts
  controller.test.ts
  pipeline.test.ts
```

## Test plan (write these first)
**reducer**
- initial state matches the documented literal.
- `load/started` with `runId = current + 1` clears snapshot and analysis and sets mode/activeDid; with any other runId returns the same reference.
- `load/progress`, `snapshot-ready`, `failed`, `cancelled` with a stale runId return the same reference.
- `load/snapshot-ready` after `load/cancelled` (same runId) is ignored (status is no longer loading).
- `analysis/ready` with a range different from `state.range` is ignored; with a stale runId is ignored; without a snapshot is ignored.
- `range/selected` with the current range returns the same reference.
- `data/cleared` keeps accounts/auth/view/range, clears data, increments runId.
- `session/ended` for the active live DID clears data and adds the notice; with reason `signed-out` clears without a notice; for another DID, or in demo mode, changes nothing.
- `notice/added` replaces a notice with the same code; `notice/dismissed` removes it; dismissing a missing code returns the same reference.
- `auth/sign-in-started` is ignored unless auth is ready.
- no event mutates a deep-frozen input state.

**store**
- listeners run synchronously on change and not when the reference is unchanged.
- unsubscribe stops notifications; a throwing listener does not block the next one.
- a dispatch made inside a listener is applied after the current notification, in order.

**pipeline / controller** (fake ports record their calls)
- demo happy path: events arrive in the order `load/started`, progress…, `load/snapshot-ready`, `analysis/started`, `analysis/ready`; final state has a snapshot with `mode: 'demo'` and the `demo-synthetic` notice.
- `listCollection` is called once per present collection in registry order with `did === session.did`, the verified `pdsOrigin`, the registry `pageSize` and the configured `maxPages`.
- an absent collection gets `not-present` coverage and **no** `listCollection` call.
- describeRepo failed (`repo: null`) → every registered collection is read, `inventoryStatus: 'unknown'`, notice `inventory-unknown`.
- `getCounts` receives only URIs from collections with an engagement source.
- `normalize` receives all raw records and the lookup results; `snapshot.skipped` = fetch rejects followed by normalize skips.
- `snapshot.fetchedAt` comes from `ports.now()`.
- coverage with a partial row adds `coverage-incomplete`; unknown counters add `engagement-incomplete`; handle not valid adds `handle-not-valid`.
- `verify` fails → `load/failed` with that failure, no `listCollection` call, accounts list refreshed (live).
- runner returns `err` → `analysis/failed`; snapshot is still shown.
- runner reports `worker-timeout` → `analysis-fallback` notice; `worker-unavailable` → no notice.
- **cancel mid-read**: `cancelLoad()` while `listCollection` is pending → state `cancelled`, snapshot null; resolving the pending port afterwards changes nothing (no `snapshot-ready`).
- **supersede**: start demo `complete`, then `enterDemo('empty')` before the first finishes → only the second snapshot is ever published; the first run's signal is aborted.
- **sign-out mid-read**: `signOut(activeDid)` during a live read → no snapshot appears afterwards.
- **session ended event** during a live read → run aborted, data cleared, account marked `needs-sign-in`, notice present.
- `selectRange('7d')` with a snapshot → no port except the runner is called; `analysis/ready` carries range `7d`; a slower earlier analysis for `30d` finishing later is ignored.
- `selectRange` without a snapshot only changes the range.
- `start()` with `auth: null` → `auth/unavailable`; demo still loads.
- `start()` with a restored session → live load for exactly that DID; with no session → no load.
- `start()` when `auth.init` fails → `auth/unavailable` with the failure.
- `start()` when `auth.init` resolves ok with a `problem` and no session → auth is `ready`, `auth.failure` is the problem, no load starts.
- `signIn` failure → `auth.failure` set and `signInPending` false; while auth is not ready → no call to `auth.signIn`.
- `switchAccount`: restore ok → loads that DID; restore fails → no load, account marked.
- `removeAccount` calls `auth.signOut` then `accounts.remove`, and clears data if it was active.
- live load refuses a session with `source: 'demo'`; demo load never calls `live.accounts`, `auth` or the live repo.
- a port that throws a non-abort error → `load/failed` with kind `internal`; no unhandled rejection.
- no action rejects in any of the cases above.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/analytics.md` (State, M6c) — snapshot only; `null` for failed fetches; keep session state (M1) separate from derived analytics state; mark fresh posts "settling" (done in analytics); no server-side history; if a cache is ever added it must be behind a visible "Clear data" control (no cache in the MVP).
- Port from the prototype (same project): the `generation` / `AbortController` pattern and `readOwn`, `stop`, `clear` in `SocialLens/src/main.ts`; `LiveRepository.load` in `SocialLens/src/adapters/atproto.ts` for the sequence and warning wording; `SocialLens/tests/integration.test.mjs` for cancellation regressions.
- Ideas (read-only, **MIT**): `BS/social-app/src/state/session/reducer.ts` for a session reducer kept apart from data state. Do not copy its React bindings.
- Open point for issue #3: this module is application state plus orchestration, not analytics; it sits under `analytics/` only because the proposed tree draws it there (see PLAN.md §11).
