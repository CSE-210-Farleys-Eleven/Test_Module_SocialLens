// Privacy: one card per observation with evidence, source, limitation and action (I-14).
import { citation } from '../../shared';
import type { ObservationEvidence, PrivacyObservation, PrivacyReport } from '../../analytics/privacy/contract';
import type { ViewRenderer, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { analysisGate, formatDateTime, formatInt, noData, OBSERVATION_TITLES, viewRoot } from './common';

function countText(e: ObservationEvidence): string {
  if (e.count === null || e.countCertainty === 'unknown') return 'Unknown';
  if (e.countCertainty === 'lower-bound') return `At least ${formatInt(e.count)}`;
  return formatInt(e.count);
}

export function createPrivacy(deps: ViewsDeps): ViewRenderer {
  const c = deps.components;

  const observationCard = (o: PrivacyObservation): HTMLElement => {
    const e = o.evidence;
    const dates: string[] = [];
    if (e.earliestAt !== null) dates.push(`Earliest ${formatDateTime(e.earliestAt)} UTC`);
    if (e.latestAt !== null) dates.push(`Latest ${formatDateTime(e.latestAt)} UTC`);
    return c.card({
      title: o.title,
      subtitle: null,
      testId: `${TEST_IDS.observation}-${o.id}`,
      children: [
        c.h('p', { class: 'observation-summary' }, o.summary),
        c.h(
          'div',
          { class: 'observation-part observation-evidence' },
          c.h('h3', null, 'Evidence'),
          c.h('p', { class: 'evidence-count' }, `Records: ${countText(e)}`),
          dates.length > 0 ? c.h('p', { class: 'evidence-dates' }, dates.join(' · ')) : null,
          e.details.length > 0 ? c.definitionList(e.details.map((d) => ({ term: d.label, description: d.value }))) : null,
          c.atUriList({ label: 'Sample records', uris: e.sampleUris, emptyText: 'No sample records for this observation.' }),
        ),
        c.h('div', { class: 'observation-part observation-source' }, c.h('h3', null, 'Source'), c.citationLink({ citation: o.source })),
        c.h('div', { class: 'observation-part observation-limitation' }, c.h('h3', null, 'Limitation'), c.h('p', null, o.limitation)),
        c.h('div', { class: 'observation-part observation-action' }, c.h('h3', null, 'What you can do'), c.h('p', null, o.action)),
      ],
    });
  };

  const notTriggered = (p: PrivacyReport): HTMLElement =>
    c.card({
      title: 'Checked, nothing to flag',
      subtitle: null,
      testId: 'privacy-not-triggered',
      children: [
        p.notTriggered.length === 0
          ? c.h('p', null, 'Every check flagged something.')
          : c.definitionList(p.notTriggered.map((n) => ({ term: OBSERVATION_TITLES[n.id], description: n.reason }))),
      ],
    });

  const notAssessed = (p: PrivacyReport): HTMLElement =>
    c.card({
      title: 'Not assessed, because it is not in your public repository',
      subtitle: null,
      testId: 'privacy-not-assessed',
      children: [
        c.definitionList(
          p.notAssessed.map((n) => ({
            term: n.label,
            description: c.h('div', null, c.h('p', null, n.explanation), c.citationLink({ citation: citation(n.source) })),
          })),
        ),
      ],
    });

  return ({ state }) => {
    if (state.snapshot === null) return noData(deps, 'privacy', TEST_IDS.viewPrivacy);
    const intro = c.h(
      'p',
      { class: 'view-intro' },
      'What your own public records show. Each point lists its evidence, an official source, what it cannot tell you, and something you can do.',
    );
    const gate = analysisGate(c, state);
    if (!gate.ok) return viewRoot(c, 'privacy', TEST_IDS.viewPrivacy, intro, gate.element);
    const p = gate.result.privacy;
    return viewRoot(
      c,
      'privacy',
      TEST_IDS.viewPrivacy,
      intro,
      p.observations.length === 0
        ? c.h('p', { class: 'privacy-empty' }, 'Nothing to flag in the fetched records.')
        : c.h('div', { class: 'observation-list' }, ...p.observations.map(observationCard)),
      notTriggered(p),
      notAssessed(p),
    );
  };
}
