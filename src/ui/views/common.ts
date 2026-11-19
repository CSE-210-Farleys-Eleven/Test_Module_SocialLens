// Small helpers shared by the views. Pure string formatting and gating; no metric is computed here.
import { AT_LEAST_PREFIX, statusLabelFor } from '../../shared';
import type { AppId, HandleStatus, IsoDateTime, MetricValue, ObservationId, ValueStatus } from '../../shared/contract';
import type { RegistryData } from '../../registry/contract';
import type { AnalysisResult } from '../../analytics/worker/contract';
import type { AppState } from '../../analytics/state/contract';
import type { Components } from '../components/contract';
import type { ViewsDeps } from './contract';

/** Groups an integer with commas, independent of locale ("1,234"). */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return 'Unknown';
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '−' : '';
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Text for a count MetricValue in a table cell. Mirrors the components' `formatMetricValue`
 * rule for format 'integer' (that function is not part of the injected `Components`).
 * Unknown is never printed as 0.
 */
export function formatCount(value: MetricValue): string {
  if (value.status === 'not-available') return 'Not available';
  if (value.status === 'unknown' || value.value === null || !Number.isFinite(value.value)) return 'Unknown';
  if (value.status === 'partial' && value.isLowerBound) return AT_LEAST_PREFIX + formatInt(value.value);
  return formatInt(value.value);
}

/** A count cell: the formatted value followed by its status label (text, not colour). */
export function countCell(c: Components, value: MetricValue): HTMLElement {
  return c.h('span', { class: 'count-cell' }, c.h('span', { class: 'count-value' }, formatCount(value)), ' ', c.statusLabel(statusLabelFor(value)));
}

/** "2026-11-10 14:00" from a normalised UTC instant. */
export function formatDateTime(iso: IsoDateTime): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function formatDate(iso: IsoDateTime): string {
  return iso.slice(0, 10);
}

export function appName(registry: RegistryData, id: AppId): string {
  return registry.apps.find((a) => a.id === id)?.displayName ?? id;
}

export function collectionLabel(registry: RegistryData, nsid: string): string {
  return registry.collections.find((c) => c.nsid === nsid)?.label ?? nsid;
}

export function handleStatusText(status: HandleStatus): string | null {
  if (status === 'invalid') return 'Handle not confirmed';
  if (status === 'unverified') return 'Handle not checked';
  return null;
}

/** Maps a series status (histogram, timeline) to a status label. */
export function seriesStatusLabel(status: ValueStatus): Parameters<Components['statusLabel']>[0] {
  return status === 'exact' ? 'known' : status;
}

export type Gate = { readonly ok: true; readonly result: AnalysisResult } | { readonly ok: false; readonly element: HTMLElement };

/** Analysis-backed sections render only when the analysis is ready; otherwise one placeholder. */
export function analysisGate(c: Components, state: AppState): Gate {
  const a = state.analysis;
  if (a.status === 'ready' && a.result !== null) return { ok: true, result: a.result };
  if (a.status === 'failed') {
    return {
      ok: false,
      element: c.h(
        'div',
        { class: 'analysis-failed', role: 'alert' },
        c.h('p', null, a.failure?.message ?? 'The analysis could not be completed.'),
        c.h('p', { class: 'muted' }, 'The fetched records are kept; "Read again" on the Accounts view retries.'),
      ),
    };
  }
  return { ok: false, element: c.h('p', { class: 'calculating', role: 'status', 'aria-live': 'polite' }, 'Calculating…') };
}

/** A view root: `<section class="view view-<name>" data-testid=…>`. */
export function viewRoot(c: Components, name: string, testId: string, ...children: (Node | null)[]): HTMLElement {
  return c.h('section', { class: `view view-${name}`, 'data-testid': testId }, ...children);
}

export function noData(deps: ViewsDeps, name: string, testId: string): HTMLElement {
  const c = deps.components;
  return viewRoot(c, name, testId, c.emptyState({ title: 'No data loaded', detail: 'Explore the synthetic demo or sign in on the Accounts view to read your own records.' }));
}

/** Catalogue titles (GLOSSARY.md Part C), needed for "not triggered" rows, which carry only an id. */
export const OBSERVATION_TITLES: Readonly<Record<ObservationId, string>> = {
  'public-likes': 'Your likes are public records',
  'public-follows': 'Your follows are public records',
  'public-blocks': 'Your blocks are public records',
  'public-lists': 'Lists you created are public records',
  'cross-app-identity': 'One identity links your activity across apps',
  'posting-time-pattern': 'Your posting times form a visible pattern',
  'handle-validity': 'Your handle could not be confirmed',
  'incomplete-coverage': 'This view is not your whole footprint',
};
