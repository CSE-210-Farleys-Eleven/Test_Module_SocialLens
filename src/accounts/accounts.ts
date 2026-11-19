import { didMethodOf, err, isAbortError, makeFailure, ok } from '../shared';
import type { Did, Failure, Handle, HandleStatus, Result } from '../shared';
import type {
  AccountsDeps,
  AccountsService,
  LinkedAccount,
  RemovalReceipt,
  VerifiedAccount,
  VerifyRequest,
} from './contract';
import { loadAccounts, removeStored, saveAccounts } from './storage';

const INVALID_HANDLE = 'handle.invalid';

export function createAccountsService(deps: AccountsDeps): AccountsService {
  const { identity, repo, storage, clock } = deps;
  let accounts: readonly LinkedAccount[] = [];
  let failure: Failure | null = null;
  /** DIDs seen only through a demo session: never written anywhere. */
  const demoDids = new Set<Did>();

  if (storage !== null) {
    const loaded = loadAccounts(storage);
    accounts = loaded.accounts;
    failure = loaded.failure;
  }

  function persist(): void {
    if (storage === null) return;
    const f = saveAccounts(
      storage,
      accounts.filter((a) => !demoDids.has(a.did)),
    );
    if (f !== null) failure = f;
  }

  function upsert(next: LinkedAccount): void {
    const i = accounts.findIndex((a) => a.did === next.did);
    accounts =
      i < 0 ? [...accounts, next] : accounts.map((a, idx) => (idx === i ? next : a));
  }

  const find = (did: Did): LinkedAccount | null => accounts.find((a) => a.did === did) ?? null;

  async function verify({ session, signal }: VerifyRequest): Promise<Result<VerifiedAccount>> {
    signal.throwIfAborted();
    const did = session.did;
    const isDemo = session.source === 'demo';
    const savePersist = (): void => {
      if (!isDemo) persist();
    };
    const mark = (): void => {
      if (isDemo) demoDids.add(did);
    };

    const resolved = await identity.resolveIdentity({ session, did, signal });
    signal.throwIfAborted();
    if (!resolved.ok) {
      const prev = find(did);
      mark();
      upsert({
        did,
        didMethod: prev?.didMethod ?? didMethodOf(did),
        handle: prev?.handle ?? null,
        handleStatus: prev?.handleStatus ?? 'unverified',
        pdsOrigin: prev?.pdsOrigin ?? null,
        status: 'could-not-verify',
        verifiedAt: prev?.verifiedAt ?? null,
        addedAt: prev?.addedAt ?? clock.now(),
        lastFailure: resolved.failure,
      });
      savePersist();
      return err(resolved.failure);
    }
    const id = resolved.value;

    const described = await repo.describeRepo({
      session,
      did,
      pdsOrigin: id.pdsOrigin,
      signal,
    });
    signal.throwIfAborted();

    let handle: Handle | null;
    let handleStatus: HandleStatus;
    let handleCheck: 'pds-attested' | 'none';
    let repoDescription = null;
    let repoFailure: Failure | null = null;
    if (described.ok) {
      const d = described.value;
      repoDescription = d;
      handle = d.handle ?? id.claimedHandle;
      handleCheck = 'pds-attested';
      handleStatus =
        d.handle !== null &&
        d.handleIsCorrect &&
        id.claimedHandle === d.handle &&
        d.handle !== INVALID_HANDLE
          ? 'valid'
          : 'invalid';
    } else {
      repoFailure = described.failure;
      handle = id.claimedHandle;
      handleStatus = 'unverified';
      handleCheck = 'none';
    }

    const verifiedAt = clock.now();
    const prev = find(did);
    mark();
    upsert({
      did,
      didMethod: id.didMethod,
      handle,
      handleStatus,
      pdsOrigin: id.pdsOrigin,
      status: 'verified',
      verifiedAt,
      addedAt: prev?.addedAt ?? verifiedAt,
      lastFailure: null,
    });
    savePersist();

    return ok({
      identity: {
        did,
        didMethod: id.didMethod,
        handle,
        handleStatus,
        handleCheck,
        pdsOrigin: id.pdsOrigin,
        verifiedAt,
      },
      repo: repoDescription,
      repoFailure,
    });
  }

  return {
    list: () => [...accounts],
    get: (did) => find(did),
    async verify(request) {
      try {
        return await verify(request);
      } catch (e) {
        if (isAbortError(e) || request.signal.aborted) throw e;
        return err(makeFailure('internal', 'The account could not be verified.'));
      }
    },
    markNeedsSignIn(did) {
      const a = find(did);
      if (a === null) return;
      upsert({ ...a, status: 'needs-sign-in' });
      persist();
    },
    remove(did): RemovalReceipt {
      const removed = find(did) !== null;
      if (removed) {
        accounts = accounts.filter((a) => a.did !== did);
        demoDids.delete(did);
        persist();
      }
      return { did, removed, scope: 'local-only' };
    },
    clear() {
      accounts = [];
      demoDids.clear();
      if (storage !== null) {
        const f = removeStored(storage);
        if (f !== null) failure = f;
      }
    },
    storageFailure: () => failure,
  };
}
