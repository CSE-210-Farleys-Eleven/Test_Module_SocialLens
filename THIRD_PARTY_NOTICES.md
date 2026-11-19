# Third-party notices

SocialLens mini MVP has one runtime dependency and adapts small pieces of permissively licensed code. No GPL or AGPL code was copied; Clearsky, ClearskyUI, Constellation and WhiteWind were used as references only and are neither called nor vendored.

## Runtime dependency

| Package | Licence | Use |
|---|---|---|
| [`@atproto/oauth-client-browser`](https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client-browser) 0.5.x (and its transitive dependencies) | MIT OR Apache-2.0 | OAuth sign-in. Imported only by `src/auth/browser-client.ts`. |

## Adapted code

Each file below carries a header comment naming its source.

| File | Adapted from | Licence |
|---|---|---|
| `src/shared/syntax.ts` | bluesky-social/atproto, `packages/syntax/src/{did,handle,nsid,recordkey,aturi_validation}.ts` | MIT OR Apache-2.0 |
| `src/shared/time.ts` | bluesky-social/atproto, `packages/syntax/src/datetime.ts`, `packages/common-web/src/{tid,util}.ts` | MIT OR Apache-2.0 |
| `src/adapters/atproto/identity.ts` | bluesky-social/atproto, `packages/common-web/src/did-doc.ts`, `packages/identity/src/did/web-resolver.ts` | MIT OR Apache-2.0 |
| `src/adapters/fixtures/generator.ts` (TID encoder) | bluesky-social/atproto, `packages/common-web/src/{tid,util}.ts` | MIT OR Apache-2.0 |

Copyright (c) 2022-2026 Bluesky Social PBC, and Contributors. The full licence texts are in the upstream repository (`LICENSE-MIT.txt`, `LICENSE-APACHE.txt`).

## Design ideas, no code copied

| File | Idea from | Licence |
|---|---|---|
| `src/analytics/worker/handler.ts` | notjuliet/pdsls, `src/workers/plc-validate.ts` (plain data in, plain result out) | 0BSD |
| `src/adapters/fixtures/server.ts` | bluesky-social/social-app, `src/state/session/__tests__/mock-fetch.ts` (routed fetch mock) | MIT |

Several modules also port ideas from this project's own earlier prototype (`CSE-210-Farleys-Eleven/SocialLens`).
