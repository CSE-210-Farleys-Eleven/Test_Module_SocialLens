// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../../shared';
import type { MetricCardProps, TableProps } from '../components/contract';
import type { AnalyticsReport } from '../../analytics/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import { byTestId, createFakeActions, demoReadyState, makeAnalytics, makeDeps, makePrivacy, renderInto, DEMO_DID } from './testkit';

function render(analytics: AnalyticsReport = makeAnalytics()) {
  const deps = makeDeps();
  const actions = createFakeActions();
  const s = demoReadyState();
  const state = { ...s, view: 'engagement' as const, analysis: { ...s.analysis, result: { analytics, privacy: makePrivacy() } } };
  const root = renderInto(createViews(deps).engagement({ state, actions }));
  return { root, components: deps.components };
}

const base = makeAnalytics();

describe('engagement', () => {
  it('has the view test id', () => {
    expect(byTestId(render().root, TEST_IDS.viewEngagement)).not.toBeNull();
  });

  it('Standard.site row shows the not-available label and reason, never 0', () => {
    const { components } = render();
    const table = (components.callsOf('dataTable') as TableProps[]).find((t) => t.caption.startsWith('Interaction counts by app'));
    expect(table).toBeDefined();
    const row = table!.rows.find((r) => r[0] === 'Standard.site')!;
    const text = row.map((c) => (c instanceof Node ? c.textContent : String(c))).join(' ');
    expect(text).toContain('Not available on this app');
    expect(text).toContain('Standard.site has no public interaction counters.');
    expect(text).not.toMatch(/\b0\b/);
    const bsky = table!.rows.find((r) => r[0] === 'Bluesky')!;
    expect(bsky.map((c) => (c instanceof Node ? c.textContent : String(c))).join(' ')).toContain('Available');
  });

  it('interactions-per-post card shows numerator and denominator; the not-a-rate sentence is present', () => {
    const { components, root } = render();
    const cards = components.callsOf('metricCard') as MetricCardProps[];
    const ipp = cards.find((c) => c.value.metricId === 'engagement.interactionsPerPost');
    expect(ipp?.format).toBe('decimal1');
    expect(ipp?.detail).toBe('40 interactions ÷ 12 posts with known counters');
    expect(root.textContent).toContain('This is not an engagement rate: there is no view count to divide by.');
    const ids = cards.map((c) => c.value.metricId);
    expect(ids).toEqual(expect.arrayContaining(['engagement.interactions', 'engagement.likes', 'engagement.reposts', 'engagement.replies', 'engagement.quotes', 'engagement.knownShare']));
    const share = cards.find((c) => c.value.metricId === 'engagement.knownShare');
    expect(share?.format).toBe('percent');
    expect(share?.detail).toBe('12 of 14 posts and replies');
  });

  it('settling note appears only when settlingPosts > 0', () => {
    expect(render().root.textContent).not.toContain('still settling');
    const { root } = render(makeAnalytics(DEMO_DID, { engagement: { ...base.engagement, settlingPosts: 2 } }));
    expect(root.textContent).toContain('2 post(s) are under 36 hours old; their counters are still settling.');
  });

  it('top-post text that looks like markup is passed as a plain string', () => {
    const probe = '<script>alert(1)</script>';
    const analytics = makeAnalytics(DEMO_DID, { topPosts: [{ ...base.topPosts[0]!, textPreview: probe, settling: true }] });
    const { root, components } = render(analytics);
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain(probe);
    const table = (components.callsOf('dataTable') as TableProps[]).find((t) => t.caption.startsWith('Top posts'))!;
    expect(table.columns.map((c) => c.header)).toEqual(['Rank', 'Post', 'Published (UTC)', 'Likes', 'Reposts', 'Replies', 'Quotes', 'Interactions', 'Status', 'Record']);
    expect(root.textContent).toContain('Settling');
    expect(root.textContent).toContain(base.topPosts[0]!.uri);
  });

  it('a post without text shows (no text)', () => {
    const analytics = makeAnalytics(DEMO_DID, { topPosts: [{ ...base.topPosts[0]!, textPreview: null }] });
    expect(render(analytics).root.textContent).toContain('(no text)');
  });

  it('not-available-metrics lists every glossary.unavailable entry with its reason', () => {
    const { root } = render();
    const list = byTestId(root, TEST_IDS.notAvailableList);
    expect(list).not.toBeNull();
    for (const u of GLOSSARY.unavailable) {
      expect(list?.textContent).toContain(u.label);
      expect(list?.textContent).toContain(u.reason);
    }
  });

  it('no post → table empty text', () => {
    const { components } = render(makeAnalytics(DEMO_DID, { topPosts: [] }));
    const table = (components.callsOf('dataTable') as TableProps[]).find((t) => t.caption.startsWith('Top posts'))!;
    expect(table.rows).toHaveLength(0);
    expect(table.emptyText.length).toBeGreaterThan(0);
  });
});
