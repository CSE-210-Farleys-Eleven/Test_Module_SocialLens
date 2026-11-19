/** IT-7: the live path with a fake auth service, real modules, and the fixture server standing in for the network. */
import { describe, expect, it } from 'vitest';
import { compose, fakeAuth, memoryStore } from './harness';
import { createFixtures, DEMO_ACCOUNT } from '../../src/adapters/fixtures';
import { STORAGE_KEYS, parseDid, systemClock } from '../../src/shared';

describe('IT-7 live path', () => {
  it('loads the session account as live data, persists no token, and clears on session end', async () => {
    const fixtures = createFixtures();
    const server = fixtures.createServer('complete', null);
    const did = parseDid(DEMO_ACCOUNT.did)!;
    const auth = fakeAuth(did);
    const storage = memoryStore();
    const app = compose({ fetch: server.fetch, auth, storage, clock: { now: () => fixtures.now, nowMs: systemClock.nowMs } });

    await app.actions.start();
    const state = app.store.getState();
    expect(state.mode).toBe('live');
    expect(state.activeDid).toBe(did);
    expect(state.snapshot?.mode).toBe('live');
    expect(state.snapshot?.records).toHaveLength(214);
    expect(state.snapshot?.notices.map((n) => n.code)).not.toContain('demo-synthetic');
    expect(state.snapshot?.notices.map((n) => n.code)).toContain('non-atomic-read');
    expect(state.analysis.status).toBe('ready');
    expect(state.accounts.map((a) => a.did)).toEqual([did]);
    expect(app.lastDemoServer()).toBeNull();

    // Only the app's own key is written, and it holds identity data only.
    expect([...storage.data.keys()]).toEqual([STORAGE_KEYS.accounts]);
    const stored = storage.data.get(STORAGE_KEYS.accounts) ?? '';
    expect(stored).toContain(did);
    expect(stored).not.toMatch(/token|dpop|refresh|secret|jwk|password/i);

    // Reads were unauthenticated even though the session is "signed in".
    expect(server.requests().every((r) => r.credentials === 'omit' && !r.hadAuthorization)).toBe(true);

    auth.end({ did, reason: 'expired' });
    const ended = app.store.getState();
    expect(ended.snapshot).toBeNull();
    expect(ended.analysis.result).toBeNull();
    expect(ended.accounts.find((a) => a.did === did)?.status).toBe('needs-sign-in');
  });

  it('refuses to run a live load when sign-in is unavailable', async () => {
    const app = compose({ auth: null });
    await app.actions.start();
    const state = app.store.getState();
    expect(state.auth.status).toBe('unavailable');
    expect(state.mode).toBe('none');
    expect(state.snapshot).toBeNull();
  });
});
