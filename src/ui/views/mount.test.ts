// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { AppState, AppStoreReader } from '../../analytics/state/contract';
import { createViews, mountApp, TEST_IDS } from './index';
import type { Views } from './contract';
import { createFakeActions, demoReadyState, initialState, makeDeps } from './testkit';

function fakeStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<(s: AppState) => void>();
  const store: AppStoreReader = {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const set = (next: AppState) => {
    state = next;
    for (const l of listeners) l(next);
  };
  return { store, set, listeners };
}

function setup(initial: AppState = initialState()) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const views = createViews(makeDeps());
  const spy = vi.fn(views.shell);
  const wrapped: Views = { ...views, shell: spy };
  const { store, set, listeners } = fakeStore(initial);
  const actions = createFakeActions();
  const app = mountApp({ root, store, actions, views: wrapped });
  return { root, spy, set, listeners, app };
}

describe('mountApp', () => {
  it('renders once on mount and again after a store notification', () => {
    const { root, spy, set } = setup();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(root.querySelector(`[data-testid="${TEST_IDS.landing}"]`)).not.toBeNull();
    set(demoReadyState());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(root.querySelector(`[data-testid="${TEST_IDS.demoBanner}"]`)).not.toBeNull();
  });

  it('restores focus to the element with the same id after a re-render', () => {
    const { root, set } = setup(demoReadyState());
    const nav = root.querySelector<HTMLButtonElement>('[data-testid="nav-item-activity"]')!;
    expect(nav.id).not.toBe('');
    nav.focus();
    expect(document.activeElement).toBe(nav);
    set(demoReadyState({ view: 'activity' }));
    const next = root.querySelector<HTMLButtonElement>('[data-testid="nav-item-activity"]')!;
    expect(next).not.toBe(nav);
    expect(document.activeElement).toBe(next);
  });

  it('restores focus and caret in the handle input', () => {
    const { root, set } = setup(initialState({ view: 'accounts' }));
    const input = root.querySelector<HTMLInputElement>(`[data-testid="${TEST_IDS.handleInput}"]`)!;
    input.focus();
    input.value = 'abc.example';
    input.dispatchEvent(new Event('input'));
    input.setSelectionRange(2, 2);
    set(initialState({ view: 'accounts', notices: [{ code: 'storage-unavailable', level: 'warning', message: 'm' }] }));
    const next = root.querySelector<HTMLInputElement>(`[data-testid="${TEST_IDS.handleInput}"]`)!;
    expect(next).not.toBe(input);
    expect(document.activeElement).toBe(next);
    expect(next.value).toBe('abc.example');
    expect(next.selectionStart).toBe(2);
  });

  it('unmount() stops re-rendering and empties the root', () => {
    const { root, spy, set, listeners, app } = setup();
    app.unmount();
    expect(root.childNodes).toHaveLength(0);
    expect(listeners.size).toBe(0);
    set(demoReadyState());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(root.childNodes).toHaveLength(0);
  });
});
