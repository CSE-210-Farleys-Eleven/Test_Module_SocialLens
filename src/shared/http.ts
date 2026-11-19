// The single bounded, read-only, unauthenticated HTTP path (PLAN §9, invariants I-3, I-4, I-9).
// Retry-After handling and the bounded body read are ported from the SocialLens prototype
// (same project): SocialLens/src/adapters/http.ts.

import {
  LIMITS,
  type Failure,
  type FailureKind,
  type HttpClient,
  type HttpClientDeps,
  type HttpLimits,
  type HttpsOrigin,
  type JsonValue,
  type Result,
  type XrpcParams,
} from './contract';
import { err, makeFailure, ok } from './result';
import { parseHttpsOrigin } from './syntax';

const DEFAULT_LIMITS: HttpLimits = {
  timeoutMs: LIMITS.httpTimeoutMs,
  maxResponseBytes: LIMITS.httpMaxResponseBytes,
  maxRetries: LIMITS.httpMaxRetries,
  retryAfterCapMs: LIMITS.retryAfterCapMs,
  backoffBaseMs: LIMITS.backoffBaseMs,
};

/** Non-2xx bodies are only inspected for an XRPC `error` name, so they are read up to 64 KB. */
const ERROR_BODY_MAX_BYTES = 64 * 1024;

const MESSAGES = {
  'blocked-origin': 'This server address is not allowed. No request was sent.',
  timeout: 'The server did not respond in time.',
  network: 'The server could not be reached (offline, blocked by the browser, or a network error).',
  'too-large': 'The response was larger than the safety limit, so it was not read.',
  'invalid-response': 'The server sent a response that is not valid JSON.',
  'rate-limited': 'The server asked for a longer pause than SocialLens waits. Try again later.',
  xrpc: 'The server rejected the request.',
} as const satisfies Partial<Record<FailureKind, string>>;

const httpMessage = (status: number) => `The server returned HTTP ${status}.`;

/** Internal marker: the attempt signal fired while reading a body. Never escapes this module. */
const ATTEMPT_ABORTED: unique symbol = Symbol('attempt-aborted');

function cancelQuietly(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    body.cancel().catch(() => {});
  } catch {
    // locked or already closed: nothing to cancel
  }
}

/**
 * Read at most `maxBytes` from a body. Returns the bytes, or `'too-large'` (after
 * cancelling the stream). Rejects with ATTEMPT_ABORTED (stream cancelled) when
 * `signal` aborts, or with the stream's own error.
 */
async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | 'too-large'> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(ATTEMPT_ABORTED);
  });
  aborted.catch(() => {});
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) {
        cancel();
        return 'too-large';
      }
      chunks.push(item.value);
    }
  } catch (e) {
    cancel();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function parseJsonBytes(bytes: Uint8Array): { ok: true; value: JsonValue } | { ok: false } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch {
    return { ok: false };
  }
}

const MONTH_NAME = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;

/** `Retry-After` as delta-seconds or an HTTP-date (relative to `nowMs`); null when absent or unparseable. */
function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const v = header.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  if (MONTH_NAME.test(v)) {
    const at = Date.parse(v);
    if (Number.isFinite(at)) return Math.max(0, at - nowMs);
  }
  return null;
}

type AttemptOutcome =
  | { readonly kind: 'done'; readonly result: Result<JsonValue> }
  | { readonly kind: 'retryable'; readonly status: number; readonly retryAfterMs: number | null };

export function createHttpClient(deps: HttpClientDeps): HttpClient {
  const limits: HttpLimits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) };
  const fixed: readonly string[] = [...deps.fixedOrigins];
  const permitted = new Set<string>();

  const isAllowed = (origin: string) => fixed.includes(origin) || permitted.has(origin);

  async function attempt(url: string, origin: string, signal: AbortSignal): Promise<AttemptOutcome> {
    const fail = (kind: FailureKind, message: string, extra: Partial<Omit<Failure, 'kind' | 'message'>> = {}) =>
      ({ kind: 'done', result: err(makeFailure(kind, message, { origin, ...extra })) }) as const;

    const attemptController = new AbortController();
    const timerController = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => attemptController.abort(signal.reason);
    signal.addEventListener('abort', onCallerAbort, { once: true });
    // The timeout is built from the injected sleep (never AbortSignal.timeout) so tests control time.
    deps.sleep(limits.timeoutMs, timerController.signal).then(
      () => {
        if (timerController.signal.aborted) return;
        timedOut = true;
        attemptController.abort(new DOMException('The request timed out.', 'TimeoutError'));
      },
      () => {},
    );

    /** After any interruption: the caller's abort wins (rethrown), then our timeout. */
    const interrupted = (): AttemptOutcome | null => {
      if (signal.aborted) throw signal.reason;
      if (timedOut) return fail('timeout', MESSAGES.timeout);
      return null;
    };

    try {
      let response: Response;
      try {
        response = await deps.fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: attemptController.signal,
        });
      } catch {
        return interrupted() ?? fail('network', MESSAGES.network);
      }

      const status = response.status;
      const early = (() => {
        try {
          return interrupted();
        } catch (e) {
          cancelQuietly(response.body);
          throw e;
        }
      })();
      if (early !== null) {
        cancelQuietly(response.body);
        return early;
      }

      if (status >= 200 && status <= 299) {
        let bytes: Uint8Array | 'too-large';
        try {
          bytes = await readLimited(response.body, limits.maxResponseBytes, attemptController.signal);
        } catch {
          return interrupted() ?? fail('network', MESSAGES.network, { status });
        }
        const late = interrupted();
        if (late !== null) return late;
        if (bytes === 'too-large') return fail('too-large', MESSAGES['too-large'], { status });
        const parsed = parseJsonBytes(bytes);
        if (!parsed.ok) return fail('invalid-response', MESSAGES['invalid-response'], { status });
        return { kind: 'done', result: ok(parsed.value) };
      }

      if (status === 429 || (status >= 500 && status <= 599)) {
        cancelQuietly(response.body);
        return {
          kind: 'retryable',
          status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), deps.nowMs()),
        };
      }

      // Any other non-2xx: look for an XRPC error name in at most 64 KB. The server's
      // `message` is never copied into the Failure.
      let xrpcError: string | null = null;
      try {
        const bytes = await readLimited(response.body, ERROR_BODY_MAX_BYTES, attemptController.signal);
        if (bytes !== 'too-large') {
          const parsed = parseJsonBytes(bytes);
          if (parsed.ok) {
            const v = parsed.value;
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              const name = (v as { readonly [k: string]: JsonValue })['error'];
              if (typeof name === 'string') xrpcError = name;
            }
          }
        }
      } catch {
        const r = interrupted();
        if (r !== null) return r;
      }
      const late = interrupted();
      if (late !== null) return late;
      if (xrpcError !== null) return fail('xrpc', MESSAGES.xrpc, { status, xrpcError });
      return fail('http', httpMessage(status), { status });
    } finally {
      timerController.abort();
      signal.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    async getJson({ url, signal }) {
      signal.throwIfAborted();

      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (
        parsed === null ||
        parsed.protocol !== 'https:' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.hash !== '' ||
        url.includes('#') ||
        !isAllowed(parsed.origin)
      ) {
        return err(
          makeFailure('blocked-origin', MESSAGES['blocked-origin'], {
            origin: parsed !== null && parsed.origin !== 'null' ? parsed.origin : null,
          }),
        );
      }
      const origin = parsed.origin;

      for (let i = 0; ; i++) {
        const outcome = await attempt(url, origin, signal);
        if (outcome.kind === 'done') return outcome.result;

        const kind: FailureKind = outcome.status === 429 ? 'rate-limited' : 'http';
        const message = kind === 'rate-limited' ? MESSAGES['rate-limited'] : httpMessage(outcome.status);
        const stop = (retryAfterMs: number | null) =>
          err(makeFailure(kind, message, { status: outcome.status, retryAfterMs, origin }));

        if (i >= limits.maxRetries) return stop(outcome.retryAfterMs);
        const wait = outcome.retryAfterMs ?? limits.backoffBaseMs * 2 ** i;
        if (wait > limits.retryAfterCapMs) return stop(wait); // no early retry
        try {
          await deps.sleep(wait, signal);
        } catch (e) {
          if (signal.aborted) throw signal.reason;
          throw e;
        }
        signal.throwIfAborted();
      }
    },

    permitOrigin(origin: HttpsOrigin, _basis) {
      const checked = parseHttpsOrigin(origin);
      if (!checked.ok || checked.value !== origin) {
        throw new TypeError('permitOrigin requires a normalised HttpsOrigin (use parseHttpsOrigin).');
      }
      permitted.add(origin);
    },

    permittedOrigins() {
      return [...new Set([...fixed, ...permitted])];
    },
  };
}

export function buildXrpcUrl(origin: string, method: string, params: XrpcParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value as readonly string[]) search.append(key, item);
    } else {
      search.append(key, String(value));
    }
  }
  const base = `${origin.endsWith('/') ? origin.slice(0, -1) : origin}/xrpc/${method}`;
  const query = search.toString();
  return query === '' ? base : `${base}?${query}`;
}
