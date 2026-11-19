# M2 `accounts/` — contract

Frozen types: [`contract.ts`](contract.ts). Plan: [`docs/architecture/PLAN.md`](../../docs/architecture/PLAN.md).

## Purpose
Keep the list of accounts the person has proved they own by signing in, keyed by DID, each with its PDS and a checked handle.

## Contribution to the whole
`verify` is the gate between "the OAuth library says this DID signed in" and "we know where this account's repository is and what to call it". Its `AccountIdentity` is what every later read and every view uses. The list is what makes switching between several of the person's own accounts possible, and "remove" is where the app says precisely what it deletes: local data only.

## What to optimise for (ranked)
1. **Ownership integrity** — an account can enter the list only through a session for that same DID.
2. **Honest handle status** — `valid`, `invalid` or `unverified`, never assumed.
3. Robust local storage — corrupt or unavailable storage degrades to memory, never crashes.

## Public API (`src/accounts/index.ts`)
```ts
export const createAccounts: CreateAccounts;   // ({ identity, repo, storage, clock }) => AccountsService
```

### Creation
If `storage` is non-null, read `STORAGE_KEYS.accounts`. Missing → empty list. Unparseable JSON, wrong `version`, or `getItem` throwing → empty list and `storageFailure()` = `storage` failure ("Saved accounts could not be read; the list starts empty on this browser."). Each stored entry is re-validated (`parseDid`, `parseHandle`, `parseHttpsOrigin`, `parseIsoDateTime`); invalid entries are dropped. **Every loaded account starts as `status: 'needs-sign-in'`** (a session has not been seen yet in this page load) with `lastFailure: null`.

### `verify({ session, signal })`
1. `did = session.did`. (There is no other target parameter — self-only by construction.)
2. `resolved = await identity.resolveIdentity({ session, did, signal })`. On `err`: upsert `{ status: 'could-not-verify', lastFailure, pdsOrigin/handle/handleStatus: previous values or null/null/'unverified' }` and return the `err`.
3. `described = await repo.describeRepo({ session, did, pdsOrigin: resolved.pdsOrigin, signal })`.
4. Handle and status:
   - describeRepo ok → `handle = described.handle ?? resolved.claimedHandle`; `handleCheck: 'pds-attested'`; `handleStatus = 'valid'` iff `described.handle !== null` **and** `described.handleIsCorrect` **and** `resolved.claimedHandle === described.handle` **and** the handle is not `handle.invalid`; otherwise `'invalid'`.
   - describeRepo failed → `handle = resolved.claimedHandle`; `handleStatus: 'unverified'`; `handleCheck: 'none'`; `repo: null`, `repoFailure` = the failure. Verification still succeeds (the PDS is known).
5. `identity = { did, didMethod, handle, handleStatus, handleCheck, pdsOrigin, verifiedAt: clock.now() }`. Upsert `{ …, status: 'verified', verifiedAt, addedAt: existing ?? now, lastFailure: null }`, keeping list position.
6. Persist — unless `storage` is null **or** `session.source === 'demo'` (demo accounts are never written anywhere).
7. Abort at any point → reject with the abort reason; the list and storage are unchanged.

### Other methods
- `list()` / `get(did)` — the in-memory list (returns a new array each call; entries are immutable).
- `markNeedsSignIn(did)` — set `status: 'needs-sign-in'`, keep the rest; persist; unknown DID → no-op.
- `remove(did)` → `{ did, removed, scope: 'local-only' }`; persist (an empty list removes the storage key).
- `clear()` — empty the list and remove the storage key.
- `storageFailure()` — last storage problem or null. A `setItem`/`removeItem` that throws sets it and is otherwise ignored.

Stored shape: `StoredAccountsV1` — `lastFailure` is never written; no token, no record, no analytics result is ever written.

## Data received / sent
Receives: `SessionRef`; `ResolvedIdentity` and `RepoDescription` from the injected ports. Sends: `VerifiedAccount` (`AccountIdentity` + the reusable `RepoDescription`), `LinkedAccount[]`, `RemovalReceipt`.

## Error behaviour
`verify` resolves a `Result` and rejects only on abort. Synchronous methods never throw, including when storage throws.

## Invariants this module must enforce
- I-1 / open point 4: the only way to add or verify an account is a `SessionRef`; the account's DID is always `session.did`. No method takes a handle.
- Linked account = account the person signed in to. Nothing else can appear in the list (stored entries are DIDs previously added the same way).
- `remove` and `clear` are local-only and say so (`scope: 'local-only'`); they perform no network request.
- Demo isolation: a `demo` session is never persisted.
- A handle is a label: lookups and identity are by DID only; two accounts can never be merged by handle.
- `handleStatus: 'valid'` requires both directions (DID document claims it; PDS attests it resolves back).

## Out of scope
Signing in/out (that is `auth/`); independent handle verification by DNS-over-HTTPS or `/.well-known/atproto-did` (not in the MVP — the status relies on the PDS's own check and is labelled as such); handle history; profile display name or avatar (no profile fetch); linking accounts the person cannot sign in to; syncing the list between browsers; an edge proxy for did:web CORS failures (shown as "could not verify").

## Dependencies
Types: `shared/contract`, `adapters/atproto/contract` (`IdentitySource`, `RepoSource`, `RepoDescription`). Runtime: `shared` (parsers, `STORAGE_KEYS`, `makeFailure`, `ok`, `err`). Ports are injected; tests use fakes and an in-memory `KeyValueStore`.

## File layout
```
src/accounts/
  contract.ts         (frozen)
  index.ts            createAccounts
  accounts.ts         service
  storage.ts          load / save / validate StoredAccountsV1
  accounts.test.ts
  storage.test.ts
```

## Test plan (write these first)
**verify**
- happy path: returns identity with `handleStatus: 'valid'`, `handleCheck: 'pds-attested'`, the resolved PDS origin, `verifiedAt` from the clock; the account is listed as `verified`.
- calls `resolveIdentity` and `describeRepo` with `did === session.did` and the resolved `pdsOrigin`.
- `handleIsCorrect: false` → `'invalid'`.
- DID document claims `a.example`, PDS reports `b.example` → `'invalid'`.
- PDS handle `handle.invalid` → `'invalid'`.
- no `alsoKnownAs` handle but the PDS reports a correct handle → `'invalid'` (one direction only), handle shown is the PDS's.
- describeRepo fails → ok with `repo: null`, `repoFailure` set, `handleStatus: 'unverified'`, `handleCheck: 'none'`, handle = claimed handle.
- resolveIdentity fails (e.g. `network` for did:web) → `err` with that failure; account listed as `could-not-verify` with `lastFailure`; `describeRepo` not called.
- second verify of the same DID updates in place (no duplicate row, `addedAt` unchanged, position unchanged).
- abort during `resolveIdentity` → rejects; list unchanged; nothing written.
- demo session with a real storage injected → verified in memory, `setItem` never called.

**list management**
- `markNeedsSignIn` changes only the status; unknown DID is a no-op.
- `remove` of a listed DID → `removed: true`, `scope: 'local-only'`, gone from `list()` and from storage; of an unknown DID → `removed: false`.
- `clear` empties the list and removes the storage key.
- `list()` returns a copy (mutating the returned array does not affect the service).

**storage**
- persists `StoredAccountsV1` with `version: 1` and no `lastFailure` field.
- the stored JSON contains only the documented fields (no token-like keys).
- a service created over existing storage lists the accounts as `needs-sign-in`.
- corrupt JSON → empty list and `storageFailure()` of kind `storage`.
- wrong version → empty list with a storage failure.
- an entry with an invalid DID or PDS origin is dropped; the valid ones remain.
- `getItem` throws → empty list, failure set, no exception; `setItem` throws on verify → verify still resolves ok and `storageFailure()` is set.
- `storage: null` → everything works in memory and `storageFailure()` stays null.

## Hints and reuse
- Research: `SocialLens/docs/research/modules/accounts.md` — store `{did, handle, pdsUrl, verifiedAt, handleValid}` keyed on the DID; the handle is a mutable label; verification must be bidirectional; re-check on each session restore; show `handle.invalid` as an observation, not a hard error; a linked account must be one the person signs in to (session DID equals account DID); multi-account builds on `client.restore(did)`; "remove account" means "clears local cache only", and say so; do not assume browser resolution never hits CORS (did:web) — show "could not verify".
- Facts verified: `atproto/lexicons/com/atproto/repo/describeRepo.json` — `handleIsCorrect`: "Indicates if handle is currently valid (resolves bi-directionally)" (**MIT**). This is why the MVP can report handle validity without a DNS-over-HTTPS dependency or a third-party resolver; the cost is trusting the person's own PDS, stated in the UI as "checked by your PDS".
- Reference for the stricter future option (not used): `pdsls/src/lib/api.ts` (0BSD) composes DoH + well-known resolvers from atcute and needs an edge proxy for CORS; `atproto/packages/identity/src/handle/index.ts` (MIT) is Node-oriented.
- The OAuth library cannot list stored sessions (`atproto/packages/oauth/oauth-client-browser/README.md`: "The app will have to keep track of those itself") — that is this module's persisted DID list.
- Prototype: none (single session DID).
