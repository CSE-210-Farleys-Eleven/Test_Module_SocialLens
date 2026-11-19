// Mount loop: render the shell now and on every store change, keeping keyboard focus by element id.
import type { MountApp } from './contract';

interface FocusMemo {
  readonly id: string;
  readonly start: number | null;
  readonly end: number | null;
}

function rememberFocus(root: HTMLElement): FocusMemo | null {
  const active = root.ownerDocument.activeElement;
  if (active === null || active.id === '' || !root.contains(active)) return null;
  const isText = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
  if (!isText) return { id: active.id, start: null, end: null };
  const field = active as HTMLInputElement | HTMLTextAreaElement;
  try {
    return { id: active.id, start: field.selectionStart, end: field.selectionEnd };
  } catch {
    return { id: active.id, start: null, end: null };
  }
}

function restoreFocus(root: HTMLElement, memo: FocusMemo | null): void {
  if (memo === null) return;
  const el = root.ownerDocument.getElementById(memo.id);
  if (el === null || !root.contains(el)) return;
  el.focus();
  if (memo.start !== null && memo.end !== null && 'setSelectionRange' in el) {
    try {
      (el as HTMLInputElement).setSelectionRange(memo.start, memo.end);
    } catch {
      // Some input types do not support selection; focus alone is enough.
    }
  }
}

export const mountApp: MountApp = ({ root, store, actions, views }) => {
  const render = (): void => {
    const memo = rememberFocus(root);
    root.replaceChildren(views.shell({ state: store.getState(), actions }));
    restoreFocus(root, memo);
  };
  render();
  const unsubscribe = store.subscribe(() => render());
  let mounted = true;
  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      unsubscribe();
      root.replaceChildren();
    },
  };
};
