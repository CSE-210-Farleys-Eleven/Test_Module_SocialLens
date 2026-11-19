import { describe, expect, it } from 'vitest';
import {
  APP_IDS,
  METRIC_IDS,
  SOURCES,
  UNAVAILABLE_METRIC_IDS,
  type MetricId,
  type MetricValue,
  type SourceId,
  type ValueStatus,
} from './contract';
import { citation, GLOSSARY, metricDefinition, statusLabelFor } from './glossary';

function mv(status: ValueStatus, value: number | null): MetricValue {
  return {
    metricId: 'records.total',
    value,
    status,
    isLowerBound: false,
    reason: null,
    numerator: null,
    denominator: null,
    contributingApps: ['bluesky'],
  };
}

describe('statusLabelFor', () => {
  it('covers all six labels', () => {
    expect(statusLabelFor(mv('not-available', null))).toBe('not-available');
    expect(statusLabelFor(mv('unknown', null))).toBe('unknown');
    expect(statusLabelFor(mv('partial', 3))).toBe('partial');
    expect(statusLabelFor(mv('settling', 3))).toBe('settling');
    expect(statusLabelFor(mv('exact', 0))).toBe('zero');
    expect(statusLabelFor(mv('exact', 12))).toBe('known');
  });
  it('a partial or settling zero is not an observed zero', () => {
    expect(statusLabelFor(mv('partial', 0))).toBe('partial');
    expect(statusLabelFor(mv('settling', 0))).toBe('settling');
  });
});

describe('GLOSSARY', () => {
  it('has the version from GLOSSARY.md', () => {
    expect(GLOSSARY.version).toBe('2026-11-18.1');
  });
  it('has exactly one metric definition per METRIC_IDS entry, in order', () => {
    expect(GLOSSARY.metrics.map((m) => m.id)).toEqual([...METRIC_IDS]);
  });
  it('has exactly one unavailable definition per UNAVAILABLE_METRIC_IDS entry, in order', () => {
    expect(GLOSSARY.unavailable.map((m) => m.id)).toEqual([...UNAVAILABLE_METRIC_IDS]);
  });
  it('engagement.interactionsPerPost names its denominator and is not sharedByAllApps', () => {
    const d = metricDefinition('engagement.interactionsPerPost');
    expect(d.denominator).toMatch(/known posts/i);
    expect(d.sharedByAllApps).toBe(false);
    expect(d.unit).toBe('per-post');
  });
  it('every sharedByAllApps metric lists both apps', () => {
    const shared = GLOSSARY.metrics.filter((m) => m.sharedByAllApps);
    expect(shared.map((m) => m.id)).toEqual(['records.total', 'content.items', 'activity.activeDays']);
    for (const m of shared) expect([...m.contributingApps].sort()).toEqual([...APP_IDS].sort());
  });
  it('engagement metrics are Bluesky-only and never on the Overview', () => {
    for (const m of GLOSSARY.metrics.filter((x) => x.id.startsWith('engagement.'))) {
      expect(m.contributingApps).toEqual(['bluesky']);
      expect(m.sharedByAllApps).toBe(false);
    }
  });
  it('ratio metrics name a denominator; plain counts do not', () => {
    expect(metricDefinition('engagement.knownShare').denominator).not.toBeNull();
    expect(metricDefinition('records.total').denominator).toBeNull();
  });
  it('every text field is non-empty', () => {
    for (const m of GLOSSARY.metrics) {
      for (const k of ['label', 'definition', 'formula', 'includes', 'excludes', 'timeBasis'] as const) {
        expect(m[k].length, `${m.id}.${k}`).toBeGreaterThan(0);
      }
    }
    for (const u of GLOSSARY.unavailable) {
      expect(u.label.length).toBeGreaterThan(0);
      expect(u.reason.length).toBeGreaterThan(0);
      expect(u.wouldRequire.length).toBeGreaterThan(0);
    }
  });
  it('never names engagement rate outside the unavailable list (hygiene IT-12)', () => {
    expect(JSON.stringify(GLOSSARY.metrics).toLowerCase()).not.toContain('engagement rate');
    expect(JSON.stringify(GLOSSARY).toLowerCase()).not.toMatch(/clearsky|constellation/);
  });
  it('is structured-cloneable and immutable', () => {
    expect(structuredClone(GLOSSARY)).toEqual(GLOSSARY);
    expect(Object.isFrozen(GLOSSARY)).toBe(true);
    expect(Object.isFrozen(GLOSSARY.metrics)).toBe(true);
    expect(Object.isFrozen(GLOSSARY.metrics[0])).toBe(true);
  });
});

describe('metricDefinition', () => {
  it('returns the definition for every id', () => {
    for (const id of METRIC_IDS) expect(metricDefinition(id).id).toBe(id);
  });
  it('throws for an id that is not in the glossary (programmer error)', () => {
    expect(() => metricDefinition('nope' as MetricId)).toThrow();
  });
});

describe('citation', () => {
  it('returns the URL from SOURCES unchanged, plus sourceId', () => {
    for (const id of Object.keys(SOURCES) as SourceId[]) {
      expect(citation(id)).toEqual({ sourceId: id, ...SOURCES[id] });
      expect(citation(id).url).toBe(SOURCES[id].url);
    }
  });
  it('returns a copy, not the SOURCES object', () => {
    const c = citation('bsky-privacy-policy');
    expect(c).not.toBe(SOURCES['bsky-privacy-policy']);
    expect(structuredClone(c)).toEqual(c);
  });
});
