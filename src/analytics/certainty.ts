// The glossary's "Status of a value" table, implemented once and reused by every count.
import type { AppId, MetricId, Nsid, RecordKind, Snapshot } from '../shared/contract';
import type { RegistryData } from '../registry/contract';
import type { MetricValue } from '../shared/contract';

export type CoverageVerdict = 'exact' | 'partial' | 'unknown' | 'not-available';

export interface Assessment {
  readonly status: CoverageVerdict;
  /** Plain sentence naming the cause; null when exact. */
  readonly reason: string | null;
  /** Apps owning at least one collection in C, in registry app order. */
  readonly contributingApps: readonly AppId[];
}

/** Registered collections that can produce any of `kinds`, in registry order. */
export function collectionsForKinds(registry: RegistryData, kinds: readonly RecordKind[]): Nsid[] {
  return registry.collections.filter((c) => c.kinds.some((k) => kinds.includes(k))).map((c) => c.nsid);
}

export function appsOwning(registry: RegistryData, collections: readonly string[]): AppId[] {
  const owners = new Set<AppId>();
  for (const c of registry.collections) if (collections.includes(c.nsid)) owners.add(c.appId);
  const ordered = registry.apps.map((a) => a.id).filter((id) => owners.has(id));
  for (const id of owners) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

function skippedCount(snapshot: Snapshot, nsid: string): number {
  let n = 0;
  for (const s of snapshot.skipped) if (s.collection === nsid) n += 1;
  return n;
}

/**
 * Status for a metric whose contributing collections are `collections` (C).
 * First match: empty C → not-available; every C unavailable (missing row = unavailable) → unknown;
 * any partial / unavailable / skipped → partial; otherwise exact.
 */
export function assessCoverage(snapshot: Snapshot, registry: RegistryData, collections: readonly string[]): Assessment {
  const contributingApps = appsOwning(registry, collections);
  if (collections.length === 0) {
    return { status: 'not-available', reason: 'No analysed collection can supply this value.', contributingApps };
  }
  // Each problem names its collection (by registry label), and identical sentences are not repeated.
  const problems = new Set<string>();
  const labelOf = (nsid: string): string => registry.collections.find((c) => c.nsid === nsid)?.label ?? nsid;
  let unavailable = 0;
  for (const nsid of new Set(collections)) {
    const row = snapshot.coverage.find((c) => c.collection === nsid);
    if (row === undefined) {
      unavailable += 1;
      problems.add(`${labelOf(nsid)}: not read.`);
    } else if (row.status === 'unavailable') {
      unavailable += 1;
      problems.add(`${labelOf(nsid)}: ${row.reason}`);
    } else if (row.status === 'partial') {
      problems.add(`${labelOf(nsid)}: ${row.reason}`);
    }
    const skipped = skippedCount(snapshot, nsid);
    if (skipped > 0) problems.add(`${labelOf(nsid)}: ${skipped} record${skipped === 1 ? ' was' : 's were'} skipped.`);
  }
  const reason = [...problems].join(' ');
  if (unavailable === new Set(collections).size) {
    return { status: 'unknown', reason, contributingApps };
  }
  if (problems.size > 0) return { status: 'partial', reason, contributingApps };
  return { status: 'exact', reason: null, contributingApps };
}

/** A count metric: null when unknown / not-available; "at least" when partial. */
export function countValue(metricId: MetricId, value: number, a: Assessment): MetricValue {
  const known = a.status === 'exact' || a.status === 'partial';
  return {
    metricId,
    value: known ? value : null,
    status: a.status,
    isLowerBound: a.status === 'partial',
    reason: a.reason,
    numerator: null,
    denominator: null,
    contributingApps: [...a.contributingApps],
  };
}
