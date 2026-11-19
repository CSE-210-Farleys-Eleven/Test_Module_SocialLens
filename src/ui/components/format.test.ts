// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatMetricValue as f } from './index';
import { mv } from './test-helpers';

describe('formatMetricValue', () => {
  it('prints exact integers with grouping', () => {
    expect(f(mv({ value: 12 }), 'integer')).toBe('12');
    expect(f(mv({ value: 0 }), 'integer')).toBe('0');
    expect(f(mv({ value: 1234 }), 'integer')).toBe('1,234');
    expect(f(mv({ value: 1234567 }), 'integer')).toBe('1,234,567');
  });
  it('prints lower bounds and non-bound partials', () => {
    expect(f(mv({ status: 'partial', isLowerBound: true, value: 12 }), 'integer')).toBe('At least 12');
    expect(f(mv({ status: 'partial', isLowerBound: false, value: 3.44 }), 'decimal1')).toBe('3.4');
  });
  it('prints unknown and not-available as words, never 0', () => {
    expect(f(mv({ status: 'unknown', value: null }), 'integer')).toBe('Unknown');
    expect(f(mv({ status: 'not-available', value: null }), 'integer')).toBe('Not available');
  });
  it('decimal1 and percent', () => {
    expect(f(mv({ value: 5 }), 'decimal1')).toBe('5.0');
    expect(f(mv({ value: 3.45 }), 'decimal1')).toBe('3.5');
    expect(f(mv({ value: 0.666 }), 'percent')).toBe('67%');
    expect(f(mv({ value: 0.145 }), 'percent')).toBe('15%');
    expect(f(mv({ value: 1234.56 }), 'decimal1')).toBe('1,234.6');
  });
  it('settling prints the plain number', () => {
    expect(f(mv({ status: 'settling', value: 7 }), 'integer')).toBe('7');
  });
  it('never prints NaN or Infinity', () => {
    expect(f(mv({ value: Number.NaN }), 'integer')).toBe('Unknown');
    expect(f(mv({ value: Infinity }), 'percent')).toBe('Unknown');
    expect(f(mv({ value: null }), 'integer')).toBe('Unknown');
  });
  it('rounds half away from zero for negatives', () => {
    expect(f(mv({ value: -2.5 }), 'integer')).toBe('-3');
    expect(f(mv({ value: -0.2 }), 'integer')).toBe('0');
  });
});
