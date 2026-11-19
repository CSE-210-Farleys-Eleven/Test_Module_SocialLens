import { describe, expect, it } from 'vitest';
import { err, isAbortError, makeFailure, ok } from './result';

describe('ok / err', () => {
  it('builds results', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    const f = makeFailure('network', 'x');
    expect(err(f)).toEqual({ ok: false, failure: f });
  });
});

describe('makeFailure', () => {
  it('defaults unspecified fields to null', () => {
    expect(makeFailure('timeout', 'Too slow.')).toEqual({
      kind: 'timeout',
      message: 'Too slow.',
      status: null,
      xrpcError: null,
      retryAfterMs: null,
      origin: null,
    });
  });
  it('keeps provided extras', () => {
    const f = makeFailure('xrpc', 'Bad.', { status: 400, xrpcError: 'InvalidRequest', origin: 'https://a.example' });
    expect(f).toEqual({
      kind: 'xrpc',
      message: 'Bad.',
      status: 400,
      xrpcError: 'InvalidRequest',
      retryAfterMs: null,
      origin: 'https://a.example',
    });
  });
  it('produces structured-cloneable plain data', () => {
    const f = makeFailure('http', 'm', { retryAfterMs: 5 });
    expect(structuredClone(f)).toEqual(f);
  });
});

describe('isAbortError', () => {
  it('recognises DOMException AbortError and TimeoutError', () => {
    expect(isAbortError(new DOMException('a', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('t', 'TimeoutError'))).toBe(true);
  });
  it('recognises the reason of an aborted signal', () => {
    const c = new AbortController();
    c.abort();
    expect(isAbortError(c.signal.reason)).toBe(true);
  });
  it('recognises any error named AbortError', () => {
    const e = new Error('x');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
  });
  it('rejects other values', () => {
    expect(isAbortError(new TypeError('fetch failed'))).toBe(false);
    expect(isAbortError(new DOMException('n', 'NetworkError'))).toBe(false);
    expect(isAbortError(new Error('TimeoutError'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
