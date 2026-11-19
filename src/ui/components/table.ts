import type { Components, TableProps } from './contract';

export function createTable(h: Components['h']): Pick<Components, 'dataTable'> {
  const dataTable = (props: TableProps): HTMLElement => {
    const tbody = h('tbody', null);
    if (props.rows.length === 0) {
      tbody.append(h('tr', null, h('td', { class: 'empty-cell', colspan: Math.max(1, props.columns.length) }, props.emptyText)));
    } else {
      for (const row of props.rows) {
        tbody.append(h('tr', null, ...props.columns.map((col, i) => h('td', { class: `align-${col.align}` }, row[i]))));
      }
    }
    return h('div', { class: 'table-wrap', 'data-testid': props.testId ?? false },
      h('table', { class: 'data-table' },
        h('caption', { class: 'sr-only' }, props.caption),
        h('thead', null, h('tr', null, ...props.columns.map((col) => h('th', { scope: 'col', class: `align-${col.align}` }, col.header)))),
        tbody));
  };
  return { dataTable };
}
