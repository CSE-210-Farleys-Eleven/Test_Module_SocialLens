// Small total readers over untrusted JSON bodies. None of them throws.
import { LIMITS, parseAtUri, parseDid } from '../shared';
import type { AtUri, Did } from '../shared';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function isPlainObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own-property read only, so `constructor` / inherited keys are never mistaken for data. */
export function field(obj: unknown, key: string): unknown {
  if (!isPlainObject(obj) || !hasOwn(obj, key)) return undefined;
  return obj[key];
}

/** Result of reading a required field: a value, or why it is unusable. */
export type Read<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reasonCode: 'missing-required-field' | 'invalid-field'; readonly detail: string };

function fail<T>(path: string, value: unknown, what: string): Read<T> {
  return value === undefined
    ? { ok: false, reasonCode: 'missing-required-field', detail: `${path} is missing` }
    : { ok: false, reasonCode: 'invalid-field', detail: `${path} is not ${what}` };
}

/** Truncate to `max` characters without splitting a surrogate pair. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

export function readString(obj: unknown, key: string): Read<string> {
  const v = field(obj, key);
  return typeof v === 'string' ? { ok: true, value: v } : fail(key, v, 'a string');
}

export function readOptionalString(obj: unknown, key: string): string | null {
  const v = field(obj, key);
  return typeof v === 'string' ? v : null;
}

/** `path` is a dotted path through nested objects, e.g. `subject.uri`. */
function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) cur = field(cur, part);
  return cur;
}

export function readAtUri(obj: unknown, path: string): Read<AtUri> {
  const v = at(obj, path);
  const parsed = typeof v === 'string' ? parseAtUri(v) : null;
  return parsed !== null ? { ok: true, value: parsed.uri } : fail(path, v, 'an AT-URI');
}

export function readDid(obj: unknown, path: string): Read<Did> {
  const v = at(obj, path);
  const parsed = typeof v === 'string' ? parseDid(v) : null;
  return parsed !== null ? { ok: true, value: parsed } : fail(path, v, 'a DID');
}

/** Valid AT-URI at `path`, else null (used where the field is optional / advisory). */
export function readOptionalAtUri(obj: unknown, path: string): AtUri | null {
  const v = at(obj, path);
  if (typeof v !== 'string') return null;
  return parseAtUri(v)?.uri ?? null;
}

const MAX_TAG_CHARS = 80;
const TAG_FACET = 'app.bsky.richtext.facet#tag';

/** Trim, drop empty, truncate, de-duplicate (first wins), cap. Non-string candidates are ignored. */
export function cleanTags(candidates: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = truncate(c.trim(), MAX_TAG_CHARS);
    if (t === '' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= LIMITS.maxTagsPerRecord) break;
  }
  return out;
}

/** `tags` strings from the record body. */
export function readTags(obj: unknown, includeFacets: boolean): string[] {
  const candidates: unknown[] = [];
  const tags = field(obj, 'tags');
  if (Array.isArray(tags)) candidates.push(...tags);
  if (includeFacets) {
    const facets = field(obj, 'facets');
    if (Array.isArray(facets)) {
      for (const facet of facets) {
        const features = field(facet, 'features');
        if (!Array.isArray(features)) continue;
        for (const f of features) {
          if (field(f, '$type') === TAG_FACET) candidates.push(field(f, 'tag'));
        }
      }
    }
  }
  return cleanTags(candidates);
}

export function clipText(s: string): string {
  return truncate(s, LIMITS.maxTextChars);
}
