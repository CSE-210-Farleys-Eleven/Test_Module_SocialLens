// Pagination loop, repeated-cursor guard and coverage wording ported from the SocialLens
// prototype (same project), src/application/pagination.ts. Response shapes follow
// bluesky-social/atproto (MIT) lexicons/com/atproto/repo/{listRecords,describeRepo}.json.

import type {
  AtUri,
  Coverage,
  CoverageReasonCode,
  CoverageStatus,
  Failure,
  HttpClient,
  JsonObject,
  JsonValue,
  Nsid,
  RawRecord,
  Result,
  SkippedRecord,
  SkipReasonCode,
} from '../../shared/contract';
import { LIMITS } from '../../shared/contract';
import { buildXrpcUrl, checkSelf, err, makeFailure, ok, parseAtUri, parseCid, parseHandle, parseNsid } from '../../shared/index';
import type { CollectionRead, ListCollectionRequest, RepoDescription, RepoRequest } from './contract';
import { getJson, isJsonObject } from './util';

// ─────────────────────────────── describeRepo ───────────────────────────────

export async function describeRepo(http: HttpClient, request: RepoRequest): Promise<Result<RepoDescription>> {
  const { session, did, pdsOrigin, signal } = request;
  const self = checkSelf(session, did);
  if (!self.ok) return self;

  const url = buildXrpcUrl(pdsOrigin, 'com.atproto.repo.describeRepo', { repo: did });
  const fetched = await getJson(http, url, signal);
  if (!fetched.ok) return fetched;

  const body = fetched.value;
  if (!isJsonObject(body) || body['did'] !== did || !Array.isArray(body['collections'])) {
    return err(
      makeFailure('invalid-response', "The PDS did not describe this account's repository.", { origin: pdsOrigin }),
    );
  }

  const valid = new Set<Nsid>();
  let invalidCollectionCount = 0;
  for (const entry of body['collections'] as readonly JsonValue[]) {
    const nsid = parseNsid(entry);
    if (nsid === null) invalidCollectionCount++;
    else valid.add(nsid);
  }

  return ok({
    did,
    handle: parseHandle(body['handle']),
    handleIsCorrect: body['handleIsCorrect'] === true,
    collections: [...valid].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    invalidCollectionCount,
  });
}

// ─────────────────────────────── listCollection ─────────────────────────────

const REASON_FIRST_PAGE_FAILED = 'This collection could not be read. Its count is unknown, not zero.';

function isIntIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

interface Tally {
  pagesFetched: number;
  returned: number;
  duplicates: number;
}

export async function listCollection(http: HttpClient, request: ListCollectionRequest): Promise<CollectionRead> {
  const { session, did, pdsOrigin, collection, pageSize, maxPages, onProgress, signal } = request;
  const records: RawRecord[] = [];
  const rejected: SkippedRecord[] = [];
  const tally: Tally = { pagesFetched: 0, returned: 0, duplicates: 0 };

  const finish = (status: CoverageStatus, reasonCode: CoverageReasonCode, failure: Failure | null): CollectionRead => {
    const coverage: Coverage = {
      collection,
      status,
      reasonCode,
      reason: reasonText(reasonCode, { maxPages, accepted: records.length, rejected: rejected.length }),
      pagesFetched: tally.pagesFetched,
      returned: tally.returned,
      accepted: records.length,
      rejected: rejected.length,
      duplicates: tally.duplicates,
      failure,
    };
    return { records, rejected, coverage };
  };

  // Guards: no request is made when any of these fail.
  const self = checkSelf(session, did);
  if (!self.ok) return finish('unavailable', 'first-page-failed', self.failure);
  if (!isIntIn(pageSize, 1, LIMITS.listPageSize) || !isIntIn(maxPages, 1, LIMITS.maxPagesPerCollection)) {
    const failure = makeFailure('validation', 'The page size or page limit is out of range. No request was sent.');
    return finish('unavailable', 'first-page-failed', failure);
  }

  const acceptedUris = new Set<AtUri>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildXrpcUrl(pdsOrigin, 'com.atproto.repo.listRecords', {
      repo: did,
      collection,
      limit: pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const fetched = await getJson(http, url, signal); // throwIfAborted before and after

    const parsed = fetched.ok ? parsePage(fetched.value, pageSize) : null;
    if (!fetched.ok || parsed === null) {
      const failure = !fetched.ok
        ? fetched.failure
        : makeFailure('invalid-response', 'The server returned a page SocialLens could not read.', { origin: pdsOrigin });
      // I-5: a failed later page keeps accepted data and is never complete.
      return tally.pagesFetched > 0
        ? finish('partial', 'later-page-failed', failure)
        : finish('unavailable', 'first-page-failed', failure);
    }

    tally.pagesFetched++;
    for (const item of parsed.records) {
      tally.returned++;
      const checked = checkItem(item, request);
      if (!checked.ok) {
        rejected.push(checked.skipped);
        continue;
      }
      if (acceptedUris.has(checked.record.uri)) {
        tally.duplicates++;
        continue;
      }
      acceptedUris.add(checked.record.uri);
      records.push(checked.record);
    }

    onProgress?.({ collection, page, maxPages, acceptedSoFar: records.length });

    const next = parsed.cursor;
    if (next === undefined || next === '' || parsed.records.length === 0) {
      return rejected.length === 0 ? finish('complete', 'ok', null) : finish('partial', 'records-rejected', null);
    }
    if (seenCursors.has(next)) return finish('partial', 'repeated-cursor', null);
    if (page === maxPages) return finish('partial', 'page-cap', null);
    seenCursors.add(next);
    cursor = next;
  }
  // Unreachable: the loop always returns on its last iteration (page === maxPages).
  return finish('partial', 'page-cap', null);
}

function parsePage(
  body: JsonValue,
  pageSize: number,
): { readonly records: readonly JsonValue[]; readonly cursor: string | undefined } | null {
  if (!isJsonObject(body)) return null;
  const items = body['records'];
  if (!Array.isArray(items)) return null;
  const list = items as readonly JsonValue[];
  if (list.length > pageSize) return null;
  const cursor = body['cursor'];
  if (cursor !== undefined && typeof cursor !== 'string') return null;
  return { records: list, cursor };
}

type ItemCheck =
  | { readonly ok: true; readonly record: RawRecord }
  | { readonly ok: false; readonly skipped: SkippedRecord };

function checkItem(item: JsonValue, request: ListCollectionRequest): ItemCheck {
  const { collection, did } = request;
  const skip = (reasonCode: SkipReasonCode, uri: AtUri | null, detail: string): ItemCheck => ({
    ok: false,
    skipped: { uri, collection, stage: 'fetch', reasonCode, detail },
  });

  if (!isJsonObject(item)) return skip('malformed-envelope', null, 'Item is not an object.');
  const rawUri = item['uri'];
  const rawCid = item['cid'];
  const value = item['value'];
  if (typeof rawUri !== 'string' || typeof rawCid !== 'string' || !isJsonObject(value)) {
    const uri = parseAtUri(rawUri)?.uri ?? null;
    const detail =
      typeof rawUri !== 'string'
        ? 'uri is missing or not a string.'
        : typeof rawCid !== 'string'
          ? 'cid is missing or not a string.'
          : 'value is not a JSON object.';
    return skip('malformed-envelope', uri, detail);
  }

  const parsed = parseAtUri(rawUri);
  if (parsed === null) return skip('invalid-uri', null, 'uri is not a full at:// record URI with a DID authority.');
  if (parsed.did !== did) return skip('foreign-owner', parsed.uri, 'uri belongs to another account.');
  if (parsed.collection !== collection) return skip('wrong-collection', parsed.uri, 'uri is in a different collection.');
  const cid = parseCid(rawCid);
  if (cid === null) return skip('invalid-cid', parsed.uri, 'cid is not a valid CID string.');

  return {
    ok: true,
    record: { uri: parsed.uri, cid, collection, rkey: parsed.rkey, value: value as JsonObject },
  };
}

function reasonText(
  code: CoverageReasonCode,
  n: { readonly maxPages: number; readonly accepted: number; readonly rejected: number },
): string {
  switch (code) {
    case 'ok':
      return 'Pagination ended; every returned record was accepted.';
    case 'records-rejected':
      return `${n.rejected} returned record(s) failed checks and were set aside.`;
    case 'page-cap':
      return `Stopped at the ${n.maxPages}-page limit (${n.accepted} newest records read); older records were not read. Counts are lower bounds.`;
    case 'repeated-cursor':
      return 'The server repeated a page marker; reading stopped to avoid a loop. Counts are lower bounds.';
    case 'later-page-failed':
      return `A later page could not be read; ${n.accepted} record(s) read before that are kept. Counts are lower bounds.`;
    case 'first-page-failed':
      return REASON_FIRST_PAGE_FAILED;
    case 'not-present':
      // Never produced here (the load controller creates it); kept for exhaustiveness.
      return 'This collection is not present in the repository.';
  }
}
