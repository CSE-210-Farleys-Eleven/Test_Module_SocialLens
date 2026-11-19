import { describe, expect, it } from 'vitest';
import type { AnalysisJob, ComputeAnalysis, WorkerResponse, WorkerScopeLike } from './contract';
import { installWorkerHandler } from './index';

const job = (jobId: unknown): AnalysisJob => ({ jobId }) as unknown as AnalysisJob;

function makeScope() {
  const posted: WorkerResponse[] = [];
  const scope: WorkerScopeLike = { postMessage: (m) => void posted.push(m), onmessage: null };
  return { scope, posted };
}
const send = (scope: WorkerScopeLike, data: unknown) => scope.onmessage?.({ data });

describe('installWorkerHandler', () => {
  it('posts a result with the same jobId and the compute output', () => {
    const { scope, posted } = makeScope();
    const out = { analytics: 'A', privacy: 'P' };
    installWorkerHandler(scope, () => out as never);
    send(scope, { type: 'analyse', job: job('j1') });
    expect(posted).toEqual([{ type: 'result', jobId: 'j1', result: out }]);
  });

  it('posts an error (max 200 chars) when compute throws, without throwing', () => {
    const { scope, posted } = makeScope();
    installWorkerHandler(scope, () => {
      throw new Error('x'.repeat(500));
    });
    expect(() => send(scope, { type: 'analyse', job: job('j1') })).not.toThrow();
    expect(posted).toHaveLength(1);
    const m = posted[0]!;
    expect(m.type).toBe('error');
    expect(m.jobId).toBe('j1');
    expect((m as { message: string }).message).toBe('x'.repeat(200));
  });

  it('handles a non-Error throw', () => {
    const { scope, posted } = makeScope();
    installWorkerHandler(scope, () => {
      throw 'plain';
    });
    send(scope, { type: 'analyse', job: job('j1') });
    expect(posted[0]).toMatchObject({ type: 'error', jobId: 'j1' });
  });

  it('ignores malformed messages', () => {
    const { scope, posted } = makeScope();
    installWorkerHandler(scope, (() => ({})) as unknown as ComputeAnalysis);
    for (const data of [null, undefined, 'analyse', 5, { type: 'other' }, { type: 'analyse' }, { type: 'analyse', job: null }, { type: 'analyse', job: {} }, { type: 'analyse', job: job(7) }]) {
      expect(() => send(scope, data)).not.toThrow();
    }
    expect(posted).toEqual([]);
  });

  it('handles two jobs in a row independently', () => {
    const { scope, posted } = makeScope();
    let n = 0;
    installWorkerHandler(scope, (() => {
      n += 1;
      if (n === 1) throw new Error('first');
      return { n };
    }) as unknown as ComputeAnalysis);
    send(scope, { type: 'analyse', job: job('a') });
    send(scope, { type: 'analyse', job: job('b') });
    expect(posted).toEqual([
      { type: 'error', jobId: 'a', message: 'first' },
      { type: 'result', jobId: 'b', result: { n: 2 } },
    ]);
  });
});
