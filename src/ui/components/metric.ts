import { STATUS_LABEL_TEXT, statusLabelFor, type Glossary } from '../../shared';
import type { Components, GlossaryTermProps, MetricCardProps } from './contract';
import { formatMetricValue } from './format';

export function createMetric(h: Components['h'], glossary: Glossary): Pick<Components, 'statusLabel' | 'metricCard' | 'glossaryTerm'> {
  const statusLabel: Components['statusLabel'] = (label) =>
    h('span', { class: `status status-${label}`, 'data-status': label, hidden: label === 'known' },
      label === 'known' ? null : STATUS_LABEL_TEXT[label]);

  const glossaryTerm = (props: GlossaryTermProps): HTMLElement => {
    const def = glossary.metrics.find((m) => m.id === props.metricId);
    const text = props.text ?? def?.label ?? props.metricId;
    if (def === undefined) return h('span', { class: 'glossary glossary-missing', 'data-metric-id': props.metricId }, text);
    const rows: [string, string][] = [['Definition', def.definition], ['Formula', def.formula]];
    if (def.denominator !== null) rows.push(['Divided by', def.denominator]);
    rows.push(['Includes', def.includes], ['Excludes', def.excludes], ['Apps', def.contributingApps.join(', ')], ['Time basis', def.timeBasis]);
    const dl = h('dl', { class: 'glossary-body' });
    for (const [term, description] of rows) dl.append(h('dt', null, term), h('dd', null, description));
    return h('details', { class: 'glossary', 'data-metric-id': props.metricId }, h('summary', { class: 'glossary-term' }, text), dl);
  };

  const metricCard = (props: MetricCardProps): HTMLElement => {
    const { value } = props;
    const label = statusLabelFor(value);
    return h('article', {
      class: 'metric-card',
      'data-metric-id': value.metricId,
      'data-status': label,
      'data-testid': props.testId ?? false,
    },
      h('div', { class: 'metric-label' }, glossaryTerm({ metricId: value.metricId, text: props.label })),
      h('p', { class: 'metric-value' }, h('strong', { class: 'metric-number' }, formatMetricValue(value, props.format)), statusLabel(label)),
      value.reason === null ? null : h('p', { class: 'metric-reason muted' }, value.reason),
      props.detail === null ? null : h('p', { class: 'metric-detail muted' }, props.detail));
  };

  return { statusLabel, metricCard, glossaryTerm };
}
