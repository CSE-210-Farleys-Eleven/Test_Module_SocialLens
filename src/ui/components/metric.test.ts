// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GLOSSARY, STATUS_LABEL_TEXT } from '../../shared';
import { make, mv, XSS } from './test-helpers';

const c = make();
const mcp = (value = mv(), extra = {}) => ({ label: null, value, detail: null, format: 'integer' as const, testId: null, ...extra });

describe('statusLabel', () => {
  it('shows exact wording for each non-known label', () => {
    expect(c.statusLabel('unknown').textContent).toBe('Unknown');
    expect(c.statusLabel('not-available').textContent).toBe('Not available on this app');
    expect(c.statusLabel('zero').textContent).toBe('Observed zero');
    expect(c.statusLabel('partial').textContent).toBe('Partial');
    expect(c.statusLabel('settling').textContent).toBe('Settling');
    expect(c.statusLabel('zero').getAttribute('data-status')).toBe('zero');
    expect(c.statusLabel('zero').className).toBe('status status-zero');
  });
  it('known is hidden and empty', () => {
    const el = c.statusLabel('known');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.textContent).toBe('');
    expect(STATUS_LABEL_TEXT.known).toBe('');
  });
});

describe('metricCard', () => {
  it('exact zero shows 0 and Observed zero', () => {
    const el = c.metricCard(mcp(mv({ value: 0 })));
    expect(el.querySelector('strong')?.textContent).toBe('0');
    expect(el.textContent).toContain('Observed zero');
    expect(el.getAttribute('data-status')).toBe('zero');
  });
  it('unknown shows Unknown, never 0', () => {
    const el = c.metricCard(mcp(mv({ value: null, status: 'unknown', reason: 'nothing read' })));
    expect(el.querySelector('strong')?.textContent).toBe('Unknown');
    expect(el.querySelector('strong')?.textContent).not.toContain('0');
    expect(el.getAttribute('data-status')).toBe('unknown');
  });
  it('lower bound shows At least 100, Partial and reason', () => {
    const el = c.metricCard(mcp(mv({ value: 100, status: 'partial', isLowerBound: true, reason: 'Some records skipped' })));
    expect(el.querySelector('strong')?.textContent).toBe('At least 100');
    expect(el.textContent).toContain('Partial');
    expect(el.textContent).toContain('Some records skipped');
  });
  it('not-available shows words and status', () => {
    const el = c.metricCard(mcp(mv({ value: null, status: 'not-available' })));
    expect(el.querySelector('strong')?.textContent).toBe('Not available');
    expect(el.textContent).toContain('Not available on this app');
  });
  it('sets data-metric-id, test id; known status has no visible label', () => {
    const el = c.metricCard(mcp(mv({ value: 5 }), { testId: 'mc' }));
    expect(el.getAttribute('data-metric-id')).toBe('engagement.interactionsPerPost');
    expect(el.getAttribute('data-testid')).toBe('mc');
    expect(el.getAttribute('data-status')).toBe('known');
    expect(el.querySelector('.status')?.hasAttribute('hidden')).toBe(true);
  });
  it('uses glossary label unless label given', () => {
    const def = GLOSSARY.metrics.find((m) => m.id === 'engagement.interactionsPerPost')!;
    expect(c.metricCard(mcp()).querySelector('summary')?.textContent).toBe(def.label);
    expect(c.metricCard(mcp(mv(), { label: 'Custom' })).querySelector('summary')?.textContent).toBe('Custom');
  });
  it('reason and detail are text', () => {
    const el = c.metricCard(mcp(mv({ status: 'partial', reason: XSS }), { detail: XSS }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(XSS);
  });
  it('omits reason/detail lines when null', () => {
    const el = c.metricCard(mcp());
    expect(el.querySelector('.metric-reason')).toBeNull();
    expect(el.querySelector('.metric-detail')).toBeNull();
  });
});

describe('glossaryTerm', () => {
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('dt')).map((d) => d.textContent);
  it('shows all rows including Divided by', () => {
    const def = GLOSSARY.metrics.find((m) => m.id === 'engagement.interactionsPerPost')!;
    const el = c.glossaryTerm({ metricId: def.id, text: null });
    expect(el.tagName).toBe('DETAILS');
    expect(el.querySelector('summary')?.textContent).toBe(def.label);
    expect(rows(el)).toEqual(['Definition', 'Formula', 'Divided by', 'Includes', 'Excludes', 'Apps', 'Time basis']);
    expect(el.textContent).toContain(def.definition);
    expect(el.textContent).toContain(def.formula);
    expect(el.textContent).toContain(def.includes);
    expect(el.textContent).toContain(def.excludes);
  });
  it('omits Divided by for records.total; custom text', () => {
    const el = c.glossaryTerm({ metricId: 'records.total', text: 'Records' });
    expect(rows(el)).not.toContain('Divided by');
    expect(el.querySelector('summary')?.textContent).toBe('Records');
  });
  it('unknown metric id does not throw', () => {
    const el = c.glossaryTerm({ metricId: 'nope' as never, text: 'x' });
    expect(el.textContent).toContain('x');
  });
});
