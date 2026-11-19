import { err, makeFailure, ok } from '../../shared';
import type { Failure, Result } from '../../shared/contract';
import type {
  AnalysisJob,
  AnalysisOutcome,
  AnalysisResult,
  CreateAnalysisRunner,
  FallbackReason,
  WorkerLike,
} from './contract';

type Verdict =
  | { readonly kind: 'result'; readonly result: AnalysisResult }
  | { readonly kind: 'fallback'; readonly reason: FallbackReason }
  | { readonly kind: 'ignore' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Classify an untrusted worker message for the given job. */
function judge(data: unknown, jobId: string): Verdict {
  if (!isObject(data)) return { kind: 'fallback', reason: 'bad-worker-message' };
  const { type, jobId: id } = data;
  if (type !== 'result' && type !== 'error') return { kind: 'fallback', reason: 'bad-worker-message' };
  if (typeof id !== 'string') return { kind: 'fallback', reason: 'bad-worker-message' };
  if (id !== jobId) return { kind: 'ignore' };
  if (type === 'error') return { kind: 'fallback', reason: 'worker-error' };
  const result = data['result'];
  if (!isObject(result) || !isObject(result['analytics']) || !isObject(result['privacy'])) {
    return { kind: 'fallback', reason: 'bad-worker-message' };
  }
  return { kind: 'result', result: result as unknown as AnalysisResult };
}

export const createAnalysisRunner: CreateAnalysisRunner = (deps) => {
  /** One entry per live run: force it to end as a worker error (used by dispose). */
  const live = new Set<() => void>();

  function mainThread(
    job: AnalysisJob,
    signal: AbortSignal,
    t0: number,
    fallbackReason: FallbackReason,
  ): Result<AnalysisOutcome, Failure> {
    signal.throwIfAborted();
    try {
      const result = deps.compute(job);
      return ok({ result, ranIn: 'main-thread', fallbackReason, durationMs: deps.nowMs() - t0 });
    } catch {
      return err(makeFailure('internal', 'The analysis could not be completed.'));
    }
  }

  function run(job: AnalysisJob, signal: AbortSignal): Promise<Result<AnalysisOutcome, Failure>> {
    return new Promise((resolve, reject) => {
      try {
        signal.throwIfAborted();
      } catch (e) {
        reject(e);
        return;
      }
      const t0 = deps.nowMs();

      const fallback = (reason: FallbackReason): void => {
        try {
          resolve(mainThread(job, signal, t0, reason));
        } catch (e) {
          reject(e);
        }
      };

      if (deps.spawnWorker === null) return fallback('worker-unavailable');
      let worker: WorkerLike;
      try {
        worker = deps.spawnWorker();
      } catch {
        return fallback('worker-unavailable');
      }

      let settled = false;
      let timer: unknown;
      const forceFail = (): void => finish({ kind: 'fallback', reason: 'worker-error' });
      const onAbort = (): void => finish({ kind: 'abort' });

      function finish(outcome: Verdict | { readonly kind: 'abort' }): void {
        if (settled) return;
        settled = true;
        live.delete(forceFail);
        deps.timers.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        try {
          worker.terminate();
        } catch {
          // A failing terminate must not change the outcome.
        }
        if (outcome.kind === 'abort') reject(signal.reason);
        else if (outcome.kind === 'result') {
          resolve(
            ok({ result: outcome.result, ranIn: 'worker', fallbackReason: null, durationMs: deps.nowMs() - t0 }),
          );
        } else if (outcome.kind === 'fallback') fallback(outcome.reason);
      }

      worker.onmessage = (event) => {
        const verdict = judge(event.data, job.jobId);
        if (verdict.kind !== 'ignore') finish(verdict);
      };
      worker.onerror = () => finish({ kind: 'fallback', reason: 'worker-error' });
      timer = deps.timers.setTimeout(() => finish({ kind: 'fallback', reason: 'worker-timeout' }), deps.timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      live.add(forceFail);

      try {
        worker.postMessage({ type: 'analyse', job });
      } catch {
        finish({ kind: 'fallback', reason: 'worker-error' });
      }
    });
  }

  return {
    run,
    dispose() {
      for (const fail of [...live]) fail();
    },
  };
};
