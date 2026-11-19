// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PrivacyReport } from '../../analytics/privacy/contract';
import { createViews } from './index';
import { TEST_IDS } from './contract';
import { byTestId, createFakeActions, demoReadyState, makeAnalytics, makeDeps, makeObservation, makePrivacy, renderInto, DEMO_DID } from './testkit';

function render(privacy: PrivacyReport = makePrivacy()) {
  const deps = makeDeps();
  const actions = createFakeActions();
  const s = demoReadyState();
  const state = { ...s, view: 'privacy' as const, analysis: { ...s.analysis, result: { analytics: makeAnalytics(), privacy } } };
  const root = renderInto(createViews(deps).privacy({ state, actions }));
  return { root, components: deps.components };
}

describe('privacy', () => {
  it('has the view test id and the intro', () => {
    const { root } = render();
    expect(byTestId(root, TEST_IDS.viewPrivacy)?.textContent).toContain('What your own public records show.');
  });

  it('one card per observation, each with summary, evidence, samples, citation, limitation and action (I-14)', () => {
    const { root } = render();
    for (const id of ['public-likes', 'public-follows']) {
      const card = byTestId(root, `observation-${id}`);
      expect(card).not.toBeNull();
      const text = card!.textContent ?? '';
      expect(text).toContain(`Title of ${id}`);
      expect(text).toContain(`Summary of ${id}.`);
      expect(text).toContain('Evidence');
      expect(text).toContain('40');
      expect(text).toContain(`at://${DEMO_DID}/app.bsky.feed.like/3kaaa`);
      expect(card!.querySelector('[data-component="citation"]')).not.toBeNull();
      expect(text).toContain(`Limitation of ${id}.`);
      expect(text).toContain(`Action for ${id}.`);
      expect(text).toContain('Earliest 2026-01-02 03:04 UTC');
      expect(text).toContain('Busiest band');
    }
  });

  it('lower-bound count renders At least N; null count renders Unknown', () => {
    const lb = makeObservation('public-likes', DEMO_DID);
    const privacy = makePrivacy(DEMO_DID, {
      observations: [
        { ...lb, evidence: { ...lb.evidence, count: 100, countCertainty: 'lower-bound' } },
        { ...makeObservation('handle-validity'), evidence: { ...lb.evidence, count: null, countCertainty: 'unknown', sampleUris: [] } },
      ],
    });
    const { root } = render(privacy);
    expect(byTestId(root, 'observation-public-likes')?.textContent).toContain('At least 100');
    expect(byTestId(root, 'observation-handle-validity')?.textContent).toContain('Unknown');
  });

  it('not-triggered list shows each reason; not-assessed shows the three registry rows with citations', () => {
    const { root, components } = render();
    expect(root.textContent).toContain('Checked, nothing to flag');
    expect(root.textContent).toContain('No block records were fetched.');
    expect(root.textContent).toContain('Your blocks are public records');
    expect(root.textContent).toContain('Not assessed, because it is not in your public repository');
    for (const label of ['Mutes', 'Direct messages', 'Permissioned spaces']) expect(root.textContent).toContain(label);
    const cites = (components.callsOf('citationLink') as { citation: { sourceId: string } }[]).map((c) => c.citation.sourceId);
    expect(cites).toEqual(expect.arrayContaining(['bsky-docs-following', 'bsky-privacy-policy', 'atproto-blog-spaces']));
  });

  it('contains no score or risk level', () => {
    const text = (render().root.textContent ?? '').toLowerCase();
    expect(text).not.toContain('score');
    expect(text).not.toContain('risk level');
  });

  it('zero observations still renders the not-triggered list', () => {
    const { root } = render(makePrivacy(DEMO_DID, { observations: [] }));
    expect(root.textContent).toContain('Nothing to flag in the fetched records.');
  });
});
