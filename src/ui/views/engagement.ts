// Engagement: per-app availability, interaction totals, pooled per-post value, top posts, not-available list.
import type { AnalyticsReport, TopPost } from '../../analytics/contract';
import type { Child } from '../components/contract';
import type { ViewRenderer, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { analysisGate, appName, formatDateTime, formatInt, noData, viewRoot } from './common';

export function createEngagement(deps: ViewsDeps): ViewRenderer {
  const c = deps.components;

  const availability = (r: AnalyticsReport): HTMLElement =>
    c.dataTable({
      caption: 'Interaction counts by app',
      columns: [
        { header: 'App', align: 'start' },
        { header: 'Interaction counts', align: 'start' },
      ],
      rows: r.engagement.perApp.map((p): Child[] => [
        appName(deps.registry, p.appId),
        p.available
          ? c.h('span', { class: 'availability availability-yes' }, 'Available')
          : c.h('span', { class: 'availability availability-no' }, c.statusLabel('not-available'), p.reason === null ? null : ` — ${p.reason}`),
      ]),
      emptyText: 'No apps.',
      testId: 'engagement-availability',
    });

  const totals = (r: AnalyticsReport): HTMLElement[] => {
    const e = r.engagement;
    const ipp = e.interactionsPerPost;
    const ippDetail =
      ipp.numerator === null || ipp.denominator === null
        ? null
        : `${formatInt(ipp.numerator)} interactions ÷ ${formatInt(ipp.denominator)} posts with known counters`;
    const integer = (v: typeof e.likes) => c.metricCard({ label: null, value: v, detail: null, format: 'integer', testId: null });
    return [
      c.card({
        title: 'Interactions per post',
        subtitle: null,
        testId: null,
        children: [
          c.metricCard({ label: null, value: ipp, detail: ippDetail, format: 'decimal1', testId: 'metric-interactions-per-post' }),
          c.h('p', { class: 'note' }, 'This is not an engagement rate: there is no view count to divide by.'),
        ],
      }),
      c.card({
        title: 'Interactions received',
        subtitle: 'Posts and replies you wrote in this range, with their lifetime public counters.',
        testId: null,
        children: [
          c.h(
            'div',
            { class: 'metric-grid' },
            integer(e.interactions),
            integer(e.likes),
            integer(e.reposts),
            integer(e.replies),
            integer(e.quotes),
            c.metricCard({ label: null, value: e.knownShare, detail: `${formatInt(e.knownPosts)} of ${formatInt(e.eligiblePosts)} posts and replies`, format: 'percent', testId: null }),
          ),
          e.settlingPosts > 0
            ? c.h('p', { class: 'note' }, `${formatInt(e.settlingPosts)} post(s) are under 36 hours old; their counters are still settling.`)
            : null,
          c.h('p', { class: 'note' }, 'Counters are a point-in-time read of a public cache; they can differ slightly from the Bluesky app.'),
        ],
      }),
    ];
  };

  const topRow = (p: TopPost): Child[] => [
    formatInt(p.rank),
    c.h('span', { class: 'post-preview' }, p.textPreview ?? '(no text)'),
    p.createdAt === null ? 'Undated' : formatDateTime(p.createdAt),
    formatInt(p.counts.likes),
    formatInt(p.counts.reposts),
    formatInt(p.counts.replies),
    formatInt(p.counts.quotes),
    formatInt(p.interactions),
    p.settling ? c.statusLabel('settling') : '',
    c.atUriList({ uris: [p.uri], label: 'Record', emptyText: '' }),
  ];

  const topPosts = (r: AnalyticsReport): HTMLElement =>
    c.card({
      title: 'Top posts',
      subtitle: 'Posts with known counters in this range, by interactions.',
      testId: null,
      children: [
        c.dataTable({
          caption: 'Top posts by interactions',
          columns: [
            { header: 'Rank', align: 'end' },
            { header: 'Post', align: 'start' },
            { header: 'Published (UTC)', align: 'start' },
            { header: 'Likes', align: 'end' },
            { header: 'Reposts', align: 'end' },
            { header: 'Replies', align: 'end' },
            { header: 'Quotes', align: 'end' },
            { header: 'Interactions', align: 'end' },
            { header: 'Status', align: 'start' },
            { header: 'Record', align: 'start' },
          ],
          rows: r.topPosts.map(topRow),
          emptyText: 'No posts with known counters in this range.',
          testId: 'top-posts',
        }),
      ],
    });

  const notAvailable = (): HTMLElement =>
    c.h(
      'section',
      { class: 'not-available', 'data-testid': TEST_IDS.notAvailableList },
      c.h('h2', null, 'Not shown, and why'),
      c.definitionList(
        deps.glossary.unavailable.map((u) => ({
          term: u.label,
          description: c.h(
            'div',
            null,
            c.h('p', null, u.reason),
            u.wouldRequire === '—' || u.wouldRequire === '' ? null : c.h('p', { class: 'muted' }, `Would require: ${u.wouldRequire}`),
          ),
        })),
      ),
    );

  return ({ state }) => {
    if (state.snapshot === null) return noData(deps, 'engagement', TEST_IDS.viewEngagement);
    const gate = analysisGate(c, state);
    if (!gate.ok) return viewRoot(c, 'engagement', TEST_IDS.viewEngagement, gate.element, notAvailable());
    const r = gate.result.analytics;
    return viewRoot(
      c,
      'engagement',
      TEST_IDS.viewEngagement,
      c.card({ title: 'Where counts come from', subtitle: null, testId: null, children: [availability(r)] }),
      ...totals(r),
      topPosts(r),
      notAvailable(),
    );
  };
}
