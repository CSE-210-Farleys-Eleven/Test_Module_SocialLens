/**
 * M2 `accounts/` — FROZEN CONTRACT.
 * The list of accounts the person has proved they own (by signing in), keyed by DID,
 * each with a checked handle and PDS. Types only.
 */
import type {
  AccountIdentity,
  Clock,
  Did,
  DidMethod,
  Failure,
  Handle,
  HandleStatus,
  HttpsOrigin,
  IsoDateTime,
  KeyValueStore,
  Result,
  SessionRef,
} from '../shared/contract';
import type { IdentitySource, RepoDescription, RepoSource } from '../adapters/atproto/contract';

export type LinkedAccountStatus =
  | 'verified' // identity resolved during this page session
  | 'could-not-verify' // signed in, but the DID document / PDS could not be resolved (e.g. did:web CORS)
  | 'needs-sign-in'; // known from an earlier visit or session ended; no usable session right now

/** One row of the Accounts view. Persisted (without tokens) so accounts can be switched after a reload. */
export interface LinkedAccount {
  readonly did: Did;
  readonly didMethod: DidMethod;
  /** Last known handle; a mutable label, never an identifier. */
  readonly handle: Handle | null;
  readonly handleStatus: HandleStatus;
  readonly pdsOrigin: HttpsOrigin | null;
  readonly status: LinkedAccountStatus;
  /** When identity was last verified; null if never. */
  readonly verifiedAt: IsoDateTime | null;
  /** When the account was first linked on this browser. */
  readonly addedAt: IsoDateTime;
  /** Why verification failed, when status is 'could-not-verify'; else null. Not persisted. */
  readonly lastFailure: Failure | null;
}

export interface VerifyRequest {
  /** The account to verify is ALWAYS `session.did`; there is no way to name another one. */
  readonly session: SessionRef;
  readonly signal: AbortSignal;
}

export interface VerifiedAccount {
  readonly identity: AccountIdentity;
  /** describeRepo result reused by the load pipeline; null when describeRepo failed. */
  readonly repo: RepoDescription | null;
  readonly repoFailure: Failure | null;
}

export interface RemovalReceipt {
  readonly did: Did;
  /** False when the DID was not in the list. */
  readonly removed: boolean;
  /** Always 'local-only': nothing is deleted from the account, its PDS or the network. */
  readonly scope: 'local-only';
}

export interface AccountsService {
  /** Accounts in insertion order. Synchronous; reads the in-memory list (loaded from storage at creation). */
  list(): readonly LinkedAccount[];
  get(did: Did): LinkedAccount | null;
  /**
   * Resolve DID → PDS, read describeRepo, derive the handle status, upsert the account.
   * err when the PDS cannot be resolved (the account is still upserted as 'could-not-verify').
   * Rejects only with the caller's AbortError (nothing is upserted then).
   */
  verify(request: VerifyRequest): Promise<Result<VerifiedAccount>>;
  /** Mark an account as having no usable session (after sign-out / session end). No-op for unknown DIDs. */
  markNeedsSignIn(did: Did): void;
  /** Forget the account on this browser. Local only. */
  remove(did: Did): RemovalReceipt;
  /** Forget every account on this browser. Local only. */
  clear(): void;
  /** Non-null when persisted data was unreadable or storage threw; the list still works in memory. */
  storageFailure(): Failure | null;
}

export interface AccountsDeps {
  readonly identity: IdentitySource;
  readonly repo: Pick<RepoSource, 'describeRepo'>;
  /** `localStorage` for live accounts; null = memory only (demo accounts are never persisted). */
  readonly storage: KeyValueStore | null;
  readonly clock: Clock;
}

export type CreateAccounts = (deps: AccountsDeps) => AccountsService;

/** Shape persisted under STORAGE_KEYS.accounts. `lastFailure` is never persisted. */
export interface StoredAccountsV1 {
  readonly version: 1;
  readonly accounts: readonly Omit<LinkedAccount, 'lastFailure'>[];
}
