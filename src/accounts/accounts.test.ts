import { describe, expect, it } from 'vitest';
import { err, makeFailure, ok, STORAGE_KEYS } from '../shared';
import type { Did } from '../shared';
import { createAccounts } from './index';
import {
  DID_A,
  DID_B,
  PDS,
  demo,
  did,
  fakeClock,
  fakeIdentity,
  fakeRepo,
  memStore,
  oauth,
  origin,
  repoDesc,
  resolved,
} from './fakes';

function setup(opts: { storage?: ReturnType<typeof memStore> | null } = {}) {
  const identity = fakeIdentity();
  const repo = fakeRepo();
  const clock = fakeClock();
  const storage = opts.storage === undefined ? memStore() : opts.storage;
  const svc = createAccounts({ identity, repo, storage, clock });
  const give = (d: Did, claimed: string | null, pds: string | null, correct = true, h?: string | null) => {
    identity.responses.set(d, ok(resolved(d, claimed)));
    repo.responses.set(d, ok(repoDesc(d, h === undefined ? pds : h, correct)));
  };
  return { identity, repo, clock, storage, svc, give };
}
const signal = () => new AbortController().signal;

describe('verify', () => {
  it('happy path: valid, pds-attested, resolved PDS, clock time, listed as verified', async () => {
    const { svc, give, clock } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    clock.set('2026-02-03T04:05:06.000Z');
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.identity).toMatchObject({
      did: DID_A,
      handle: 'alice.example.com',
      handleStatus: 'valid',
      handleCheck: 'pds-attested',
      pdsOrigin: PDS,
      verifiedAt: '2026-02-03T04:05:06.000Z',
    });
    expect(r.value.repo).not.toBeNull();
    expect(r.value.repoFailure).toBeNull();
    expect(svc.list()).toHaveLength(1);
    expect(svc.get(DID_A)?.status).toBe('verified');
  });

  it('calls both ports with did === session.did and the resolved pdsOrigin', async () => {
    const { svc, give, identity, repo } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(identity.calls[0]?.did).toBe(DID_A);
    expect(repo.calls[0]?.did).toBe(DID_A);
    expect(repo.calls[0]?.pdsOrigin).toBe(PDS);
  });

  it('handleIsCorrect false -> invalid', async () => {
    const { svc, give } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com', false);
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(r.ok && r.value.identity.handleStatus).toBe('invalid');
  });

  it('DID document claims a.example, PDS reports b.example -> invalid', async () => {
    const { svc, give } = setup();
    give(DID_A, 'a.example', null, true, 'b.example');
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(r.ok && r.value.identity.handleStatus).toBe('invalid');
    expect(r.ok && r.value.identity.handle).toBe('b.example');
  });

  it('PDS handle handle.invalid -> invalid', async () => {
    const { svc, give } = setup();
    give(DID_A, 'handle.invalid', null, true, 'handle.invalid');
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(r.ok && r.value.identity.handleStatus).toBe('invalid');
  });

  it('no claimed handle but PDS reports a correct one -> invalid, shows the PDS handle', async () => {
    const { svc, give } = setup();
    give(DID_A, null, null, true, 'alice.example.com');
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(r.ok && r.value.identity.handleStatus).toBe('invalid');
    expect(r.ok && r.value.identity.handle).toBe('alice.example.com');
  });

  it('describeRepo fails -> ok, repo null, repoFailure set, unverified, check none, claimed handle', async () => {
    const { svc, identity, repo } = setup();
    identity.responses.set(DID_A, ok(resolved(DID_A, 'alice.example.com')));
    const failure = makeFailure('network', 'pds down');
    repo.responses.set(DID_A, err(failure));
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.repo).toBeNull();
    expect(r.value.repoFailure).toEqual(failure);
    expect(r.value.identity).toMatchObject({
      handleStatus: 'unverified',
      handleCheck: 'none',
      handle: 'alice.example.com',
      pdsOrigin: PDS,
    });
    expect(svc.get(DID_A)?.status).toBe('verified');
  });

  it('resolveIdentity fails -> err, could-not-verify with lastFailure, describeRepo not called', async () => {
    const { svc, identity, repo } = setup();
    const webDid = did('did:web:example.org');
    const failure = makeFailure('network', 'cors');
    identity.responses.set(webDid, err(failure));
    const r = await svc.verify({ session: oauth(webDid), signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toEqual(failure);
    expect(repo.calls).toHaveLength(0);
    expect(svc.get(webDid)).toMatchObject({
      status: 'could-not-verify',
      lastFailure: failure,
      handle: null,
      pdsOrigin: null,
      handleStatus: 'unverified',
    });
  });

  it('failed re-verification keeps previously known handle and PDS', async () => {
    const { svc, give, identity } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    identity.responses.set(DID_A, err(makeFailure('timeout', 'slow')));
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(svc.get(DID_A)).toMatchObject({
      status: 'could-not-verify',
      handle: 'alice.example.com',
      pdsOrigin: PDS,
      handleStatus: 'valid',
    });
  });

  it('second verify updates in place: no duplicate, addedAt and position unchanged', async () => {
    const { svc, give, clock } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    give(DID_B, 'bob.example.com', 'bob.example.com');
    clock.set('2026-01-01T00:00:00.000Z');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    await svc.verify({ session: oauth(DID_B), signal: signal() });
    clock.set('2026-03-01T00:00:00.000Z');
    give(DID_A, 'alice2.example.com', 'alice2.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    const list = svc.list();
    expect(list.map((a) => a.did)).toEqual([DID_A, DID_B]);
    expect(list[0]).toMatchObject({
      handle: 'alice2.example.com',
      addedAt: '2026-01-01T00:00:00.000Z',
      verifiedAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('abort during resolveIdentity -> rejects; list unchanged; nothing written', async () => {
    const { svc, give, identity, storage } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    const ac = new AbortController();
    identity.onCall = () => {
      ac.abort();
      throw ac.signal.reason;
    };
    await expect(svc.verify({ session: oauth(DID_A), signal: ac.signal })).rejects.toBeDefined();
    expect(svc.list()).toHaveLength(0);
    expect(storage?.setCalls).toBe(0);
  });

  it('abort after a port resolved still rejects and leaves the list unchanged', async () => {
    const { svc, give, identity } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    const ac = new AbortController();
    identity.onCall = () => ac.abort();
    await expect(svc.verify({ session: oauth(DID_A), signal: ac.signal })).rejects.toBeDefined();
    expect(svc.list()).toHaveLength(0);
  });

  it('already-aborted signal makes no port call', async () => {
    const { svc, identity } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(svc.verify({ session: oauth(DID_A), signal: ac.signal })).rejects.toBeDefined();
    expect(identity.calls).toHaveLength(0);
  });

  it('demo session with real storage: verified in memory, setItem never called', async () => {
    const { svc, give, storage } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    const r = await svc.verify({ session: demo(DID_A), signal: signal() });
    expect(r.ok).toBe(true);
    expect(svc.get(DID_A)?.status).toBe('verified');
    expect(storage?.setCalls).toBe(0);
    expect(storage?.data.size).toBe(0);
  });

  it('demo accounts are excluded when a live account later persists the list', async () => {
    const { svc, give, storage } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    give(DID_B, 'bob.example.com', 'bob.example.com');
    await svc.verify({ session: demo(DID_A), signal: signal() });
    await svc.verify({ session: oauth(DID_B), signal: signal() });
    const stored = JSON.parse(storage!.data.get(STORAGE_KEYS.accounts)!);
    expect(stored.accounts.map((a: { did: string }) => a.did)).toEqual([DID_B]);
  });
});

describe('list management', () => {
  it('markNeedsSignIn changes only the status; unknown DID is a no-op', async () => {
    const { svc, give } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    const before = svc.get(DID_A)!;
    svc.markNeedsSignIn(DID_B);
    expect(svc.list()).toHaveLength(1);
    svc.markNeedsSignIn(DID_A);
    expect(svc.get(DID_A)).toEqual({ ...before, status: 'needs-sign-in' });
  });

  it('remove of a listed DID is local-only and gone from list and storage; unknown -> removed false', async () => {
    const { svc, give, storage } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    give(DID_B, 'bob.example.com', 'bob.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    await svc.verify({ session: oauth(DID_B), signal: signal() });
    expect(svc.remove(DID_A)).toEqual({ did: DID_A, removed: true, scope: 'local-only' });
    expect(svc.get(DID_A)).toBeNull();
    expect(storage!.data.get(STORAGE_KEYS.accounts)).not.toContain(DID_A);
    expect(svc.remove(DID_A)).toEqual({ did: DID_A, removed: false, scope: 'local-only' });
    svc.remove(DID_B);
    expect(storage!.data.has(STORAGE_KEYS.accounts)).toBe(false);
  });

  it('clear empties the list and removes the storage key', async () => {
    const { svc, give, storage } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(storage!.data.has(STORAGE_KEYS.accounts)).toBe(true);
    svc.clear();
    expect(svc.list()).toHaveLength(0);
    expect(storage!.data.has(STORAGE_KEYS.accounts)).toBe(false);
  });

  it('list() returns a copy', async () => {
    const { svc, give } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    const l = svc.list() as unknown[];
    l.length = 0;
    expect(svc.list()).toHaveLength(1);
  });

  it('remove and clear make no port calls', async () => {
    const { svc, give, identity, repo } = setup();
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    const n = identity.calls.length + repo.calls.length;
    svc.remove(DID_A);
    svc.clear();
    expect(identity.calls.length + repo.calls.length).toBe(n);
  });
});

describe('storage (service level)', () => {
  it('a service created over existing storage lists the accounts as needs-sign-in', async () => {
    const first = setup();
    first.give(DID_A, 'alice.example.com', 'alice.example.com');
    await first.svc.verify({ session: oauth(DID_A), signal: signal() });
    const second = setup({ storage: first.storage });
    expect(second.svc.list()).toHaveLength(1);
    expect(second.svc.get(DID_A)).toMatchObject({
      status: 'needs-sign-in',
      lastFailure: null,
      handle: 'alice.example.com',
      pdsOrigin: PDS,
      verifiedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(second.svc.storageFailure()).toBeNull();
  });

  it('setItem throws on verify -> verify still ok and storageFailure set', async () => {
    const storage = memStore();
    storage.throwOnSet = true;
    const { svc, give } = setup({ storage });
    give(DID_A, 'alice.example.com', 'alice.example.com');
    const r = await svc.verify({ session: oauth(DID_A), signal: signal() });
    expect(r.ok).toBe(true);
    expect(svc.storageFailure()?.kind).toBe('storage');
    expect(svc.list()).toHaveLength(1);
  });

  it('removeItem throwing in clear/remove does not throw', async () => {
    const storage = memStore();
    const { svc, give } = setup({ storage });
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    storage.throwOnRemove = true;
    expect(() => svc.remove(DID_A)).not.toThrow();
    expect(svc.storageFailure()?.kind).toBe('storage');
    expect(() => svc.clear()).not.toThrow();
  });

  it('storage null: works in memory and storageFailure stays null', async () => {
    const { svc, give } = setup({ storage: null });
    give(DID_A, 'alice.example.com', 'alice.example.com');
    await svc.verify({ session: oauth(DID_A), signal: signal() });
    svc.markNeedsSignIn(DID_A);
    svc.remove(DID_A);
    svc.clear();
    expect(svc.storageFailure()).toBeNull();
  });

  it('origin helper sanity', () => {
    expect(origin('https://pds.example.com')).toBe(PDS);
  });
});
