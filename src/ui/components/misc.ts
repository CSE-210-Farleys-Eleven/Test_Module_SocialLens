import type { AtUriListProps, BannerProps, CitationLinkProps, Components, NoticeListProps } from './contract';

function isHttps(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

export function createMisc(h: Components['h'], button: Components['button']): Pick<Components, 'banner' | 'noticeList' | 'atUriList' | 'citationLink'> {
  const banner = (props: BannerProps): HTMLElement =>
    h('div', { role: 'status', class: `banner banner-${props.tone}`, 'data-testid': props.testId ?? false },
      h('span', { class: 'banner-badge' }, props.badge),
      h('span', { class: 'banner-text' }, props.text));

  const noticeList = (props: NoticeListProps): HTMLElement =>
    h('div', { class: 'notice-list' }, ...props.notices.map((n) => {
      const code = n.code;
      return h('div', { class: `notice notice-${n.level}`, role: n.level === 'warning' ? 'alert' : 'status', 'data-notice-code': code },
        h('span', { class: 'notice-message' }, n.message),
        button({ label: 'Dismiss', onClick: () => props.onDismiss(code), variant: 'text', disabled: false, testId: null, current: false }));
    }));

  const atUriList = (props: AtUriListProps): HTMLElement => {
    const body = props.uris.length === 0
      ? h('p', { class: 'at-uri-empty muted' }, props.emptyText)
      : h('ul', { class: 'at-uri-items' }, ...props.uris.map((u) => h('li', null, h('code', null, u))));
    return h('div', { class: 'at-uri-list' }, h('p', { class: 'at-uri-label' }, props.label), body);
  };

  const citationLink = (props: CitationLinkProps): HTMLElement => {
    const c = props.citation;
    const text = `${c.title} — ${c.publisher}`;
    const main = isHttps(c.url)
      ? h('a', { class: 'citation-link', target: '_blank', rel: 'noopener noreferrer' }, text)
      : h('span', { class: 'citation-text' }, text);
    // href is refused by `h`; it is set here only after the https check.
    if (main.tagName === 'A') main.setAttribute('href', c.url);
    return h('span', { class: 'citation' }, main, ` (checked ${c.accessed})`);
  };

  return { banner, noticeList, atUriList, citationLink };
}
