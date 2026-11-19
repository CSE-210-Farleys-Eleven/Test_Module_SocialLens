// Ground truth for a scenario, derived from the same generator output and the same pure
// response functions the server uses (never hard-coded separately). It simulates what a
// correct client (adapters/atproto + adapters/bluesky + shared HTTP retries) observes.

import { LIMITS, type EngagementCounts } from '../../shared/contract';
import { DEMO_ACCOUNT, type DemoScenarioId, type FixtureCollectionExpectation, type FixtureManifest } from './contract';
import {
  REGISTERED_COLLECTIONS,
  collectionData,
  generateScenario,
  getPostsOutcome,
  listRecordsPage,
  type CollectionData,
  type FailureScript,
  type ListItem,
  type ScenarioData,
} from './generator';

const POST = 'app.bsky.feed.post';

/** Whether a page request still fails after the client's retries (429 once is absorbed by a retry). */
export function pageFailsPermanently(script: FailureScript, hasCursor: boolean): boolean {
  return script === 'fail-always' || (script === 'fail-after-first-page' && hasCursor);
}

interface ServedPage {
  readonly items: readonly ListItem[];
  readonly ok: boolean;
  readonly hasNext: boolean;
}

/** Every page the fixture holds for a collection, in order, regardless of any client page cap. */
function allPages(c: CollectionData, pageSize: number): ServedPage[] {
  const pages: ServedPage[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = listRecordsPage(c.items, pageSize, cursor);
    pages.push({ items: page.items, ok: !pageFailsPermanently(c.script, cursor !== null), hasNext: page.cursor !== null });
    if (page.cursor === null) return pages;
    cursor = page.cursor;
  }
}

interface ClientRead {
  readonly accepted: readonly ListItem[];
  readonly status: FixtureCollectionExpectation['expectedStatus'];
  readonly reasonCode: string;
}

/** What `adapters/atproto.listCollection` reports with `maxPages = LIMITS.maxPagesPerCollection`. */
function simulateClient(pages: readonly ServedPage[]): ClientRead {
  const accepted: ListItem[] = [];
  let rejected = 0;
  for (let k = 0; k < pages.length && k < LIMITS.maxPagesPerCollection; k++) {
    const page = pages[k]!;
    if (!page.ok) {
      return k === 0
        ? { accepted, status: 'unavailable', reasonCode: 'first-page-failed' }
        : { accepted, status: 'partial', reasonCode: 'later-page-failed' };
    }
    for (const i of page.items) {
      if (i.valid) accepted.push(i);
      else rejected++;
    }
    if (!page.hasNext || page.items.length === 0) break;
    if (k + 1 === LIMITS.maxPagesPerCollection) return { accepted, status: 'partial', reasonCode: 'page-cap' };
  }
  return rejected === 0
    ? { accepted, status: 'complete', reasonCode: 'ok' }
    : { accepted, status: 'partial', reasonCode: 'records-rejected' };
}

function expectationFor(data: ScenarioData, nsid: string, pageSize: number): { row: FixtureCollectionExpectation; accepted: readonly ListItem[] } {
  const advertised = data.advertised.includes(nsid);
  if (!advertised) {
    return {
      row: { collection: nsid, advertised, servedValid: 0, servedInvalid: 0, pages: 0, expectedStatus: 'complete', expectedReasonCode: 'not-present' },
      accepted: [],
    };
  }
  const c: CollectionData = collectionData(data, nsid) ?? { nsid, items: [], script: 'none' };
  const pages = allPages(c, pageSize);
  const okItems = pages.filter((p) => p.ok).flatMap((p) => p.items);
  const read = simulateClient(pages);
  return {
    row: {
      collection: nsid,
      advertised,
      servedValid: okItems.filter((i) => i.valid).length,
      servedInvalid: okItems.filter((i) => !i.valid).length,
      pages: pages.length,
      expectedStatus: read.status,
      expectedReasonCode: read.reasonCode,
    },
    accepted: read.accepted,
  };
}

function hasText(value: unknown): boolean {
  return value !== null && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string';
}

export function buildManifest(scenario: DemoScenarioId): FixtureManifest {
  const data = generateScenario(scenario);
  const rows = REGISTERED_COLLECTIONS.map((c) => expectationFor(data, c.nsid, c.pageSize));
  const registered = new Set<string>(REGISTERED_COLLECTIONS.map((c) => c.nsid));

  // Engagement: the accepted own post URIs, in served order, batched as adapters/bluesky does.
  const postUris = rows.find((r) => r.row.collection === POST)!.accepted.map((i) => i.uri);
  const totals = { likes: 0, reposts: 0, replies: 0, quotes: 0 } satisfies EngagementCounts;
  let known = 0;
  let batches = 0;
  let consecutiveFailures = 0;
  for (let start = 0; start < postUris.length; start += LIMITS.getPostsBatchSize) {
    if (consecutiveFailures >= LIMITS.maxConsecutiveCountFailures) break;
    batches++;
    const outcome = getPostsOutcome(data, postUris.slice(start, start + LIMITS.getPostsBatchSize));
    if (outcome.status !== 200) {
      consecutiveFailures++;
      continue;
    }
    consecutiveFailures = 0;
    for (const p of outcome.posts) {
      known++;
      totals.likes += p.likeCount;
      totals.reposts += p.repostCount;
      totals.replies += p.replyCount;
      totals.quotes += p.quoteCount;
    }
  }

  const normalizeSkips = rows
    .find((r) => r.row.collection === POST)!
    .accepted.filter((i) => !hasText(i.value)).length;

  return {
    scenario,
    did: DEMO_ACCOUNT.did,
    handle: DEMO_ACCOUNT.handle,
    pdsOrigin: DEMO_ACCOUNT.pdsOrigin,
    now: DEMO_ACCOUNT.now,
    handleIsCorrect: data.handleIsCorrect,
    collections: rows.map((r) => r.row),
    presentNotAnalysed: data.advertised.filter((n) => !registered.has(n)).sort(),
    postsWithCounts: known,
    postsWithUnknownCounts: postUris.length - known,
    countTotals: totals,
    expectedCountBatches: batches,
    expectedNormalizeSkips: normalizeSkips,
  };
}
