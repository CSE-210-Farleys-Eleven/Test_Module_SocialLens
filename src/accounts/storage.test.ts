import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../shared';
import { createAccounts } from './index';
import { loadAccounts, saveAccounts } from './storage';
import { DID_A, DID_B, fakeClock, fakeIdentity, fakeRepo, memStore, oauth } from './fakes';
import { ok } from '../shared';
import { repoDesc, resolved } from './fakes';

const entry = (over: Record<string, unknown> = {}) => ({
  did: DID_A,
  didMethod: 'plc',
  handle: 'alice.example.com',
  handleStatus: 'valid',
  pdsOrigin: 'https://pds.example.com',
  status: 'verified',
  verifiedAt: '2026-01-01T00:00:00.000Z',
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const store = (json: unknown) =>
  memStore({ [STORAGE_KEYS.accounts]: typeof json === 'string' ? json : JSON.stringify(json) });
const mk = (storage: ReturnType<typeof memStore>) =>
  createAccounts({ identity: fakeIdentity(), repo: fakeRepo(), storage, clock: fakeClock() });

describe('persisted shape', () => {
  it('persists version 1, no lastFailure, only documented fields', async () => {
    const storage = memStore();
    const identity = fakeIdentity();
    const repo = fakeRepo();
    identity.responses.set(DID_A, ok(resolved(DID_A, 'alice.example.com')));
    repo.responses.set(DID_A, ok(repoDesc(DID_A, 'alice.example.com', true)));
    const svc = createAccounts({ identity, repo, storage, clock: fakeClock() });
    await svc.verify({ session: oauth(DID_A), signal: new AbortController().signal });
    const text = storage.data.get(STORAGE_KEYS.accounts)!;
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.accounts).toHaveLength(1);
    expect(Object.keys(parsed.accounts[0]).sort()).toEqual(
      ['addedAt', 'did', 'didMethod', 'handle', 'handleStatus', 'pdsOrigin', 'status', 'verifiedAt'].sort(),
    );
    expect(text).not.toMatch(/lastFailure|token|secret|password|jwt|access|refresh/i);
  });

  it('saveAccounts with an empty list removes the key', () => {
    const s = store({ version: 1, accounts: [entry()] });
    expect(saveAccounts(s, [])).toBeNull();
    expect(s.data.has(STORAGE_KEYS.accounts)).toBe(false);
  });
});

describe('loading', () => {
  it('missing key -> empty, no failure', () => {
    const svc = mk(memStore());
    expect(svc.list()).toEqual([]);
    expect(svc.storageFailure()).toBeNull();
  });

  it('loads valid entries as needs-sign-in with lastFailure null', () => {
    const svc = mk(store({ version: 1, accounts: [entry({ status: 'verified' })] }));
    expect(svc.get(DID_A)).toMatchObject({ status: 'needs-sign-in', lastFailure: null });
  });

  it('corrupt JSON -> empty list and storage failure', () => {
    const svc = mk(store('{not json'));
    expect(svc.list()).toEqual([]);
    expect(svc.storageFailure()?.kind).toBe('storage');
  });

  it('wrong version -> empty list with storage failure', () => {
    const svc = mk(store({ version: 2, accounts: [entry()] }));
    expect(svc.list()).toEqual([]);
    expect(svc.storageFailure()?.kind).toBe('storage');
  });

  it('non-object / missing accounts array -> storage failure', () => {
    expect(mk(store('[]')).storageFailure()?.kind).toBe('storage');
    expect(mk(store({ version: 1 })).storageFailure()?.kind).toBe('storage');
  });

  it('drops entries with invalid DID, PDS origin, handle, timestamps or status; keeps valid ones', () => {
    const svc = mk(
      store({
        version: 1,
        accounts: [
          entry({ did: 'not-a-did' }),
          entry({ did: DID_B, pdsOrigin: 'http://pds.example.com' }),
          entry({ did: DID_B, handle: 'NOT A HANDLE' }),
          entry({ did: DID_B, addedAt: 'yesterday' }),
          entry({ did: DID_B, handleStatus: 'great' }),
          'garbage',
          null,
          entry(),
        ],
      }),
    );
    expect(svc.list().map((a) => a.did)).toEqual([DID_A]);
    expect(svc.storageFailure()).toBeNull();
  });

  it('accepts null handle, pdsOrigin and verifiedAt', () => {
    const svc = mk(store({ version: 1, accounts: [entry({ handle: null, pdsOrigin: null, verifiedAt: null })] }));
    expect(svc.get(DID_A)).toMatchObject({ handle: null, pdsOrigin: null, verifiedAt: null });
  });

  it('duplicate DIDs collapse to the first entry', () => {
    const svc = mk(store({ version: 1, accounts: [entry({ handle: 'a.example.com' }), entry({ handle: 'b.example.com' })] }));
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0]?.handle).toBe('a.example.com');
  });

  it('getItem throws -> empty list, failure set, no exception', () => {
    const s = memStore();
    s.throwOnGet = true;
    const svc = mk(s);
    expect(svc.list()).toEqual([]);
    expect(svc.storageFailure()?.kind).toBe('storage');
  });

  it('loadAccounts returns didMethod derived from the DID, not the stored value', () => {
    const r = loadAccounts(store({ version: 1, accounts: [entry({ didMethod: 'web' })] }));
    expect(r.accounts[0]?.didMethod).toBe('plc');
  });
});
