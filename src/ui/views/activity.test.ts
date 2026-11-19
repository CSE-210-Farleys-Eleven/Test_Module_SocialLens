// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BarChartProps, MetricCardProps, TableProps } from '../components/contract';
import type { AnalyticsReport } from '../../analytics/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import { byTestId, createFakeActions, demoReadyState, makeAnalytics, makeDeps, makePrivacy, mv, renderInto, DEMO_DID } from './testkit';

function render(analytics: AnalyticsReport = makeAnalytics()) {
  const deps = makeDeps();
  const actions = createFakeActions();
  const s = demoReadyState();
  const state = { ...s, view: 'activity' as const, analysis: { ...s.analysis, result: { analytics, privacy: makePrivacy() } } };
  const root = renderInto(createViews(deps).activity({ state, actions }));
  return { root, components: deps.components };
}

const base = makeAnalytics();

describe('activity', () => {
  it('has the view test id', () => {
    expect(byTestId(render().root, TEST_IDS.viewActivity)).not.toBeNull();
  });

  it('timeline chart title says UTC and has one series per app', () => {
    const { components, root } = render();
    const charts = components.callsOf('barChart') as BarChartProps[];
    const timeline = charts.find((c) => c.title.startsWith('Content items per day'));
    expect(timeline?.title).toBe('Content items per day (UTC)');
    expect(timeline?.series).toEqual(['Bluesky', 'Standard.site']);
    expect(timeline?.data).toEqual([
      { label: '2026-11-09', values: [2, 1] },
      { label: '2026-11-10', values: [0, 0] },
    ]);
    for (const c of charts) expect(c.title).toContain('(UTC)');
    expect(charts.map((c) => c.title)).toEqual(['Content items per day (UTC)', 'Posting hours (UTC)', 'Posting weekdays (UTC)']);
    expect(root.textContent).toContain('a gap is not proof of inactivity');
    expect(root.textContent).not.toContain('Only the latest');
  });

  it('truncated timeline shows the truncation note', () => {
    const { root } = render(makeAnalytics(DEMO_DID, { timeline: { ...base.timeline, truncated: true } }));
    expect(root.textContent).toContain('Only the latest 366 days are shown.');
  });

  it('unknown timeline is not drawn as zero bars', () => {
    const { root, components } = render(makeAnalytics(DEMO_DID, { timeline: { ...base.timeline, status: 'unknown' } }));
    const charts = components.callsOf('barChart') as BarChartProps[];
    expect(charts.some((c) => c.title.startsWith('Content items per day'))).toBe(false);
    expect(root.textContent).toContain('Unknown');
  });

  it('streak cards receive the streak values with their date spans', () => {
    const { components } = render();
    const cards = components.callsOf('metricCard') as MetricCardProps[];
    const current = cards.find((c) => c.value.metricId === 'activity.streak.current');
    const longest = cards.find((c) => c.value.metricId === 'activity.streak.longest');
    expect(current?.value).toEqual(base.streak.current);
    expect(longest?.value).toEqual(base.streak.longest);
    expect(current?.detail).toContain('2026-11-09');
    expect(longest?.detail).toContain('2026-10-05');
  });

  it('week over week shows +3 and 150%', () => {
    const { root, components } = render();
    expect(root.textContent).toContain('+3');
    expect(root.textContent).toContain('150%');
    const cards = (components.callsOf('metricCard') as MetricCardProps[]).filter((c) => c.value.metricId === 'activity.weekOverWeek');
    expect(cards).toHaveLength(2);
  });

  it('week over week shows Unknown when delta is null, and no change / minus', () => {
    const unknown = makeAnalytics(DEMO_DID, { weekOverWeek: { ...base.weekOverWeek, delta: null, deltaFraction: null, previous: { ...base.weekOverWeek.previous, contentItems: mv('activity.weekOverWeek', null, 'unknown') } } });
    expect(render(unknown).root.textContent).toContain('Change: Unknown');
    const zero = makeAnalytics(DEMO_DID, { weekOverWeek: { ...base.weekOverWeek, delta: 0, deltaFraction: 0 } });
    expect(render(zero).root.textContent).toContain('no change');
    const minus = makeAnalytics(DEMO_DID, { weekOverWeek: { ...base.weekOverWeek, delta: -2, deltaFraction: -0.5 } });
    expect(render(minus).root.textContent).toContain('−2');
    expect(render(minus).root.textContent).toContain('−50%');
  });

  it('records-by-type table has 11 rows using the app alias', () => {
    const { components, root } = render();
    const tables = components.callsOf('dataTable') as TableProps[];
    const byType = tables.find((t) => t.caption.startsWith('Records by type'));
    expect(byType?.rows).toHaveLength(11);
    expect(byType?.columns.map((c) => c.header)).toEqual(['Type', 'App', 'Count']);
    expect(root.textContent).toContain('Like given');
    expect(tables.some((t) => t.caption.startsWith('Records by app'))).toBe(true);
  });

  it('a partial count in the table reads "At least N" with its label', () => {
    const analytics = makeAnalytics(DEMO_DID, { byKind: base.byKind.map((k) => (k.kind === 'like' ? { ...k, count: mv('records.byKind', 100, 'partial') } : k)) });
    const { root } = render(analytics);
    expect(root.textContent).toContain('At least 100');
    expect(root.textContent).toContain('Partial');
  });

  it('undated footnote appears only when the count is > 0', () => {
    expect(render().root.textContent).not.toContain('no usable date');
    const { root } = render(makeAnalytics(DEMO_DID, { undated: 2, futureDated: 1 }));
    expect(root.textContent).toContain("3 record(s) have no usable date; they count only in 'All fetched records'.");
  });
});
