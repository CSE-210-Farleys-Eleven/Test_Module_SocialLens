import {
  makeFailure,
  parseDid,
  parseHandle,
  parseHttpsOrigin,
  parseIsoDateTime,
  didMethodOf,
  STORAGE_KEYS,
} from '../shared';
import type { Failure, HandleStatus, KeyValueStore } from '../shared';
import type { LinkedAccount, StoredAccountsV1 } from './contract';

const READ_FAILURE_MESSAGE =
  'Saved accounts could not be read; the list starts empty on this browser.';
const WRITE_FAILURE_MESSAGE =
  'Accounts could not be saved on this browser; the list works until the page is closed.';

export const readFailure = (): Failure => makeFailure('storage', READ_FAILURE_MESSAGE);
export const writeFailure = (): Failure => makeFailure('storage', WRITE_FAILURE_MESSAGE);

const HANDLE_STATUSES: readonly HandleStatus[] = ['valid', 'invalid', 'unverified'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Re-validate one stored entry; null when it is unusable. Loaded accounts always need a fresh sign-in. */
function parseEntry(raw: unknown): LinkedAccount | null {
  if (!isRecord(raw)) return null;
  const did = parseDid(raw.did);
  if (did === null) return null;
  const addedAt = parseIsoDateTime(raw.addedAt);
  if (addedAt === null) return null;
  const handle = raw.handle === null ? null : parseHandle(raw.handle);
  if (raw.handle !== null && handle === null) return null;
  let pdsOrigin = null;
  if (raw.pdsOrigin !== null) {
    const parsed = parseHttpsOrigin(raw.pdsOrigin);
    if (!parsed.ok) return null;
    pdsOrigin = parsed.value;
  }
  let verifiedAt = null;
  if (raw.verifiedAt !== null) {
    verifiedAt = parseIsoDateTime(raw.verifiedAt);
    if (verifiedAt === null) return null;
  }
  const handleStatus = HANDLE_STATUSES.find((s) => s === raw.handleStatus);
  if (handleStatus === undefined) return null;
  return {
    did,
    didMethod: didMethodOf(did),
    handle,
    handleStatus,
    pdsOrigin,
    status: 'needs-sign-in',
    verifiedAt,
    addedAt,
    lastFailure: null,
  };
}

export interface LoadResult {
  readonly accounts: readonly LinkedAccount[];
  readonly failure: Failure | null;
}

export function loadAccounts(storage: KeyValueStore): LoadResult {
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEYS.accounts);
  } catch {
    return { accounts: [], failure: readFailure() };
  }
  if (text === null) return { accounts: [], failure: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { accounts: [], failure: readFailure() };
  }
  if (!isRecord(json) || json.version !== 1 || !Array.isArray(json.accounts)) {
    return { accounts: [], failure: readFailure() };
  }
  const seen = new Set<string>();
  const accounts: LinkedAccount[] = [];
  for (const entry of json.accounts as unknown[]) {
    const account = parseEntry(entry);
    if (account === null || seen.has(account.did)) continue;
    seen.add(account.did);
    accounts.push(account);
  }
  return { accounts, failure: null };
}

/** Write the list (an empty list removes the key). Returns a failure when storage throws. */
export function saveAccounts(
  storage: KeyValueStore,
  accounts: readonly LinkedAccount[],
): Failure | null {
  try {
    if (accounts.length === 0) {
      storage.removeItem(STORAGE_KEYS.accounts);
      return null;
    }
    const stored: StoredAccountsV1 = {
      version: 1,
      accounts: accounts.map((a) => ({
        did: a.did,
        didMethod: a.didMethod,
        handle: a.handle,
        handleStatus: a.handleStatus,
        pdsOrigin: a.pdsOrigin,
        status: a.status,
        verifiedAt: a.verifiedAt,
        addedAt: a.addedAt,
      })),
    };
    storage.setItem(STORAGE_KEYS.accounts, JSON.stringify(stored));
    return null;
  } catch {
    return writeFailure();
  }
}

export function removeStored(storage: KeyValueStore): Failure | null {
  try {
    storage.removeItem(STORAGE_KEYS.accounts);
    return null;
  } catch {
    return writeFailure();
  }
}
