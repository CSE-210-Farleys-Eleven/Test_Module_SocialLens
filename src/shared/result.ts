import type { Failure, FailureKind, Result } from './contract';

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err(failure: Failure): Result<never, Failure> {
  return { ok: false, failure };
}

export function makeFailure(
  kind: FailureKind,
  message: string,
  extra?: Partial<Omit<Failure, 'kind' | 'message'>>,
): Failure {
  return {
    kind,
    message,
    status: extra?.status ?? null,
    xrpcError: extra?.xrpcError ?? null,
    retryAfterMs: extra?.retryAfterMs ?? null,
    origin: extra?.origin ?? null,
  };
}

/** True for a cancellation: DOMException AbortError/TimeoutError, or any error named AbortError. */
export function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name: unknown }).name === 'AbortError'
  );
}
