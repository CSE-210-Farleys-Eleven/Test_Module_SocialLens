// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { make, XSS } from './test-helpers';

const c = make();
const tp = { caption: 'Cap', columns: [{ header: 'A', align: 'start' as const }, { header: 'B', align: 'end' as const }], rows: [['x', 1], [XSS, c.h('b', null, '2')]], emptyText: 'Nothing', testId: 'tb' };

describe('dataTable', () => {
  it('renders caption, headers, cells', () => {
    const el = c.dataTable(tp);
    expect(el.querySelector('caption')?.textContent).toBe('Cap');
    const ths = el.querySelectorAll('th');
    expect(ths.length).toBe(2);
    expect(ths[0]!.getAttribute('scope')).toBe('col');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelectorAll('tbody td').length).toBe(4);
    expect(el.getAttribute('data-testid')).toBe('tb');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(XSS);
    expect(el.querySelectorAll('td')[1]!.className).toContain('align-end');
  });
  it('zero rows renders emptyText in one full-width cell', () => {
    const el = c.dataTable({ ...tp, rows: [] });
    const tds = el.querySelectorAll('tbody td');
    expect(tds.length).toBe(1);
    expect(tds[0]!.getAttribute('colspan')).toBe('2');
    expect(tds[0]!.textContent).toBe('Nothing');
  });
});

const days = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
const mkChart = (over = {}) => ({
  title: 'Posts per day (UTC)', series: ['Posts', 'Replies'], labelHeader: 'Day', emptyText: 'No activity', testId: 'ch',
  data: days.map((label, i) => ({ label, values: [i + 1, 2] })), ...over,
});
const num = (e: Element, n: string) => Number(e.getAttribute(n));

describe('barChart', () => {
  it('7 points x 2 series -> 14 rects, accessible svg, matching table', () => {
    const el = c.barChart(mkChart());
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Posts per day (UTC)');
    expect(svg.querySelector('title')?.textContent).toBe('Posts per day (UTC)');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.querySelectorAll('rect').length).toBe(14);
    expect(el.querySelector('details summary')?.textContent).toBe('View data table');
    const heads = Array.from(el.querySelectorAll('th')).map((t) => t.textContent);
    expect(heads).toEqual(['Day', 'Posts', 'Replies']);
    const cells = Array.from(el.querySelectorAll('tbody td')).map((t) => t.textContent);
    expect(cells.slice(0, 6)).toEqual(['d1', '1', '2', 'd2', '2', '2']);
    expect(el.getAttribute('data-testid')).toBe('ch');
    expect(el.textContent).toContain('Posts');
    expect(el.querySelectorAll('.chart-legend li').length).toBe(2);
  });
  it('heights proportional; stacked bars adjoin', () => {
    const el = c.barChart(mkChart({ series: ['S'], data: [{ label: 'a', values: [2] }, { label: 'b', values: [4] }] }));
    const [a, b] = Array.from(el.querySelectorAll('rect'));
    expect(num(b!, 'height')).toBeCloseTo(2 * num(a!, 'height'));
    const st = c.barChart(mkChart({ data: [{ label: 'a', values: [3, 5] }] }));
    const [s1, s2] = Array.from(st.querySelectorAll('rect'));
    expect(num(s2!, 'y') + num(s2!, 'height')).toBeCloseTo(num(s1!, 'y'));
    expect(num(s1!, 'x')).toBe(num(s2!, 'x'));
  });
  it('minimum axis max is 4; zero values still emitted', () => {
    const el = c.barChart(mkChart({ series: ['S'], data: [{ label: 'a', values: [0] }, { label: 'b', values: [1] }] }));
    const rects = el.querySelectorAll('rect');
    expect(rects.length).toBe(2);
    expect(num(rects[0]!, 'height')).toBe(0);
    expect(el.querySelector('.chart-gridlines, line.gridline')).not.toBeNull();
  });
  it('all-zero and empty data show emptyText with no rects', () => {
    const zero = c.barChart(mkChart({ data: [{ label: 'a', values: [0, 0] }] }));
    expect(zero.querySelectorAll('rect').length).toBe(0);
    expect(zero.querySelector('svg')).toBeNull();
    expect(zero.textContent).toContain('No activity');
    expect(zero.querySelector('table')).not.toBeNull();
    const none = c.barChart(mkChart({ data: [] }));
    expect(none.textContent).toContain('No activity');
    expect(none.querySelector('svg')).toBeNull();
    expect(none.querySelector('table')).toBeNull();
  });
  it('30 points -> first, middle, last x labels only', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, values: [1, 1] }));
    const el = c.barChart(mkChart({ data }));
    const xs = Array.from(el.querySelectorAll('svg text.axis-x')).map((t) => t.textContent);
    expect(xs.length).toBe(3);
    expect(xs[0]).toBe('L0');
    expect(xs[2]).toBe('L29');
    expect(c.barChart(mkChart()).querySelectorAll('svg text.axis-x').length).toBe(7);
  });
  it('labels with markup appear as text', () => {
    const el = c.barChart(mkChart({ title: '<b>t</b>', series: ['<b>s</b>'], data: [{ label: '<b>x</b>', values: [1] }] }));
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>x</b>');
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toBe('<b>t</b>');
  });
  it('tolerates short value arrays and bad numbers', () => {
    const el = c.barChart(mkChart({ data: [{ label: 'a', values: [Number.NaN] }, { label: 'b', values: [2] }] }));
    expect(el.querySelectorAll('rect').length).toBe(4);
    expect(el.textContent).not.toContain('NaN');
  });
});
