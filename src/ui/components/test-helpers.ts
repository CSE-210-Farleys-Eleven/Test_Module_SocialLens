// Test-only helpers (not exported from index.ts).
import { GLOSSARY, type MetricId, type MetricValue } from '../../shared';
import { createComponents } from './index';

export const XSS = '<img src=x onerror=alert(1)>';

export function make() {
  return createComponents({ document, glossary: GLOSSARY });
}

export function mv(over: Partial<MetricValue> = {}): MetricValue {
  return {
    metricId: 'engagement.interactionsPerPost' as MetricId,
    value: 12,
    status: 'exact',
    isLowerBound: false,
    reason: null,
    numerator: null,
    denominator: null,
    contributingApps: ['bluesky'],
    ...over,
  };
}
