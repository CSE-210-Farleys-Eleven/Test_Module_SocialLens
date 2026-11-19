// One pure trigger/evidence function per catalogue observation (GLOSSARY.md Part C).
// Restraint rules: evidence is only the person's own records; a subject DID, another
// account's handle or record text never reaches the output; no inference about
// location, identity, health or personality; no score.

import { citation } from '../../shared/index';
import { CONTENT_KINDS } from '../../shared/contract';
import type { ActivityRecord, AppId, Nsid, ObservationId, RecordKind } from '../../shared/contract';
import type { EvidenceDetail, NotTriggered, ObservationEvidence, PrivacyObservation } from './contract';
import { catalogueEntry, NOT_TRIGGERED } from './catalogue';
import {
  certaintyOf,
  collectionsFor,
  compareNewestFirst,
  type Context,
  countPhrase,
  coverageStatus,
  earliestLatest,
  isDated,
  recordEvidence,
  sampleCap,
  summaryPrefix,
} from './evidence';

export type RuleResult = PrivacyObservation | NotTriggered;
export type Rule = (ctx: Context) => RuleResult;

function observation(ctx: Context, id: ObservationId, sentence: string, evidence: ObservationEvidence): PrivacyObservation {
  const entry = catalogueEntry(id);
  return {
    id,
    title: entry.title,
    summary: `${summaryPrefix(ctx)}${sentence}`,
    evidence,
    source: citation(entry.sourceId),
    limitation: entry.limitation,
    action: entry.action,
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ───────────────────────── record observations ─────────────────────────

interface RecordRuleSpec {
  readonly id: ObservationId;
  readonly kinds: readonly RecordKind[];
  /** Noun used in the summary: "<n> <noun> records are public." */
  readonly noun: string;
  readonly noRecords: string;
  /** Optional per-kind detail rows: kind → label. */
  readonly detailRows?: readonly (readonly [RecordKind, string])[];
}

function recordRule(spec: RecordRuleSpec): Rule {
  return (ctx) => {
    const registered = collectionsFor(ctx, spec.kinds);
    const records = ctx.own.filter((r) => spec.kinds.includes(r.kind));
    const first = registered[0];
    if (first !== undefined && registered.every((c) => coverageStatus(ctx, c.nsid) === 'unavailable')) {
      return { id: spec.id, reason: NOT_TRIGGERED.notRead(first.label) };
    }
    if (records.length === 0) return { id: spec.id, reason: spec.noRecords };

    const collections =
      registered.length > 0 ? registered.map((c) => c.nsid as string) : uniqueInOrder(records.map((r) => r.collection)).sort();
    const details: EvidenceDetail[] = (spec.detailRows ?? []).map(([kind, label]) => {
      const kindCollections = collectionsFor(ctx, [kind]).map((c) => c.nsid as string);
      const n = records.filter((r) => r.kind === kind).length;
      if (kindCollections.length > 0 && kindCollections.every((c) => coverageStatus(ctx, c) === 'unavailable')) {
        return { label, value: 'could not be read' };
      }
      return { label, value: certaintyOf(ctx, kindCollections) === 'exact' ? String(n) : `at least ${n}` };
    });
    const evidence = recordEvidence(ctx, records, collections, details);
    const sentence = `${countPhrase(records.length, evidence.countCertainty, spec.noun)} public.`;
    return observation(ctx, spec.id, sentence, evidence);
  };
}

export const publicLikes = recordRule({ id: 'public-likes', kinds: ['like'], noun: 'like', noRecords: NOT_TRIGGERED.noLikes });
export const publicFollows = recordRule({
  id: 'public-follows',
  kinds: ['follow'],
  noun: 'follow',
  noRecords: NOT_TRIGGERED.noFollows,
});
export const publicBlocks = recordRule({ id: 'public-blocks', kinds: ['block'], noun: 'block', noRecords: NOT_TRIGGERED.noBlocks });
export const publicLists = recordRule({
  id: 'public-lists',
  kinds: ['list', 'list-item'],
  noun: 'list or list-membership',
  noRecords: NOT_TRIGGERED.noLists,
  detailRows: [
    ['list', 'Lists'],
    ['list-item', 'List memberships you created'],
  ],
});

// ─────────────────────────── cross-app identity ───────────────────────────

export const crossAppIdentity: Rule = (ctx) => {
  const id: ObservationId = 'cross-app-identity';
  const byApp = new Map<AppId, ActivityRecord[]>();
  for (const r of ctx.own) byApp.set(r.app, [...(byApp.get(r.app) ?? []), r]);
  if (byApp.size < 2) return { id, reason: NOT_TRIGGERED.oneApp };

  const registryOrder = ctx.registry.apps.map((a) => a.id);
  const apps = [...byApp.keys()].sort((a, b) => {
    const ia = registryOrder.indexOf(a);
    const ib = registryOrder.indexOf(b);
    if (ia !== ib) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const details: EvidenceDetail[] = [];
  const newestPerApp: ActivityRecord[] = [];
  for (const app of apps) {
    const records = byApp.get(app) ?? [];
    const appCollections = ctx.registry.collections.filter((c) => c.appId === app).map((c) => c.nsid as string);
    const atLeast = certaintyOf(ctx, appCollections) === 'exact' ? '' : 'at least ';
    const label = ctx.registry.apps.find((a) => a.id === app)?.displayName ?? app;
    details.push({ label, value: `${atLeast}${plural(records.length, 'record', 'records')}` });
    const newest = [...records].sort(compareNewestFirst)[0];
    if (newest !== undefined) newestPerApp.push(newest);
  }

  const registeredOrder: readonly Nsid[] = ctx.registry.collections.map((c) => c.nsid);
  const present = new Set<Nsid>(ctx.own.map((r) => r.collection));
  const collections: Nsid[] = [
    ...registeredOrder.filter((c) => present.has(c)),
    ...[...present].filter((c) => !registeredOrder.includes(c)).sort(),
  ];

  const evidence: ObservationEvidence = {
    count: apps.length,
    countCertainty: 'exact',
    sampleUris: [...newestPerApp].sort(compareNewestFirst).slice(0, sampleCap(ctx.options)).map((r) => r.uri),
    ...earliestLatest(ctx.own, ctx.snapshot.fetchedAt),
    collections,
    details,
  };
  const names = details.map((d) => d.label).join(' and ');
  return observation(ctx, id, `records from ${apps.length} apps (${names}) are published under the same account.`, evidence);
};

// ─────────────────────────── posting-time pattern ───────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const postingTimePattern: Rule = (ctx) => {
  const id: ObservationId = 'posting-time-pattern';
  const { patternMinItems, patternShareThreshold } = ctx.options;
  const bandHours = Number.isFinite(ctx.options.patternBandHours)
    ? Math.min(24, Math.max(1, Math.floor(ctx.options.patternBandHours)))
    : 6;
  const contentKinds: readonly RecordKind[] = CONTENT_KINDS;
  const items = ctx.own.filter((r) => contentKinds.includes(r.kind) && isDated(r.createdAt, ctx.snapshot.fetchedAt));
  if (items.length < patternMinItems || items.length === 0) {
    return { id, reason: NOT_TRIGGERED.fewItems(patternMinItems) };
  }

  const bandCount = Math.ceil(24 / bandHours);
  const bands: ActivityRecord[][] = Array.from({ length: bandCount }, () => []);
  for (const r of items) {
    const hour = Number((r.createdAt ?? '').slice(11, 13));
    bands[Math.floor(hour / bandHours)]?.push(r);
  }
  let best = 0;
  for (let b = 1; b < bandCount; b++) {
    if ((bands[b]?.length ?? 0) > (bands[best]?.length ?? 0)) best = b; // strict: ties keep the earliest band
  }
  const inBand = bands[best] ?? [];
  const total = items.length;
  // Integer-safe "share ≥ threshold" (tolerates 0.4 not being exact in binary).
  if (inBand.length / total < patternShareThreshold - 1e-9) {
    return { id, reason: NOT_TRIGGERED.noBand(patternShareThreshold, bandHours) };
  }

  const start = best * bandHours;
  const end = Math.min(24, start + bandHours) - 1;
  const bandLabel = `${pad2(start)}:00–${pad2(end)}:59 UTC`;
  const percent = Math.floor((200 * inBand.length + total) / (2 * total)); // nearest integer, half up
  const collections = collectionsFor(ctx, CONTENT_KINDS).map((c) => c.nsid as string);
  const evidence = recordEvidence(ctx, inBand, collections, [
    { label: 'Busiest band', value: bandLabel },
    { label: 'Share', value: `${percent}% of ${total} dated items` },
  ]);
  const atLeast = evidence.countCertainty === 'lower-bound' ? 'at least ' : '';
  return observation(ctx, id, `${atLeast}${inBand.length} of ${total} dated content items fall in ${bandLabel}.`, evidence);
};

// ─────────────────────────── handle validity ───────────────────────────

export const handleValidity: Rule = (ctx) => {
  const id: ObservationId = 'handle-validity';
  const account = ctx.snapshot.account;
  if (account.handleStatus === 'valid') return { id, reason: NOT_TRIGGERED.handleValid };

  const status = account.handleStatus === 'invalid' ? 'invalid' : 'unverified';
  const checkedBy = status === 'invalid' && account.handleCheck === 'pds-attested' ? 'your PDS (describeRepo)' : 'not checked';
  const handle = account.handle ?? 'none';
  const evidence: ObservationEvidence = {
    count: null,
    countCertainty: 'unknown',
    sampleUris: [],
    earliestAt: null,
    latestAt: null,
    collections: [],
    details: [
      { label: 'Handle', value: handle },
      { label: 'Status', value: status },
      { label: 'Checked by', value: checkedBy },
    ],
  };
  const sentence =
    account.handle === null
      ? 'this account has no handle that could be confirmed.'
      : status === 'invalid'
        ? `the handle ${account.handle} was not confirmed to point to this account.`
        : `the handle ${account.handle} could not be checked.`;
  return observation(ctx, id, sentence, evidence);
};

// ─────────────────────────── incomplete coverage ───────────────────────────

export const incompleteCoverage: Rule = (ctx) => {
  const id: ObservationId = 'incomplete-coverage';
  const snap = ctx.snapshot;
  const registered = ctx.registry.collections.map((c) => c.nsid as string);
  const unregisteredRows = snap.coverage
    .map((c) => c.collection as string)
    .filter((c) => !registered.includes(c))
    .sort();
  const affected = uniqueInOrder([...registered, ...unregisteredRows]).filter((c) => coverageStatus(ctx, c) !== 'complete');
  const engagementIncomplete = snap.engagementCoverage.status !== 'complete';
  const skipped = snap.skipped.length;
  const inventoryUnknown = snap.inventoryStatus === 'unknown';
  const unanalysed = snap.unanalysedCollections.length;

  if (affected.length === 0 && !engagementIncomplete && skipped === 0 && !inventoryUnknown && unanalysed === 0) {
    return { id, reason: NOT_TRIGGERED.coverageComplete };
  }

  const details: EvidenceDetail[] = affected.map((nsid) => ({
    label: ctx.registry.collections.find((c) => c.nsid === nsid)?.label ?? nsid,
    value: snap.coverage.find((c) => c.collection === nsid)?.reason ?? 'No read was recorded for this collection.',
  }));
  if (engagementIncomplete) details.push({ label: 'Engagement counts', value: snap.engagementCoverage.reason });
  if (inventoryUnknown) details.push({ label: 'Collection inventory', value: 'could not be read' });
  details.push({ label: 'Skipped records', value: String(skipped) });
  details.push({ label: 'Present, not analysed', value: String(unanalysed) });

  const parts: string[] = [];
  if (affected.length > 0) {
    parts.push(`${plural(affected.length, 'collection was', 'collections were')} not read completely`);
  }
  if (engagementIncomplete) parts.push('public counts for some posts could not be read');
  if (skipped > 0) parts.push(`${plural(skipped, 'record was', 'records were')} skipped`);
  if (inventoryUnknown) parts.push('the list of collections in your repository could not be read');
  if (unanalysed > 0) {
    parts.push(`${plural(unanalysed, 'collection is', 'collections are')} present in your repository but not analysed`);
  }

  const evidence: ObservationEvidence = {
    count: affected.length,
    countCertainty: 'exact',
    sampleUris: [],
    earliestAt: null,
    latestAt: null,
    collections: affected as unknown as ObservationEvidence['collections'],
    details,
  };
  return observation(ctx, id, `${parts.join('; ')}.`, evidence);
};

/** In OBSERVATION_IDS order. */
export const RULES: Readonly<Record<ObservationId, Rule>> = {
  'public-likes': publicLikes,
  'public-follows': publicFollows,
  'public-blocks': publicBlocks,
  'public-lists': publicLists,
  'cross-app-identity': crossAppIdentity,
  'posting-time-pattern': postingTimePattern,
  'handle-validity': handleValidity,
  'incomplete-coverage': incompleteCoverage,
};
