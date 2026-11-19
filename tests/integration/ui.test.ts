// @vitest-environment happy-dom
/** IT-8: the real components and views, mounted on real demo state. */
import { beforeAll, describe, expect, it } from 'vitest';
import { compose } from './harness';
import { DEMO_BANNER_TEXT, GLOSSARY, STATUS_LABEL_TEXT } from '../../src/shared';
import { createComponents } from '../../src/ui/components';
import { TEST_IDS, createViews, mountApp } from '../../src/ui/views';
import { VIEW_IDS } from '../../src/analytics/state/contract';
import type { ComposedApp } from '../../src/compose';

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

describe('IT-8 UI on the complete demo', () => {
  let app: ComposedApp;
  let root: HTMLElement;

  beforeAll(async () => {
    app = compose();
    root = document.createElement('div');
    document.body.append(root);
    const components = createComponents({ document, glossary: GLOSSARY });
    const views = createViews({ components, registry: app.registry.data, glossary: GLOSSARY, demoScenarios: app.fixtures.scenarios, document });
    mountApp({ root, store: app.store, actions: app.actions, views });
    await app.actions.enterDemo('complete');
    await app.actions.selectRange('all');
  });

  it('shows the synthetic banner on all five views', () => {
    for (const view of VIEW_IDS) {
      app.actions.selectView(view);
      const banner = byTestId(TEST_IDS.demoBanner);
      expect(banner, view).not.toBeNull();
      expect(banner?.textContent).toContain(DEMO_BANNER_TEXT);
      expect(byTestId(`view-${view}`), view).not.toBeNull();
    }
  });

  it('Overview shows only metrics every app shares', () => {
    app.actions.selectView('overview');
    const ids = [...root.querySelectorAll('[data-metric-id]')].map((el) => el.getAttribute('data-metric-id') ?? '');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith('engagement.'))).toEqual([]);
    expect(byTestId(TEST_IDS.includesNote)?.textContent).toMatch(/Bluesky.*Standard\.site/);
  });

  it('Engagement says "not available" for Standard.site and never calls the number a rate', () => {
    app.actions.selectView('engagement');
    const text = byTestId(TEST_IDS.viewEngagement)?.textContent ?? '';
    expect(text).toContain(STATUS_LABEL_TEXT['not-available']);
    expect(text).toContain('Interactions per post');
    expect(text).toContain('This is not an engagement rate');
    expect(byTestId(TEST_IDS.notAvailableList)).not.toBeNull();
  });

  it('renders hostile source text as text: no element is created from it', () => {
    app.actions.selectView('engagement');
    const probe = app.store.getState().snapshot?.records.find((r) => r.text !== null && r.text.includes('<'));
    expect(probe, 'the fixture contains a probe post with markup characters').toBeDefined();
    for (const view of VIEW_IDS) {
      app.actions.selectView(view);
      expect(document.querySelector('img'), view).toBeNull();
      expect(document.querySelector('script'), view).toBeNull();
      expect(document.querySelector('iframe'), view).toBeNull();
      expect(root.querySelector('[onerror], [onclick], [onload], [style]'), view).toBeNull();
    }
  });

  it('every link is an https citation that opens safely', () => {
    for (const view of VIEW_IDS) {
      app.actions.selectView(view);
      for (const link of root.querySelectorAll('a')) {
        expect(link.getAttribute('href') ?? '', view).toMatch(/^https:\/\//);
        expect(link.getAttribute('rel'), view).toBe('noopener noreferrer');
      }
    }
  });

  it('Privacy shows seven observations, each with sample record URIs as text', () => {
    app.actions.selectView('privacy');
    const cards = [...root.querySelectorAll(`[data-testid^="${TEST_IDS.observation}-"]`)];
    expect(cards).toHaveLength(7);
    for (const card of cards) {
      const text = card.textContent ?? '';
      for (const part of ['Evidence', 'Source', 'Limitation', 'What you can do']) expect(text.toLowerCase()).toContain(part.toLowerCase());
    }
    const withSamples = cards.filter((card) => [...card.querySelectorAll('code')].some((code) => (code.textContent ?? '').startsWith('at://')));
    expect(withSamples.length).toBeGreaterThanOrEqual(6);
    expect(root.textContent).not.toMatch(/did:plc:(?!demosyntheticaccount2222)/);
  });

  it('Accounts shows coverage, the local-only remove note and both sign-in disclosures', () => {
    app.actions.selectView('accounts');
    expect(byTestId(TEST_IDS.coverageTable)?.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(10);
    expect(byTestId(TEST_IDS.unanalysedList)?.textContent).toContain('app.bsky.graph.listblock');
    expect(byTestId(TEST_IDS.removeScopeNote)?.textContent).toMatch(/Nothing is deleted from your account/);
    expect(byTestId(TEST_IDS.resolverDisclosure)?.textContent).toMatch(/bsky\.social/);
    // The only free-text input is the handle field for signing in to one's own account.
    expect(root.querySelectorAll('input[type="text"], input:not([type]), textarea')).toHaveLength(1);
    expect(byTestId(TEST_IDS.handleInput)).not.toBeNull();
  });
});

describe('IT-8b UI on the partial demo', () => {
  it('prints unknown as "Unknown" and lower bounds as "At least", never as a bare number', async () => {
    document.body.replaceChildren();
    const app = compose();
    const root = document.createElement('div');
    document.body.append(root);
    const components = createComponents({ document, glossary: GLOSSARY });
    const views = createViews({ components, registry: app.registry.data, glossary: GLOSSARY, demoScenarios: app.fixtures.scenarios, document });
    mountApp({ root, store: app.store, actions: app.actions, views });
    await app.actions.enterDemo('partial');
    await app.actions.selectRange('all');

    app.actions.selectView('activity');
    const activity = root.textContent ?? '';
    expect(activity).toContain('At least 100');
    expect(activity).toContain(STATUS_LABEL_TEXT.unknown);

    app.actions.selectView('privacy');
    const privacy = root.textContent ?? '';
    expect(privacy).toMatch(/at least 100 like records/i);
    expect(privacy).toMatch(/could not be read/i);

    app.actions.selectView('accounts');
    expect(byTestId(TEST_IDS.skippedTable)?.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});
