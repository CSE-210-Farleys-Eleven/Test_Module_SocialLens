// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { citation } from '../../shared';
import { make, XSS } from './test-helpers';

const c = make();

describe('banner', () => {
  it('has role status, badge, text, no button', () => {
    const el = c.banner({ tone: 'synthetic', badge: 'SYNTHETIC DEMO', text: XSS, testId: 'bn' });
    expect(el.getAttribute('role')).toBe('status');
    expect(el.className).toBe('banner banner-synthetic');
    expect(el.querySelector('.banner-badge')?.textContent).toBe('SYNTHETIC DEMO');
    expect(el.textContent).toContain(XSS);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('button')).toBeNull();
    expect(el.getAttribute('data-testid')).toBe('bn');
  });
});

describe('noticeList', () => {
  const notices = [
    { code: 'demo-synthetic', level: 'info', message: XSS },
    { code: 'records-skipped', level: 'warning', message: 'skipped' },
  ] as const;
  it('roles, codes, text-only messages', () => {
    const el = c.noticeList({ notices, onDismiss: () => {} });
    const items = el.querySelectorAll('[data-notice-code]');
    expect(items.length).toBe(2);
    expect(items[0]!.getAttribute('role')).toBe('status');
    expect(items[1]!.getAttribute('role')).toBe('alert');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(XSS);
  });
  it('Dismiss calls onDismiss with code', () => {
    const onDismiss = vi.fn();
    const el = c.noticeList({ notices, onDismiss });
    const btns = el.querySelectorAll('button');
    expect(btns[1]!.textContent).toBe('Dismiss');
    btns[1]!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('records-skipped');
  });
  it('empty list renders no items', () => {
    expect(c.noticeList({ notices: [], onDismiss: () => {} }).querySelectorAll('[data-notice-code]').length).toBe(0);
  });
});

describe('atUriList', () => {
  it('renders each URI in code, no anchors', () => {
    const uris = ['at://did:plc:abc/app.bsky.feed.post/3k', XSS] as never;
    const el = c.atUriList({ uris, label: 'Records', emptyText: 'none' });
    expect(el.querySelectorAll('li code').length).toBe(2);
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('Records');
    expect(el.textContent).toContain(XSS);
  });
  it('empty shows emptyText', () => {
    const el = c.atUriList({ uris: [], label: 'Records', emptyText: 'none here' });
    expect(el.querySelector('li')).toBeNull();
    expect(el.textContent).toContain('none here');
  });
});

describe('citationLink', () => {
  const base = citation('atproto-blog-blocks');
  it('https url -> safe anchor with visible text', () => {
    const cit = { ...base, url: 'https://example.com/doc', title: 'T', publisher: 'P', accessed: '2026-11-18' };
    const el = c.citationLink({ citation: cit });
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/doc');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.textContent).toBe('T — P');
    expect(el.textContent).toBe('T — P (checked 2026-11-18)');
  });
  it('javascript:, http:, garbage -> no anchor, same text', () => {
    for (const url of ['javascript:alert(1)', 'http://example.com', 'not a url', '']) {
      const el = c.citationLink({ citation: { ...base, url, title: 'T', publisher: 'P', accessed: 'd' } });
      expect(el.querySelector('a')).toBeNull();
      expect(el.textContent).toBe('T — P (checked d)');
    }
  });
  it('title is text', () => {
    const el = c.citationLink({ citation: { ...base, url: 'https://example.com', title: XSS, publisher: 'P', accessed: 'd' } });
    expect(el.querySelector('img')).toBeNull();
  });
});
