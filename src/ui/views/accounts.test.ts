// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ORIGINS } from '../../shared/contract';
import type { Did, Nsid, SkippedRecord } from '../../shared/contract';
import type { AppState } from '../../analytics/state/contract';
import type { TableProps } from '../components/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import {
  byTestId,
  coverageRow,
  createFakeActions,
  demoReadyState,
  initialState,
  linkedAccount,
  liveReadyState,
  makeDeps,
  makeSnapshot,
  renderInto,
  LIVE_DID,
  OTHER_DID,
} from './testkit';

function setup() {
  const deps = makeDeps();
  const views = createViews(deps);
  const actions = createFakeActions();
  return { deps, views, actions };
}

function render(state: AppState) {
  const { deps, views, actions } = setup();
  const root = renderInto(views.accounts({ state: { ...state, view: 'accounts' }, actions }));
  return { root, actions, components: deps.components, views };
}

const btn = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

describe('accounts: sign in', () => {
  it('shows both disclosure sentences with a citation; submit calls signIn with the typed draft', () => {
    const { root, actions } = render(initialState());
    expect(byTestId(root, TEST_IDS.viewAccounts)).not.toBeNull();
    const disclosure = byTestId(root, TEST_IDS.resolverDisclosure);
    expect(disclosure?.textContent).toContain('sent to https://bsky.social');
    expect(disclosure?.textContent).toContain('Sign-in tokens are kept in this browser');
    expect(disclosure?.querySelector('[data-component="citation"]')).not.toBeNull();
    const input = byTestId(root, TEST_IDS.handleInput) as HTMLInputElement;
    expect(input.maxLength).toBe(253);
    expect(input.placeholder).toBe('name.example.com');
    input.value = 'alice.example.com';
    input.dispatchEvent(new Event('input'));
    btn(root, 'Sign in with AT Protocol')?.click();
    expect(actions.calls).toContainEqual(['signIn', 'alice.example.com']);
  });

  it('Enter in the handle field also signs in', () => {
    const { root, actions } = render(initialState());
    const input = byTestId(root, TEST_IDS.handleInput) as HTMLInputElement;
    input.value = 'carol.example.com';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(actions.calls).toContainEqual(['signIn', 'carol.example.com']);
  });

  it('button is disabled while signInPending or when auth is not ready; failure message shown', () => {
    const pending = render(initialState({ auth: { ...initialState().auth, signInPending: true } }));
    expect(btn(pending.root, 'Sign in with AT Protocol')?.disabled).toBe(true);
    const init = render(initialState({ auth: { status: 'initialising', disclosure: null, failure: null, signInPending: false } }));
    expect(btn(init.root, 'Sign in with AT Protocol')?.disabled).toBe(true);
    const failed = render(
      initialState({ auth: { ...initialState().auth, failure: { kind: 'auth', message: 'Sign-in was cancelled.', status: null, xrpcError: null, retryAfterMs: null, origin: null } } }),
    );
    expect(failed.root.textContent).toContain('Sign-in was cancelled.');
    expect(btn(failed.root, 'Sign in with AT Protocol')?.disabled).toBe(false);
  });

  it('auth unavailable shows the explanation and disables the button', () => {
    const { root } = render(initialState({ auth: { status: 'unavailable', disclosure: null, failure: null, signInPending: false } }));
    expect(root.textContent).toContain('Live sign-in is unavailable here. The synthetic demo still works.');
    expect(btn(root, 'Sign in with AT Protocol')?.disabled).toBe(true);
  });

  it('the typed draft survives a re-render caused by an unrelated state change', () => {
    const { views, actions } = setup();
    const first = renderInto(views.accounts({ state: initialState({ view: 'accounts' }), actions }));
    const input = byTestId(first, TEST_IDS.handleInput) as HTMLInputElement;
    input.value = 'draft.example.com';
    input.dispatchEvent(new Event('input'));
    const second = renderInto(views.accounts({ state: initialState({ view: 'accounts', notices: [{ code: 'storage-unavailable', level: 'warning', message: 'x' }] }), actions }));
    expect((byTestId(second, TEST_IDS.handleInput) as HTMLInputElement).value).toBe('draft.example.com');
  });

  it('there is exactly one text input in the whole view (I-1)', () => {
    for (const s of [initialState(), liveReadyState(), demoReadyState()]) {
      const { root } = render(s);
      expect(root.querySelectorAll('input, textarea')).toHaveLength(1);
    }
  });
});

describe('accounts: linked accounts', () => {
  it('one row per account with status text and the right actions', () => {
    const accounts = [
      linkedAccount(LIVE_DID),
      linkedAccount(OTHER_DID, { status: 'could-not-verify', lastFailure: { kind: 'network', message: 'CORS blocked.', status: null, xrpcError: null, retryAfterMs: null, origin: null } }),
      linkedAccount('did:plc:needssigninaccount2222222' as Did, { status: 'needs-sign-in' }),
    ];
    const { root, actions } = render(liveReadyState({ accounts }));
    const active = byTestId(root, `account-row-${LIVE_DID}`)!;
    const other = byTestId(root, `account-row-${OTHER_DID}`)!;
    expect(active.textContent).toContain('Verified');
    expect(other.textContent).toContain('Could not verify — CORS blocked.');
    expect(byTestId(root, 'account-row-did:plc:needssigninaccount2222222')?.textContent).toContain('Needs sign-in');
    expect(btn(active, 'Switch to')).toBeUndefined();
    btn(other, 'Switch to')?.click();
    btn(other, 'Sign out')?.click();
    (other.querySelector(`[data-testid="${TEST_IDS.removeAccount}"]`) as HTMLButtonElement).click();
    btn(active, 'Sign out')?.click();
    expect(actions.calls).toEqual([
      ['switchAccount', OTHER_DID],
      ['signOut', OTHER_DID],
      ['removeAccount', OTHER_DID],
      ['signOut', LIVE_DID],
    ]);
  });

  it('remove-scope-note says nothing is deleted from the account', () => {
    const { root } = render(initialState());
    expect(byTestId(root, TEST_IDS.removeScopeNote)?.textContent).toContain('Nothing is deleted from your account');
  });
});

describe('accounts: what was read', () => {
  const coverage = [coverageRow('app.bsky.feed.post', 'complete', 1234), coverageRow('app.bsky.feed.like', 'partial', 100), coverageRow('app.bsky.graph.block', 'unavailable')];

  it('coverage table: count, At least, Unknown, reason, engagement row', () => {
    const { root, components } = render(demoReadyState({ snapshot: makeSnapshot('demo', { coverage }) }));
    const table = byTestId(root, TEST_IDS.coverageTable)!;
    const text = table.textContent ?? '';
    expect(text).toContain('1,234');
    expect(text).toContain('At least 100');
    expect(text).toContain('Unknown');
    expect(text).toContain('Stopped at the 10-page limit.');
    expect(text).toContain('Posts & replies');
    expect([...table.querySelectorAll('code')].map((c) => c.textContent)).toContain('app.bsky.feed.post');
    const props = (components.callsOf('dataTable') as TableProps[]).find((t) => t.testId === TEST_IDS.coverageTable)!;
    expect(props.rows).toHaveLength(4);
    expect(text).toContain('Interaction counters');
    expect(text).toContain('All counters read.');
    expect(root.textContent).toContain('Coverage of the whole read, independent of the date range.');
  });

  it('unanalysed list shows NSIDs, none, or unknown', () => {
    const withN = render(demoReadyState({ snapshot: makeSnapshot('demo', { unanalysedCollections: ['com.whtwnd.blog.entry' as Nsid] }) }));
    expect(byTestId(withN.root, TEST_IDS.unanalysedList)?.textContent).toContain('com.whtwnd.blog.entry');
    expect(byTestId(render(demoReadyState()).root, TEST_IDS.unanalysedList)?.textContent).toContain('none');
    const unknown = render(demoReadyState({ snapshot: makeSnapshot('demo', { inventoryStatus: 'unknown' }) }));
    expect(byTestId(unknown.root, TEST_IDS.unanalysedList)?.textContent?.toLowerCase()).toContain('unknown');
  });

  it('skipped table shows at most 50 rows and the total', () => {
    const skipped: SkippedRecord[] = Array.from({ length: 60 }, (_, i) => ({
      uri: i === 0 ? null : (`at://did:plc:x/app.bsky.feed.post/${i}` as SkippedRecord['uri']),
      collection: 'app.bsky.feed.post' as Nsid,
      stage: 'normalize',
      reasonCode: 'missing-required-field',
      detail: `detail ${i}`,
    }));
    const { root, components } = render(demoReadyState({ snapshot: makeSnapshot('demo', { skipped }) }));
    const props = (components.callsOf('dataTable') as TableProps[]).find((t) => t.testId === TEST_IDS.skippedTable)!;
    expect(props.rows).toHaveLength(50);
    expect(props.rows[0]?.[0]).toBe('—');
    expect(root.textContent).toContain('60 record(s) set aside in total');
  });

  it('network lists the contacted origins', () => {
    const { root } = render(liveReadyState());
    expect(root.textContent).toContain('https://pds.example.com');
    expect(root.textContent).toContain(ORIGINS.plcDirectory);
    expect(root.textContent).toContain(ORIGINS.appView);
    expect(root.textContent).toContain('https://bsky.social');
  });

  it('measured line shows acquisition and analysis timings and where analysis ran', () => {
    expect(render(demoReadyState()).root.textContent).toContain('Reading took 120 ms; analysis ran in a background worker in 42 ms.');
    expect(render(liveReadyState()).root.textContent).toContain('analysis ran on the main thread in 7 ms.');
  });
});

describe('accounts: active account and controls', () => {
  it('demo mode: heading says synthetic; Leave demo calls exitDemo; clear-data and Read again', () => {
    const { root, actions } = render(demoReadyState());
    expect(root.textContent).toContain('Synthetic demo account');
    btn(root, 'Leave demo')?.click();
    (byTestId(root, TEST_IDS.clearData) as HTMLButtonElement).click();
    btn(root, 'Read again')?.click();
    expect(actions.calls).toEqual([['exitDemo'], ['clearData'], ['reload']]);
  });

  it('live mode: active account shows handle, DID in code, PDS and check source', () => {
    const { root } = render(liveReadyState());
    expect(root.textContent).toContain('Active account');
    expect(root.textContent).toContain('alice.example.com');
    expect(root.textContent).toContain('checked by your PDS');
    expect([...root.querySelectorAll('code')].some((c) => c.textContent === LIVE_DID)).toBe(true);
    expect(btn(root, 'Leave demo')).toBeUndefined();
  });

  it('a cancel control is available while loading', () => {
    const { root, actions } = render(initialState({ mode: 'demo', load: { status: 'loading', runId: 1, progress: null, failure: null, acquisitionMs: null } }));
    (byTestId(root, TEST_IDS.cancelLoad) as HTMLButtonElement).click();
    expect(actions.calls).toContainEqual(['cancelLoad']);
  });
});
