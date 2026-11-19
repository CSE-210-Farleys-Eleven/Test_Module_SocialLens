// Adapted from the SocialLens prototype (same project), src/ui/dom.ts.
import type { Attrs, ButtonProps, CardProps, Child, Components, DefinitionItem, EmptyStateProps, SelectProps, TextInputProps } from './contract';

const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'style']);
const FORBIDDEN_ATTRS = new Set(['style', 'srcdoc', 'href']);

export interface DomKit {
  readonly h: Components['h'];
  readonly button: Components['button'];
  readonly select: Components['select'];
  readonly textInput: Components['textInput'];
  readonly card: Components['card'];
  readonly definitionList: Components['definitionList'];
  readonly emptyState: Components['emptyState'];
}

export function createDom(doc: Document): DomKit {
  function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
    if (FORBIDDEN_TAGS.has(String(tag).toLowerCase())) throw new TypeError(`h: tag <${String(tag)}> is not allowed`);
    const node = doc.createElement(tag);
    if (attrs !== null) {
      for (const [name, value] of Object.entries(attrs)) {
        const lower = name.toLowerCase();
        if (lower.startsWith('on') || FORBIDDEN_ATTRS.has(lower)) throw new TypeError(`h: attribute "${name}" is not allowed`);
        if (value === false) continue;
        node.setAttribute(name, value === true ? '' : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
    }
    return node;
  }

  function button(props: ButtonProps): HTMLButtonElement {
    const b = h('button', {
      type: 'button',
      class: `btn btn-${props.variant}`,
      disabled: props.disabled,
      'data-testid': props.testId ?? false,
      'aria-current': props.current ? 'page' : false,
    }, props.label);
    b.addEventListener('click', () => {
      if (!b.disabled) props.onClick();
    });
    return b;
  }

  function select(props: SelectProps): HTMLElement {
    const control = h('select', { id: props.id, 'data-testid': props.testId ?? false });
    for (const o of props.options) {
      control.append(h('option', { value: o.value, selected: o.value === props.value }, o.label));
    }
    control.value = props.value;
    control.addEventListener('change', () => props.onChange(control.value));
    return h('div', { class: 'field select-field' }, h('label', { class: 'field-label', for: props.id }, props.label), control);
  }

  function textInput(props: TextInputProps): HTMLElement {
    const descId = `${props.id}-description`;
    const input = h('input', {
      id: props.id,
      type: 'text',
      class: 'field-input',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      placeholder: props.placeholder,
      maxlength: props.maxLength,
      value: props.value,
      'aria-describedby': props.description === null ? false : descId,
      'data-testid': props.testId ?? false,
    });
    input.addEventListener('input', () => props.onInput(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) props.onSubmit(input.value);
    });
    return h('div', { class: 'field text-field' },
      h('label', { class: 'field-label', for: props.id }, props.label),
      input,
      props.description === null ? null : h('p', { class: 'field-description', id: descId }, props.description));
  }

  function card(props: CardProps): HTMLElement {
    return h('section', { class: 'card', 'data-testid': props.testId ?? false },
      h('div', { class: 'card-heading' },
        h('h2', { class: 'card-title' }, props.title),
        props.subtitle === null ? null : h('p', { class: 'card-subtitle muted' }, props.subtitle)),
      h('div', { class: 'card-body' }, ...props.children));
  }

  function definitionList(items: readonly DefinitionItem[]): HTMLElement {
    const dl = h('dl', { class: 'definition-list' });
    for (const item of items) {
      dl.append(h('dt', null, item.term), h('dd', null, item.description));
    }
    return dl;
  }

  function emptyState(props: EmptyStateProps): HTMLElement {
    return h('div', { class: 'empty-state' },
      h('span', { class: 'empty-icon', 'aria-hidden': 'true' }, '○'),
      h('h3', { class: 'empty-title' }, props.title),
      h('p', { class: 'empty-detail' }, props.detail));
  }

  return { h, button, select, textInput, card, definitionList, emptyState };
}
