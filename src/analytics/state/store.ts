import type { AppEvent, AppState, AppStore, CreateAppStore } from './contract';
import { createInitialState } from './initial';
import { reduce } from './reducer';

/**
 * Synchronous store. Listeners are notified in subscription order after every dispatch that
 * produced a new state reference. A dispatch made while listeners are being notified is queued
 * and applied after the current notification round finishes (FIFO). A throwing listener is
 * isolated so the others still run.
 */
export const createAppStore: CreateAppStore = (initial: AppState | null): AppStore => {
  let state = initial ?? createInitialState();
  let listeners: readonly ((state: AppState) => void)[] = [];
  const queue: AppEvent[] = [];
  let draining = false;

  function notify(next: AppState): void {
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        // Isolate a faulty listener: report it, but never interrupt the others or the dispatcher.
        console.error('AppStore listener threw', error);
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners = [...listeners, listener];
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners = listeners.filter((l) => l !== listener);
      };
    },
    dispatch(event) {
      queue.push(event);
      if (draining) return;
      draining = true;
      try {
        while (queue.length > 0) {
          const next = reduce(state, queue.shift() as AppEvent);
          if (next !== state) {
            state = next;
            notify(next);
          }
        }
      } finally {
        draining = false;
      }
    },
  };
};
