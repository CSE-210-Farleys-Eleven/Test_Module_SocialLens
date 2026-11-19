// Shape adapted from pdsls (0BSD), src/workers/plc-validate.ts: plain data in, plain result out.
import type { InstallWorkerHandler } from './contract';

const MAX_MESSAGE = 200;

function errorMessage(e: unknown): string {
  try {
    const m = typeof e === 'object' && e !== null && 'message' in e ? (e as { message: unknown }).message : e;
    return String(m).slice(0, MAX_MESSAGE);
  } catch {
    return 'Analysis failed.';
  }
}

export const installWorkerHandler: InstallWorkerHandler = (scope, compute) => {
  scope.onmessage = (event) => {
    try {
      const data: unknown = event?.data;
      if (typeof data !== 'object' || data === null) return;
      const { type, job } = data as { type?: unknown; job?: unknown };
      if (type !== 'analyse' || typeof job !== 'object' || job === null) return;
      const jobId = (job as { jobId?: unknown }).jobId;
      if (typeof jobId !== 'string') return;
      try {
        const result = compute(job as Parameters<typeof compute>[0]);
        scope.postMessage({ type: 'result', jobId, result });
      } catch (e) {
        scope.postMessage({ type: 'error', jobId, message: errorMessage(e) });
      }
    } catch {
      // The handler never throws.
    }
  };
};
