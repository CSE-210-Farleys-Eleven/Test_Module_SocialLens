/**
 * M6b `analytics/worker/` — FROZEN CONTRACT.
 * Runs analytics + privacy off the main thread, with a timeout and a main-thread fallback.
 * Everything posted in either direction is plain structured-cloneable data. Types only.
 */
import type { Failure, Result, Snapshot } from '../../shared/contract';
import type { RegistryData } from '../../registry/contract';
import type { AnalyticsOptions, AnalyticsReport, ComputeAnalytics } from '../contract';
import type { ComputePrivacy, PrivacyOptions, PrivacyReport } from '../privacy/contract';

export interface AnalysisJob {
  /** Unique per run; echoes back in the response so late messages can be ignored. */
  readonly jobId: string;
  readonly snapshot: Snapshot;
  readonly registry: RegistryData;
  readonly analytics: AnalyticsOptions;
  readonly privacy: PrivacyOptions;
}

export interface AnalysisResult {
  readonly analytics: AnalyticsReport;
  readonly privacy: PrivacyReport;
}

/** The whole computation as one pure function. Built once from the two pure modules. */
export type ComputeAnalysis = (job: AnalysisJob) => AnalysisResult;

export interface ComputeAnalysisDeps {
  readonly computeAnalytics: ComputeAnalytics;
  readonly computePrivacy: ComputePrivacy;
}

export type CreateComputeAnalysis = (deps: ComputeAnalysisDeps) => ComputeAnalysis;

// ── wire protocol ──

export type WorkerRequest = { readonly type: 'analyse'; readonly job: AnalysisJob };

export type WorkerResponse =
  | { readonly type: 'result'; readonly jobId: string; readonly result: AnalysisResult }
  | { readonly type: 'error'; readonly jobId: string; readonly message: string };

/** Minimal main-thread view of a Worker. Obtain one from a real `Worker` with `adaptWorker`. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  /** Set by the runner. `data` is untrusted until checked against WorkerResponse. */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Minimal worker-side view of the global scope. */
export interface WorkerScopeLike {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

export type AdaptWorker = (worker: Worker) => WorkerLike;

/** Worker-side: listen for 'analyse', run `compute`, post 'result' or 'error'. Never throws out of the handler. */
export type InstallWorkerHandler = (scope: WorkerScopeLike, compute: ComputeAnalysis) => void;

// ── main-thread runner ──

export type FallbackReason = 'worker-unavailable' | 'worker-error' | 'worker-timeout' | 'bad-worker-message';

export interface AnalysisOutcome {
  readonly result: AnalysisResult;
  readonly ranIn: 'worker' | 'main-thread';
  /** Why the main thread was used; null when the worker answered. */
  readonly fallbackReason: FallbackReason | null;
  /** Wall-clock duration of the whole run, including a failed worker attempt. */
  readonly durationMs: number;
}

export interface AnalysisRunner {
  /**
   * Resolves ok with an outcome, or err('internal') only if the main-thread fallback itself threw.
   * Rejects only with the caller's AbortError; on abort the worker is terminated and nothing is published.
   */
  run(job: AnalysisJob, signal: AbortSignal): Promise<Result<AnalysisOutcome, Failure>>;
  /** Terminate any live worker. Safe to call repeatedly. */
  dispose(): void;
}

export interface TimerPort {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnalysisRunnerDeps {
  /** Creates a fresh worker per run; null when Workers are unavailable (then every run uses the main thread). May throw. */
  readonly spawnWorker: (() => WorkerLike) | null;
  /** Main-thread fallback: the same function the worker runs. */
  readonly compute: ComputeAnalysis;
  /** Worker budget in ms (LIMITS.analysisTimeoutMs). */
  readonly timeoutMs: number;
  readonly nowMs: () => number;
  readonly timers: TimerPort;
}

export type CreateAnalysisRunner = (deps: AnalysisRunnerDeps) => AnalysisRunner;
