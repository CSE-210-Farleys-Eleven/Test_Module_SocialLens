import { describe, expect, it } from 'vitest';
import { assessCoverage, collectionsForKinds, countValue } from './certainty';
import { makeRegistry, makeSnapshot, NSID, skip } from './testkit';

describe('certainty (status of a value)', () => {
  const registry = makeRegistry();

  it('maps kinds to collections via the registry', () => {
    expect(collectionsForKinds(registry, ['post'])).toEqual([NSID.post]);
    expect(collectionsForKinds(registry, ['post', 'reply', 'document'])).toEqual([NSID.post, NSID.document]);
  });

  it('all complete, nothing skipped → exact, null reason, contributing apps from C', () => {
    const a = assessCoverage(makeSnapshot({ registry }), registry, [NSID.post, NSID.document]);
    expect(a.status).toBe('exact');
    expect(a.reason).toBeNull();
    expect(a.contributingApps).toEqual(['bluesky', 'standard-site']);
  });

  it('partial collection → partial with a reason', () => {
    const a = assessCoverage(makeSnapshot({ registry, coverage: { [NSID.like]: 'partial' } }), registry, [NSID.like]);
    expect(a.status).toBe('partial');
    expect(a.reason).toMatch(/page limit/);
  });

  it('several incomplete collections → each reason names its collection by its registry label', () => {
    const snap = makeSnapshot({ registry, coverage: { [NSID.like]: 'partial', [NSID.follow]: 'partial' } });
    const a = assessCoverage(snap, registry, [NSID.post, NSID.like, NSID.follow]);
    expect(a.status).toBe('partial');
    // Found on a real account: identical sentences were concatenated with no hint of which collection each was about.
    // The test registry uses the NSID as the label.
    expect(a.reason).toContain(`${NSID.like}: `);
    expect(a.reason).toContain(`${NSID.follow}: `);
    expect(a.reason).not.toContain(`${NSID.post}: `);
    const again = assessCoverage(snap, registry, [NSID.like, NSID.like]);
    expect(again.reason?.split(`${NSID.like}: `).length).toBe(2);
  });

  it('every collection unavailable → unknown; some → partial', () => {
    const snap = makeSnapshot({ registry, coverage: { [NSID.post]: 'unavailable', [NSID.document]: 'unavailable' } });
    expect(assessCoverage(snap, registry, [NSID.post, NSID.document]).status).toBe('unknown');
    const snap2 = makeSnapshot({ registry, coverage: { [NSID.document]: 'unavailable' } });
    expect(assessCoverage(snap2, registry, [NSID.post, NSID.document]).status).toBe('partial');
  });

  it('missing coverage row counts as unavailable', () => {
    const snap = makeSnapshot({ registry, coverage: { [NSID.block]: null } });
    expect(assessCoverage(snap, registry, [NSID.block]).status).toBe('unknown');
  });

  it('skipped records → partial', () => {
    const snap = makeSnapshot({ registry, skipped: [skip(NSID.post)] });
    const a = assessCoverage(snap, registry, [NSID.post]);
    expect(a.status).toBe('partial');
    expect(a.reason).toMatch(/skipped/i);
  });

  it('empty C → not-available', () => {
    expect(assessCoverage(makeSnapshot({ registry }), registry, []).status).toBe('not-available');
  });

  it('countValue: value null iff unknown / not-available; lower bound only on partial', () => {
    const snap = makeSnapshot({ registry, coverage: { [NSID.like]: 'partial', [NSID.block]: 'unavailable' } });
    const p = countValue('records.byKind', 4, assessCoverage(snap, registry, [NSID.like]));
    expect(p).toMatchObject({ value: 4, status: 'partial', isLowerBound: true, numerator: null, denominator: null });
    const u = countValue('records.byKind', 0, assessCoverage(snap, registry, [NSID.block]));
    expect(u).toMatchObject({ value: null, status: 'unknown', isLowerBound: false });
    const e = countValue('records.byKind', 0, assessCoverage(snap, registry, [NSID.post]));
    expect(e).toMatchObject({ value: 0, status: 'exact', isLowerBound: false, reason: null });
  });
});
