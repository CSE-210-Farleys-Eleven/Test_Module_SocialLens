import { describe, expect, it, vi } from 'vitest';
import type {
  AnalysisJob,
  AnalysisOutcome,
  AnalysisResult,
  AnalysisRunnerDeps,
  ComputeAnalysis,
  TimerPort,
  WorkerLike,
  WorkerRequest,
} from './contract';
import { createAnalysisRunner } from './index';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  posted: WorkerRequest[] = [];
  terminated = 0;
  postThrows: Error | null = null;
  onTerminate: (() => void) | null = null;
  postMessage(m: WorkerRequest) {
    if (this.postThrows) throw this.postThrows;
    this.posted.push(m);
  }
  terminate() {
    this.terminated += 1;
    this.onTerminate?.();
  }
  /** Calls the handler captured at call time (a late message after nulling is a no-op). */
  say(data: unknown) {
    this.onmessage?.({ data });
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

class ManualTimers implements TimerPort {
  pending = new Map<number, () => void>();
  cleared: number[] = [];
  private next = 1;
  setTimeout(cb: () => void) {
    const id = this.next++;
    this.pending.set(id, cb);
    return id;
  }
  clearTimeout(h: unknown) {
    this.cleared.push(h as number);
    this.pending.delete(h as number);
  }
  fireAll() {
    for (const [id, cb] of [...this.pending]) {
      this.pending.delete(id);
      cb();
    }
  }
}

const job = (jobId = 'j1'): AnalysisJob => ({ jobId, snapshot: 's' }) as unknown as AnalysisJob;
const result = (tag = 'r'): AnalysisResult => ({ analytics: { tag }, privacy: { tag } }) as unknown as AnalysisResult;
const stubCompute = (): ComputeAnalysis & { calls: number } => {
  const f = ((j: AnalysisJob) => {
    f.calls += 1;
    return result(`main-${j.jobId}`);
  }) as ComputeAnalysis & { calls: number };
  f.calls = 0;
  return f;
};

function setup(over: Partial<AnalysisRunnerDeps> = {}) {
  const workers: FakeWorker[] = [];
  const timers = new ManualTimers();
  const compute = stubCompute();
  let clock = 1000;
  const spawnWorker = vi.fn(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  const deps: AnalysisRunnerDeps = {
    spawnWorker,
    compute,
    timeoutMs: 5000,
    nowMs: () => clock,
    timers,
    ...over,
  };
  const runner = createAnalysisRunner(deps);
  return { runner, workers, timers, compute, spawnWorker, advance: (ms: number) => void (clock += ms) };
}

const value = (r: { ok: boolean }): AnalysisOutcome => {
  if (!(r as { ok: true }).ok) throw new Error('expected ok');
  return (r as unknown as { value: AnalysisOutcome }).value;
};
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('runner: worker path', () => {
  it('posts exactly { type: analyse, job } and resolves ok from a matching result', async () => {
    const { runner, workers } = setup();
    const j = job();
    const p = runner.run(j, new AbortController().signal);
    expect(workers[0]!.posted).toEqual([{ type: 'analyse', job: j }]);
    workers[0]!.say({ type: 'result', jobId: 'j1', result: result('w') });
    const o = value(await p);
    expect(o).toMatchObject({ ranIn: 'worker', fallbackReason: null, result: result('w') });
  });

  it('terminates the worker, clears the timer and nulls handlers after success', async () => {
    const { runner, workers, timers, compute } = setup();
    const p = runner.run(job(), new AbortController().signal);
    expect(timers.pending.size).toBe(1);
    workers[0]!.say({ type: 'result', jobId: 'j1', result: result() });
    await p;
    expect(workers[0]!.terminated).toBe(1);
    expect(timers.pending.size).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[0]!.onerror).toBeNull();
    expect(compute.calls).toBe(0);
  });

  it('durationMs is the fake clock difference', async () => {
    const { runner, workers, advance } = setup();
    const p = runner.run(job(), new AbortController().signal);
    advance(123);
    workers[0]!.say({ type: 'result', jobId: 'j1', result: result() });
    expect(value(await p).durationMs).toBe(123);
  });

  it('ignores a result with a different jobId, then resolves on the right one', async () => {
    const { runner, workers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    workers[0]!.say({ type: 'result', jobId: 'other', result: result('stale') });
    workers[0]!.say({ type: 'error', jobId: 'other', message: 'stale' });
    expect(workers[0]!.terminated).toBe(0);
    workers[0]!.say({ type: 'result', jobId: 'j1', result: result('right') });
    expect(value(await p).result).toEqual(result('right'));
  });

  it('a late message after resolution has no effect', async () => {
    const { runner, workers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    const w = workers[0]!;
    const handler = w.onmessage!;
    w.say({ type: 'result', jobId: 'j1', result: result('first') });
    const o = value(await p);
    handler({ data: { type: 'result', jobId: 'j1', result: result('second') } });
    w.say({ type: 'result', jobId: 'j1', result: result('third') });
    expect(o.result).toEqual(result('first'));
    expect(w.terminated).toBe(1);
  });
});

describe('runner: fallback path', () => {
  it('spawnWorker null -> main-thread, worker-unavailable', async () => {
    const { runner, compute } = setup({ spawnWorker: null });
    const o = value(await runner.run(job(), new AbortController().signal));
    expect(o).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-unavailable', result: result('main-j1') });
    expect(compute.calls).toBe(1);
  });

  it('spawnWorker throws -> worker-unavailable', async () => {
    const { runner } = setup({
      spawnWorker: () => {
        throw new Error('no');
      },
    });
    const o = value(await runner.run(job(), new AbortController().signal));
    expect(o).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-unavailable' });
  });

  it('postMessage throws -> worker-error, worker terminated, timer cleared', async () => {
    const workers: FakeWorker[] = [];
    const timers = new ManualTimers();
    const { runner } = setup({
      timers,
      spawnWorker: () => {
        const w = new FakeWorker();
        w.postThrows = new Error('DataCloneError');
        workers.push(w);
        return w;
      },
    });
    const o = value(await runner.run(job(), new AbortController().signal));
    expect(o).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-error' });
    expect(workers[0]!.terminated).toBe(1);
    expect(timers.pending.size).toBe(0);
  });

  it('worker error message -> worker-error', async () => {
    const { runner, workers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    workers[0]!.say({ type: 'error', jobId: 'j1', message: 'bad' });
    const o = value(await p);
    expect(o).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-error' });
    expect(workers[0]!.terminated).toBe(1);
  });

  it('onerror -> worker-error', async () => {
    const { runner, workers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    workers[0]!.fail();
    expect(value(await p)).toMatchObject({ fallbackReason: 'worker-error', ranIn: 'main-thread' });
    expect(workers[0]!.terminated).toBe(1);
  });

  it.each([
    ['result 42', { type: 'result', jobId: 'j1', result: 42 }],
    ['foo', { foo: 1 }],
    ['null', null],
    ['string', 'hello'],
    ['result without privacy', { type: 'result', jobId: 'j1', result: { analytics: {} } }],
    ['result without jobId', { type: 'result', result: { analytics: {}, privacy: {} } }],
    ['unknown type', { type: 'weird', jobId: 'j1' }],
  ])('malformed message (%s) -> bad-worker-message', async (_n, data) => {
    const { runner, workers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    workers[0]!.say(data);
    expect(value(await p)).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'bad-worker-message' });
    expect(workers[0]!.terminated).toBe(1);
  });

  it('timer fires -> worker-timeout, terminated; later message ignored', async () => {
    const { runner, workers, timers } = setup();
    const p = runner.run(job(), new AbortController().signal);
    const w = workers[0]!;
    const handler = w.onmessage!;
    timers.fireAll();
    const o = value(await p);
    expect(o).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-timeout' });
    expect(w.terminated).toBe(1);
    handler({ data: { type: 'result', jobId: 'j1', result: result('late') } });
    expect(o.result).toEqual(result('main-j1'));
    expect(w.terminated).toBe(1);
  });

  it('uses the configured timeout', () => {
    const calls: number[] = [];
    const timers: TimerPort = { setTimeout: (_cb, ms) => (calls.push(ms), 1), clearTimeout: () => {} };
    const { runner } = setup({ timers, timeoutMs: 777 });
    void runner.run(job(), new AbortController().signal);
    expect(calls).toEqual([777]);
  });

  it('fallback result deep-equals the worker path result for the same stub', async () => {
    const shared = stubCompute();
    const a = setup({ compute: shared });
    const pa = a.runner.run(job(), new AbortController().signal);
    a.workers[0]!.say({ type: 'result', jobId: 'j1', result: shared(job()) });
    const viaWorker = value(await pa);
    const b = setup({ compute: shared, spawnWorker: null });
    const viaMain = value(await b.runner.run(job(), new AbortController().signal));
    expect(viaMain.result).toEqual(viaWorker.result);
  });

  it('main-thread compute throws -> err internal, no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { runner } = setup({
      spawnWorker: null,
      compute: () => {
        throw new Error('secret detail');
      },
    });
    const r = await runner.run(job(), new AbortController().signal);
    await flush();
    process.off('unhandledRejection', unhandled);
    expect(r).toMatchObject({ ok: false, failure: { kind: 'internal', message: 'The analysis could not be completed.' } });
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('runner: cancellation', () => {
  it('already aborted -> rejects; nothing spawned or computed', async () => {
    const { runner, spawnWorker, compute } = setup();
    const ac = new AbortController();
    ac.abort(new DOMException('x', 'AbortError'));
    await expect(runner.run(job(), ac.signal)).rejects.toBe(ac.signal.reason);
    expect(spawnWorker).not.toHaveBeenCalled();
    expect(compute.calls).toBe(0);
  });

  it('abort while waiting -> rejects with reason, terminated, timer cleared, no compute', async () => {
    const { runner, workers, timers, compute } = setup();
    const ac = new AbortController();
    const p = runner.run(job(), ac.signal);
    const reason = new DOMException('stop', 'AbortError');
    ac.abort(reason);
    await expect(p).rejects.toBe(reason);
    expect(workers[0]!.terminated).toBe(1);
    expect(timers.pending.size).toBe(0);
    expect(compute.calls).toBe(0);
  });

  it('abort after a worker failure but before fallback -> rejects, no compute', async () => {
    const { runner, workers, compute } = setup();
    const ac = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    const p = runner.run(job(), ac.signal);
    workers[0]!.onTerminate = () => ac.abort(reason);
    workers[0]!.fail();
    await expect(p).rejects.toBe(reason);
    expect(compute.calls).toBe(0);
  });

  it('a result arriving after abort is not delivered', async () => {
    const { runner, workers } = setup();
    const ac = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    const p = runner.run(job(), ac.signal);
    const w = workers[0]!;
    const handler = w.onmessage!;
    ac.abort(reason);
    handler({ data: { type: 'result', jobId: 'j1', result: result() } });
    w.say({ type: 'result', jobId: 'j1', result: result() });
    await expect(p).rejects.toBe(reason);
    expect(w.terminated).toBe(1);
  });

  it('timer firing after abort does nothing', async () => {
    const { runner, timers, compute } = setup();
    const ac = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    const p = runner.run(job(), ac.signal);
    ac.abort(reason);
    timers.fireAll();
    await expect(p).rejects.toBe(reason);
    expect(compute.calls).toBe(0);
  });
});

describe('runner: lifecycle', () => {
  it('two concurrent runs use two workers and resolve with their own results', async () => {
    const { runner, workers } = setup();
    const p1 = runner.run(job('a'), new AbortController().signal);
    const p2 = runner.run(job('b'), new AbortController().signal);
    expect(workers).toHaveLength(2);
    workers[1]!.say({ type: 'result', jobId: 'b', result: result('B') });
    workers[0]!.say({ type: 'result', jobId: 'a', result: result('A') });
    expect(value(await p1).result).toEqual(result('A'));
    expect(value(await p2).result).toEqual(result('B'));
  });

  it('dispose terminates live workers (runs fall back as worker-error) and is idempotent', async () => {
    const { runner, workers } = setup();
    const p1 = runner.run(job('a'), new AbortController().signal);
    const p2 = runner.run(job('b'), new AbortController().signal);
    runner.dispose();
    runner.dispose();
    expect(workers.map((w) => w.terminated)).toEqual([1, 1]);
    expect(value(await p1)).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-error' });
    expect(value(await p2)).toMatchObject({ ranIn: 'main-thread', fallbackReason: 'worker-error' });
  });

  it('dispose with nothing live is harmless; finished workers are not terminated twice', async () => {
    const { runner, workers } = setup();
    runner.dispose();
    const p = runner.run(job(), new AbortController().signal);
    workers[0]!.say({ type: 'result', jobId: 'j1', result: result() });
    await p;
    runner.dispose();
    expect(workers[0]!.terminated).toBe(1);
  });
});
