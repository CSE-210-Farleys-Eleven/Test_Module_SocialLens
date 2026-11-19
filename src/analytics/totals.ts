// Totals: byKind, byApp and the Overview (metrics shared by every app only — I-13).
import { CONTENT_KINDS, RECORD_KINDS } from '../shared/contract';
import type { AppId, IsoDate, IsoDateTime, RecordKind } from '../shared/contract';
import { isoDateOf } from '../shared/index';
import type { AppTotal, KindTotal, OverviewMetrics } from './contract';
import { assessCoverage, collectionsForKinds, countValue } from './certainty';
import { isDated, type AnalysisContext } from './window';

const CONTENT: readonly RecordKind[] = CONTENT_KINDS;

/** Used only when no registered collection produces a kind (then its count is not-available anyway). */
function fallbackApp(kind: RecordKind): AppId {
  return kind === 'document' || kind === 'publication' ? 'standard-site' : 'bluesky';
}

export interface Totals {
  readonly byKind: KindTotal[];
  readonly byApp: AppTotal[];
  readonly overview: OverviewMetrics;
}

export function computeTotals(ctx: AnalysisContext): Totals {
  const { snapshot, registry, inRange } = ctx;
  const N = snapshot.fetchedAt;

  const perKind = new Map<RecordKind, number>();
  const perApp = new Map<AppId, number>();
  const contentPerApp = new Map<AppId, number>();
  const activeDates = new Set<IsoDate>();
  let content = 0;
  for (const r of inRange) {
    perKind.set(r.kind, (perKind.get(r.kind) ?? 0) + 1);
    perApp.set(r.app, (perApp.get(r.app) ?? 0) + 1);
    if (CONTENT.includes(r.kind)) {
      content += 1;
      contentPerApp.set(r.app, (contentPerApp.get(r.app) ?? 0) + 1);
      if (isDated(r.createdAt, N)) activeDates.add(isoDateOf(r.createdAt));
    }
  }

  const byKind: KindTotal[] = RECORD_KINDS.map((kind) => {
    const owner = registry.collections.find((c) => c.kinds.includes(kind));
    const a = assessCoverage(snapshot, registry, collectionsForKinds(registry, [kind]));
    return { kind, appId: owner?.appId ?? fallbackApp(kind), count: countValue('records.byKind', perKind.get(kind) ?? 0, a) };
  });

  const byApp: AppTotal[] = registry.apps.map((app) => {
    const own = registry.collections.filter((c) => c.appId === app.id);
    const ownContent = own.filter((c) => c.kinds.some((k) => CONTENT.includes(k)));
    return {
      appId: app.id,
      records: countValue('records.byApp', perApp.get(app.id) ?? 0, assessCoverage(snapshot, registry, own.map((c) => c.nsid))),
      contentItems: countValue(
        'content.items',
        contentPerApp.get(app.id) ?? 0,
        assessCoverage(snapshot, registry, ownContent.map((c) => c.nsid)),
      ),
    };
  });

  const contentCollections = collectionsForKinds(registry, CONTENT);
  const contentAssessment = assessCoverage(snapshot, registry, contentCollections);

  let lastContentAt: IsoDateTime | null = null;
  for (const r of snapshot.records) {
    if (CONTENT.includes(r.kind) && isDated(r.createdAt, N) && (lastContentAt === null || r.createdAt > lastContentAt)) {
      lastContentAt = r.createdAt;
    }
  }

  const overview: OverviewMetrics = {
    includedApps: registry.apps.map((a) => a.id),
    contentItems: countValue('content.items', content, contentAssessment),
    activeDays: countValue('activity.activeDays', activeDates.size, contentAssessment),
    recordsTotal: countValue(
      'records.total',
      inRange.length,
      assessCoverage(snapshot, registry, registry.collections.map((c) => c.nsid)),
    ),
    lastContentAt,
  };

  return { byKind, byApp, overview };
}
