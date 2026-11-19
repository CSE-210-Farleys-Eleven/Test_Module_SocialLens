// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { MetricCardProps } from '../components/contract';
import type { AppState } from '../../analytics/state/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import { byTestId, coverageRow, createFakeActions, demoReadyState, makeAnalytics, makeDeps, makeObservation, makePrivacy, makeSnapshot, mv, renderInto, DEMO_DID } from './testkit';

function render(state: AppState) {
  const deps = makeDeps();
  const actions = createFakeActions();
  const root = renderInto(createViews(deps).overview({ state, actions }));
  return { root, actions, components: deps.components };
}

function withResult(analytics = makeAnalytics(), privacy = makePrivacy()): AppState {
  const s = demoReadyState();
  return { ...s, analysis: { ...s.analysis, result: { analytics, privacy } } };
}

describe('overview', () => {
  it('has the view test id and an includes note naming both apps', () => {
    const { root } = render(demoReadyState());
    expect(byTestId(root, TEST_IDS.viewOverview)).not.toBeNull();
    expect(byTestId(root, TEST_IDS.includesNote)?.textContent).toBe('Includes: Bluesky, Standard.site');
  });

  it('renders exactly three metric cards with the shared metric ids', () => {
    const { components } = render(demoReadyState());
    const ids = (components.callsOf('metricCard') as MetricCardProps[]).map((p) => p.value.metricId);
    expect(ids).toEqual(['content.items', 'activity.activeDays', 'records.total']);
    for (const p of components.callsOf('metricCard') as MetricCardProps[]) expect(p.format).toBe('integer');
  });

  it('contains no engagement metric (I-13)', () => {
    const { root, components } = render(demoReadyState());
    for (const p of components.callsOf('metricCard') as MetricCardProps[]) expect(p.value.metricId.startsWith('engagement.')).toBe(false);
    for (const p of components.callsOf('glossaryTerm') as { metricId: string }[]) expect(p.metricId.startsWith('engagement.')).toBe(false);
    expect(root.querySelector('[data-metric-id^="engagement."]')).toBeNull();
  });

  it('passes an unknown content value through unchanged (I-7)', () => {
    const base = makeAnalytics();
    const analytics = makeAnalytics(DEMO_DID, { overview: { ...base.overview, contentItems: mv('content.items', null, 'unknown') } });
    const { components, root } = render(withResult(analytics));
    const card = (components.callsOf('metricCard') as MetricCardProps[]).find((p) => p.value.metricId === 'content.items');
    expect(card?.value.value).toBeNull();
    expect(card?.value.status).toBe('unknown');
    expect(root.textContent).toContain('content.items: Unknown');
  });

  it('shows the last content item date or the no-dated-content text', () => {
    expect(render(demoReadyState()).root.textContent).toContain('Last content item: 2026-11-10 14:00 UTC');
    const base = makeAnalytics();
    const none = makeAnalytics(DEMO_DID, { overview: { ...base.overview, lastContentAt: null } });
    expect(render(withResult(none)).root.textContent).toContain('No dated content was fetched.');
  });

  it('coverage line counts complete collections and its button opens Accounts', () => {
    const s = demoReadyState();
    const snapshot = makeSnapshot('demo', { coverage: [coverageRow('app.bsky.feed.post'), coverageRow('app.bsky.feed.like', 'partial'), coverageRow('app.bsky.graph.block', 'unavailable')] });
    const { root, actions } = render({ ...s, snapshot });
    expect(root.textContent).toContain('1 of 3 collections were read completely.');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'See what was read')?.click();
    expect(actions.calls).toContainEqual(['selectView', 'accounts']);
  });

  it('privacy teaser lists at most 3 titles and links to Privacy', () => {
    const privacy = makePrivacy(DEMO_DID, {
      observations: [makeObservation('public-likes'), makeObservation('public-follows'), makeObservation('public-blocks'), makeObservation('public-lists')],
    });
    const { root, actions } = render(withResult(makeAnalytics(), privacy));
    expect(root.textContent).toContain('Title of public-likes');
    expect(root.textContent).toContain('Title of public-blocks');
    expect(root.textContent).not.toContain('Title of public-lists');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Review privacy observations')?.click();
    expect(actions.calls).toContainEqual(['selectView', 'privacy']);
  });

  it('zero observations shows Nothing to flag', () => {
    const { root } = render(withResult(makeAnalytics(), makePrivacy(DEMO_DID, { observations: [] })));
    expect(root.textContent).toContain('Nothing to flag in the fetched records.');
  });

  it('handle invalid shows the handle with a not-confirmed label and the DID beneath', () => {
    const s = demoReadyState();
    const snapshot = makeSnapshot('demo');
    const { root } = render({ ...s, snapshot: { ...snapshot, account: { ...snapshot.account, handleStatus: 'invalid' } } });
    expect(root.textContent).toContain('synthetic-demo.example');
    expect(root.textContent).toContain('Handle not confirmed');
    expect([...root.querySelectorAll('code')].some((c) => c.textContent === DEMO_DID)).toBe(true);
  });

  it('valid handle has no status label; null handle says no handle', () => {
    expect(render(demoReadyState()).root.textContent).not.toContain('Handle not');
    const s = demoReadyState();
    const snapshot = makeSnapshot('demo');
    const { root } = render({ ...s, snapshot: { ...snapshot, account: { ...snapshot.account, handle: null, handleStatus: 'unverified' } } });
    expect(root.textContent).toContain('no handle');
    expect(root.textContent).toContain('Handle not checked');
  });

  it('without analysis shows Calculating… but still the snapshot-backed sections', () => {
    const s = demoReadyState();
    const { root, components } = render({ ...s, analysis: { ...s.analysis, status: 'running', result: null } });
    expect(root.textContent).toContain('Calculating…');
    expect(components.callsOf('metricCard')).toHaveLength(0);
    expect(root.textContent).toContain('collections were read completely.');
  });

  it('without a snapshot returns an empty state', () => {
    const { components } = render({ ...demoReadyState(), snapshot: null });
    expect(components.callsOf('emptyState')).toHaveLength(1);
  });
});
