// Adapted from bluesky-social/atproto (MIT), packages/syntax/src/{did,handle,nsid,recordkey,aturi_validation}.ts
//
// The rules below follow the atproto reference validators, narrowed to what
// SocialLens accepts (did:plc / did:web only; did:web without path or port;
// origins without local names or IP literals). Nothing here throws.

import type { AtUri, Cid, Did, DidMethod, Handle, HttpsOrigin, Nsid, ParsedAtUri, RecordKey, Result } from './contract';
import { err, makeFailure, ok } from './result';

const DID_MAX_LENGTH = 2048;
const AT_URI_MAX_LENGTH = 8 * 1024;
const PLC_REGEX = /^did:plc:[a-z2-7]{24}$/;

const HANDLE_MAX_LENGTH = 253;
// atproto HANDLE_REGEX, lower-case only (input is lower-cased first).
const HANDLE_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

// atproto validateNsidRegex.
const NSID_MAX_LENGTH = 253 + 1 + 63;
const NSID_REGEX =
  /^[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?:\.[a-zA-Z](?:[a-zA-Z0-9]{0,62})?)$/;

// atproto RECORD_KEY_REGEX.
const RECORD_KEY_REGEX = /^[a-zA-Z0-9_~.:-]{1,512}$/;

const CID_REGEX = /^[A-Za-z0-9]{8,256}$/;

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'] as const;
const IPV4_REGEX = /^\d+(\.\d+){3}$/;

/**
 * Host rules shared by `parseHttpsOrigin` and `did:web`: a lower-case DNS name of
 * ≥ 2 labels (handle syntax: TLD starts with a letter), not a local / private
 * name and not an IP literal.
 */
function isPublicHostname(host: string): boolean {
  if (host.length === 0 || host.length > HANDLE_MAX_LENGTH) return false;
  if (host.startsWith('[') || IPV4_REGEX.test(host)) return false;
  if (!HANDLE_REGEX.test(host)) return false; // also rejects single-label names and numeric TLDs
  if (host === 'localhost') return false;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return false;
  }
  return true;
}

export function parseDid(value: unknown): Did | null {
  if (typeof value !== 'string' || value.length > DID_MAX_LENGTH) return null;
  if (PLC_REGEX.test(value)) return value as Did;
  if (value.startsWith('did:web:')) {
    const host = value.slice('did:web:'.length);
    // No `:` path segments, no `%3A`-encoded port (no `%` at all), lower-case host only.
    if (host.includes(':') || host.includes('%')) return null;
    return isPublicHostname(host) ? (value as Did) : null;
  }
  return null;
}

export function didMethodOf(did: Did): DidMethod {
  return did.startsWith('did:web:') ? 'web' : 'plc';
}

export function parseHandle(value: unknown): Handle | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().toLowerCase();
  if (h.length === 0 || h.length > HANDLE_MAX_LENGTH) return null;
  return HANDLE_REGEX.test(h) ? (h as Handle) : null;
}

export function parseNsid(value: unknown): Nsid | null {
  if (typeof value !== 'string' || value.length < 5 || value.length > NSID_MAX_LENGTH) return null;
  return NSID_REGEX.test(value) ? (value as Nsid) : null;
}

export function parseRecordKey(value: unknown): RecordKey | null {
  if (typeof value !== 'string' || value === '.' || value === '..') return null;
  return RECORD_KEY_REGEX.test(value) ? (value as RecordKey) : null;
}

export function parseCid(value: unknown): Cid | null {
  return typeof value === 'string' && CID_REGEX.test(value) ? (value as Cid) : null;
}

export function parseAtUri(value: unknown): ParsedAtUri | null {
  if (typeof value !== 'string' || value.length > AT_URI_MAX_LENGTH) return null;
  if (!value.startsWith('at://') || value.includes('?') || value.includes('#')) return null;
  const parts = value.slice('at://'.length).split('/');
  if (parts.length !== 3) return null;
  const did = parseDid(parts[0]);
  const collection = parseNsid(parts[1]);
  const rkey = parseRecordKey(parts[2]);
  if (did === null || collection === null || rkey === null) return null;
  return { uri: value as AtUri, did, collection, rkey };
}

export function makeAtUri(did: Did, collection: Nsid, rkey: RecordKey): AtUri {
  return `at://${did}/${collection}/${rkey}` as AtUri;
}

// Raw shape check before URL parsing: scheme, then an authority with no
// credentials (`@`), no port (`:`), no backslash or whitespace, then nothing or a
// single `/`. This catches what the URL parser would silently normalise away
// (e.g. `:443`, a trailing `?` or `#`, surrounding whitespace).
const RAW_ORIGIN_REGEX = /^https:\/\/[^/?#@:\\\s]+\/?$/i;

export function parseHttpsOrigin(value: unknown): Result<HttpsOrigin> {
  const blocked = () =>
    err(
      makeFailure('blocked-origin', 'This server address is not allowed. No request was sent.', {
        origin: typeof value === 'string' ? value : null,
      }),
    );
  if (typeof value !== 'string' || !RAW_ORIGIN_REGEX.test(value)) return blocked();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return blocked();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return blocked();
  }
  const host = url.hostname.toLowerCase();
  if (!isPublicHostname(host)) return blocked();
  return ok(`https://${host}` as HttpsOrigin);
}
