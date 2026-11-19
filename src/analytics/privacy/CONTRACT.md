# M6a `analytics/privacy/` — contract

Frozen types: [`contract.ts`](contract.ts). Catalogue (binding wording and rules): [`docs/architecture/GLOSSARY.md` Part C](../../../docs/architecture/GLOSSARY.md). Plan: [`docs/architecture/PLAN.md`](../../../docs/architecture/PLAN.md).

## Purpose
Tell the person what their **own** public records reveal. Each statement has four parts: evidence (count, sample AT-URIs, timestamps), an official source, a limitation, and an action.

## Contribution to the whole
This is the part of SocialLens no other tool was found to provide: a self-only, evidence-backed explanation of public exposure. It turns the same snapshot the analytics use into eight checkable observations, and it is deliberately incapable of saying anything about other people.

## What to optimise for (ranked)
1. **Evidence integrity** — every sentence is backed by records in the snapshot; counts carry their certainty; no claim outruns the data.
2. **Restraint** — no inference about identity, location, health, personality; no other-account data; no score.
3. Determinism — pure function, fixed order, fixed wording.

## Public API (`src/analytics/privacy/index.ts`)
```ts
export const computePrivacy: ComputePrivacy;   // (input: PrivacyInput) => PrivacyReport
```

### Behaviour
Evaluate the eight catalogue entries in `OBSERVATION_IDS` order. For each: if its trigger holds, emit a `PrivacyObservation` with the catalogue's exact `title`, `limitation`, `action` and `source = citation(sourceId)`; otherwise emit a `NotTriggered` with the catalogue's exact reason. Common rules (from the catalogue):

- Evidence uses all records in the snapshot (no date range).
- `countCertainty`: `exact` when every contributing collection's coverage is `complete` and has no skipped records; `lower-bound` when any is `partial`, `unavailable` or has skipped records.
- The four record observations (`public-likes`, `public-follows`, `public-blocks`, `public-lists`): when **every** contributing collection is `unavailable` → **not triggered**, with reason "The {label} collection could not be read, so this was not assessed." ({label} = registry `label` of the first contributing collection). When only some are unavailable (lists) → evaluate on what was read; certainty `lower-bound`. A missing coverage row counts as `unavailable`.
- `countCertainty` is `unknown` only for `handle-validity`; a record observation that triggers always has a numeric count.
- `sampleUris`: the person's own record URIs, newest first by `createdAt` (null last), ties by URI ascending, at most `options.sampleUris`.
- `earliestAt` / `latestAt`: min / max `createdAt` over the dated evidence records, else null.
- `summary` prefix: "In this synthetic example, " when `snapshot.mode === 'demo'`, else "In the records fetched, "; then one sentence with the count, e.g. "at least 100 like records are public." / "3 block records are public." Use "at least" exactly when certainty is `lower-bound`.
- `details` never contain a subject DID, a handle of another account, or record text.
- `notAssessed` = `registry.nonRepoData` copied unchanged.
- Posting-time pattern: bands of `patternBandHours` (6) → 00–05, 06–11, 12–17, 18–23 UTC over dated (`createdAt ≤ fetchedAt`) content items; busiest band, ties → earliest; trigger when items ≥ `patternMinItems` and share ≥ `patternShareThreshold`. Details: "Busiest band" → `"18:00–23:59 UTC"`, "Share" → `"62% of 54 dated items"` (percentage rounded to the nearest integer, half up).

## Data received / sent
Receives `PrivacyInput { snapshot, registry: RegistryData, options }` (plain data, possibly inside a Worker). Sends `PrivacyReport` (plain data).

## Error behaviour
Total: never throws; an empty snapshot yields eight `notTriggered` entries (or `incomplete-coverage` if coverage says so).

## Invariants this module must enforce
- `observations.length + notTriggered.length === OBSERVATION_IDS.length`, each id exactly once, both arrays in catalogue order.
- I-14: every observation has non-empty `title`, `summary`, `limitation`, `action`, a `source` whose `url` is in `SOURCES`, and an `evidence` object.
- I-12: nothing about who blocks, follows or lists the person; no incoming data at all.
- Every sample URI's authority is `snapshot.account.did`.
- No subject DID/handle leaves this module (check: the serialised report contains no `subjectDid` value from the input).
- No words that assert unproven user beliefs ("you may not know…") and no severity score or ranking field.
- No clock, DOM or network.

## Out of scope
Handle history from the PLC log (data source not verified); lists other people put the person on; any network index; k-anonymity aggregates over other accounts (none are produced); text analysis of posts; recommendations that require writes (SocialLens is read-only — actions tell the person what to do in their own app).

## Dependencies
Types: `shared/contract`, `registry/contract` (`RegistryData`, `NonRepoDataNote`). Runtime: `shared` (`citation`, `OBSERVATION_IDS`, `CONTENT_KINDS`). No other module — in particular it does not import `analytics/` code and does not receive an `AnalyticsReport` (it derives the time bands itself, so the two modules stay independent).

## File layout
```
src/analytics/privacy/
  contract.ts          (frozen)
  index.ts             computePrivacy
  catalogue.ts         the eight entries: title, source id, limitation, action, not-triggered reasons (from GLOSSARY.md)
  rules.ts             one pure trigger/evidence function per observation
  evidence.ts          count certainty, samples, earliest/latest
  catalogue.test.ts
  rules.test.ts
```

## Test plan (write these first)
Build snapshots with a local factory and a tiny registry (same style as `analytics/` tests; do not import other modules' implementations).

**catalogue**
- has exactly the eight ids in `OBSERVATION_IDS` order, each with non-empty title, limitation, action and a source id that exists in `SOURCES`.
- `public-blocks` cites `bsky-docs-following`; `handle-validity` cites `atproto-spec-handle`.
- the block action mentions muting as the private alternative; no text contains "who blocks you" phrased as a feature.

**record observations**
- 3 likes, complete coverage → `public-likes` triggered, count 3 `exact`, 3 sample URIs newest first, earliest/latest set.
- 5 likes with `sampleUris: 3` → 3 samples; ties on `createdAt` break by URI ascending; undated records sort last.
- likes coverage `partial` → count certainty `lower-bound` and the summary says "at least".
- likes coverage `unavailable` → not triggered with the "could not be read" reason.
- 0 likes, complete → not triggered "No like records were fetched."
- follows and blocks behave the same way with their own collections and reasons.
- `public-lists` counts lists + list-items and reports both in `details`; triggers with only list-items.
- `public-lists` with the list collection `unavailable` and 2 list-items → triggered, count 2 `lower-bound`; with both collections `unavailable` → not triggered.
- a skipped record in the like collection → certainty `lower-bound`.
- demo snapshot → summary starts "In this synthetic example, "; live → "In the records fetched, ".
- every sample URI has the snapshot's DID as authority.
- the serialised report contains none of the `subjectDid` values present in the input.

**cross-app, time pattern, handle, coverage**
- only Bluesky records → `cross-app-identity` not triggered; Bluesky + one document → triggered, count 2, one sample per app, per-app detail rows.
- 9 dated content items → pattern not triggered ("Fewer than 10…").
- 10 items, 4 in 18–23 UTC and 2 in each other band → triggered, band `18:00–23:59 UTC`, share `40% of 10 dated items`.
- 12 items spread 3/3/3/3 → not triggered ("No 6-hour UTC band…").
- tie between two bands above the threshold → the earliest band is reported.
- likes do not count toward the pattern; undated and future-dated posts are ignored.
- band boundaries: 05:59:59Z → band 00–05; 06:00:00Z → band 06–11.
- `handleStatus: 'valid'` → `handle-validity` not triggered; `'invalid'` → triggered with details Handle / Status / Checked by, count null, certainty `unknown`, no samples; `'unverified'` → triggered with "not checked".
- all coverage complete, nothing skipped, inventory known, nothing unanalysed → `incomplete-coverage` not triggered.
- one partial collection → triggered with a detail row quoting that coverage's `reason`.
- each alternative trigger alone fires it: engagement coverage partial; one skipped record; `inventoryStatus: 'unknown'`; one unanalysed collection.

**report-level**
- empty snapshot (complete coverage) → 0 observations, 8 not-triggered.
- lengths always sum to 8 and ids are unique.
- `notAssessed` equals the registry's `nonRepoData`.
- output survives `structuredClone`; same input twice → deep-equal; input not mutated.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/privacy.md` — the four-part structure; candidate topics from the person's own repo (likes, follows, blocks, lists, cross-app publications, posting-time patterns); every observation ends in an action, not reassurance (Farke et al.); do not state "users don't know their blocks are public" as fact; never "who blocks me", viewer identities or follower demographics; never call Clearsky or Constellation; never copy ClearskyUI (AGPL).
- Facts and their citations are already in `SOURCES` (`src/shared/contract.ts`); do not add a URL that is not there.
- Port from the prototype (same project): `SocialLens/src/domain/privacy.ts` (the interaction, timestamp-band, shared-identity and coverage insights and their limitation wording).
- No open-source self-privacy audit tool exists to reuse (searched; see the research file).
