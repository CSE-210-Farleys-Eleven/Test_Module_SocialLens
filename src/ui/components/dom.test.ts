// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { make, XSS } from './test-helpers';

const c = make();
const btnProps = { label: 'Go', onClick: () => {}, variant: 'primary', disabled: false, testId: null, current: false } as const;

describe('h', () => {
  it('renders string children as text nodes', () => {
    const el = c.h('div', null, XSS);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe(XSS);
    expect(el.firstChild?.nodeType).toBe(3);
  });
  it('appends nodes, numbers; skips null/undefined/false', () => {
    const el = c.h('p', { class: 'x' }, 'a', 2, null, undefined, false, c.h('b', null, 'z'));
    expect(el.textContent).toBe('a2z');
    expect(el.className).toBe('x');
  });
  it('boolean attributes: true sets, false omits', () => {
    const el = c.h('input', { disabled: true, hidden: false });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
  });
  it('throws for forbidden attributes', () => {
    for (const name of ['onclick', 'onerror', 'ONLOAD', 'style', 'srcdoc', 'href'])
      expect(() => c.h('div', { [name]: 'x' })).toThrow(TypeError);
  });
  it('throws for forbidden tags', () => {
    for (const tag of ['script', 'iframe', 'object', 'embed', 'link', 'style'])
      expect(() => c.h(tag as 'div', null)).toThrow(TypeError);
  });
});

describe('button', () => {
  it('calls onClick once per click', () => {
    const onClick = vi.fn();
    const b = c.button({ ...btnProps, onClick });
    b.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b.type).toBe('button');
    expect(b.textContent).toBe('Go');
    expect(b.classList.contains('btn-primary')).toBe(true);
  });
  it('disabled does not call', () => {
    const onClick = vi.fn();
    const b = c.button({ ...btnProps, onClick, disabled: true });
    b.click();
    b.dispatchEvent(new Event('click'));
    expect(onClick).not.toHaveBeenCalled();
    expect(b.disabled).toBe(true);
  });
  it('aria-current and test id', () => {
    const b = c.button({ ...btnProps, current: true, testId: 't1' });
    expect(b.getAttribute('aria-current')).toBe('page');
    expect(b.getAttribute('data-testid')).toBe('t1');
    expect(c.button(btnProps).hasAttribute('aria-current')).toBe(false);
  });
  it('label is text', () => {
    expect(c.button({ ...btnProps, label: XSS }).querySelector('img')).toBeNull();
  });
});

describe('select', () => {
  const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
  it('renders options, marks current, calls onChange', () => {
    const onChange = vi.fn();
    const root = c.select({ id: 'sel', label: 'Pick', options: opts, value: 'b', onChange, testId: 'sel-t' });
    const sel = root.querySelector('select')!;
    expect(sel.options.length).toBe(2);
    expect(sel.value).toBe('b');
    expect(sel.getAttribute('data-testid')).toBe('sel-t');
    expect(root.querySelector('label')?.getAttribute('for')).toBe('sel');
    expect(root.querySelector('label')?.textContent).toBe('Pick');
    sel.value = 'a';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('textInput', () => {
  const base = { id: 'h', label: 'Handle', placeholder: 'x', value: 'v', maxLength: 253, description: 'Help me', testId: 'ti', onInput: () => {}, onSubmit: () => {} };
  it('wires label, description, attributes', () => {
    const root = c.textInput(base);
    const input = root.querySelector('input')!;
    expect(input.type).toBe('text');
    expect(input.id).toBe('h');
    expect(input.getAttribute('maxlength')).toBe('253');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('data-testid')).toBe('ti');
    expect(input.value).toBe('v');
    expect(root.querySelector('label')?.getAttribute('for')).toBe('h');
    const descId = input.getAttribute('aria-describedby')!;
    expect(root.querySelector(`[id="${descId}"]`)?.textContent).toBe('Help me');
  });
  it('omits aria-describedby without description', () => {
    const input = c.textInput({ ...base, description: null }).querySelector('input')!;
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
  it('fires onInput and onSubmit on Enter only', () => {
    const onInput = vi.fn(); const onSubmit = vi.fn();
    const input = c.textInput({ ...base, onInput, onSubmit }).querySelector('input')!;
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    expect(onInput).toHaveBeenCalledWith('abc');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onSubmit).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSubmit).toHaveBeenCalledWith('abc');
  });
});

describe('card, definitionList, emptyState', () => {
  it('card renders title/subtitle/children as text', () => {
    const el = c.card({ title: XSS, subtitle: XSS, children: ['x', c.h('i', null, 'k')], testId: 'cd' });
    expect(el.tagName).toBe('SECTION');
    expect(el.querySelector('h2')?.textContent).toBe(XSS);
    expect(el.querySelector('img')).toBeNull();
    expect(el.getAttribute('data-testid')).toBe('cd');
    expect(el.textContent).toContain('k');
  });
  it('card omits null subtitle', () => {
    const el = c.card({ title: 'T', subtitle: null, children: [], testId: null });
    expect(el.querySelector('.card-subtitle')).toBeNull();
  });
  it('emptyState is text', () => {
    const el = c.emptyState({ title: XSS, detail: XSS });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(XSS);
  });
  it('definitionList pairs dt/dd', () => {
    const el = c.definitionList([{ term: 'A', description: XSS }, { term: 'B', description: c.h('b', null, 'n') }]);
    expect(el.querySelectorAll('dt').length).toBe(2);
    expect(el.querySelectorAll('dd').length).toBe(2);
    expect(el.querySelector('img')).toBeNull();
  });
});
