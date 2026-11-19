/**
 * M1 `auth/` — FROZEN CONTRACT.
 * AT Protocol OAuth sign-in whose ONLY purpose is to prove "this DID is me".
 * Scope `atproto` only. Tokens are stored by the OAuth library, never by this app.
 * Types only.
 */
import type { Did, Failure, Result, SessionRef, SourceId, Unsubscribe } from '../shared/contract';

export type OAuthClientKind =
  | 'loopback' // local development: client_id on http://localhost, app served from http://127.0.0.1:<port>
  | 'hosted'; // production: client_id is an https URL serving client-metadata.json

export interface AuthConfig {
  readonly clientKind: OAuthClientKind;
  /** Required for 'hosted' (https URL of the client metadata); must be null for 'loopback'. */
  readonly clientId: string | null;
  /** XRPC service the OAuth library uses to resolve the typed handle (ORIGINS.oauthHandleResolver by default). */
  readonly handleResolver: string;
  /** The literal 'atproto'. Any other value is a contract violation. */
  readonly scope: 'atproto';
}

/** What the sign-in UI must tell the person before they type a handle. Plain data. */
export interface AuthDisclosure {
  readonly scope: 'atproto';
  readonly clientKind: OAuthClientKind;
  readonly handleResolverOrigin: string;
  /** True when the resolver is operated by someone other than the user's own PDS (always true in the MVP). */
  readonly handleResolverIsThirdParty: boolean;
  /** Ready-to-render sentence naming the resolver and what it learns (IP address + handle). */
  readonly resolverNotice: string;
  /** Ready-to-render sentence: tokens are kept in this browser's IndexedDB by the OAuth library. */
  readonly storageNotice: string;
  readonly source: SourceId;
}

export type SessionEndReason =
  | 'signed-out' // this app called signOut
  | 'expired' // refresh failed or the session cap was reached: re-authentication is normal
  | 'revoked'
  | 'invalid'
  | 'unknown';

export interface SessionEndedEvent {
  readonly did: Did;
  readonly reason: SessionEndReason;
}

export interface AuthInitResult {
  /** The active session after start-up, or null when signed out. */
  readonly session: SessionRef | null;
  /** How it was obtained: an OAuth redirect just completed, a stored session was restored, or neither. */
  readonly via: 'callback' | 'restore' | 'none';
  /**
   * Non-null (with `session: null`) when a restore or callback was attempted and did not yield a session
   * (expired session, sign-in denied, …). This is a normal signed-out outcome, not a broken client.
   */
  readonly problem: Failure | null;
}

export interface AuthService {
  readonly disclosure: AuthDisclosure;
  /**
   * Process an OAuth callback if the URL carries one, else restore the last active session. Call once at start-up.
   * err ONLY when the OAuth client itself could not be created (unsupported browser, bad configuration).
   */
  init(): Promise<Result<AuthInitResult>>;
  /**
   * Validate `handle` (syntax only), then start the redirect flow. On success the page navigates away,
   * so the promise normally never resolves ok; it resolves err on invalid input ('validation', no I/O)
   * or when the flow could not start / the person came back without finishing ('auth').
   */
  signIn(handle: string): Promise<Result<null>>;
  /** Make a previously signed-in account the active session (multi-account). */
  restore(did: Did): Promise<Result<SessionRef>>;
  /** Revoke and delete the stored session for `did`. Resolves ok even when remote revocation failed but local deletion succeeded. */
  signOut(did: Did): Promise<Result<null>>;
  /** Fires whenever a stored session becomes unusable (including after signOut, and from other tabs). */
  onSessionEnded(listener: (event: SessionEndedEvent) => void): Unsubscribe;
}

// ── the seam to @atproto/oauth-client-browser (so unit tests never load the real library) ──

export interface OAuthSessionLike {
  /** The authenticated account DID. */
  readonly sub: string;
}

export interface OAuthInitLike {
  readonly session: OAuthSessionLike;
  /** Present (string or null) only when an OAuth callback was just processed. */
  readonly state?: string | null;
}

/** The subset of `BrowserOAuthClient` (0.5.x) this module uses. */
export interface OAuthClientLike {
  init(): Promise<OAuthInitLike | undefined>;
  signIn(input: string): Promise<unknown>;
  restore(sub: string): Promise<OAuthSessionLike>;
  revoke(sub: string): Promise<void>;
}

export interface OAuthClientHooks {
  /**
   * Wired to the library's `onSessionDeleted` constructor option. The client factory classifies the
   * library's error object into a reason (it is the only code that can see the library's error classes).
   */
  onSessionDeleted(sub: string, reason: Exclude<SessionEndReason, 'signed-out'>): void;
}

/** Pure: map the library's `onSessionDeleted` cause to a reason, given the library's three error constructors. */
export type ClassifySessionEnd = (
  cause: unknown,
  classes: {
    readonly TokenRefreshError: abstract new (...args: never[]) => unknown;
    readonly TokenRevokedError: abstract new (...args: never[]) => unknown;
    readonly TokenInvalidError: abstract new (...args: never[]) => unknown;
  },
) => Exclude<SessionEndReason, 'signed-out'>;

/** Builds the real (or a fake) OAuth client. The real one is exported as `createBrowserOAuthClient`. */
export type CreateOAuthClient = (config: AuthConfig, hooks: OAuthClientHooks) => Promise<OAuthClientLike>;

export interface AuthDeps {
  readonly config: AuthConfig;
  readonly createClient: CreateOAuthClient;
}

export type CreateAuth = (deps: AuthDeps) => AuthService;

/** Pure: derive the config for the current page (loopback when served from a loopback IP, else hosted). */
export type ResolveAuthConfig = (location: { readonly hostname: string; readonly origin: string }, hostedClientId: string | null) => Result<AuthConfig>;
