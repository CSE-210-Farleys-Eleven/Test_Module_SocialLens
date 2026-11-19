// Test-only hand-written fake HttpClient (no network). Imported only by *.test.ts in this folder.
import type {
  Clock,
  Failure,
  HttpClient,
  HttpGetRequest,
  HttpsOrigin,
  IsoDateTime,
  JsonValue,
  OriginBasis,
  Result,
} from '../../shared/contract';

/** A scripted response: a Result, or a function producing one (may await / observe the signal). */
export type Scripted = Result<JsonValue> | ((request: HttpGetRequest) => Promise<Result<JsonValue>>);

export type FakeEvent =
  | { readonly type: 'get'; readonly url: string }
  | { readonly type: 'permit'; readonly origin: HttpsOrigin; readonly basis: OriginBasis };

export interface FakeHttp extends HttpClient {
  /** Queue one response for an exact URL (FIFO per URL). */
  on(url: string, response: Scripted): FakeHttp;
  /** Every getJson URL, in order. */
  readonly calls: string[];
  /** Every permitOrigin call, in order. */
  readonly permits: { origin: HttpsOrigin; basis: OriginBasis }[];
  /** gets and permits interleaved, in order. */
  readonly events: FakeEvent[];
}

const UNSCRIPTED: Failure = {
  kind: 'internal',
  message: 'fake: unscripted URL',
  status: null,
  xrpcError: null,
  retryAfterMs: null,
  origin: null,
};

export function createFakeHttp(): FakeHttp {
  const queues = new Map<string, Scripted[]>();
  const calls: string[] = [];
  const permits: { origin: HttpsOrigin; basis: OriginBasis }[] = [];
  const events: FakeEvent[] = [];
  const fake: FakeHttp = {
    calls,
    permits,
    events,
    on(url, response) {
      const q = queues.get(url) ?? [];
      q.push(response);
      queues.set(url, q);
      return fake;
    },
    async getJson(request) {
      // Mirrors the real client: rejects only with the caller's abort reason.
      request.signal.throwIfAborted();
      calls.push(request.url);
      events.push({ type: 'get', url: request.url });
      const next = queues.get(request.url)?.shift();
      if (next === undefined) return { ok: false, failure: UNSCRIPTED };
      const result = typeof next === 'function' ? await next(request) : next;
      request.signal.throwIfAborted();
      return result;
    },
    permitOrigin(origin, basis) {
      permits.push({ origin, basis });
      events.push({ type: 'permit', origin, basis });
    },
    permittedOrigins() {
      return ['https://public.api.bsky.app', 'https://plc.directory', ...permits.map((p) => p.origin)];
    },
  };
  return fake;
}

export const fakeClock: Clock = {
  now: () => '2026-11-18T00:00:00.000Z' as IsoDateTime,
  nowMs: () => 0,
};

export function okJson(value: JsonValue): Result<JsonValue> {
  return { ok: true, value };
}

export function failWith(kind: Failure['kind'], extra: Partial<Failure> = {}): Result<JsonValue> {
  return { ok: false, failure: { ...UNSCRIPTED, kind, message: `fake ${kind}`, ...extra } };
}

/** A response that never settles until the request's signal aborts (then rejects with its reason). */
export function hangUntilAbort(onStart?: () => void): Scripted {
  return (request) =>
    new Promise((_, reject) => {
      onStart?.();
      const { signal } = request;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}
