# M5 `normalize/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md).

## Purpose
Map accepted raw records from every registered collection into one shared `ActivityRecord` model, attach engagement, and put everything that cannot be mapped into a "skipped" bucket with a reason.

## Contribution to the whole
Analytics, privacy and the UI only ever see `ActivityRecord`s. This module is the one place that knows what a Bluesky post or a Standard.site document looks like inside, so adding an app later means adding a mapper here and a registry row — nothing downstream changes. It is also where "Standard.site has no counters" becomes `not-available` rather than `0`.

## What to optimise for (ranked)
1. **Losing nothing silently** — every input record ends up in `records` or `skipped`.
2. **Preserving uncertainty** — null timestamps stay null; unknown engagement stays unknown.
3. Determinism — pure function of its input; same order out as in.

## Public API (`src/normalize/index.ts`)
```ts
export const createNormalizer: CreateNormalizer;   // ({ registry }) => Normalizer
```

### `normalize({ did, records, engagement })`
For each `RawRecord`, in input order:

1. `registry.collection(raw.collection)` is null → skip `unregistered-collection`.
2. `parseAtUri(raw.uri)`: DID ≠ `did` → skip `foreign-owner`; collection ≠ `raw.collection` → skip `wrong-collection` (defence in depth; the adapter already checked).
3. `raw.value.$type` is present and is not the collection NSID → skip `type-mismatch`. An absent `$type` is accepted.
4. Run the mapper named by `normalizerId` (table below). A missing or wrong-typed **required non-time** field → skip `missing-required-field` (absent) or `invalid-field` (present but wrong type/format), with `detail` naming the field (e.g. `"subject.uri is not an AT-URI"`).
5. Time: read the definition's `timestampField`; `parseIsoDateTime` → `createdAt`, `timeSource` = that field name. Missing or invalid time is **not** a skip: `createdAt = null`, `timeSource = 'none'`. `timestampField: null` → always null / `'none'`.
6. `rkeyTime` = `tidToIsoDateTime(raw.rkey)`.
7. Engagement: if the collection's `engagementSource` is non-null → the `engagement` of the first `EngagementResult` whose `uri` equals the record URI, else `{ status: 'unknown', reason: 'not-requested' }`. If `engagementSource` is null → `{ status: 'not-available' }`.

Mappers (`app` comes from the definition):

| normalizerId | Required | kind | title | text | subjectUri | subjectDid | tags |
|---|---|---|---|---|---|---|---|
| `bsky.post` | `text`: string | `reply` if `reply` is an object, else `post` | null | `text` | reply → `reply.parent.uri` if a valid AT-URI else null | null | `tags` strings + `facets[].features[]` with `$type === 'app.bsky.richtext.facet#tag'` → `.tag` |
| `bsky.repost` | `subject.uri`: AT-URI | `repost` | null | null | `subject.uri` | null | [] |
| `bsky.like` | `subject.uri`: AT-URI | `like` | null | null | `subject.uri` | null | [] |
| `bsky.follow` | `subject`: DID | `follow` | null | null | null | `subject` | [] |
| `bsky.block` | `subject`: DID | `block` | null | null | null | `subject` | [] |
| `bsky.list` | `name`: string, `purpose`: string | `list` | `name` | `description` if string | null | null | [] |
| `bsky.listitem` | `subject`: DID, `list`: AT-URI | `list-item` | null | null | `list` | `subject` | [] |
| `bsky.profile` | — | `profile` | `displayName` if string | `description` if string | null | null | [] |
| `standard.document` | `title`: string, `site`: string | `document` | `title` | `description` if string, else `textContent` if string | `site` if it is a valid AT-URI else null | null | `tags` strings |
| `standard.publication` | `name`: string, `url`: string | `publication` | `name` | `description` if string | null | null | [] |

Text rules: `title` and `text` are copied as-is and truncated to `LIMITS.maxTextChars` (10,000) characters; an absent optional field → `null`; an empty string stays `""`. Tags: trim, drop empty, truncate each to 80 characters, de-duplicate preserving first occurrence, keep at most `LIMITS.maxTagsPerRecord` (30). Nothing is HTML-escaped or otherwise transformed — rendering as text is the UI's job.

## Data received / sent
Receives `RawRecord[]` (envelope already checked, body unvalidated JSON) and `EngagementResult[]`. Sends `{ records: ActivityRecord[], skipped: SkippedRecord[] }` with `stage: 'normalize'`.

## Error behaviour
Total and synchronous: never throws for any JSON body (deeply nested, wrong types, huge strings, prototype-looking keys such as `__proto__`). Unexpected mapper exceptions must be caught per record and turned into a skip with `invalid-field` and detail "unexpected record shape".

## Invariants this module must enforce
- `records.length + skipped.length === input.records.length`; relative order preserved in both.
- I-7: engagement is never fabricated; no numeric default anywhere.
- I-8 (prototype invariant 4): a publication never gets a timestamp; a document's time is `publishedAt` only (never `updatedAt`, never the rkey time).
- I-2: every output record's `did` is the input `did`.
- `subjectDid` / `subjectUri` are validated branded values or null.
- Output is plain JSON (no `Date`, no class instances): it is posted to the Worker.

## Out of scope
Full lexicon validation; fetching anything; de-duplication across collections; language detection; link/mention extraction; counting unique actors (needs other people's records); deciding "content" vs "outbound" (that is `CONTENT_KINDS` / `OUTBOUND_KINDS` in `shared`); sorting.

## Dependencies
Types: `shared/contract`, `registry/contract` (`Registry`, `NormalizerId`), `adapters/bluesky/contract` (`EngagementResult`). Runtime: `shared` (`parseAtUri`, `parseDid`, `parseIsoDateTime`, `tidToIsoDateTime`, `LIMITS`). The registry instance is injected; tests build a small fake `Registry` (do not import `registry/`'s implementation).

## File layout
```
src/normalize/
  contract.ts         (frozen)
  index.ts            createNormalizer
  mappers.ts          one pure function per NormalizerId
  fields.ts           small readers: readString, readAtUri, readDid, readTags, truncate
  mappers.test.ts
  normalize.test.ts
```

## Test plan (write these first)
**per mapper (dummy records written inline, shaped like the lexicons)**
- post with text → kind `post`, `text` set, `title` null, `timeSource: 'createdAt'`.
- post with a `reply` object → kind `reply`, `subjectUri` = parent URI; malformed `reply.parent.uri` → still `reply`, `subjectUri` null.
- post without `text` → skipped `missing-required-field`; `text: 42` → `invalid-field`.
- post with empty text `""` → accepted, `text: ""`.
- post tags: merges `tags` and tag facets, trims, de-duplicates, caps at 30, truncates to 80 chars; ignores mention/link facets.
- post text of 20,000 chars is truncated to 10,000.
- like / repost with a valid `subject.uri` → `subjectUri` set; `subject` missing → `missing-required-field`; `subject.uri` with a handle authority → `invalid-field`.
- follow / block with a DID subject → `subjectDid` set, `createdAt` preserved; subject `"alice.example"` → `invalid-field`.
- list requires `name` and `purpose`; description optional.
- list-item sets both `subjectDid` and `subjectUri` (the list).
- profile with no fields at all → accepted, `title` null, `text` null, `createdAt` null.
- document → kind `document`, time from `publishedAt`, `timeSource: 'publishedAt'`; `site` as `https://…` → `subjectUri` null; `site` as `at://…publication/…` → `subjectUri` set; falls back to `textContent` when `description` is absent.
- document with invalid `publishedAt` but valid `updatedAt` → accepted with `createdAt: null`, `timeSource: 'none'` (never uses `updatedAt`).
- publication → `createdAt: null`, `timeSource: 'none'` even if the body has a `createdAt` field.

**time and keys**
- `createdAt` with an offset is normalised to UTC `Z`.
- `createdAt: "yesterday"`, missing, or a number → record kept with `createdAt: null`.
- TID rkey → `rkeyTime` set; rkey `self` → null.

**engagement**
- post with a matching `known` result → that engagement object.
- post with no matching result → `unknown / not-requested`.
- post with an `unknown / lookup-failed` result → passed through unchanged.
- like, follow, document, publication → `not-available` even if a result with the same URI is supplied.

**bucket and totals**
- unregistered collection → skipped `unregistered-collection`.
- `$type` mismatch → skipped `type-mismatch`; absent `$type` → accepted.
- URI DID differs from `did` → skipped `foreign-owner`.
- mixed input of 6 records with 2 bad → `records.length === 4`, `skipped.length === 2`, both in input order, sum equals input length.
- empty input → both arrays empty.
- body with keys `__proto__` / `constructor` and deeply nested arrays does not throw and does not pollute `Object.prototype`.
- output survives `structuredClone` and JSON round-trip unchanged.
- calling twice with the same input returns deep-equal output (purity).

## Hints and reuse
- Research: `SocialLens/docs/research/modules/normalize.md` — validate first, then one pure mapper per registry entry; shared fields `{uri, cid, did, collection, createdAt, kind, text?, subjectUri?}`; keep interaction time on graph records such as blocks; Standard.site items get unknown/not-available engagement, not 0; invalid records go to a "skipped" bucket with a reason; do not trust client `createdAt` alone — keep the rkey/TID too; never silently drop. No open-source cross-app normaliser exists to copy.
- Port from the prototype (same project): `SocialLens/src/domain/normalize.ts` (`normalize`, `readTags`, the publication-has-no-timestamp rule) and the cases in `SocialLens/tests/domain.test.mjs`. Differences: the prototype returns `null` for rejects (now a skip with a reason), has no `subjectUri` / `did` / `rkeyTime`, and treats a record without `$type` as invalid (now accepted).
- Record shapes (all **MIT**, read-only reference): `atproto/packages/api/lexicons/app/bsky/feed/{post,like,repost}.json`, `graph/{follow,block,list,listitem}.json`, `actor/profile.json`, `richtext/facet.json`; `BS/social-app/lexicons/site/standard/{document,publication}.json`.
