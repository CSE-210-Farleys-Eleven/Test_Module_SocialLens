# M7a `ui/views/` — contract

Frozen types and test ids: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md). Metric wording: [`GLOSSARY.md`](../../../docs/architecture/GLOSSARY.md).

## Purpose
The five views — Overview, Activity, Engagement, Privacy, Accounts — plus the app shell (banner, navigation, notices, loading and landing states) and the mount loop that re-renders on every state change.

## Contribution to the whole
This is what the person sees. Views translate `AppState` into components and user gestures into `AppActions`; they add no data of their own. Their job is to keep the promises visible: demo data is always labelled synthetic, the Overview shows only what every app shares, every number has a status and a definition, every privacy observation shows its evidence, source, limitation and action, and the Accounts view says exactly what is contacted and what "remove" deletes.

## What to optimise for (ranked)
1. **Truthful presentation** — never show a number where the state says unknown; never hide a caveat the state carries.
2. **Comprehension and accessibility** — plain language, headings, keyboard navigation, focus kept across re-renders, UTC stated.
3. Thinness — no calculations, no fetching, no business rules.

## Public API (`src/ui/views/index.ts`)
```ts
export const createViews: CreateViews;   // ({ components, registry, glossary, demoScenarios, document }) => Views
export const mountApp: MountApp;         // ({ root, store, actions, views }) => MountedApp
export { TEST_IDS } from './contract';
```

### `mountApp`
Render `views.shell({ state, actions })` into `root` with `replaceChildren` immediately and after every store notification. Before replacing, remember `document.activeElement`'s `id` (and, for inputs, the selection range); afterwards re-focus the element with the same id. `unmount()` unsubscribes and empties `root`. No other DOM is touched (no `document.title` writes are required).

### View-local state
The only state views may keep (in the `createViews` closure) is the unsubmitted handle draft of the sign-in form. Everything else comes from `AppState`.

### `shell`
In order:
1. Skip link to `#main`.
2. Header "SocialLens" + strapline "Your public AT Protocol records, explained."
3. **Mode banner** — `mode === 'demo'`: `banner({ tone: 'synthetic', badge: 'SYNTHETIC DEMO', text: DEMO_BANNER_TEXT, testId: TEST_IDS.demoBanner })`, present on **every** view and in the loading/failed states, not dismissible. `mode === 'live'`: `banner({ tone: 'info', badge: 'YOUR ACCOUNT', text: 'Only the signed-in account is read. Requests go to your PDS and the public Bluesky API.', testId: TEST_IDS.liveBanner })`.
4. Navigation (`data-testid="main-nav"`): five buttons `nav-item-<ViewId>`, `current` on the active one. Overview/Activity/Engagement/Privacy are disabled while there is no snapshot; Accounts is always enabled.
5. Range select (`range-select`; "Last 7 days (UTC)", "Last 30 days (UTC)", "Last 90 days (UTC)", "All fetched records") — only when a snapshot exists and the view is not Accounts.
6. Notices: `state.notices` followed by `snapshot.notices`, except `demo-synthetic` (the banner already says it). Dismiss → `actions.dismissNotice` (snapshot notices are not dismissible: render them as plain status lines).
7. `<main id="main">` with an `<h1 tabindex="-1">` naming the view, then exactly one of:
   - Accounts view when `view === 'accounts'` (always available);
   - `load.status === 'loading'` → loading card (`loading`): `progress.message` in a `role="status" aria-live="polite"` element, "step {done} of {total}", and a `cancel-load` button → `actions.cancelLoad`;
   - `'failed'` → card (`load-failed`) with `load.failure.message`, "Nothing was kept from this attempt.", and a "Try again" button → `actions.reload`;
   - `'cancelled'` → "Read cancelled. Nothing was kept." + "Read again";
   - `mode === 'none'` → landing (`landing`): what SocialLens does in three short points (your own account only; read-only; unknown stays unknown), one button per demo scenario (`demo-start-<id>`, label "Explore synthetic demo — {label}") → `actions.enterDemo(id)`, and a "Use my own account" button → `actions.selectView('accounts')`;
   - otherwise the active data view. While `analysis.status` is `'idle'`/`'running'` a data view shows "Calculating…" in place of analysis-backed sections; `'failed'` shows `analysis.failure.message`. Sections backed only by the snapshot still render.
8. Footer: "Counts are observations, not scores. Times are UTC." and, when a snapshot exists, "Read {fetchedAt date} UTC" (demo: "Fixed sample date {date} UTC").

### `overview` (`view-overview`) — shared metrics only
- `includes-apps-note`: "Includes: Bluesky, Standard.site" from `analysis.result.analytics.overview.includedApps` and registry display names.
- Three `metricCard`s: `contentItems`, `activeDays`, `recordsTotal` (format `integer`). **No engagement number appears here** (not shared by all apps).
- "Last content item: {date} UTC" or "No dated content was fetched."
- Coverage line: "{k} of {n} collections were read completely." + button "See what was read" → Accounts.
- Privacy teaser: titles of up to the first 3 observations + button "Review privacy observations" → Privacy (the Privacy view is on the landing path, not behind settings). Zero observations → "Nothing to flag in the fetched records."
- Identity line: handle (or "no handle") with a status label for `handleStatus !== 'valid'`, and the DID beneath in `<code>`.

### `activity` (`view-activity`)
- Timeline `barChart` titled "Content items per day (UTC)", series = app display names, data from `timeline.days`; note when `truncated`; note "Only dated, fetched records are shown; a gap is not proof of inactivity."
- Hour and weekday `barChart`s ("Posting hours (UTC)", "Posting weekdays (UTC)").
- Streak `metricCard`s (current, longest) with their date spans as `detail`.
- Week-over-week card: both windows with dates, the delta ("+3", "−2", "no change") and, when `deltaFraction` is non-null, the percentage; "Unknown" when `delta` is null.
- "Records by type" table: Type (app-specific alias) · App · Count (formatted + status label). "Records by app" table.
- Footnote when `undated + futureDated > 0`: "{n} record(s) have no usable date; they count only in 'All fetched records'."

### `engagement` (`view-engagement`)
- Availability table per app from `engagement.perApp`: "Available" or `statusLabel('not-available')` + reason. Standard.site never shows 0.
- `metricCard` for `interactionsPerPost` (format `decimal1`, detail "{numerator} interactions ÷ {denominator} posts with known counters") with the sentence "This is not an engagement rate: there is no view count to divide by."
- `metricCard`s for interactions, likes, reposts, replies, quotes (`integer`) and `knownShare` (`percent`, detail "{known} of {eligible} posts and replies").
- When `settlingPosts > 0`: "{n} post(s) are under 36 hours old; their counters are still settling."
- Top posts table: Rank · Post (text preview as text, or "(no text)") · Published (UTC) · Likes · Reposts · Replies · Quotes · Interactions · status (`Settling` label when set) · the AT-URI via `atUriList`.
- `not-available-metrics`: every `glossary.unavailable` entry as label + reason + what it would require.

### `privacy` (`view-privacy`)
- Intro: "What your own public records show. Each point lists its evidence, an official source, what it cannot tell you, and something you can do."
- One card per observation (`observation-<id>`), in order: title; summary; **Evidence** — count ("At least N" when `lower-bound`, "Unknown" when null), "Earliest … / Latest … UTC" when present, `details` as a definition list, `atUriList({ label: 'Sample records', … })`; **Source** — `citationLink`; **Limitation**; **What you can do** (action).
- "Checked, nothing to flag": the `notTriggered` list (id title + reason).
- "Not assessed, because it is not in your public repository": `notAssessed` rows with label, explanation and `citationLink(citation(source))`.
- No score, grade, colour scale or "risk level" anywhere.

### `accounts` (`view-accounts`)
- **Active account** (when `snapshot` or an active live account exists): handle + handle-status label ("valid" shows no label; `invalid` → "Handle not confirmed"; `unverified` → "Handle not checked") + "checked by your PDS" / "not checked"; DID in `<code>` beneath; PDS origin; verified-at (UTC). In demo mode the heading says "Synthetic demo account".
- **Sign in** (`sign-in-form`): `textInput` (`handle-input`, label "Your handle", placeholder "name.example.com", max length 253); `resolver-disclosure` showing `auth.disclosure.resolverNotice` and `storageNotice` with a `citationLink`; button "Sign in with AT Protocol" → `actions.signIn(draft)`, disabled while `signInPending` or when `auth.status !== 'ready'`; `auth.failure.message` when present; when auth is `unavailable`: "Live sign-in is unavailable here. The synthetic demo still works." There is **no** field or control to analyse any other account.
- **Linked accounts** table (`account-row-<did>` rows): handle, DID, status ("Verified", "Could not verify — {lastFailure.message}", "Needs sign-in"), actions: "Switch to" (→ `switchAccount`, not for the active one), "Sign out" (→ `signOut`), "Remove" (`remove-account` → `removeAccount`). Under the table `remove-scope-note`: "Remove clears this browser's saved data for that account only. Nothing is deleted from your account, your PDS or the network."
- **What was read** (`coverage-table`, when a snapshot exists): one row per `snapshot.coverage` entry — collection label + NSID in `<code>`; status (Complete / Partial / Unavailable as text); records ("{accepted}", "At least {accepted}" when partial, "Unknown" when unavailable); pages; skipped count for that collection; `reason`. A final row for interaction counters from `engagementCoverage`. Caption: "Coverage of the whole read, independent of the date range."
- **Present, not analysed** (`unanalysed-collections`): NSIDs as text; "unknown" when `inventoryStatus === 'unknown'`; "none" when empty.
- **Set aside** (`skipped-table`): up to 50 skipped records (URI as text or "—", collection, reason code, detail) + total count.
- **Network**: the origins this read contacts as text — the PDS origin, `ORIGINS.plcDirectory`, `ORIGINS.appView`, and the handle resolver from the disclosure (sign-in only).
- **Measured**: "Reading took {acquisitionMs} ms; analysis ran {in a background worker | on the main thread} in {durationMs} ms."
- Buttons: "Read again" (→ `reload`), `clear-data` "Clear displayed data" (→ `clearData`), and in demo mode "Leave demo" (→ `exitDemo`).

## Data received / sent
Receives `AppState` (via props / the store) and static `RegistryData`, `Glossary`, demo scenario list. Sends DOM, and intents through `AppActions`.

## Error behaviour
Rendering never throws for any reachable `AppState` (including null snapshot, null analysis, empty arrays, null handle). A view asked to render without the data it needs returns an `emptyState`.

## Invariants this module must enforce
- I-10: in demo mode the synthetic banner is in the DOM for every view and every load state.
- I-13: the Overview contains only `OverviewMetrics` values — no engagement metric id.
- I-7: a `MetricValue` is always rendered through `metricCard` / `formatMetricValue` + `statusLabel`; views never print `value ?? 0`.
- I-14: an observation card always shows evidence, source, limitation and action.
- I-15: all source content (post text, handles, NSIDs, URIs, failure messages, record details) goes through components as text; views never build markup strings.
- I-1 (UI side): no input accepts a handle or DID for analysis; the only handle field is the sign-in form.
- I-11: no impressions/reach/follower-growth/engagement-rate/score UI; they appear only in the "not available" list with reasons.
- Views never import adapters, never call `fetch`, never read storage, never compute a metric or a privacy rule.
- Every time-based heading or axis says "UTC".

## Out of scope
CSS/visual design (class names only; the stylesheet is added at integration); routing and deep links; CSV export; i18n; record drill-down beyond sample URIs; comparing accounts; dark mode; onboarding tours.

## Dependencies
Types: `shared/contract`, `registry/contract`, `adapters/fixtures/contract` (`DemoScenarioInfo`), `analytics/state/contract` (`AppState`, `AppActions`, `AppStoreReader`, `ViewId`), `ui/components/contract`; and through `AppState`: `accounts`, `auth`, `analytics`, `privacy`, `worker` contracts. Runtime: `shared` (`STATUS_LABEL_TEXT`, `DEMO_BANNER_TEXT`, `ORIGINS`, `citation`). `Components` are injected: unit tests pass a **fake `Components`** (each member returns a simple element carrying its props as data attributes / text) so view tests do not depend on the real component implementation.

## File layout
```
src/ui/views/
  contract.ts          (frozen)
  index.ts             createViews, mountApp
  shell.ts
  overview.ts
  activity.ts
  engagement.ts
  privacy.ts
  accounts.ts
  mount.ts
  testkit.ts           fake Components, fake actions (records calls), AppState builders (test-only)
  *.test.ts            one per view + mount.test.ts; first line `// @vitest-environment happy-dom`
```

## Test plan (write these first)
**shell**
- mode `none` → landing with one demo button per scenario; clicking one calls `enterDemo` with its id.
- mode `demo` → `demo-banner` present with `DEMO_BANNER_TEXT`; still present while loading, after a failed load, and on each of the five views.
- mode `live` → `live-banner`, no `demo-banner`.
- no snapshot → the four data nav items are disabled, Accounts is enabled.
- nav click calls `selectView`; the active item has `current`.
- range select appears only with a snapshot (not on Accounts) and calls `selectRange`.
- loading → shows `progress.message` in a `role="status"` element and `cancel-load` calls `cancelLoad`.
- failed → shows the failure message and "Nothing was kept"; "Try again" calls `reload`.
- cancelled → shows the cancelled text.
- state notices and snapshot notices are rendered; `demo-synthetic` is not duplicated; dismiss calls `dismissNotice`.
- analysis `running` → "Calculating…"; analysis `failed` → its message.

**overview**
- shows `includes-apps-note` naming both apps.
- renders exactly three metric cards with ids `content.items`, `activity.activeDays`, `records.total`.
- contains no metric id starting with `engagement.` (assert on the fake components' recorded props).
- an `unknown` content value is passed through unchanged (the fake records `value: null`, status `unknown`).
- coverage line counts complete collections; its button navigates to Accounts.
- privacy teaser lists at most 3 titles; zero observations shows the "Nothing to flag" text.
- handle `invalid` shows the handle with a not-confirmed label and the DID beneath.

**activity**
- timeline chart title contains "(UTC)" and has one series per app.
- truncated timeline shows the truncation note.
- streak cards receive the `activity.streak.*` values; week-over-week shows "+3" and "150%" for delta 3 / fraction 1.5, and "Unknown" when delta is null.
- records-by-type table has 11 rows and uses the app alias ("Like given").
- undated footnote appears only when the count is > 0.

**engagement**
- Standard.site row shows the not-available label and its reason, never "0".
- interactions-per-post card detail shows numerator and denominator; the "not an engagement rate" sentence is present.
- settling note appears only when `settlingPosts > 0`.
- top-post text `<script>alert(1)</script>` is passed to components as a plain string (no element created from it).
- `not-available-metrics` lists every `glossary.unavailable` entry with its reason.
- no post → table empty text.

**privacy**
- one card per observation with test id `observation-<id>`; each shows summary, evidence count, sample URIs, a citation link, limitation and action.
- `lower-bound` count renders "At least N"; null count renders "Unknown".
- not-triggered list shows each reason; not-assessed list shows the three registry rows with citations.
- the rendered text contains no "score" or "risk level".

**accounts**
- sign-in form shows both disclosure sentences; submit calls `signIn` with the typed draft; the button is disabled when `signInPending` or auth is not ready; auth failure message is shown.
- auth `unavailable` → the explanation text, and the sign-in button is disabled.
- the typed draft survives a re-render caused by an unrelated state change.
- there is exactly one text input in the whole view (the handle field).
- linked accounts: row per account with status text; Switch / Sign out / Remove call the right action with that DID; the active account has no "Switch to".
- `remove-scope-note` contains "Nothing is deleted from your account".
- coverage table: complete → the count; partial → "At least 100"; unavailable → "Unknown"; reason text shown; engagement row present.
- unanalysed list shows NSIDs, "none", or "unknown" per `inventoryStatus`.
- skipped table shows at most 50 rows and the total.
- demo mode → heading says synthetic; "Leave demo" calls `exitDemo`.
- measured line shows acquisition and analysis timings and where analysis ran.

**mount**
- renders once on mount and again after a store notification.
- focus is restored to the element with the same id after a re-render.
- `unmount()` stops re-rendering and empties the root.

**robustness**
- every view renders without throwing for: initial state, demo-ready state, live state with null handle, snapshot with empty records, analysis null.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/ui.md` — hybrid layout: the Overview shows only metrics every supported app shares, with an "includes: Bluesky, Standard.site" note; per-app detail lives in the other views; summary cards, one chart with a range, a streak view, a per-post table, a weekly recap; every number links to its AT-URIs; inline glossary per metric; show identity as handle with the DID beneath and flag `handle.invalid`; put the Privacy view on the landing path; no raw JSON as the main view; no paywall/upsell panels; no AGPL UI code (ClearskyUI).
- Port from the prototype (same project): `SocialLens/src/ui/views.ts` (overview/activity/engagement/privacy/coverage layouts and wording), the shell, focus restoration and loading/cancel UI in `SocialLens/src/main.ts`, and `SocialLens/tests/browser_test.py` for acceptance ideas.
- Reference only (**MIT**): `atproto/packages/oauth/oauth-client-browser-example/src/components/` for a sign-in form's fields (React; adapt the idea, not the code).
