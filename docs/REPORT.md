# Build report: SocialLens mini MVP

Date: 2026-11-18. Branch: `poc/mini-mvp` (local only, not pushed). Plan: [architecture/PLAN.md](architecture/PLAN.md).

## Result

All 14 modules are implemented against their frozen contracts and compose into one working app. The synthetic demo runs end to end in a browser. The real sign-in was taken as far as the provider's login page; **completing sign-in with a real account has not been done** and is the remaining check (see the README).

## Test results

`npm run check` on 2026-11-18: typecheck exit 0; **57 test files, 1,028 tests passed, 0 failed, 0 skipped**; production build succeeded.

| Module | Path | Test files | Tests | Written test-first? | Built with |
|---|---|---:|---:|---|---|
| M8 shared | `src/shared/` | 7 | 224 | yes | Opus |
| M1 auth | `src/auth/` | 3 | 49 | yes | Opus |
| M2 accounts | `src/accounts/` | 2 | 37 | **no** | Sonnet |
| M3 registry | `src/registry/` | 1 | 18 | yes | Sonnet |
| M4a atproto adapter | `src/adapters/atproto/` | 2 | 53 | yes | Opus |
| M4b bluesky adapter | `src/adapters/bluesky/` | 1 | 49 | yes | Sonnet |
| M4c fixtures | `src/adapters/fixtures/` | 3 | 63 | yes | Opus |
| M5 normalize | `src/normalize/` | 2 | 43 | **no** | Sonnet |
| M6 analytics | `src/analytics/` | 6 | 66 | yes | Opus |
| M6a privacy | `src/analytics/privacy/` | 2 | 57 | yes | Opus |
| M6b worker | `src/analytics/worker/` | 4 | 40 | yes | Sonnet |
| M6c state | `src/analytics/state/` | 4 | 96 | yes | Opus |
| M7b components | `src/ui/components/` | 6 | 69 | yes | Sonnet |
| M7a views | `src/ui/views/` | 8 | 124 | yes | Opus |
| Integration | `tests/integration/` | 5 | 25 | written after the modules | orchestrator |
| Architecture | `tests/architecture/` | 1 | 15 | written after the modules | orchestrator |
| **Total** | | **57** | **1,028** | | |

Honest notes on the process:

- **`accounts` and `normalize` were not test-first.** Their agents wrote the implementation before the tests and said so. Their tests pass and follow the contract's test plan, but they never failed against missing behaviour. Both are exercised by the integration tests.
- "Test-first" for the others means the tests were written from the contract's test plan and failed before the implementation existed. Only `privacy` and `auth` also ran deliberate-break checks.
- The architecture plan and contracts were written by one Fable agent; each module by one Opus or Sonnet agent that saw only the plan, its contract and `shared/`. The modules composed on the first wiring with no contract change.
- One change was made at integration, test-first: coverage reasons in `analytics/certainty.ts` now name their collection and are de-duplicated (found on a real account, where three identical sentences ran together).

## What was verified outside unit tests

| Check | How | Result |
|---|---|---|
| Demo, all five views, three scenarios | Dev server in a browser | Works; no console errors |
| Analysis in a real Web Worker | Accounts view in the browser | "analysis ran in a background worker in 24 ms" |
| OAuth loopback client accepted by a real authorization server | Typed the public handle `bsky.app`, pressed Sign in | Redirected to `bsky.social/oauth/authorize` with `client_id=http://localhost?redirect_uri=http://127.0.0.1:5173/`; no credentials were entered |
| Returning from the provider without signing in | Pressed Cancel on the provider page | Back on the app, signed out, URL clean |
| CORS from `http://127.0.0.1:5173` with the app's exact request options | `fetch` in the page to `plc.directory`, a Bluesky-hosted PDS (`describeRepo`, `listRecords`) and `public.api.bsky.app` (`getPosts`) | All 200 |
| The whole read path on real response shapes | One-off Node run of the composed app with a fake session for the public official `bsky.app` account (script not committed) | 81 requests, all 200, 3,207 records, 0 skipped, 8.9 s; three collections hit the 1,000-record cap and were labelled partial |
| Production build | `npm run build` | Succeeds; the OAuth library and the worker are separate chunks |

**Not verified:**

- Completing OAuth with a real account: the callback, session restore after reload, sign-out, session expiry.
- A self-hosted PDS, a `did:web` account, or a PDS that sends no CORS headers.
- AppView rate limits; Standard.site documents on a real account (the probe account has none).
- Accessibility with a screen reader; only DOM structure is tested.
- The CI workflow has never run (nothing is pushed).

The `bsky.app` probe analysed an account that is not the user's own. It was a one-off developer check of response shapes on a public organisational account, done through a fake session in a throwaway script; the app itself has no way to do this.

## Deviations from the proposed architecture

The module tree was followed as drawn. Differences:

1. **Three root files, not one.** `src/main.ts` (page), `src/worker-main.ts` (worker entry) and `src/compose.ts` (the wiring, shared with the integration tests). The plan named two; `compose.ts` was added so tests run the same wiring as the app.
2. **The load controller lives in `analytics/state/`.** The tree has no application layer, so orchestration sits beside the store.
3. **No writes.** `adapters/atproto/` is read-only; the tree's "writes" is not implemented.
4. **Failures are plain data** (`Result` / `Failure`), not error classes, so they cross the Worker boundary.
5. **Handle validity is attested by the user's PDS** (`describeRepo.handleIsCorrect` plus the DID document), not resolved independently. The UI says "checked by your PDS".
6. **Origin policy replaces prototype ADR-005.** Fixed origins (`public.api.bsky.app`, `plc.directory`) plus origins derived from the signed-in DID's own document. Self-hosted PDSs and hostname `did:web` are accepted.
7. **Four counters** (likes, reposts, replies, quotes); a post is "known" only when all four are observed.
8. **The linked-accounts list is persisted** (DID, handle, PDS origin, no tokens) in one `localStorage` key.
9. **The phrase "engagement rate" appears in two source files** (`shared/glossary.ts`, `ui/views/engagement.ts`), only to say the metric is not shown. The hygiene test allowlists exactly those two.

Per-module deviations from contract wording are in each module's commit message.

## Open points for issue #3

1. **Where does `state/` belong?** It is application state plus the controller, neither of which is analytics. Proposal: top-level `state/` or `app/`. Only `ui/views` and the root files import it.
2. **Remove "writes" from the tree**, or decide scope and privacy for a specific write feature first.
3. **Linked accounts:** ship multi-account in the first sprint? Is persisting the DID list acceptable under "no persistence"?
4. **Worker:** is it needed? Analysis took 24 ms in the worker on the demo and about 5 ms for 10,000 synthetic records on the main thread (one run each). Measure on a large real account before keeping the complexity.
5. **Origin policy:** accept the widened policy (CSP `connect-src https:`), or restrict the first release to Bluesky-hosted PDSs behind a default-OFF flag?
6. **Independent handle verification** (DNS-over-HTTPS + well-known) later, and with which disclosed third party?
7. **Page cap of 10 (1,000 records per collection).** Heavy accounts are cut: on the probe account posts, likes and list items were all capped. Raise the cap, read concurrently, or read the whole repo as a CAR file?
8. **Range-aware exactness.** A 30-day count is labelled "At least" whenever the collection was capped, even though the cap only drops the oldest records. Fixable inside `analytics/`.
9. **`cursor: null`** from a non-reference PDS is treated as a failed page. Tolerate it?
10. **The 36-hour "settling" threshold** is borrowed from X. Is there a better-grounded value?
11. **A throwing demo factory** only logs to the console; decide whether it needs a notice.
12. **Dependency risk:** `npm audit` reports 15 high-severity entries, all one transitive `zod` advisory (memory exhaustion on oversized input, GHSA-mrhx-c7xc-m3w5) under `@atproto/oauth-client-browser`, no fix available. Low impact today: it runs in the user's own browser on OAuth metadata. Track upstream.
13. **Licence for SocialLens itself** is not chosen.
14. **Doc fix:** GLOSSARY's example "62% of 54 dated items" is arithmetically impossible (61% or 63%).
15. **User study (issue #7):** test whether people understand the status labels and the observation wording.
16. **Production hosting:** publish `client-metadata.json`, set `VITE_OAUTH_CLIENT_ID`, apply the CSP in PLAN §9.
