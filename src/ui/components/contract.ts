/**
 * M7b `ui/components/` — FROZEN CONTRACT.
 * Dependency-free native-DOM building blocks: cards, charts (hand-rolled SVG), tables, status labels.
 * Components receive data and callbacks; they never fetch, never read the store,
 * and render every piece of source content as TEXT (no innerHTML, ever).
 */
import type { AtUri, Citation, Glossary, MetricId, MetricValue, Notice, NoticeCode, StatusLabel } from '../../shared/contract';

export type Child = Node | string | number | null | undefined | false;

/** Attribute values. `on*` names, `style`, `srcdoc` and `href` are refused by `h` (use the dedicated components). */
export type Attrs = Readonly<Record<string, string | number | boolean>>;

export type Tone = 'neutral' | 'info' | 'warning' | 'synthetic';

export interface ButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant: 'primary' | 'secondary' | 'text' | 'danger';
  readonly disabled: boolean;
  readonly testId: string | null;
  /** Marks the current item in a navigation group (`aria-current="page"`). */
  readonly current: boolean;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  readonly id: string;
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly testId: string | null;
}

export interface TextInputProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  /** Help or disclosure text tied to the input with `aria-describedby`. */
  readonly description: string | null;
  readonly onInput: (value: string) => void;
  /** Enter key. */
  readonly onSubmit: (value: string) => void;
  readonly testId: string | null;
}

export interface CardProps {
  readonly title: string;
  readonly subtitle: string | null;
  readonly children: readonly Child[];
  readonly testId: string | null;
}

export interface MetricCardProps {
  /** Overrides the glossary label when set. */
  readonly label: string | null;
  readonly value: MetricValue;
  /** Extra line under the value, e.g. "12 of 14 posts have known counts". */
  readonly detail: string | null;
  /** How to print a non-null value. */
  readonly format: 'integer' | 'decimal1' | 'percent';
  readonly testId: string | null;
}

export interface TableColumn {
  readonly header: string;
  readonly align: 'start' | 'end';
}

export interface TableProps {
  /** Visually hidden caption for assistive technology. */
  readonly caption: string;
  readonly columns: readonly TableColumn[];
  /** Each row has exactly `columns.length` cells. */
  readonly rows: readonly (readonly Child[])[];
  readonly emptyText: string;
  readonly testId: string | null;
}

export interface BarDatum {
  /** Axis label, e.g. "2026-11-03", "18", "Mon". */
  readonly label: string;
  /** One value per series, same order as `BarChartProps.series`. Non-negative. */
  readonly values: readonly number[];
}

export interface BarChartProps {
  /** Accessible name of the chart; must state the time zone when time-based ("… (UTC)"). */
  readonly title: string;
  /** Legend labels; one entry = plain bars, several = stacked bars. */
  readonly series: readonly string[];
  readonly data: readonly BarDatum[];
  /** Header of the label column in the equivalent data table. */
  readonly labelHeader: string;
  readonly emptyText: string;
  readonly testId: string | null;
}

export interface BannerProps {
  readonly tone: Tone;
  /** Short badge text, e.g. "SYNTHETIC DEMO". */
  readonly badge: string;
  readonly text: string;
  readonly testId: string | null;
}

export interface NoticeListProps {
  readonly notices: readonly Notice[];
  readonly onDismiss: (code: NoticeCode) => void;
}

export interface GlossaryTermProps {
  readonly metricId: MetricId;
  /** Visible text; defaults to the glossary label when null. */
  readonly text: string | null;
}

export interface AtUriListProps {
  /** Shown as text inside <code>; never turned into links, never fetched. */
  readonly uris: readonly AtUri[];
  readonly label: string;
  readonly emptyText: string;
}

export interface CitationLinkProps {
  readonly citation: Citation;
}

export interface DefinitionItem {
  readonly term: string;
  readonly description: Child;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly detail: string;
}

export interface Components {
  /** Hyperscript helper: creates an element, sets attributes with setAttribute, appends children as nodes or TEXT. */
  h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K];
  button(props: ButtonProps): HTMLButtonElement;
  select(props: SelectProps): HTMLElement;
  textInput(props: TextInputProps): HTMLElement;
  card(props: CardProps): HTMLElement;
  /** Small pill for one of the six status labels; empty-text label 'known' renders nothing visible. */
  statusLabel(label: StatusLabel): HTMLElement;
  /** Number + status label + glossary term for one MetricValue. */
  metricCard(props: MetricCardProps): HTMLElement;
  dataTable(props: TableProps): HTMLElement;
  /** SVG bar chart (role="img") followed by an equivalent <details> data table. */
  barChart(props: BarChartProps): HTMLElement;
  banner(props: BannerProps): HTMLElement;
  noticeList(props: NoticeListProps): HTMLElement;
  /** Inline <details> definition: label, definition, formula, denominator, includes/excludes, contributing apps. */
  glossaryTerm(props: GlossaryTermProps): HTMLElement;
  atUriList(props: AtUriListProps): HTMLElement;
  /** The ONLY way to render a hyperlink: https URL from a Citation, rel="noopener noreferrer", target="_blank". */
  citationLink(props: CitationLinkProps): HTMLElement;
  definitionList(items: readonly DefinitionItem[]): HTMLElement;
  emptyState(props: EmptyStateProps): HTMLElement;
}

export interface ComponentsDeps {
  readonly document: Document;
  readonly glossary: Glossary;
}

export type CreateComponents = (deps: ComponentsDeps) => Components;

/** Pure: the exact text a MetricValue is printed as ("≥ 12", "Unknown", "0", "3.4", "86%" …). */
export type FormatMetricValue = (value: MetricValue, format: MetricCardProps['format']) => string;
