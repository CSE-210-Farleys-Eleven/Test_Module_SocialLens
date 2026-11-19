// Overview: only metrics every supported app shares (I-13), coverage, privacy teaser, identity.
import type { AccountIdentity } from '../../shared/contract';
import type { ViewRenderer, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { analysisGate, appName, formatDateTime, handleStatusText, noData, viewRoot } from './common';

const TEASER_MAX = 3;

export function identityBlock(deps: ViewsDeps, account: Pick<AccountIdentity, 'did' | 'handle' | 'handleStatus'>): HTMLElement {
  const c = deps.components;
  const label = handleStatusText(account.handleStatus);
  return c.h(
    'div',
    { class: 'identity' },
    c.h(
      'p',
      { class: 'identity-handle' },
      account.handle ?? 'no handle',
      label === null ? null : ' ',
      label === null ? null : c.h('span', { class: `handle-status handle-status-${account.handleStatus}` }, label),
    ),
    c.h('p', { class: 'identity-did' }, c.h('code', null, account.did)),
  );
}

export function createOverview(deps: ViewsDeps): ViewRenderer {
  const c = deps.components;
  return ({ state, actions }) => {
    const snapshot = state.snapshot;
    if (snapshot === null) return noData(deps, 'overview', TEST_IDS.viewOverview);

    const gate = analysisGate(c, state);
    let analysisPart: HTMLElement;
    let privacyPart: HTMLElement;
    if (gate.ok) {
      const ov = gate.result.analytics.overview;
      analysisPart = c.h(
        'div',
        { class: 'overview-metrics' },
        c.h('p', { class: 'includes-note', 'data-testid': TEST_IDS.includesNote }, `Includes: ${ov.includedApps.map((id) => appName(deps.registry, id)).join(', ')}`),
        c.h(
          'div',
          { class: 'metric-grid' },
          c.metricCard({ label: null, value: ov.contentItems, detail: null, format: 'integer', testId: 'metric-content-items' }),
          c.metricCard({ label: null, value: ov.activeDays, detail: null, format: 'integer', testId: 'metric-active-days' }),
          c.metricCard({ label: null, value: ov.recordsTotal, detail: null, format: 'integer', testId: 'metric-records-total' }),
        ),
        c.h('p', { class: 'last-content' }, ov.lastContentAt === null ? 'No dated content was fetched.' : `Last content item: ${formatDateTime(ov.lastContentAt)} UTC`),
      );
      const obs = gate.result.privacy.observations;
      privacyPart =
        obs.length === 0
          ? c.h('p', { class: 'privacy-teaser-empty' }, 'Nothing to flag in the fetched records.')
          : c.h('ul', { class: 'privacy-teaser-list' }, ...obs.slice(0, TEASER_MAX).map((o) => c.h('li', null, o.title)));
    } else {
      analysisPart = gate.element;
      privacyPart = c.h('p', { class: 'muted' }, state.analysis.status === 'failed' ? 'Privacy observations are unavailable.' : 'Calculating…');
    }

    const complete = snapshot.coverage.filter((r) => r.status === 'complete').length;
    const coverage = c.card({
      title: 'What was read',
      subtitle: null,
      testId: null,
      children: [
        c.h('p', { class: 'coverage-line' }, `${complete} of ${snapshot.coverage.length} collections were read completely.`),
        c.button({ label: 'See what was read', onClick: () => actions.selectView('accounts'), variant: 'text', disabled: false, testId: null, current: false }),
      ],
    });

    const privacy = c.card({
      title: 'Privacy observations',
      subtitle: `What your own public records show (up to ${TEASER_MAX} shown here).`,
      testId: null,
      children: [
        privacyPart,
        c.button({ label: 'Review privacy observations', onClick: () => actions.selectView('privacy'), variant: 'secondary', disabled: false, testId: null, current: false }),
      ],
    });

    const identity = c.card({
      title: state.mode === 'demo' ? 'Synthetic demo account' : 'Account',
      subtitle: null,
      testId: null,
      children: [identityBlock(deps, snapshot.account)],
    });

    return viewRoot(c, 'overview', TEST_IDS.viewOverview, analysisPart, c.h('div', { class: 'overview-grid' }, privacy, coverage, identity));
  };
}
