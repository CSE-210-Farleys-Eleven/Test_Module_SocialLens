import { buildXrpcUrl, isAbortError, LIMITS, makeFailure, ORIGINS, parseAtUri } from '../../shared';
import type {
  AtUri,
  Clock,
  Engagement,
  EngagementCounts,
  EngagementCoverage,
  EngagementUnknownReason,
  Failure,
  HttpClient,
  JsonValue,
} from '../../shared/contract';
import type { EngagementLookup, EngagementRequest, EngagementResult } from './contract';

const POST_COLLECTION = 'app.bsky.feed.post';

const unknown = (reason: EngagementUnknownReason): Engagement => ({ status: 'unknown', reason });

const isObject = (v: unknown): v is { readonly [k: string]: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Counters are known only when all four are observed non-negative safe integers. */
function readCounts(view: { readonly [k: string]: unknown }): EngagementCounts | null {
  const { likeCount, repostCount, replyCount, quoteCount } = view;
  if (!isCount(likeCount) || !isCount(repostCount) || !isCount(replyCount) || !isCount(quoteCount)) return null;
  return { likes: likeCount, reposts: repostCount, replies: replyCount, quotes: quoteCount };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type BatchOutcome =
  | { readonly ok: true; readonly posts: readonly unknown[] }
  | { readonly ok: false; readonly failure: Failure };

async function fetchBatch(http: HttpClient, batch: readonly AtUri[], signal: AbortSignal): Promise<BatchOutcome> {
  const url = buildXrpcUrl(ORIGINS.appView, 'app.bsky.feed.getPosts', { uris: batch });
  let result;
  try {
    result = await http.getJson({ url, signal });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw signal.aborted ? signal.reason : error;
    return {
      ok: false,
      failure: makeFailure('internal', 'The engagement lookup failed unexpectedly.', { origin: ORIGINS.appView }),
    };
  }
  signal.throwIfAborted();
  if (!result.ok) return { ok: false, failure: result.failure };
  const body: JsonValue = result.value;
  if (!isObject(body) || !Array.isArray(body.posts)) {
    return {
      ok: false,
      failure: makeFailure('invalid-response', 'The Bluesky AppView returned an unexpected response.', { origin: ORIGINS.appView }),
    };
  }
  return { ok: true, posts: body.posts as readonly unknown[] };
}

function coverageFor(
  requested: number,
  known: number,
  batches: number,
  batchesFailed: number,
  anySuccess: boolean,
  failure: Failure | null,
): EngagementCoverage {
  const base = { requested, known, unknown: requested - known, batches, batchesFailed, failure };
  if (requested === 0) return { ...base, status: 'complete', reason: 'No posts to look up.' };
  if (known === requested) return { ...base, status: 'complete', reason: 'Counters were read for every post.' };
  if (anySuccess) {
    return {
      ...base,
      status: 'partial',
      reason: `Counters are known for ${known} of ${requested} posts; the rest are unknown, not zero.`,
    };
  }
  return { ...base, status: 'unavailable', reason: 'Counters could not be read. They are unknown, not zero.' };
}

export async function getCounts(http: HttpClient, clock: Clock, request: EngagementRequest): Promise<EngagementLookup> {
  const { session, signal, onProgress } = request;
  const distinct = [...new Set(request.uris)];
  const outcomes = new Map<AtUri, Engagement>();

  const sendable: AtUri[] = [];
  for (const uri of distinct) {
    const parsed = parseAtUri(uri);
    if (parsed !== null && parsed.did === session.did && parsed.collection === POST_COLLECTION) sendable.push(uri);
    else outcomes.set(uri, unknown('rejected-not-self'));
  }

  const batches = chunk(sendable, LIMITS.getPostsBatchSize);
  let attempted = 0;
  let failed = 0;
  let consecutive = 0;
  let anySuccess = false;
  let failure: Failure | null = null;

  for (const [index, batch] of batches.entries()) {
    if (consecutive >= LIMITS.maxConsecutiveCountFailures) {
      for (const uri of batches.slice(index).flat()) outcomes.set(uri, unknown('not-requested'));
      break;
    }
    signal.throwIfAborted();
    const outcome = await fetchBatch(http, batch, signal);
    attempted += 1;

    if (!outcome.ok) {
      failed += 1;
      consecutive += 1;
      failure = outcome.failure;
      for (const uri of batch) outcomes.set(uri, unknown('lookup-failed'));
    } else {
      consecutive = 0;
      anySuccess = true;
      const inBatch = new Set<string>(batch);
      const seen = new Set<string>();
      for (const item of outcome.posts) {
        if (!isObject(item) || typeof item.uri !== 'string') continue;
        const uri = item.uri as AtUri;
        if (!inBatch.has(uri) || seen.has(uri)) continue;
        seen.add(uri);
        const counts = readCounts(item);
        outcomes.set(
          uri,
          counts === null ? unknown('invalid-counts') : { status: 'known', counts, observedAt: clock.now() },
        );
      }
      for (const uri of batch) if (!outcomes.has(uri)) outcomes.set(uri, unknown('not-returned'));
    }
    onProgress?.({ batch: index + 1, batches: batches.length });
  }

  const results: EngagementResult[] = distinct.map((uri) => ({
    uri,
    engagement: outcomes.get(uri) ?? unknown('not-requested'),
  }));
  const known = results.filter((r) => r.engagement.status === 'known').length;
  return { results, coverage: coverageFor(distinct.length, known, attempted, failed, anySuccess, failure) };
}
