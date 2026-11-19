import { AT_LEAST_PREFIX } from '../../shared';
import type { FormatMetricValue } from './contract';

/** Manual thousands grouping so output never depends on the runtime locale. */
function group(n: number): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Half away from zero; the epsilon absorbs binary representation error (e.g. 14.499999999999998). */
function roundHalfUp(abs: number): number {
  return Math.round(abs + 1e-9);
}

function formatNumber(n: number, format: 'integer' | 'decimal1' | 'percent'): string {
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  if (format === 'percent') {
    const r = roundHalfUp(abs * 100);
    return `${r > 0 && sign < 0 ? '-' : ''}${group(r)}%`;
  }
  if (format === 'decimal1') {
    const tenths = roundHalfUp(abs * 10);
    const whole = Math.floor(tenths / 10);
    return `${tenths > 0 && sign < 0 ? '-' : ''}${group(whole)}.${tenths % 10}`;
  }
  const r = roundHalfUp(abs);
  return `${r > 0 && sign < 0 ? '-' : ''}${group(r)}`;
}

export const formatMetricValue: FormatMetricValue = (value, format) => {
  if (value.status === 'not-available') return 'Not available';
  if (value.status === 'unknown') return 'Unknown';
  if (value.value === null || !Number.isFinite(value.value)) return 'Unknown';
  const text = formatNumber(value.value, format);
  if (value.status === 'partial' && value.isLowerBound) return AT_LEAST_PREFIX + text;
  return text;
};
