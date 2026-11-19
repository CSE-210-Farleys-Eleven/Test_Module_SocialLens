/** IT-4 (cancel) and IT-5 (supersede): a cancelled or superseded load never publishes. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compose } from './harness';

afterEach(() => {
  vi.useRealTimers();
});

describe('IT-4 cancel mid-read', () => {
  it('ends as cancelled with no snapshot, and nothing happens afterwards', async () => {
    vi.useFakeTimers();
    const app = compose({ demoLatencyMs: 50 });
    const loading = app.actions.enterDemo('complete');
    await vi.advanceTimersByTimeAsync(120);
    expect(app.store.getState().load.status).toBe('loading');
    const requestsAtCancel = app.lastDemoServer()?.requests().length ?? 0;
    expect(requestsAtCancel).toBeGreaterThan(0);
    expect(requestsAtCancel).toBeLessThan(18);

    app.actions.cancelLoad();
    await loading;
    // The fixture server logs the one in-flight request when it is aborted (status null): nothing was served.
    const logAfterCancel = app.lastDemoServer()?.requests() ?? [];
    expect(logAfterCancel.length).toBeLessThanOrEqual(requestsAtCancel + 1);
    expect(logAfterCancel.slice(requestsAtCancel).every((r) => r.status === null)).toBe(true);
    const cancelled = app.store.getState();
    expect(cancelled.load.status).toBe('cancelled');
    expect(cancelled.snapshot).toBeNull();
    expect(cancelled.analysis.result).toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.store.getState()).toBe(cancelled);
    expect(app.lastDemoServer()?.requests().length).toBe(logAfterCancel.length);
  });
});

describe('IT-5 supersede', () => {
  it('only the newer load is ever published to subscribers', async () => {
    const app = compose();
    const seen: (string | null)[] = [];
    app.store.subscribe(() => {
      const snapshot = app.store.getState().snapshot;
      if (snapshot !== null) seen.push(snapshot.demoScenario);
    });
    const first = app.actions.enterDemo('complete');
    const second = app.actions.enterDemo('empty');
    await Promise.all([first, second]);
    const state = app.store.getState();
    expect(state.demoScenario).toBe('empty');
    expect(state.snapshot?.records).toHaveLength(0);
    expect(new Set(seen)).toEqual(new Set(['empty']));
  });
});
