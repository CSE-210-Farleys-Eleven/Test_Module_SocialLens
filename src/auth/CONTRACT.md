# M1 `auth/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md).

## Purpose
Sign the person in with AT Protocol OAuth so the app knows which DID is "me" — and nothing else. No data is read with the session; public reads are unauthenticated.

## Contribution to the whole
The DID this module returns (`SessionRef.did`, the OAuth `session.sub`) is the root of the self-only guarantee: every read elsewhere is checked against it. This module also owns the two honest disclosures at sign-in (which service resolves the handle, where tokens live) and turns session expiry into an ordinary "signed out" event instead of an error.

## What to optimise for (ranked)
1. **Least privilege and no home-grown security** — scope `atproto` only; the official library does PKCE/PAR/DPoP and owns token storage.
2. **Truthful session state** — a session that ended is reported once, promptly, with a reason.
3. Small seam — everything testable without loading the real library.

## Public API (`src/auth/index.ts`)
```ts
export const createAuth: CreateAuth;                         // ({ config, createClient }) => AuthService
export const resolveAuthConfig: ResolveAuthConfig;           // (location, hostedClientId) => Result<AuthConfig>
export const createBrowserOAuthClient: CreateOAuthClient;    // the real client factory (dynamic import)
export const classifySessionEnd: ClassifySessionEnd;         // pure helper used by the real factory
```

- **`resolveAuthConfig(location, hostedClientId)`** — hostname `127.0.0.1`, `[::1]` or `localhost` → `ok({ clientKind: 'loopback', clientId: null, handleResolver: ORIGINS.oauthHandleResolver, scope: 'atproto' })` (on `localhost` the library itself redirects to `127.0.0.1`). Otherwise, `hostedClientId` that is an `https:` URL → `ok({ clientKind: 'hosted', clientId, … })`. Otherwise `err('unsupported', 'Live sign-in is not configured for this site.')`.
- **`createBrowserOAuthClient(config, hooks)`** — `const lib = await import('@atproto/oauth-client-browser')` (**dynamic**, so tests and the demo never load it). `onSessionDeleted: (sub, cause) => hooks.onSessionDeleted(sub, classifySessionEnd(cause, lib))`. Loopback → `new lib.BrowserOAuthClient({ handleResolver: config.handleResolver, onSessionDeleted })` (no `clientMetadata`: the library builds the loopback client id `http://localhost?redirect_uri=http://127.0.0.1:<port>/…` from `window.location`, scope defaults to `atproto`). Hosted → `lib.BrowserOAuthClient.load({ clientId: config.clientId, handleResolver, onSessionDeleted })`. Never pass a `scope`, `responseMode` or `fetch` override. This file contains no other logic.
- **`classifySessionEnd(cause, classes)`** — `instanceof TokenRefreshError` → `'expired'`; `TokenRevokedError` → `'revoked'`; `TokenInvalidError` → `'invalid'`; else `'unknown'`.
- **`createAuth({ config, createClient })`** → `AuthService`. The client is created lazily on first use and memoised (one `createClient` call; a rejected creation is not cached, so a later call may retry).

| Method | Behaviour |
|---|---|
| `disclosure` | Available immediately (no client needed). `scope: 'atproto'`; `clientKind`; `handleResolverOrigin` = origin of `config.handleResolver`; `handleResolverIsThirdParty: true`; `resolverNotice`: "To find your account, your handle and this device's IP address are sent to {host}, which looks up handles for sign-in."; `storageNotice`: "Sign-in tokens are kept in this browser by the official AT Protocol OAuth library. SocialLens requests only the identity scope: it cannot post, edit, delete or read private data."; `source: 'oauth-client-browser-readme'`. |
| `init()` | Client creation throws → `err('auth', 'Sign-in is not available in this browser.')`. `client.init()` returns `undefined` → `ok({ session: null, via: 'none', problem: null })`. Returns a session: `parseDid(session.sub)`; null → `ok({ session: null, via: 'none', problem: failure('unsupported', 'This account identifier is not supported.') })`; else `ok({ session: { did, source: 'oauth' }, via: 'state' in result ? 'callback' : 'restore', problem: null })`. `client.init()` throws → `ok({ session: null, via: 'none', problem: failure('auth', 'Your earlier sign-in could not be restored or completed. Sign in again to continue.') })`. A second `init()` call returns the first call's promise. |
| `signIn(handle)` | Trim; remove one leading `@`; `parseHandle`; invalid → `err('validation', 'Enter your handle, such as name.example.com — not a password, an email address or a URL.')` **without creating or calling the client**. Else `await client.signIn(handle)`: rejection → `err('auth', 'Sign-in was cancelled or could not be started.')`; resolution → `ok(null)`. Only a handle is accepted (not a DID, not a PDS URL). |
| `restore(did)` | `await client.restore(did)`; `session.sub === did` → `ok({ did, source: 'oauth' })`; mismatch or rejection → `err('auth', 'This account needs to sign in again.')`. |
| `signOut(did)` | Mark `did` as signing out; `await client.revoke(did)` (a rejection is ignored: the library deletes the local session in a `finally`); emit exactly one `SessionEndedEvent { did, reason: 'signed-out' }`; `ok(null)`. `err('auth')` only if the client cannot be created. |
| `onSessionEnded(listener)` | Listeners receive: `signed-out` from `signOut`, and the hook's reason for every `hooks.onSessionDeleted(sub, reason)` whose `sub` parses as a DID. **At most one event per DID until that DID is next returned by `init` or `restore`** (the library also fires its hook during `signOut`; that duplicate is suppressed). A throwing listener does not affect the others. |

## Data received / sent
Receives: a typed handle; a DID to restore or sign out; library callbacks. Sends: `SessionRef` (DID only — never a token, never the library's session object), `AuthDisclosure`, `SessionEndedEvent`.

## Error behaviour
Every method resolves a `Result`; none rejects. Library errors are mapped to `kind: 'auth'` with fixed, plain messages — the library's error text, tokens, `state` values and URLs are never copied into a `Failure`, logged, or put in a URL.

## Invariants this module must enforce
- Scope is the literal `atproto`; there is no code path that requests `transition:generic` or any other scope.
- No app password, no password field, no credential ever passes through this module.
- Tokens are never read, stored, logged or returned; `localStorage`/IndexedDB are never touched directly (the library owns them).
- `SessionRef.source` is always `'oauth'` here; `did` is always a `parseDid`-validated value equal to the library's `session.sub`.
- `signIn` with invalid input performs no I/O.
- The real library is loaded only via the dynamic import in `createBrowserOAuthClient`.

## Out of scope
Reading or writing records with the session (`session.fetchHandler` is never used); popup sign-in; listing stored sessions (the library cannot; `accounts/` tracks DIDs); handle resolution or verification (`accounts/`); production client-metadata hosting and its contents (a deploy task — the hosted JSON must declare `"scope": "atproto"`); token refresh logic (library); server-side OAuth.

## Dependencies
Types: `shared/contract`. Runtime: `shared` (`parseDid`, `parseHandle`, `makeFailure`, `ok`, `err`, `ORIGINS`) and `@atproto/oauth-client-browser` (0.5.x, MIT) — dynamic import in one file only. No other module.

## File layout
```
src/auth/
  contract.ts            (frozen)
  index.ts               exports (must NOT statically import the OAuth library)
  auth.ts                createAuth
  config.ts              resolveAuthConfig
  classify.ts            classifySessionEnd
  browser-client.ts      createBrowserOAuthClient (the only file that imports the library)
  auth.test.ts
  config.test.ts
  classify.test.ts
```
`browser-client.ts` is exercised by the manual live check in PLAN.md §9, not by unit tests (it needs a real browser, IndexedDB and a redirect).

## Test plan (write these first)
Fake `createClient` returns a scripted `OAuthClientLike` and captures the hooks.

**config**
- `127.0.0.1`, `[::1]` and `localhost` → loopback config with `clientId: null`, scope `atproto`, resolver `https://bsky.social`.
- another host with an https `hostedClientId` → hosted config.
- another host with null, `http://…` or a non-URL client id → `err('unsupported')`.

**disclosure**
- names the resolver host, says IP address and handle are sent, and is available before `init`.
- `scope` is `atproto`; `handleResolverIsThirdParty` is true.

**init**
- client returns `undefined` → `session: null`, `via: 'none'`, `problem: null`.
- client returns `{ session }` → `via: 'restore'`, `SessionRef.source === 'oauth'`, DID equals `sub`.
- client returns `{ session, state: null }` → `via: 'callback'`.
- `sub` is `did:key:…` → `session: null` with an `unsupported` problem.
- `client.init()` rejects → `ok` with `session: null` and an `auth` problem (not `err`).
- `createClient` rejects → `err('auth')`.
- two `init()` calls → `createClient` and `client.init` each called once.

**signIn**
- `'@Alice.Example.com '` → client receives `alice.example.com`.
- a password-like string, an email address, a URL, a DID, an empty string → `err('validation')` and `createClient` was never called.
- client rejects → `err('auth')`; the failure message does not contain the rejection's message.
- no `scope` or other option is passed to `client.signIn` (assert the call arguments).

**restore / signOut**
- restore returns the session for the same DID → ok; a different `sub` → `err('auth')`; rejection → `err('auth')`.
- signOut calls `revoke(did)` and resolves ok even when `revoke` rejects.
- signOut emits exactly one `signed-out` event; a hook call for the same DID during or after it emits nothing more.

**session-ended events**
- hook with reason `expired` → listeners get `{ did, reason: 'expired' }`.
- two hook calls for the same DID → one event; after `restore(did)` succeeds, a new hook call emits again.
- hook with an unparseable `sub` → no event.
- unsubscribe stops delivery; a throwing listener does not stop the next one.

**classify**
- instances of the three fake classes map to `expired`, `revoked`, `invalid`; a plain `Error`, a string and `undefined` map to `unknown`.

**hygiene**
- `index.ts` and `auth.ts` contain no static import of `@atproto/oauth-client-browser` (read the source text in a test, or assert the module graph).
- no returned object contains a property named like a token (`access_token`, `refresh_token`, `dpopKey`).

## Hints and reuse
- Research: `SocialLens/docs/research/modules/auth.md` — reuse `@atproto/oauth-client-browser`; request only `atproto`; treat re-authentication after the public-client session cap (2 weeks; about 1 day for loopback clients) as normal, not an error; wire session deletion to the signed-out state; local dev uses `client_id` on `http://localhost` with the app served from `127.0.0.1`; never app passwords, never `transition:generic`, never write tokens to `localStorage` yourself; disclose `bsky.social` as handle resolver.
- **Verified against the installed 0.5.15** (`node_modules/@atproto/oauth-client/dist/session-getter.d.ts`, and `atproto/packages/oauth/oauth-client-browser/src/browser-oauth-client.ts`): session invalidation is delivered through the **`onSessionDeleted(sub, cause)` constructor option**, not `client.addEventListener('deleted', …)` as the package README and the research note still say. `BrowserOAuthClient` is structurally assignable to `OAuthClientLike` (checked with `tsc`). `signIn` in redirect mode never resolves; it rejects after ~5 s if the person navigates back. `revoke(sub)` deletes the local session even if the remote call fails.
- Loopback rules: `atproto/packages/oauth/oauth-client-browser/src/util.ts` (`buildLoopbackClientId`) and `README.md` § "Using in development (localhost)" — origin must be `http://127.0.0.1:<port>` (the repo's Vite config fixes port 5173). Licence **MIT**; no code needs copying.
- Prototype equivalent: `SocialLens/src/adapters/auth.ts` and `SocialLens/integrations/oauth/` (never verified live — issue #4).
- Not reused: `BS/social-app` (password sessions, no OAuth) and `BS/bsky-analytics-app` (app password — forbidden here).
