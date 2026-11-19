// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { make, mv, XSS } from './test-helpers';

const dir = __dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-helpers.ts' && f !== 'contract.ts');

describe('hygiene', () => {
  it('has source files to check', () => expect(sources.length).toBeGreaterThanOrEqual(7));
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'DOMParser', 'eval(', 'style=', '.style', 'localStorage', 'fetch(', 'setTimeout', 'setInterval']) {
    it(`no source file contains ${banned}`, () => {
      for (const f of sources) expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain(banned);
    });
  }
  it('no component output has src, style, on* attributes, img or iframe', () => {
    const c = make();
    const root = c.h('div', null,
      c.card({ title: XSS, subtitle: XSS, children: [c.emptyState({ title: XSS, detail: XSS })], testId: null }),
      c.metricCard({ label: null, value: mv(), detail: XSS, format: 'integer', testId: null }),
      c.barChart({ title: XSS, series: ['a'], data: [{ label: XSS, values: [3] }], labelHeader: 'h', emptyText: 'e', testId: null }),
      c.banner({ tone: 'info', badge: 'b', text: XSS, testId: null }),
      c.noticeList({ notices: [{ code: 'demo-synthetic', level: 'info', message: XSS }], onDismiss: () => {} }),
      c.textInput({ id: 'i', label: 'l', placeholder: '', value: '', maxLength: 5, description: null, onInput: () => {}, onSubmit: () => {}, testId: null }),
      c.citationLink({ citation: { sourceId: 'x' as never, title: 't', publisher: 'p', url: 'https://example.com', accessed: 'd' } }),
    );
    expect(root.querySelector('[src]')).toBeNull();
    expect(root.querySelector('img,iframe,script,video,audio,object,embed,link,style')).toBeNull();
    for (const el of Array.from(root.querySelectorAll('*'))) {
      for (const name of el.getAttributeNames()) {
        expect(name.startsWith('on'), name).toBe(false);
        expect(name).not.toBe('style');
        if (name === 'href') expect(el.tagName).toBe('A');
      }
    }
    expect(root.querySelectorAll('a').length).toBe(1);
  });
});
