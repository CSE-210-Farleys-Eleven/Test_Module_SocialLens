import { describe, expect, it, vi } from 'vitest';
import type { AppState } from './contract';
import { createAppStore, createInitialState } from './index';

describe('createAppStore', () => {
  it('starts from createInitialState() when given null, or from the given state', () => {
    expect(createAppStore(null).getState()).toEqual(createInitialState());
    const initial = { ...createInitialState(), view: 'privacy' as const };
    expect(createAppStore(initial).getState()).toBe(initial);
  });

  it('listeners run synchronously on change and not when the reference is unchanged', () => {
    const store = createAppStore(null);
    const seen: AppState[] = [];
    store.subscribe((s) => seen.push(s));
    store.dispatch({ type: 'view/selected', view: 'privacy' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.getState());
    store.dispatch({ type: 'view/selected', view: 'privacy' });
    store.dispatch({ type: 'notice/dismissed', code: 'session-ended' });
    expect(seen).toHaveLength(1);
  });

  it('notifies listeners in subscription order', () => {
    const store = createAppStore(null);
    const order: string[] = [];
    store.subscribe(() => order.push('a'));
    store.subscribe(() => order.push('b'));
    store.dispatch({ type: 'range/selected', range: '7d' });
    expect(order).toEqual(['a', 'b']);
  });

  it('unsubscribe stops notifications', () => {
    const store = createAppStore(null);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    off();
    store.dispatch({ type: 'range/selected', range: '7d' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener does not block the next one', () => {
    const store = createAppStore(null);
    const next = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(next);
    expect(() => store.dispatch({ type: 'range/selected', range: '7d' })).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a dispatch made inside a listener is applied after the current notification, in order', () => {
    const store = createAppStore(null);
    const log: string[] = [];
    store.subscribe((s) => {
      log.push(`a:${s.view}:${s.range}`);
      if (s.view === 'privacy' && s.range === '30d') {
        store.dispatch({ type: 'range/selected', range: '7d' });
        store.dispatch({ type: 'range/selected', range: '90d' });
        log.push(`a-after-dispatch:${store.getState().range}`);
      }
    });
    store.subscribe((s) => log.push(`b:${s.view}:${s.range}`));
    store.dispatch({ type: 'view/selected', view: 'privacy' });
    expect(log).toEqual([
      'a:privacy:30d',
      'a-after-dispatch:30d',
      'b:privacy:30d',
      'a:privacy:7d',
      'b:privacy:7d',
      'a:privacy:90d',
      'b:privacy:90d',
    ]);
    expect(store.getState().range).toBe('90d');
  });

  it('a listener subscribed during notification is not called for that notification', () => {
    const store = createAppStore(null);
    const late = vi.fn();
    let added = false;
    store.subscribe(() => {
      if (!added) {
        added = true;
        store.subscribe(late);
      }
    });
    store.dispatch({ type: 'range/selected', range: '7d' });
    expect(late).not.toHaveBeenCalled();
    store.dispatch({ type: 'range/selected', range: '90d' });
    expect(late).toHaveBeenCalledTimes(1);
  });
});
