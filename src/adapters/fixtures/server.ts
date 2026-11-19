// A routed `fetch` replacement serving one synthetic scenario. The routed-mock idea follows
// bluesky-social/social-app (MIT), src/state/session/__tests__/mock-fetch.ts; no code was copied.
// It never touches the network and never falls through to globalThis.fetch.

import { LIMITS, ORIGINS, type FetchLike, type JsonObject } from '../../shared/contract';
import { DEMO_ACCOUNT, type DemoScenarioId, type FixtureRequestLogEntry, type FixtureServer, type FixtureServerOptions } from './contract';
import {
  collectionData,
  describeRepoBody,
  didDocument,
  generateScenario,
  getPostsOutcome,
  listRecordsBody,
  listRecordsPage,
  type ScenarioData,
} from './generator';
import { pageFailsPermanently } from './manifest';

interface Reply {
  readonly status: number;
  readonly body: JsonObject;
  readonly retryAfterZero?: true;
}

const json = (status: number, body: JsonObject): Reply => ({ status, body });
const xrpcError = (status: number, error: string, message: string): Reply => ({ status, body: { error, message } });
const scriptedFailure = (status: 429 | 500): Reply => ({
  status,
  body:
    status === 429
      ? { error: 'RateLimitExceeded', message: 'Synthetic scripted rate limit.' }
      : { error: 'InternalServerError', message: 'Synthetic scripted failure.' },
  retryAfterZero: true,
});

function toResponse(reply: Reply): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (reply.retryAfterZero === true) headers['retry-after'] = '0';
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
}

const isOwnRepo = (repo: string | null) => repo === DEMO_ACCOUNT.did || repo === DEMO_ACCOUNT.handle;

/** Per-server mutable state: request counts per collection for the `rate-limit-first-request` script. */
type Counters = Map<string, number>;

function route(data: ScenarioData, counters: Counters, url: URL): Reply | null {
  if (url.origin === ORIGINS.plcDirectory) {
    const target = decodeURIComponent(url.pathname.slice(1));
    if (url.search !== '' || target.includes('/')) return null;
    return target === DEMO_ACCOUNT.did ? json(200, didDocument()) : json(404, { message: 'DID not registered' });
  }

  if (url.origin === DEMO_ACCOUNT.pdsOrigin) {
    const q = url.searchParams;
    if (url.pathname === '/xrpc/com.atproto.repo.describeRepo') {
      const repo = q.get('repo');
      if (repo === null) return xrpcError(400, 'InvalidRequest', 'Params must have the property "repo"');
      if (!isOwnRepo(repo)) return xrpcError(400, 'RepoNotFound', `Could not find repo: ${repo}`);
      return json(200, describeRepoBody(data));
    }
    if (url.pathname === '/xrpc/com.atproto.repo.listRecords') {
      const repo = q.get('repo');
      const collection = q.get('collection');
      if (repo === null || collection === null) return xrpcError(400, 'InvalidRequest', 'Params must have the properties "repo" and "collection"');
      const rawLimit = q.get('limit');
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (rawLimit !== null && !/^\d+$/.test(rawLimit))) {
        return xrpcError(400, 'InvalidRequest', 'limit must be an integer between 1 and 100');
      }
      if (!isOwnRepo(repo)) return xrpcError(400, 'RepoNotFound', `Could not find repo: ${repo}`);
      const cursor = q.get('cursor');
      const c = collectionData(data, collection);
      if (c === null) return json(200, { records: [] });
      const seen = counters.get(collection) ?? 0;
      counters.set(collection, seen + 1);
      if (c.script === 'rate-limit-first-request' && seen === 0) return scriptedFailure(429);
      if (pageFailsPermanently(c.script, cursor !== null)) return scriptedFailure(500);
      return json(200, listRecordsBody(listRecordsPage(c.items, limit, cursor)));
    }
    return null;
  }

  if (url.origin === ORIGINS.appView && url.pathname === '/xrpc/app.bsky.feed.getPosts') {
    const uris = url.searchParams.getAll('uris');
    if (uris.length === 0) return xrpcError(400, 'InvalidRequest', 'Params must have the property "uris"');
    if (uris.length > LIMITS.getPostsBatchSize) return xrpcError(400, 'InvalidRequest', 'uris must not have more than 25 elements');
    const outcome = getPostsOutcome(data, uris);
    return outcome.status === 200 ? json(200, { posts: [...outcome.posts] }) : scriptedFailure(500);
  }

  return null;
}

function hasAuthorization(init: RequestInit | undefined): boolean {
  if (init?.headers === undefined) return false;
  try {
    return new Headers(init.headers).has('authorization');
  } catch {
    return false;
  }
}

/** Resolves after `ms` (immediately for 0), or rejects with the signal's reason when it aborts first. */
function delay(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    if (ms <= 0) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createFixtureServer(scenario: DemoScenarioId, options: FixtureServerOptions | null): FixtureServer {
  const data = generateScenario(scenario);
  const latencyMs = options?.latencyMs ?? 0;
  const counters: Counters = new Map();
  let log: FixtureRequestLogEntry[] = [];

  const fetch: FetchLike = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const base = {
      url: input,
      method,
      credentials: init?.credentials ?? null,
      hadAuthorization: hasAuthorization(init),
    };
    const signal = init?.signal ?? null;

    let url: URL | null = null;
    try {
      url = new URL(input);
    } catch {
      url = null;
    }
    if (url === null || method !== 'GET' || !/^https:$/.test(url.protocol)) {
      log.push({ ...base, status: null, unexpected: true });
      throw new TypeError('Fixture fetch: unexpected request');
    }

    try {
      await delay(latencyMs, signal);
    } catch (reason) {
      log.push({ ...base, status: null, unexpected: false });
      throw reason;
    }

    const reply = route(data, counters, url);
    if (reply === null) {
      log.push({ ...base, status: null, unexpected: true });
      throw new TypeError('Fixture fetch: unexpected request');
    }
    log.push({ ...base, status: reply.status, unexpected: false });
    return toResponse(reply);
  };

  return {
    fetch,
    requests: () => [...log],
    resetLog: () => {
      log = [];
    },
  };
}
