# M6b `analytics/worker/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Run the analytics and privacy calculations off the main thread: plain data in, plain result out, with a timeout and a main-thread fallback.

## Contribution to the whole
Keeps the UI responsive while a large repository is analysed, without making the app depend on Workers: if a Worker cannot start, crashes, answers badly or is too slow, the same pure function runs on the main thread and the user still gets a result. It also records where each run executed and how long it took, so the team can measure whether the Worker is worth having.

## What to optimise for (ranked)
1. **Always produce the same result as a direct call** — the Worker path and the fallback path are indistinguishable in output.
2. **Bounded waits and clean cancellation** — a timeout, and no message from an old or cancelled run is ever delivered.
3. Low overhead — one structured clone each way, one Worker per run.

## Public API (`src/analytics/worker/index.ts`)
```ts
export const createComputeAnalysis: CreateComputeAnalysis;  // ({ computeAnalytics, computePrivacy }) => ComputeAnalysis
export const createAnalysisRunner: CreateAnalysisRunner;    // (deps) => AnalysisRunner
export const installWorkerHandler: InstallWorkerHandler;    // (scope, compute) => void     (worker side)
export const adaptWorker: AdaptWorker;                      // (worker: Worker) => WorkerLike (main side)
```

- **`createComputeAnalysis`** → `job => ({ analytics: computeAnalytics({ snapshot, registry, options: job.analytics }), privacy: computePrivacy({ snapshot, registry, options: job.privacy }) })`. No try/catch here.
- **`installWorkerHandler(scope, compute)`** sets `scope.onmessage`. For a message whose `data` is `{ type: 'analyse', job }` with a string `job.jobId`: run `compute(job)` and post `{ type: 'result', jobId, result }`; if `compute` throws, post `{ type: 'error', jobId, message }` (message = the error's `message`, max 200 chars). Any other message is ignored. The handler itself never throws.
- **`adaptWorker(worker)`** returns a `WorkerLike` whose `postMessage`/`terminate` forward to the Worker and whose `onmessage`/`onerror` setters attach the listener to the Worker's `message` / `error` + `messageerror` events.
- **`createAnalysisRunner(deps).run(job, signal)`**:
  1. `signal.throwIfAborted()`; `t0 = nowMs()`.
  2. If `spawnWorker` is null → fallback with `worker-unavailable`. Else call it inside try/catch; a throw → fallback with `worker-unavailable`.
  3. Set `onmessage`, `onerror`, start a timer of `timeoutMs`, listen for `signal` abort, then `postMessage({ type: 'analyse', job })` (a throw here, e.g. `DataCloneError` → fallback `worker-error`).
  4. First event wins; then **always**: clear the timer, remove the abort listener, null both handlers, `terminate()` the Worker.
     - message `{ type: 'result', jobId === job.jobId, result }` with object `result.analytics` and `result.privacy` → `ok({ result, ranIn: 'worker', fallbackReason: null, durationMs })`;
     - message `{ type: 'error', … }` or `onerror` → fallback `worker-error`;
     - a message with another `jobId` → ignored (keep waiting); any other malformed message → fallback `bad-worker-message`;
     - timer → fallback `worker-timeout`;
     - abort → reject with `signal.reason` (no fallback, nothing returned).
  5. Fallback: `signal.throwIfAborted()`; run `deps.compute(job)` synchronously in try/catch. Success → `ok({ result, ranIn: 'main-thread', fallbackReason, durationMs })`. Throw → `err(makeFailure('internal', 'The analysis could not be completed.'))`.
  - Concurrent `run` calls are independent (each has its own Worker). `dispose()` terminates every live Worker; runs in flight then fall back as `worker-error`.

## Data received / sent
Receives an `AnalysisJob` (snapshot + registry data + options: all plain data). Sends `Result<AnalysisOutcome>`. Over the wire: `WorkerRequest` → `WorkerResponse`, nothing else.

## Error behaviour
`run` resolves `ok` whenever either path computed a result; `err('internal')` only when the main-thread computation threw; rejects only on caller abort. A Worker that never answers costs at most `timeoutMs`.

## Invariants this module must enforce
- I-6 cancelled never publishes: after abort no result is resolved, the Worker is terminated, and late messages are dropped.
- I-9 bounded: the timer always fires or is cleared; no Worker outlives its run.
- Messages are treated as untrusted until their shape is checked; a foreign `jobId` is never accepted.
- Nothing non-cloneable is posted (the job types guarantee it; do not add functions or `AbortSignal`s to messages).
- This module contains no metric or privacy logic of its own.

## Out of scope
A Worker pool or a long-lived Worker; transferring `ArrayBuffer`s; progress streaming; running normalisation or network reads in the Worker; SharedArrayBuffer; service workers; deciding whether a Worker is worth it (the runner reports `durationMs` so that can be measured).

## Dependencies
Types: `shared/contract`, `registry/contract`, `analytics/contract`, `analytics/privacy/contract`. Runtime: `shared` (`makeFailure`, `ok`, `err`). The two compute functions and the Worker factory are injected. The Worker entry file is **not** in this module: the composition root owns `src/worker-main.ts`, which imports the implementations and calls `installWorkerHandler`.

## File layout
```
src/analytics/worker/
  contract.ts         (frozen)
  index.ts            exports the four functions
  compute.ts          createComputeAnalysis
  runner.ts           createAnalysisRunner
  handler.ts          installWorkerHandler
  adapt.ts            adaptWorker
  runner.test.ts
  handler.test.ts
  compute.test.ts
```
Tests use a hand-written `FakeWorker implements WorkerLike` (the test decides when and what it answers), a manual `TimerPort`, a fake `nowMs`, and stub compute functions returning recognisable objects. No real `Worker` is needed (the test environment is Node).

## Test plan (write these first)
**compute**
- calls both functions once with the job's snapshot, registry and respective options, and returns `{ analytics, privacy }` as returned by them.

**handler**
- an `analyse` message → posts `result` with the same `jobId` and the compute output.
- compute throws → posts `error` with the `jobId` and a message; does not throw.
- ignores `null`, a string, `{ type: 'other' }`, and `analyse` without a `jobId`.
- handles two jobs in a row independently.

**runner — worker path**
- posts exactly `{ type: 'analyse', job }`; a matching `result` → `ok`, `ranIn: 'worker'`, `fallbackReason: null`.
- terminates the Worker and clears the timer after success.
- `durationMs` = fake clock difference.
- a `result` with a different `jobId` is ignored; the later correct one resolves.
- a late message after resolution has no effect (handlers were nulled).

**runner — fallback path**
- `spawnWorker: null` → `ranIn: 'main-thread'`, `worker-unavailable`, result equals `compute(job)`.
- `spawnWorker` throws → same.
- `postMessage` throws → `worker-error`, Worker terminated.
- Worker posts `error` → `worker-error`; `onerror` fires → `worker-error`.
- Worker posts `{ type: 'result', jobId, result: 42 }` or `{ foo: 1 }` → `bad-worker-message`.
- timer fires before any message → `worker-timeout`, Worker terminated; a message arriving afterwards is ignored.
- fallback result deep-equals what the worker path would have returned for the same stub.
- main-thread compute throws → `err` with `kind: 'internal'`; never an unhandled rejection.

**runner — cancellation**
- signal already aborted → rejects, `spawnWorker` not called, `compute` not called.
- abort while waiting → rejects with the abort reason, Worker terminated, timer cleared, `compute` not called.
- abort after a worker failure but before fallback starts → rejects; `compute` not called.
- a result message arriving after abort is not delivered.

**runner — lifecycle**
- two concurrent runs use two Workers and resolve with their own results.
- `dispose()` terminates live Workers and can be called twice.

**adaptWorker** (with a minimal `EventTarget`-based fake of `Worker`)
- forwards `postMessage` and `terminate`; a dispatched `message` event reaches `onmessage` with `data`; `error` and `messageerror` reach `onerror`; setting a handler to null stops delivery.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/analytics.md` (Performance, M6b) — copy PDSls's shape: `postMessage` plain data in, plain results out, with a timeout and a main-thread fallback; data volumes are one repo, so measure before investing further.
- Reference shape: `pdsls/src/workers/plc-validate.ts` (**0BSD**) — a ten-line `self.onmessage` handler posting `{ valid }`. Adapting it needs no attribution under 0BSD, but add a one-line header comment anyway.
- Vite worker syntax used by the composition root (for your information): `new Worker(new URL('./worker-main.ts', import.meta.url), { type: 'module' })`; `vite.config.ts` already sets `worker.format = 'es'`.
- The prototype has no worker (`SocialLens/docs/research/architecture.md`, M6b "new").
