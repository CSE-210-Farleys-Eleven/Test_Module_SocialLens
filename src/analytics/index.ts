// M6 `analytics/` public API. Pure, deterministic, synchronous and total; runs unchanged in a Worker.
import type { ComputeAnalytics } from './contract';
import { computeActivity } from './activity';
import { computeEngagement } from './engagement';
import { computeTotals } from './totals';
import { isDated, isInRange, resolveWindow, type AnalysisContext } from './window';

export const computeAnalytics: ComputeAnalytics = (input) => {
  const { snapshot, registry, options } = input;
  const N = snapshot.fetchedAt;
  const rangeWindow = resolveWindow(options.range, N);
  const inRange = snapshot.records.filter((r) => isInRange(r.createdAt, rangeWindow));
  const ctx: AnalysisContext = { snapshot, registry, options, rangeWindow, inRange };

  let undated = 0;
  let futureDated = 0;
  for (const r of snapshot.records) {
    if (r.createdAt === null) undated += 1;
    else if (!isDated(r.createdAt, N)) futureDated += 1;
  }

  const coverageComplete =
    snapshot.skipped.length === 0 &&
    snapshot.coverage.every((c) => c.status === 'complete') &&
    registry.collections.every((c) => snapshot.coverage.some((row) => row.collection === c.nsid));

  const totals = computeTotals(ctx);
  const { engagement, topPosts } = computeEngagement(ctx);
  const activity = computeActivity(ctx);

  return {
    schemaVersion: 1,
    did: snapshot.account.did,
    fetchedAt: N,
    mode: snapshot.mode,
    window: rangeWindow,
    coverageComplete,
    overview: totals.overview,
    byKind: totals.byKind,
    byApp: totals.byApp,
    undated,
    futureDated,
    engagement,
    topPosts,
    hourHistogram: activity.hourHistogram,
    weekdayHistogram: activity.weekdayHistogram,
    timeline: activity.timeline,
    streak: activity.streak,
    weekOverWeek: activity.weekOverWeek,
  };
};
