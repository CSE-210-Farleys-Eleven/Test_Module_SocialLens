# M7b `ui/components/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md). Wording of status labels: `STATUS_LABEL_TEXT`, `AT_LEAST_PREFIX` in `src/shared/contract.ts`.

## Purpose
Dependency-free native-DOM building blocks — cards, hand-rolled SVG bar charts, tables, status labels, glossary popovers, AT-URI lists — that receive data and callbacks and return elements.

## Contribution to the whole
Two of the product's promises are enforced here once, for every view: **source content is only ever rendered as text**, and **every number carries its honesty label** (known / observed zero / partial / settling / unknown / not available on this app) with its glossary definition one click away. Views compose these and stay small.

## What to optimise for (ranked)
1. **Safety of rendering** — no path from data to markup, script or network.
2. **Clarity and accessibility of uncertainty** — labels are text (not colour alone), charts have table equivalents, controls are keyboard-usable.
3. Small and predictable — pure functions of props; no state, no fetch, no store.

## Public API (`src/ui/components/index.ts`)
```ts
export const createComponents: CreateComponents;     // ({ document, glossary }) => Components
export const formatMetricValue: FormatMetricValue;   // pure
```

### `formatMetricValue(value, format)`
| Status | Output |
|---|---|
| `not-available` | `"Not available"` |
| `unknown` | `"Unknown"` |
| `partial` with `isLowerBound` | `AT_LEAST_PREFIX + n` → `"At least 12"` |
| anything else | `n` |

`n`: `integer` → `Math.round`, grouped with a thin, locale-independent rule (`1,000`; use a manual formatter, not `toLocaleString`); `decimal1` → one decimal, half away from zero (`3.45` → `3.5`, `5` → `5.0`); `percent` → value × 100 rounded to an integer + `%`. Never prints `NaN`; a non-finite number prints `"Unknown"`.

### Components (all return detached elements created with `deps.document`)
- **`h(tag, attrs, ...children)`** — `createElement`; attributes via `setAttribute` (`true` → empty attribute, `false` → omitted); children: `Node` appended, strings/numbers appended as **text nodes**, `null`/`undefined`/`false` skipped. Throws a `TypeError` for an attribute named `on*`, `style`, `srcdoc` or `href`, and for tags `script`, `iframe`, `object`, `embed`, `link`, `style` (programmer errors, caught in tests).
- **`button`** — `<button type="button">`; variant as a class; `disabled`; `data-testid`; `aria-current="page"` when `current`; listener via `addEventListener`.
- **`select`** — `<label>` + `<select>`; `onChange(value)` on `change`.
- **`textInput`** — `<label>` + `<input type="text" autocomplete="off" autocapitalize="none" spellcheck="false">` + optional description linked by `aria-describedby`; `onInput` on `input`; `onSubmit` on Enter. Never `type="password"`.
- **`card`** — `<section>` with an `<h2>` title, optional subtitle, children.
- **`statusLabel(label)`** — `<span class="status status-<label>" data-status="<label>">` with text `STATUS_LABEL_TEXT[label]`; for `known` the span is empty and has the `hidden` attribute.
- **`metricCard`** — label (glossary label unless overridden) rendered through `glossaryTerm`; the value text from `formatMetricValue` in a `<strong>`; `statusLabel(statusLabelFor(value))`; `value.reason` as a small line when non-null; `detail` when non-null; `data-metric-id`, `data-status`.
- **`dataTable`** — wrapper + `<table>` with a visually hidden `<caption>`, `<th scope="col">` headers, one `<tr>` per row; zero rows → `emptyText` in a single full-width cell.
- **`barChart`** — a wrapper containing (1) `<svg role="img" aria-label="<title>">` with a `<title>`, gridlines, one `<rect>` per datum and series (stacked when several series; zero-height bars are still emitted), sparse x-axis labels (first, middle, last when more than 12 data points; all otherwise), a text legend; (2) `<details><summary>View data table</summary>` + a `dataTable` with `labelHeader` and one column per series — the same numbers as the bars. All values 0 or no data → `emptyText` instead of the SVG (the table is still present when there is data). Use `createElementNS('http://www.w3.org/2000/svg', …)`. Scale: max of stacked totals, minimum axis max 4.
- **`banner`** — `<div role="status" class="banner banner-<tone>">` with a badge and text. Not dismissible.
- **`noticeList`** — one item per notice, `role="status"` for info and `role="alert"` for warning, each with a "Dismiss" button calling `onDismiss(code)`; `data-notice-code`.
- **`glossaryTerm`** — `<details class="glossary">` whose `<summary>` is the visible text; the body is a definition list: Definition, Formula, Divided by (omitted when the denominator is null), Includes, Excludes, Apps, Time basis. Content comes from `deps.glossary` by `metricId`.
- **`atUriList`** — a labelled `<ul>` of `<li><code>` text items; **no anchors**; `emptyText` when empty.
- **`citationLink`** — `<a>` whose `href` is `citation.url` **only if** it parses as an `https:` URL; `target="_blank"`, `rel="noopener noreferrer"`; visible text `"<title> — <publisher>"`, followed by plain text `(checked <accessed>)`. A non-https URL renders the same text with no anchor.
- **`definitionList`**, **`emptyState`** — plain structure.

Styling is by class names only (the stylesheet is the composition root's concern). No inline styles, so the CSP in PLAN.md §8 holds.

## Data received / sent
Receives props (shared data types, strings, callbacks). Sends DOM elements; user interaction goes out only through the callbacks in props.

## Error behaviour
Components do not throw for any well-typed props, including empty arrays, very long strings, and strings that look like HTML. `h` throws `TypeError` only for the forbidden attributes/tags above.

## Invariants this module must enforce
- I-15 text-only: never `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `setAttribute('on…')`, `javascript:` URLs, or `eval`. Source text reaches the DOM only through text nodes / `textContent`.
- The only hyperlinks are produced by `citationLink`, only to `https:` URLs.
- No `<img>`, `<iframe>`, `<video>`, `<audio>` or other element that loads a remote resource.
- A status is always conveyed as text, never by colour alone.
- Every chart has an equivalent data table.
- No `fetch`, no storage, no global state, no timers.

## Out of scope
Layout of whole views; routing; CSS files and design tokens; animation; tooltips that need positioning logic (the glossary uses native `<details>`); CSV export; a virtualised table; any chart type other than (stacked) bars; React or any chart library (ADR-002).

## Dependencies
Types: `shared/contract`. Runtime: `shared` (`statusLabelFor`, `STATUS_LABEL_TEXT`, `AT_LEAST_PREFIX`). `document` and the glossary are injected. No other module.

## File layout
```
src/ui/components/
  contract.ts          (frozen)
  index.ts             createComponents, formatMetricValue
  dom.ts               h, button, select, textInput, card, definitionList, emptyState
  format.ts            formatMetricValue
  metric.ts            statusLabel, metricCard, glossaryTerm
  table.ts             dataTable
  chart.ts             barChart
  misc.ts              banner, noticeList, atUriList, citationLink
  *.test.ts            one per file; first line: `// @vitest-environment happy-dom`
```
(`vite.config.ts` defaults tests to the Node environment; UI test files opt in to happy-dom with that docblock.)

## Test plan (write these first)
**format**
- exact 12 → `"12"`; exact 0 → `"0"`; 1234 → `"1,234"`.
- partial lower bound 12 → `"At least 12"`; partial ratio 3.44 (`isLowerBound: false`) with `decimal1` → `"3.4"`.
- unknown → `"Unknown"`; not-available → `"Not available"`.
- `decimal1` of 5 → `"5.0"`; of 3.45 → `"3.5"`; `percent` of 0.666 → `"67%"`.
- settling 7 → `"7"` (the label carries "Settling").

**h and text-only rendering**
- a child string `<img src=x onerror=alert(1)>` produces a text node; the element has no `img` descendant and `textContent` equals the string.
- same for `card` title/subtitle, `dataTable` cells, `atUriList` items, `banner` text, `noticeList` messages, `metricCard` reason/detail, `emptyState`.
- `h` throws for `onclick`, `style`, `href`, `srcdoc` attributes and for the `script` tag.
- boolean attributes: `true` sets, `false` omits; `null` children are skipped.

**controls**
- `button` calls `onClick` once per click; disabled button does not; sets `aria-current` when `current`; sets `data-testid`.
- `select` renders options, marks the current value, calls `onChange` with the new value.
- `textInput` wires label `for`/`id`, `aria-describedby` to the description, `onInput` on typing, `onSubmit` on Enter; type is `text`; `maxlength` set.

**metric**
- `statusLabel('unknown')` shows "Unknown"; `'not-available'` shows "Not available on this app"; `'zero'` shows "Observed zero"; `'known'` is hidden and empty.
- `metricCard` for exact 0 shows "0" and "Observed zero"; for unknown shows "Unknown" (never "0"); for a lower bound shows "At least 100" and "Partial" and the reason; sets `data-metric-id` and `data-status`.
- `metricCard` uses the glossary label unless `label` is given.
- `glossaryTerm` shows definition, formula, includes, excludes and apps for `engagement.interactionsPerPost`, includes a "Divided by" row; omits that row for `records.total`.

**table and chart**
- `dataTable` renders the caption, `th scope="col"`, rows × columns cells; zero rows → `emptyText`.
- `barChart` with 7 data points and 2 series renders 14 rects, `role="img"`, an `aria-label` equal to the title, and a data table whose cells equal the input numbers.
- bar heights are proportional (a value of 4 is twice the height of 2); stacked bars do not overlap (second series starts where the first ends).
- all-zero data or empty data → `emptyText`, no rects.
- 30 data points → only first, middle and last axis labels.
- labels containing `<b>` appear as text.

**misc**
- `banner` has `role="status"`, the badge and the text; contains no button.
- `noticeList`: warning → `role="alert"`, info → `role="status"`; Dismiss calls `onDismiss` with the code.
- `atUriList` renders each URI inside `<code>`; the output contains no `<a>`.
- `citationLink` with an https URL → anchor with `rel="noopener noreferrer"` and `target="_blank"`; with `javascript:alert(1)` or `http://…` → no anchor, text only.

**hygiene**
- the module's source files contain none of: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `eval(` (read the files in a test).
- no component adds an element with a `src` attribute.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/ui.md` — status labels unknown / not available on this app / 0 / partial / settling; hover or inline glossary per metric (formula, what it excludes, which apps contribute); every number links to its AT-URIs; one chart with an equivalent table; no raw JSON dumps as the main view; do not pull in React or Recharts (ADR-002); never copy ClearskyUI (AGPL).
- Port from the prototype (same project): `SocialLens/src/ui/dom.ts` (`h`, `button`, `select`, `badge`, `card`, `table`, `empty`) and `SocialLens/src/ui/chart.ts` (SVG bars + `<details>` data table).
- Ideas only: `BS/bsky-analytics-app` (**MIT**) for card/chart composition — it uses React + Recharts, so nothing is copied. `pdsls/src/components/json.tsx` (0BSD) shows text-safe record rendering in Solid; not reused.
- Optional dependency: none recommended. A chart library would add far more code than the one bar chart needs.
