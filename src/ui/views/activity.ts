// Activity: timeline, posting hours/weekdays, streaks, week over week, records by type and app.
import { LIMITS } from '../../shared';
import type { IsoDate } from '../../shared/contract';
import type { AnalyticsReport, Histogram, WeekWindow } from '../../analytics/contract';
import type { ViewRenderer, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { analysisGate, appName, countCell, formatInt, noData, seriesStatusLabel, viewRoot } from './common';

function span(start: IsoDate | null, end: IsoDate | null): string | null {
  if (start === null || end === null) return null;
  return start === end ? `${start} (UTC)` : `${start} to ${end} (UTC)`;
}

function signed(n: number, suffix = ''): string {
  if (n > 0) return `+${formatInt(n)}${suffix}`;
  if (n < 0) return `${formatInt(n)}${suffix}`; // formatInt prints the minus sign (U+2212)
  return `0${suffix}`;
}

export function createActivity(deps: ViewsDeps): ViewRenderer {
  const c = deps.components;
  const apps = deps.registry.apps;

  const unknownSeries = (title: string): HTMLElement =>
    c.h('div', { class: 'chart-unknown' }, c.h('h3', null, title), c.h('p', null, c.statusLabel('unknown'), ' ', 'The records this chart needs could not be read.'));

  const statusLine = (status: Histogram['status']): HTMLElement | null =>
    status === 'exact' ? null : c.h('p', { class: 'chart-status' }, c.statusLabel(seriesStatusLabel(status)), ' ', 'Some contributing collections were not read completely.');

  const timeline = (r: AnalyticsReport): HTMLElement => {
    const title = 'Content items per day (UTC)';
    const t = r.timeline;
    const body: (HTMLElement | null)[] = [];
    if (t.status === 'unknown') body.push(unknownSeries(title));
    else {
      body.push(
        c.barChart({
          title,
          series: apps.map((a) => a.displayName),
          data: t.days.map((d) => ({ label: d.date, values: apps.map((a) => d.content[a.id]) })),
          labelHeader: 'Day (UTC)',
          emptyText: 'No dated content items in this range.',
          testId: 'timeline-chart',
        }),
        statusLine(t.status),
      );
    }
    if (t.truncated) body.push(c.h('p', { class: 'note' }, `Only the latest ${LIMITS.timelineMaxDays} days are shown.`));
    body.push(c.h('p', { class: 'note' }, 'Only dated, fetched records are shown; a gap is not proof of inactivity.'));
    return c.h('div', { class: 'activity-timeline' }, ...body);
  };

  const histogram = (hist: Histogram, title: string, labelHeader: string, testId: string): HTMLElement => {
    if (hist.status === 'unknown') return unknownSeries(title);
    return c.h(
      'div',
      { class: 'activity-histogram' },
      c.barChart({
        title,
        series: ['Content items'],
        data: hist.bins.map((b) => ({ label: b.label, values: [b.count] })),
        labelHeader,
        emptyText: 'No dated content items in this range.',
        testId,
      }),
      statusLine(hist.status),
    );
  };

  const weekCard = (r: AnalyticsReport): HTMLElement => {
    const w = r.weekOverWeek;
    const windowCard = (label: string, win: WeekWindow) =>
      c.metricCard({ label: `${label}, ${win.startDate} to ${win.endDate}`, value: win.contentItems, detail: null, format: 'integer', testId: null });
    let change: string;
    if (w.delta === null) change = 'Change: Unknown';
    else if (w.delta === 0) change = 'Change: no change';
    else change = `Change: ${signed(w.delta)}${w.deltaFraction === null ? '' : ` (${signed(w.deltaFraction * 100, '%')})`}`;
    const partial = w.current.contentItems.status === 'partial' || w.previous.contentItems.status === 'partial';
    return c.card({
      title: 'Week over week (UTC)',
      subtitle: 'Content items in the last 7 UTC days and the 7 days before. Independent of the date range.',
      testId: 'week-over-week',
      children: [
        c.h('div', { class: 'metric-grid' }, windowCard('This week', w.current), windowCard('Previous week', w.previous)),
        c.h('p', { class: 'week-delta' }, change),
        partial ? c.h('p', { class: 'note' }, 'At least one week was not read completely, so the change may be off.') : null,
      ],
    });
  };

  const tables = (r: AnalyticsReport): HTMLElement[] => {
    const byType = c.dataTable({
      caption: 'Records by type in this range',
      columns: [
        { header: 'Type', align: 'start' },
        { header: 'App', align: 'start' },
        { header: 'Count', align: 'end' },
      ],
      rows: r.byKind.map((k) => {
        const app = apps.find((a) => a.id === k.appId);
        return [app?.kindLabels[k.kind] ?? k.kind, appName(deps.registry, k.appId), countCell(c, k.count)];
      }),
      emptyText: 'No records.',
      testId: 'records-by-type',
    });
    const byApp = c.dataTable({
      caption: 'Records by app in this range',
      columns: [
        { header: 'App', align: 'start' },
        { header: 'Records', align: 'end' },
        { header: 'Content items', align: 'end' },
      ],
      rows: r.byApp.map((a) => [appName(deps.registry, a.appId), countCell(c, a.records), countCell(c, a.contentItems)]),
      emptyText: 'No records.',
      testId: 'records-by-app',
    });
    return [c.card({ title: 'Records by type', subtitle: null, testId: null, children: [byType] }), c.card({ title: 'Records by app', subtitle: null, testId: null, children: [byApp] })];
  };

  return ({ state }) => {
    if (state.snapshot === null) return noData(deps, 'activity', TEST_IDS.viewActivity);
    const gate = analysisGate(c, state);
    if (!gate.ok) return viewRoot(c, 'activity', TEST_IDS.viewActivity, gate.element);
    const r = gate.result.analytics;
    const s = r.streak;
    const noUsableDate = r.undated + r.futureDated;
    return viewRoot(
      c,
      'activity',
      TEST_IDS.viewActivity,
      c.card({ title: 'Timeline', subtitle: null, testId: null, children: [timeline(r)] }),
      c.card({
        title: 'When you post (UTC)',
        subtitle: null,
        testId: null,
        children: [
          c.h(
            'div',
            { class: 'chart-pair' },
            histogram(r.hourHistogram, 'Posting hours (UTC)', 'Hour (UTC)', 'hour-chart'),
            histogram(r.weekdayHistogram, 'Posting weekdays (UTC)', 'Weekday (UTC)', 'weekday-chart'),
          ),
        ],
      }),
      c.card({
        title: 'Posting streaks (UTC days)',
        subtitle: 'All fetched content, independent of the date range.',
        testId: null,
        children: [
          c.h(
            'div',
            { class: 'metric-grid' },
            c.metricCard({ label: null, value: s.current, detail: span(s.currentStart, s.currentEnd), format: 'integer', testId: null }),
            c.metricCard({ label: null, value: s.longest, detail: span(s.longestStart, s.longestEnd), format: 'integer', testId: null }),
          ),
        ],
      }),
      weekCard(r),
      ...tables(r),
      noUsableDate > 0 ? c.h('p', { class: 'footnote' }, `${formatInt(noUsableDate)} record(s) have no usable date; they count only in 'All fetched records'.`) : null,
    );
  };
}
