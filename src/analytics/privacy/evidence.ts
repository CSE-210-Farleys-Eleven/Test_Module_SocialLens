// Evidence helpers: count certainty, own-record samples, earliest/latest.
// Pure: no clock (the reference "now" is snapshot.fetchedAt), no DOM, no network.

import { parseAtUri } from '../../shared/index';
import type { ActivityRecord, AtUri, CoverageStatus, IsoDateTime, Nsid, Snapshot } from '../../shared/contract';
import type { CollectionDefinition, RegistryData } from '../../registry/contract';
import type { ObservationEvidence, PrivacyOptions } from './contract';

/** Shape of a normalised IsoDateTime; anything else is treated as "no usable time". */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface Context {
  readonly snapshot: Snapshot;
  readonly registry: RegistryData;
  readonly options: PrivacyOptions;
  /** Records whose URI authority is the account DID. Nothing else is ever evidence. */
  readonly own: readonly ActivityRecord[];
  /** Collections with at least one skipped record or one record that was not the person's own. */
  readonly incompleteCollections: ReadonlySet<string>;
  readonly coverage: ReadonlyMap<string, CoverageStatus>;
}

export function buildContext(snapshot: Snapshot, registry: RegistryData, options: PrivacyOptions): Context {
  const did = snapshot.account.did;
  const own: ActivityRecord[] = [];
  const incomplete = new Set<string>();
  for (const r of snapshot.records) {
    const parsed = parseAtUri(r.uri);
    if (parsed !== null && parsed.did === did && r.did === did) own.push(r);
    else incomplete.add(r.collection);
  }
  for (const s of snapshot.skipped) incomplete.add(s.collection);
  const coverage = new Map<string, CoverageStatus>();
  for (const c of snapshot.coverage) coverage.set(c.collection, c.status);
  return { snapshot, registry, options, own, incompleteCollections: incomplete, coverage };
}

/** A missing coverage row counts as `unavailable`. */
export function coverageStatus(ctx: Context, nsid: string): CoverageStatus {
  return ctx.coverage.get(nsid) ?? 'unavailable';
}

/** `exact` only when every collection is complete and nothing in it was skipped. */
export function certaintyOf(ctx: Context, nsids: readonly string[]): 'exact' | 'lower-bound' {
  for (const n of nsids) {
    if (coverageStatus(ctx, n) !== 'complete' || ctx.incompleteCollections.has(n)) return 'lower-bound';
  }
  return 'exact';
}

/** Registered collections (registry order) able to produce any of the given kinds. */
export function collectionsFor(ctx: Context, kinds: readonly string[]): readonly CollectionDefinition[] {
  return ctx.registry.collections.filter((c) => c.kinds.some((k) => kinds.includes(k)));
}

export function isDated(createdAt: IsoDateTime | null, fetchedAt: IsoDateTime): createdAt is IsoDateTime {
  return createdAt !== null && ISO_INSTANT.test(createdAt) && createdAt <= fetchedAt;
}

/** Newest first by createdAt (undated / malformed last), ties by URI ascending. */
export function compareNewestFirst(a: ActivityRecord, b: ActivityRecord): number {
  const ta = a.createdAt !== null && ISO_INSTANT.test(a.createdAt) ? a.createdAt : null;
  const tb = b.createdAt !== null && ISO_INSTANT.test(b.createdAt) ? b.createdAt : null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta < tb ? 1 : -1;
  }
  return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
}

export function sampleCap(options: PrivacyOptions): number {
  return Number.isFinite(options.sampleUris) ? Math.max(0, Math.floor(options.sampleUris)) : 0;
}

export function samplesOf(records: readonly ActivityRecord[], cap: number): AtUri[] {
  return [...records].sort(compareNewestFirst).slice(0, cap).map((r) => r.uri);
}

export function earliestLatest(
  records: readonly ActivityRecord[],
  fetchedAt: IsoDateTime,
): { earliestAt: IsoDateTime | null; latestAt: IsoDateTime | null } {
  let earliestAt: IsoDateTime | null = null;
  let latestAt: IsoDateTime | null = null;
  for (const r of records) {
    if (!isDated(r.createdAt, fetchedAt)) continue;
    if (earliestAt === null || r.createdAt < earliestAt) earliestAt = r.createdAt;
    if (latestAt === null || r.createdAt > latestAt) latestAt = r.createdAt;
  }
  return { earliestAt, latestAt };
}

/** Evidence for a set of own records: count, certainty, samples, earliest/latest. */
export function recordEvidence(
  ctx: Context,
  records: readonly ActivityRecord[],
  collections: readonly string[],
  details: ObservationEvidence['details'] = [],
): ObservationEvidence {
  return {
    count: records.length,
    countCertainty: certaintyOf(ctx, collections),
    sampleUris: samplesOf(records, sampleCap(ctx.options)),
    ...earliestLatest(records, ctx.snapshot.fetchedAt),
    collections: collections as Nsid[],
    details,
  };
}

/** "In this synthetic example, " for demo data, "In the records fetched, " for live data. */
export function summaryPrefix(ctx: Context): string {
  return ctx.snapshot.mode === 'demo' ? 'In this synthetic example, ' : 'In the records fetched, ';
}

/** "3 like records are" / "at least 1 like record is". */
export function countPhrase(count: number, certainty: ObservationEvidence['countCertainty'], noun: string): string {
  const atLeast = certainty === 'lower-bound' ? 'at least ' : '';
  return `${atLeast}${count} ${noun} ${count === 1 ? 'record is' : 'records are'}`;
}
