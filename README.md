# SocialLens mini MVP (proof of concept)

A browser-only, self-only dashboard that reads **your own** public AT Protocol records (Bluesky and Standard.site) and shows activity numbers, interaction counts and privacy observations. No backend, no history store, read-only.

This repository is a proof of concept for the module architecture proposed in SocialLens issue #3. It is not the team's production code.

## What it does

- **Sign in with AT Protocol OAuth** to prove which account is yours. The only scope requested is `atproto`. No app passwords.
- **Reads your public records** straight from your PDS (`com.atproto.repo.listRecords`, 100 per page, up to 10 pages per collection) and public post counters from `public.api.bsky.app` (`app.bsky.feed.getPosts`, 25 posts per call). These reads carry no token and no cookies.
- **Five views:** Overview, Activity, Engagement, Privacy, Accounts.
- **Honest numbers:** a value that could not be read is "Unknown", never 0. Capped reads show "At least N". There is no engagement rate, no impressions, no reach, no follower growth.
- **Privacy observations** about your own records (public likes, follows, blocks you created, lists, shared identity across apps, posting-time pattern, handle validity, incomplete coverage), each with evidence, an official source, a limitation and an action.
- **Synthetic demo** with three scenarios (complete, partial, empty) that runs the same pipeline with no network.

It never looks up another account, never answers "who blocks me", and never calls a network index.

## Requirements

Node.js 22.12 or newer and npm.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open **http://127.0.0.1:5173** (not `localhost`: AT Protocol OAuth requires the loopback IP for local clients, and the port is fixed because it is part of the redirect URI).

### Try the demo first (no account needed)

On the landing page choose **Explore synthetic demo — Complete sample**. A "SYNTHETIC DEMO" banner stays on every view. The Accounts view shows what was read and "analysis ran in a background worker".

### Test with your real Bluesky account

1. Open http://127.0.0.1:5173 and choose **Use my own account** (or the Accounts tab).
2. Read the disclosure: your handle and IP address go to `bsky.social` to look up your account; tokens stay in this browser.
3. Type your handle (for example `yourname.bsky.social`) and press **Sign in with AT Protocol**.
4. Your provider's sign-in page opens. Sign in there. The consent screen should ask only to confirm your identity, with no permission to post or read private data. If it asks for more, stop and report it.
5. You are sent back to `http://127.0.0.1:5173/`. The app verifies the account, reads your collections one by one (progress is shown; Cancel works), then shows the Overview.

What to expect:

| Where | What you should see |
|---|---|
| Banner | No "SYNTHETIC DEMO" banner |
| Accounts | Your handle and DID, your PDS origin, a coverage row for each of 10 collections, "Present, not analysed" for other collections in your repo, and how long reading and analysis took |
| Overview | Content items, active days and records analysed for the chosen date range |
| Activity | Daily timeline, hour and weekday histograms (UTC), streak, week over week |
| Engagement | Interactions per post with its numerator and denominator, top posts, and the list of metrics that are not shown and why |
| Privacy | Observations with sample `at://` URIs from your own repo |

A collection with more than 1,000 records is read up to the 10-page cap and labelled "Partial / At least N". Posts younger than 36 hours are labelled "Settling".

Things worth checking in the browser's DevTools (Network tab):

- Requests to your PDS, `plc.directory` and `public.api.bsky.app` have **no `Authorization` header and no cookies**.
- No request goes anywhere else, apart from the OAuth library's own sign-in traffic.

To finish: Accounts → **Sign out**. The displayed data is cleared. **Remove** forgets the account in this browser only; nothing is deleted from your account.

### If something goes wrong

| Symptom | Cause and fix |
|---|---|
| Blank page or sign-in loops | You opened `localhost:5173`. Use `http://127.0.0.1:5173`. |
| "Port 5173 is in use" | Stop the other process; the port cannot change. |
| A collection shows "Unavailable" | That read failed (network, rate limit, or a PDS that sends no CORS headers). Press **Read again**. |
| Counters "Unknown" | The public API did not answer for those posts. This is shown as unknown on purpose. |

## Tests

```bash
npm run check
```

That runs the typecheck, every test and a production build. Tests use synthetic fixtures only and make no network request.

| Suite | Where | What |
|---|---|---|
| Unit | `src/**/**.test.ts` | Each module against its contract, with fakes for everything it receives |
| Integration | `tests/integration/` | The real modules wired as in the app, over the fixture server: three demo scenarios, cancel, supersede, self-only, the live path with a fake auth service, the UI |
| Architecture | `tests/architecture/` | Module boundaries and hygiene: no cross-module runtime imports, no HTML injection APIs, no writes, scope `atproto` only |

Current counts are in [docs/REPORT.md](docs/REPORT.md).

## How it is organised

One folder per module under `src/`. Each has a `CONTRACT.md` (purpose, API, test plan), a frozen type-only `contract.ts`, the implementation and its tests.

```
src/
├── auth/                 sign-in and sessions (OAuth)
├── accounts/             linked accounts, each verified by DID
├── registry/             supported apps and their collections
├── adapters/
│   ├── atproto/          identity, describeRepo, listRecords
│   ├── bluesky/          public post counters
│   └── fixtures/         synthetic data and a fetch mock
├── normalize/            raw records → one shared model
├── analytics/            activity and engagement calculations
│   ├── privacy/          privacy observations
│   ├── worker/           runs the analysis in a Web Worker
│   └── state/            app state and the load controller
├── ui/
│   ├── views/            Overview · Activity · Engagement · Privacy · Accounts
│   └── components/       cards, charts, tables, status labels
├── shared/               ids, failures, HTTP client, glossary
├── compose.ts            wiring (shared by the app and the integration tests)
├── main.ts               page entry
└── worker-main.ts        worker entry
```

**The module rule:** a module imports runtime code only from itself and `shared/`. From any other module it imports types from that module's `contract.ts`, and receives what it needs by dependency injection. Only the three root files import implementations. `tests/architecture/boundaries.test.ts` enforces this.

Read next: [docs/architecture/PLAN.md](docs/architecture/PLAN.md) (data flow, invariants, security), [docs/architecture/GLOSSARY.md](docs/architecture/GLOSSARY.md) (every metric and observation), [docs/REPORT.md](docs/REPORT.md) (test results, deviations, open points).

## Security and privacy notes

- No secrets exist in this app. `.env*`, key files and OAuth client metadata are git-ignored.
- OAuth tokens are stored by the official library in this browser's IndexedDB. SocialLens code never reads them. The app's own storage is one `localStorage` key holding DID, handle and PDS origin of accounts you signed in to.
- Record content is rendered as text only.
- `npm audit` currently reports a transitive `zod` advisory under the OAuth library with no fix available; see the report.

## Licence

No licence has been chosen for this repository yet (open point for the team). Third-party attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
