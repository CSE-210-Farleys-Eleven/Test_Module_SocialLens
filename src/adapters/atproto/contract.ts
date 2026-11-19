/**
 * M4a `adapters/atproto/` — FROZEN CONTRACT.
 * Identity resolution and READ-ONLY repo reads from the user's own PDS.
 * Types only.
 */
import type {
  Clock,
  Coverage,
  Did,
  DidMethod,
  Failure,
  Handle,
  HttpClient,
  HttpsOrigin,
  Nsid,
  RawRecord,
  Result,
  SessionRef,
  SkippedRecord,
} from '../../shared/contract';

/** Present on every call so the self-only guard can run before any I/O. */
export interface SelfRequest {
  /** The authenticated (or demo) session. */
  readonly session: SessionRef;
  /** The repo to read. MUST equal `session.did`, otherwise the call fails with 'access-denied' and sends nothing. */
  readonly did: Did;
  readonly signal: AbortSignal;
}

export interface ResolvedIdentity {
  readonly did: Did;
  readonly didMethod: DidMethod;
  /** From the DID document's `#atproto_pds` service. Already permitted on the HttpClient. */
  readonly pdsOrigin: HttpsOrigin;
  /** First `at://<handle>` entry of `alsoKnownAs`, syntactically valid; null when absent. Unverified claim. */
  readonly claimedHandle: Handle | null;
  /** Origin the DID document was fetched from (plc.directory or the did:web host). */
  readonly resolvedFrom: string;
}

export interface IdentitySource {
  /** DID → DID document → PDS origin. did:plc via ORIGINS.plcDirectory; did:web via `https://<host>/.well-known/did.json`. */
  resolveIdentity(request: SelfRequest): Promise<Result<ResolvedIdentity>>;
}

export interface RepoRequest extends SelfRequest {
  /** Must be the `pdsOrigin` returned by `resolveIdentity` for this DID. */
  readonly pdsOrigin: HttpsOrigin;
}

export interface RepoDescription {
  readonly did: Did;
  /** Handle as reported by the PDS; null when missing or syntactically invalid. */
  readonly handle: Handle | null;
  /** PDS attestation that the handle resolves back to the DID. */
  readonly handleIsCorrect: boolean;
  /** Advertised collections that are valid NSIDs, de-duplicated, sorted ascending. */
  readonly collections: readonly Nsid[];
  /** Advertised strings that were not valid NSIDs (count only; never shown raw as HTML). */
  readonly invalidCollectionCount: number;
}

export interface ListProgress {
  readonly collection: Nsid;
  /** 1-based index of the page just processed. */
  readonly page: number;
  readonly maxPages: number;
  readonly acceptedSoFar: number;
}

export interface ListCollectionRequest extends RepoRequest {
  readonly collection: Nsid;
  /** listRecords `limit` (1–100). Use the registry's `pageSize`. */
  readonly pageSize: number;
  /** Page cap (1–LIMITS.maxPagesPerCollection). */
  readonly maxPages: number;
  /** Called synchronously after each processed page; never called after abort. */
  readonly onProgress: ((progress: ListProgress) => void) | null;
}

/** Result of reading one collection. Always produced, even on failure: failure is expressed in `coverage`. */
export interface CollectionRead {
  /** Accepted records, unique by URI, in server order (newest first by default). */
  readonly records: readonly RawRecord[];
  /** Every item rejected at the fetch stage, with a reason. */
  readonly rejected: readonly SkippedRecord[];
  readonly coverage: Coverage;
}

export interface RepoSource {
  describeRepo(request: RepoRequest): Promise<Result<RepoDescription>>;
  /**
   * Bounded, sequential, cursor-paginated read of one collection.
   * Never resolves with a thrown failure: every non-abort problem becomes `coverage`.
   * Rejects only with the caller's AbortError.
   */
  listCollection(request: ListCollectionRequest): Promise<CollectionRead>;
}

export interface AtprotoAdapterDeps {
  readonly http: HttpClient;
  readonly clock: Clock;
}

export interface AtprotoAdapter extends IdentitySource, RepoSource {}

export type CreateAtprotoAdapter = (deps: AtprotoAdapterDeps) => AtprotoAdapter;

/** Convenience alias used by consumers that only need the failure type of a read. */
export type RepoFailure = Failure;
