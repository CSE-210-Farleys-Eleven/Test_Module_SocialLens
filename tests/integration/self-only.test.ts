/** IT-6: live reads are only ever for the session DID; anything else is refused before any request. */
import { describe, expect, it } from 'vitest';
import { compose } from './harness';
import { createFixtures, DEMO_ACCOUNT } from '../../src/adapters/fixtures';
import { makeAtUri, parseDid, parseHttpsOrigin, parseNsid, parseRecordKey } from '../../src/shared';
import type { SessionRef } from '../../src/shared/contract';

describe('IT-6 self-only at the adapter boundary', () => {
  const server = createFixtures().createServer('complete', null);
  const app = compose({ fetch: server.fetch });
  const me = parseDid(DEMO_ACCOUNT.did)!;
  const other = parseDid('did:plc:otheraccountotheraccount')!;
  const session: SessionRef = { did: me, source: 'oauth' };
  const origin = parseHttpsOrigin(DEMO_ACCOUNT.pdsOrigin);
  if (!origin.ok) throw new Error('fixture origin must parse');
  const pdsOrigin = origin.value;
  const posts = parseNsid('app.bsky.feed.post')!;
  const signal = new AbortController().signal;

  it('refuses another DID for describeRepo and listRecords with zero requests', async () => {
    const resolved = await app.live.repo.describeRepo({ session, did: other, pdsOrigin, signal });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.failure.kind).toBe('access-denied');

    const read = await app.live.repo.listCollection({ session, did: other, pdsOrigin, collection: posts, pageSize: 100, maxPages: 10, onProgress: null, signal });
    expect(read.records).toHaveLength(0);
    expect(read.coverage.status).toBe('unavailable');
    expect(read.coverage.failure?.kind).toBe('access-denied');

    expect(server.requests()).toHaveLength(0);
  });

  it("never sends another account's post URI to the public API", async () => {
    const foreign = makeAtUri(other, posts, parseRecordKey('3kforeignpost22')!);
    const lookup = await app.live.engagement.getCounts({ session, uris: [foreign], signal, onProgress: null });
    expect(lookup.results).toHaveLength(1);
    expect(lookup.results[0]?.engagement).toMatchObject({ status: 'unknown', reason: 'rejected-not-self' });
    expect(server.requests()).toHaveLength(0);
  });

  it('an unpermitted origin is blocked before fetch even for the right DID', async () => {
    // The PDS origin has not been derived from this DID's document on this client yet.
    const read = await app.live.repo.listCollection({ session, did: me, pdsOrigin, collection: posts, pageSize: 100, maxPages: 1, onProgress: null, signal });
    expect(read.coverage.failure?.kind).toBe('blocked-origin');
    expect(server.requests()).toHaveLength(0);
  });
});
