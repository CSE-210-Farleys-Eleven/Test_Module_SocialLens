// The app shell: skip control, header, mode banner, navigation, range, notices, main region, footer.
import { DEMO_BANNER_TEXT, RANGE_IDS } from '../../shared';
import type { Notice, RangeId } from '../../shared/contract';
import type { AppActions, AppState, ViewId } from '../../analytics/state/contract';
import type { ViewProps, ViewRenderer, Views, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { formatDate, formatDateTime, formatInt } from './common';

const VIEW_ORDER: readonly ViewId[] = ['overview', 'activity', 'engagement', 'privacy', 'accounts'];

const VIEW_TITLE: Readonly<Record<ViewId, string>> = {
  overview: 'Overview',
  activity: 'Activity',
  engagement: 'Engagement',
  privacy: 'Privacy',
  accounts: 'Accounts',
};

const RANGE_LABEL: Readonly<Record<RangeId, string>> = {
  '7d': 'Last 7 days (UTC)',
  '30d': 'Last 30 days (UTC)',
  '90d': 'Last 90 days (UTC)',
  all: 'All fetched records',
};

export const MAIN_HEADING_ID = 'main-heading';

type DataViews = Omit<Views, 'shell'>;

export function createShell(deps: ViewsDeps, views: DataViews): ViewRenderer {
  const c = deps.components;
  const doc = deps.document;

  const focusMain = (): void => {
    doc.getElementById(MAIN_HEADING_ID)?.focus();
  };

  const header = (): HTMLElement =>
    c.h(
      'header',
      { class: 'app-header' },
      c.h('p', { class: 'app-name' }, 'SocialLens'),
      c.h('p', { class: 'app-strapline' }, 'Your public AT Protocol records, explained.'),
    );

  const modeBanner = (state: AppState): HTMLElement | null => {
    if (state.mode === 'demo') return c.banner({ tone: 'synthetic', badge: 'SYNTHETIC DEMO', text: DEMO_BANNER_TEXT, testId: TEST_IDS.demoBanner });
    if (state.mode === 'live')
      return c.banner({
        tone: 'info',
        badge: 'YOUR ACCOUNT',
        text: 'Only the signed-in account is read. Requests go to your PDS and the public Bluesky API.',
        testId: TEST_IDS.liveBanner,
      });
    return null;
  };

  const nav = (state: AppState, actions: AppActions): HTMLElement =>
    c.h(
      'nav',
      { class: 'main-nav', 'data-testid': TEST_IDS.nav, 'aria-label': 'Views' },
      ...VIEW_ORDER.map((v) => {
        const testId = `${TEST_IDS.navItem}-${v}`;
        const el = c.button({
          label: VIEW_TITLE[v],
          onClick: () => actions.selectView(v),
          variant: 'text',
          disabled: v !== 'accounts' && state.snapshot === null,
          testId,
          current: v === state.view,
        });
        el.id = testId;
        return el;
      }),
    );

  const rangeSelect = (state: AppState, actions: AppActions): HTMLElement | null => {
    if (state.snapshot === null || state.view === 'accounts') return null;
    return c.h(
      'div',
      { class: 'range-control' },
      c.select({
        id: TEST_IDS.rangeSelect,
        label: 'Date range',
        options: RANGE_IDS.map((r) => ({ value: r, label: RANGE_LABEL[r] })),
        value: state.range,
        onChange: (value) => {
          const range = RANGE_IDS.find((r) => r === value);
          if (range !== undefined) void actions.selectRange(range);
        },
        testId: TEST_IDS.rangeSelect,
      }),
    );
  };

  const notices = (state: AppState, actions: AppActions): HTMLElement | null => {
    const notDemo = (n: Notice) => n.code !== 'demo-synthetic';
    const own = state.notices.filter(notDemo);
    const ownCodes = new Set(own.map((n) => n.code));
    const fromSnapshot = (state.snapshot?.notices ?? []).filter(notDemo).filter((n) => !ownCodes.has(n.code));
    if (own.length === 0 && fromSnapshot.length === 0) return null;
    return c.h(
      'div',
      { class: 'notices', 'data-testid': TEST_IDS.noticeList },
      own.length > 0 ? c.noticeList({ notices: own, onDismiss: (code) => actions.dismissNotice(code) }) : null,
      fromSnapshot.length > 0
        ? c.h(
            'ul',
            { class: 'snapshot-notices' },
            ...fromSnapshot.map((n) =>
              c.h('li', { class: `notice-line notice-${n.level}`, role: n.level === 'warning' ? 'alert' : 'status', 'data-notice-code': n.code }, n.message),
            ),
          )
        : null,
    );
  };

  const landing = (actions: AppActions): HTMLElement =>
    c.h(
      'section',
      { class: 'landing', 'data-testid': TEST_IDS.landing },
      c.h('p', { class: 'landing-lead' }, 'SocialLens explains what your own public AT Protocol records show.'),
      c.h(
        'ul',
        { class: 'landing-points' },
        c.h('li', null, 'Your own account only: you sign in to prove it is yours, and no other account can be looked up.'),
        c.h('li', null, 'Read-only: SocialLens reads public records and never posts, deletes or changes anything.'),
        c.h('li', null, 'Unknown stays unknown: a number that could not be read is shown as unknown, never as zero.'),
      ),
      c.h(
        'div',
        { class: 'landing-actions' },
        ...deps.demoScenarios.map((s) =>
          c.h(
            'div',
            { class: 'demo-choice' },
            c.button({
              label: `Explore synthetic demo — ${s.label}`,
              onClick: () => void actions.enterDemo(s.id),
              variant: 'secondary',
              disabled: false,
              testId: `${TEST_IDS.demoStart}-${s.id}`,
              current: false,
            }),
            c.h('p', { class: 'muted' }, s.description),
          ),
        ),
        c.button({ label: 'Use my own account', onClick: () => actions.selectView('accounts'), variant: 'primary', disabled: false, testId: 'use-own-account', current: false }),
      ),
    );

  const loadingCard = (state: AppState, actions: AppActions): HTMLElement => {
    const p = state.load.progress;
    const cancel = c.button({ label: 'Cancel', onClick: () => actions.cancelLoad(), variant: 'secondary', disabled: false, testId: TEST_IDS.cancelLoad, current: false });
    cancel.id = TEST_IDS.cancelLoad;
    return c.card({
      title: state.mode === 'demo' ? 'Reading the synthetic demo records' : 'Reading your public records',
      subtitle: null,
      testId: TEST_IDS.loading,
      children: [
        c.h('p', { class: 'load-progress', role: 'status', 'aria-live': 'polite' }, p?.message ?? 'Starting…'),
        p !== null && p.total > 0 ? c.h('p', { class: 'load-step muted' }, `step ${formatInt(p.done)} of ${formatInt(p.total)}`) : null,
        cancel,
      ],
    });
  };

  const failedCard = (state: AppState, actions: AppActions): HTMLElement =>
    c.card({
      title: 'The read did not finish',
      subtitle: null,
      testId: TEST_IDS.loadFailed,
      children: [
        c.h('p', { role: 'alert' }, state.load.failure?.message ?? 'Something went wrong while reading.'),
        c.h('p', null, 'Nothing was kept from this attempt.'),
        c.button({ label: 'Try again', onClick: () => void actions.reload(), variant: 'primary', disabled: false, testId: 'retry-load', current: false }),
      ],
    });

  const cancelledCard = (actions: AppActions): HTMLElement =>
    c.card({
      title: 'Read cancelled',
      subtitle: null,
      testId: 'load-cancelled',
      children: [
        c.h('p', { role: 'status' }, 'Read cancelled. Nothing was kept.'),
        c.button({ label: 'Read again', onClick: () => void actions.reload(), variant: 'primary', disabled: false, testId: 'read-again-after-cancel', current: false }),
      ],
    });

  /** The heading and the single body the main region shows for this state. */
  const mainBody = (props: ViewProps): { title: string; body: HTMLElement } => {
    const { state, actions } = props;
    if (state.view === 'accounts') return { title: VIEW_TITLE.accounts, body: views.accounts(props) };
    switch (state.load.status) {
      case 'loading':
        return { title: 'Reading records', body: loadingCard(state, actions) };
      case 'failed':
        return { title: 'Read failed', body: failedCard(state, actions) };
      case 'cancelled':
        return { title: 'Read cancelled', body: cancelledCard(actions) };
      default:
        break;
    }
    if (state.mode === 'none') return { title: 'Welcome to SocialLens', body: landing(actions) };
    return { title: VIEW_TITLE[state.view], body: views[state.view](props) };
  };

  const footer = (state: AppState): HTMLElement => {
    const s = state.snapshot;
    return c.h(
      'footer',
      { class: 'app-footer' },
      c.h('p', null, 'Counts are observations, not scores. Times are UTC.'),
      s === null
        ? null
        : c.h('p', { class: 'muted' }, s.mode === 'demo' ? `Fixed sample date ${formatDate(s.fetchedAt)} UTC` : `Read ${formatDateTime(s.fetchedAt)} UTC`),
    );
  };

  return (props) => {
    const { state, actions } = props;
    const skip = c.button({ label: 'Skip to main content', onClick: focusMain, variant: 'text', disabled: false, testId: 'skip-link', current: false });
    skip.id = 'skip-link';
    skip.classList.add('skip-link');
    const { title, body } = mainBody(props);
    const main = c.h(
      'main',
      { id: 'main', class: 'app-main' },
      c.h('h1', { id: MAIN_HEADING_ID, tabindex: -1, class: 'view-title' }, title),
      body,
    );
    return c.h(
      'div',
      { class: `app-shell mode-${state.mode}` },
      skip,
      header(),
      modeBanner(state),
      c.h('div', { class: 'app-toolbar' }, nav(state, actions), rangeSelect(state, actions)),
      notices(state, actions),
      main,
      footer(state),
    );
  };
}
