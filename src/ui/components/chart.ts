// Adapted from the SocialLens prototype (same project), src/ui/chart.ts.
import type { BarChartProps, Components } from './contract';

const NS = 'http://www.w3.org/2000/svg';
const LEFT = 40;
const RIGHT = 790;
const BASELINE = 190;
const PLOT_HEIGHT = 150;

function clean(v: number | undefined): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
}

function tickText(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function createChart(doc: Document, h: Components['h'], dataTable: Components['dataTable']): Pick<Components, 'barChart'> {
  function svgNode(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
    const el = doc.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
    if (text !== undefined) el.append(doc.createTextNode(text));
    return el;
  }

  const barChart = (props: BarChartProps): HTMLElement => {
    const rows = props.data.map((d) => ({ label: d.label, values: props.series.map((_, i) => clean(d.values[i])) }));
    const totals = rows.map((r) => r.values.reduce((a, b) => a + b, 0));
    const hasSignal = totals.some((t) => t > 0);

    const table = h('details', { class: 'chart-data' },
      h('summary', null, 'View data table'),
      dataTable({
        caption: props.title,
        columns: [{ header: props.labelHeader, align: 'start' }, ...props.series.map((s) => ({ header: s, align: 'end' as const }))],
        rows: rows.map((r) => [r.label, ...r.values.map((v) => String(v))]),
        emptyText: props.emptyText,
        testId: null,
      }));

    const wrapper = h('div', { class: 'chart', 'data-testid': props.testId ?? false });
    if (!hasSignal) {
      wrapper.append(h('p', { class: 'chart-empty muted' }, props.emptyText));
      if (rows.length > 0) wrapper.append(table);
      return wrapper;
    }

    const max = Math.max(4, ...totals);
    const scale = PLOT_HEIGHT / max;
    const svg = svgNode('svg', { viewBox: '0 0 800 230', role: 'img', 'aria-label': props.title, class: 'bar-chart' });
    svg.append(svgNode('title', {}, props.title));
    for (let i = 0; i <= 4; i++) {
      const y = BASELINE - (PLOT_HEIGHT * i) / 4;
      svg.append(svgNode('line', { x1: LEFT, x2: RIGHT, y1: y, y2: y, class: 'gridline' }));
      svg.append(svgNode('text', { x: LEFT - 6, y: y + 4, class: 'chart-label axis-y', 'text-anchor': 'end' }, tickText((max * i) / 4)));
    }
    const n = rows.length;
    const step = (RIGHT - LEFT) / n;
    const width = Math.max(2, step * 0.62);
    const labelled = n <= 12 ? new Set(rows.keys()) : new Set([0, Math.floor(n / 2), n - 1]);
    rows.forEach((row, i) => {
      const x = LEFT + i * step + (step - width) / 2;
      let top = BASELINE;
      row.values.forEach((v, s) => {
        const height = v * scale;
        top -= height;
        const rect = svgNode('rect', { x, y: top, width, height, class: `bar series-${s}` });
        rect.append(svgNode('title', {}, `${row.label}: ${v} (${props.series[s] ?? ''})`));
        svg.append(rect);
      });
      if (labelled.has(i)) {
        const anchor = n > 12 && i === 0 ? 'start' : n > 12 && i === n - 1 ? 'end' : 'middle';
        const lx = anchor === 'start' ? LEFT : anchor === 'end' ? RIGHT : x + width / 2;
        svg.append(svgNode('text', { x: lx, y: 216, class: 'chart-label axis-x', 'text-anchor': anchor }, row.label));
      }
    });

    const legend = h('ul', { class: 'chart-legend' },
      ...props.series.map((s, i) => h('li', null, h('span', { class: `legend-swatch series-${i}`, 'aria-hidden': 'true' }), s)));
    wrapper.append(svg, legend, table);
    return wrapper;
  };
  return { barChart };
}
