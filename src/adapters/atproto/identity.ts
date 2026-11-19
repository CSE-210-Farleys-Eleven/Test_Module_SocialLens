// Adapted from bluesky-social/atproto (MIT), packages/common-web/src/did-doc.ts and
// packages/identity/src/did/web-resolver.ts — `#atproto_pds` / `AtprotoPersonalDataServer`
// service lookup, `alsoKnownAs` handle extraction, did:web `/.well-known/did.json`.

import type { Did, HttpClient, HttpsOrigin, JsonObject, JsonValue, Result } from '../../shared/contract';
import { ORIGINS } from '../../shared/contract';
import { checkSelf, didMethodOf, err, makeFailure, ok, parseHandle, parseHttpsOrigin } from '../../shared/index';
import type { ResolvedIdentity, SelfRequest } from './contract';
import { getJson, isJsonObject } from './util';

const DOC_MISMATCH = 'The DID document does not match this account.';
const NO_PDS = 'No PDS is listed for this account.';
const PDS_BLOCKED = "This account's PDS address is not supported by SocialLens.";

export async function resolveIdentity(http: HttpClient, request: SelfRequest): Promise<Result<ResolvedIdentity>> {
  const { session, did, signal } = request;
  // I-1: self-only before any I/O (including permitOrigin).
  const self = checkSelf(session, did);
  if (!self.ok) return self;
  signal.throwIfAborted();

  const didMethod = didMethodOf(did);
  let resolvedFrom: string;
  let docUrl: string;
  if (didMethod === 'plc') {
    resolvedFrom = ORIGINS.plcDirectory;
    docUrl = `${ORIGINS.plcDirectory}/${did}`;
  } else {
    const host = parseHttpsOrigin('https://' + did.slice('did:web:'.length));
    if (!host.ok) return host;
    http.permitOrigin(host.value, 'did-web-host');
    resolvedFrom = host.value;
    docUrl = `${host.value}/.well-known/did.json`;
  }

  const fetched = await getJson(http, docUrl, signal);
  if (!fetched.ok) return fetched;

  const doc = fetched.value;
  if (!isJsonObject(doc) || doc['id'] !== did) {
    return err(makeFailure('invalid-response', DOC_MISMATCH, { origin: resolvedFrom }));
  }

  const endpoint = findPdsEndpoint(doc, did);
  if (endpoint === null) return err(makeFailure('invalid-response', NO_PDS, { origin: resolvedFrom }));

  const pds = parseHttpsOrigin(endpoint);
  if (!pds.ok) return err(makeFailure('blocked-origin', PDS_BLOCKED, { origin: pds.failure.origin }));
  // I-3: the only PDS origin ever permitted is the one named in this DID's own document.
  http.permitOrigin(pds.value, 'pds-from-did-document');

  return ok({
    did,
    didMethod,
    pdsOrigin: pds.value as HttpsOrigin,
    claimedHandle: claimedHandleOf(doc),
    resolvedFrom,
  });
}

function findPdsEndpoint(doc: JsonObject, did: Did): string | null {
  const services: JsonValue | undefined = doc['service'];
  if (!Array.isArray(services)) return null;
  for (const service of services as readonly JsonValue[]) {
    if (!isJsonObject(service)) continue;
    const id = service['id'];
    const endpoint = service['serviceEndpoint'];
    if (
      service['type'] === 'AtprotoPersonalDataServer' &&
      (id === '#atproto_pds' || id === `${did}#atproto_pds`) &&
      typeof endpoint === 'string'
    ) {
      return endpoint;
    }
  }
  return null;
}

function claimedHandleOf(doc: JsonObject) {
  const aka: JsonValue | undefined = doc['alsoKnownAs'];
  if (!Array.isArray(aka)) return null;
  const first = (aka as readonly JsonValue[]).find(
    (entry): entry is string => typeof entry === 'string' && entry.startsWith('at://'),
  );
  return first === undefined ? null : parseHandle(first.slice('at://'.length));
}
