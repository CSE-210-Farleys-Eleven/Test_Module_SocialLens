import type { Failure, HttpClient, JsonObject, JsonValue, Result } from '../../shared/contract';
import { err, makeFailure } from '../../shared/index';

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `http.getJson` with the abort contract enforced locally: rejects only with the caller's
 * abort reason (checked before and after the request); any other unexpected rejection
 * becomes an `internal` failure value instead of escaping.
 */
export async function getJson(http: HttpClient, url: string, signal: AbortSignal): Promise<Result<JsonValue>> {
  signal.throwIfAborted();
  let result: Result<JsonValue>;
  try {
    result = await http.getJson({ url, signal });
  } catch (error) {
    signal.throwIfAborted();
    return err(internalFailure(url));
  }
  signal.throwIfAborted();
  return result;
}

function internalFailure(url: string): Failure {
  let origin: string | null = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  return makeFailure('internal', 'An unexpected error occurred while reading. No data was kept from this request.', { origin });
}
