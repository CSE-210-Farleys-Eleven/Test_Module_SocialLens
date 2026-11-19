// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEMO_BANNER_TEXT } from '../../shared/contract';
import type { AppState, ViewId } from '../../analytics/state/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import { byTestId, createFakeActions, demoReadyState, initialState, liveReadyState, makeDeps, NOTICE, renderInto } from './testkit';

function renderShell(state: AppState) {
  const deps = makeDeps();
  const views = createViews(deps);
  const actions = createFakeActions();
  const root = renderInto(views.shell({ state, actions }));
  return { root, actions, deps };
}

const VIEWS: readonly ViewId[] = ['overview', 'activity', 'engagement', 'privacy', 'accounts'];

describe('shell: landing', () => {
  it('mode none shows the landing with one demo button per scenario', () => {
    const { root, actions } = renderShell(initialState());
    expect(byTestId(root, TEST_IDS.landing)).not.toBeNull();
    const buttons = root.querySelectorAll(`[data-testid^="${TEST_IDS.demoStart}-"]`);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.textContent).toBe('Explore synthetic demo — Complete read');
    (byTestId(root, 'demo-start-partial') as HTMLButtonElement).click();
    expect(actions.calls).toContainEqual(['enterDemo', 'partial']);
  });

  it('"Use my own account" goes to Accounts', () => {
    const { root, actions } = renderShell(initialState());
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Use my own account');
    btn?.click();
    expect(actions.calls).toContainEqual(['selectView', 'accounts']);
  });

  it('has a skip control, the header and the footer', () => {
    const { root } = renderShell(initialState());
    expect(root.textContent).toContain('Skip to main content');
    expect(root.textContent).toContain('SocialLens');
    expect(root.textContent).toContain('Your public AT Protocol records, explained.');
    expect(root.textContent).toContain('Counts are observations, not scores. Times are UTC.');
    const main = root.querySelector('main#main');
    expect(main?.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('shell: banners (I-10)', () => {
  it('demo mode shows the synthetic banner with the exact text', () => {
    const { root } = renderShell(demoReadyState());
    const banner = byTestId(root, TEST_IDS.demoBanner);
    expect(banner?.textContent).toContain(DEMO_BANNER_TEXT);
    expect(byTestId(root, TEST_IDS.liveBanner)).toBeNull();
  });

  it.each(VIEWS)('demo banner present on the %s view', (view) => {
    const { root } = renderShell(demoReadyState({ view }));
    expect(byTestId(root, TEST_IDS.demoBanner)).not.toBeNull();
  });

  it('demo banner present while loading, after a failed load and after cancel', () => {
    const loading = demoReadyState({ snapshot: null, load: { status: 'loading', runId: 2, progress: null, failure: null, acquisitionMs: null } });
    const failed = demoReadyState({ snapshot: null, load: { status: 'failed', runId: 2, progress: null, failure: { kind: 'network', message: 'Offline.', status: null, xrpcError: null, retryAfterMs: null, origin: null }, acquisitionMs: null } });
    const cancelled = demoReadyState({ snapshot: null, load: { status: 'cancelled', runId: 2, progress: null, failure: null, acquisitionMs: null } });
    for (const s of [loading, failed, cancelled]) {
      expect(byTestId(renderShell(s).root, TEST_IDS.demoBanner)).not.toBeNull();
    }
  });

  it('live mode shows the live banner and no demo banner', () => {
    const { root } = renderShell(liveReadyState());
    expect(byTestId(root, TEST_IDS.liveBanner)?.textContent).toContain('Only the signed-in account is read.');
    expect(byTestId(root, TEST_IDS.demoBanner)).toBeNull();
  });
});

describe('shell: navigation and range', () => {
  it('without a snapshot the four data items are disabled and Accounts is enabled', () => {
    const { root } = renderShell(initialState());
    for (const v of ['overview', 'activity', 'engagement', 'privacy']) {
      expect((byTestId(root, `nav-item-${v}`) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((byTestId(root, 'nav-item-accounts') as HTMLButtonElement).disabled).toBe(false);
    expect(byTestId(root, TEST_IDS.nav)).not.toBeNull();
  });

  it('nav click calls selectView and the active item is current', () => {
    const { root, actions } = renderShell(demoReadyState({ view: 'activity' }));
    expect(byTestId(root, 'nav-item-activity')?.getAttribute('aria-current')).toBe('page');
    expect(byTestId(root, 'nav-item-overview')?.hasAttribute('aria-current')).toBe(false);
    (byTestId(root, 'nav-item-privacy') as HTMLButtonElement).click();
    expect(actions.calls).toContainEqual(['selectView', 'privacy']);
  });

  it('range select appears only with a snapshot and not on Accounts; change calls selectRange', () => {
    expect(byTestId(renderShell(initialState()).root, TEST_IDS.rangeSelect)).toBeNull();
    expect(byTestId(renderShell(demoReadyState({ view: 'accounts' })).root, TEST_IDS.rangeSelect)).toBeNull();
    const { root, actions } = renderShell(demoReadyState());
    const sel = byTestId(root, TEST_IDS.rangeSelect) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Last 7 days (UTC)', 'Last 30 days (UTC)', 'Last 90 days (UTC)', 'All fetched records']);
    sel.value = '7d';
    sel.dispatchEvent(new Event('change'));
    expect(actions.calls).toContainEqual(['selectRange', '7d']);
  });
});

describe('shell: load states', () => {
  it('loading shows the progress message in a status region and cancel calls cancelLoad', () => {
    const { root, actions } = renderShell(
      demoReadyState({
        snapshot: null,
        analysis: initialState().analysis,
        load: { status: 'loading', runId: 2, progress: { phase: 'reading-records', collection: null, done: 3, total: 10, message: 'Reading likes…' }, failure: null, acquisitionMs: null },
      }),
    );
    const loading = byTestId(root, TEST_IDS.loading);
    const status = loading?.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Reading likes…');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(loading?.textContent).toContain('step 3 of 10');
    (byTestId(root, TEST_IDS.cancelLoad) as HTMLButtonElement).click();
    expect(actions.calls).toContainEqual(['cancelLoad']);
  });

  it('failed shows the message and Nothing was kept; Try again calls reload', () => {
    const { root, actions } = renderShell(
      initialState({ mode: 'live', load: { status: 'failed', runId: 2, progress: null, failure: { kind: 'network', message: 'Your PDS could not be reached.', status: null, xrpcError: null, retryAfterMs: null, origin: null }, acquisitionMs: null } }),
    );
    const card = byTestId(root, TEST_IDS.loadFailed);
    expect(card?.textContent).toContain('Your PDS could not be reached.');
    expect(card?.textContent).toContain('Nothing was kept from this attempt.');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again')?.click();
    expect(actions.calls).toContainEqual(['reload']);
  });

  it('cancelled shows the cancelled text', () => {
    const { root, actions } = renderShell(initialState({ mode: 'demo', load: { status: 'cancelled', runId: 2, progress: null, failure: null, acquisitionMs: null } }));
    expect(root.textContent).toContain('Read cancelled. Nothing was kept.');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Read again')?.click();
    expect(actions.calls).toContainEqual(['reload']);
  });

  it('Accounts view wins over load states', () => {
    const { root } = renderShell(initialState({ view: 'accounts', mode: 'demo', load: { status: 'failed', runId: 2, progress: null, failure: null, acquisitionMs: null } }));
    expect(byTestId(root, TEST_IDS.viewAccounts)).not.toBeNull();
    expect(byTestId(root, TEST_IDS.loadFailed)).toBeNull();
  });
});

describe('shell: notices', () => {
  it('renders state and snapshot notices, does not duplicate demo-synthetic, dismiss calls dismissNotice', () => {
    const base = demoReadyState();
    const state = demoReadyState({
      notices: [NOTICE('analysis-fallback', 'Ran on the main thread.'), NOTICE('demo-synthetic', 'dup')],
      snapshot: { ...base.snapshot!, notices: [...base.snapshot!.notices, NOTICE('coverage-incomplete', 'Some collections are partial.')] },
    });
    const { root, actions } = renderShell(state);
    const list = byTestId(root, TEST_IDS.noticeList);
    expect(list?.textContent).toContain('Ran on the main thread.');
    expect(list?.textContent).toContain('Some collections are partial.');
    expect(list?.textContent).not.toContain('Synthetic demo data.');
    expect(list?.textContent).not.toContain('dup');
    list?.querySelector('[data-notice-code="analysis-fallback"] button')?.dispatchEvent(new Event('click'));
    expect(actions.calls).toContainEqual(['dismissNotice', 'analysis-fallback']);
    // snapshot notices are not dismissible
    expect(list?.querySelector('[data-notice-code="coverage-incomplete"] button')).toBeNull();
  });
});

describe('shell: analysis status', () => {
  it('analysis running shows Calculating…', () => {
    const s = demoReadyState();
    const { root } = renderShell({ ...s, analysis: { ...s.analysis, status: 'running', result: null } });
    expect(root.textContent).toContain('Calculating…');
  });

  it('analysis failed shows its message', () => {
    const s = demoReadyState();
    const { root } = renderShell({
      ...s,
      analysis: { ...s.analysis, status: 'failed', result: null, failure: { kind: 'internal', message: 'Analysis broke.', status: null, xrpcError: null, retryAfterMs: null, origin: null } },
    });
    expect(root.textContent).toContain('Analysis broke.');
  });

  it('footer states the fixed sample date in demo and the read time in live', () => {
    expect(renderShell(demoReadyState()).root.textContent).toContain('Fixed sample date 2026-11-10 UTC');
    expect(renderShell(liveReadyState()).root.textContent).toContain('Read 2026-11-10 23:59 UTC');
  });
});

describe('robustness', () => {
  const states: Record<string, AppState> = {
    initial: initialState(),
    initialising: initialState({ auth: { status: 'initialising', disclosure: null, failure: null, signInPending: false } }),
    demoReady: demoReadyState(),
    liveNullHandle: liveReadyState({
      snapshot: { ...liveReadyState().snapshot!, account: { ...liveReadyState().snapshot!.account, handle: null, handleStatus: 'unverified', handleCheck: 'none' } },
    }),
    emptyRecords: demoReadyState({ snapshot: { ...demoReadyState().snapshot!, records: [], coverage: [], skipped: [] } }),
    analysisNull: demoReadyState({ analysis: initialState().analysis }),
    liveNoSnapshot: initialState({ mode: 'live', activeDid: null }),
  };
  for (const [name, state] of Object.entries(states)) {
    it.each(VIEWS)(`${name}: %s renders without throwing`, (view) => {
      expect(() => renderShell({ ...state, view })).not.toThrow();
      const deps = makeDeps();
      const views = createViews(deps);
      const actions = createFakeActions();
      expect(() => views[view]({ state: { ...state, view }, actions })).not.toThrow();
    });
  }
});
