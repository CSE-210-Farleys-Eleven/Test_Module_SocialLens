// Hand-written test fakes for the injected ports (test support only; not exported by index.ts).
import { err, makeFailure, ok, parseDid, parseHandle, parseHttpsOrigin } from '../shared';
import type { Clock, Did, Failure, Handle, HttpsOrigin, KeyValueStore, SessionRef } from '../shared';
import type {
  IdentitySource,
  RepoDescription,
  RepoRequest,
  RepoSource,
  ResolvedIdentity,
  SelfRequest,
} from '../adapters/atproto/contract';

export function did(s: string): Did {
  const d = parseDid(s);
  if (d === null) throw new Error(`bad test did ${s}`);
  return d;
}
export function handle(s: string): Handle {
  const h = parseHandle(s);
  if (h === null) throw new Error(`bad test handle ${s}`);
  return h;
}
export function origin(s: string): HttpsOrigin {
  const r = parseHttpsOrigin(s);
  if (!r.ok) throw new Error(`bad test origin ${s}`);
  return r.value;
}

export const DID_A = did('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa');
export const DID_B = did('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb');
export const PDS = origin('https://pds.example.com');

export const oauth = (d: Did): SessionRef => ({ did: d, source: 'oauth' });
export const demo = (d: Did): SessionRef => ({ did: d, source: 'demo' });

export function resolved(d: Did, claimed: string | null, pds: HttpsOrigin = PDS): ResolvedIdentity {
  return {
    did: d,
    didMethod: d.startsWith('did:web:') ? 'web' : 'plc',
    pdsOrigin: pds,
    claimedHandle: claimed === null ? null : handle(claimed),
    resolvedFrom: 'https://plc.directory',
  };
}

export function repoDesc(d: Did, h: string | null, handleIsCorrect: boolean): RepoDescription {
  return {
    did: d,
    handle: h === null ? null : handle(h),
    handleIsCorrect,
    collections: [],
    invalidCollectionCount: 0,
  };
}

export interface FakeIdentity extends IdentitySource {
  readonly calls: SelfRequest[];
  responses: Map<Did, ReturnType<typeof ok<ResolvedIdentity>> | ReturnType<typeof err>>;
  onCall?: (req: SelfRequest) => Promise<void> | void;
}
export function fakeIdentity(): FakeIdentity {
  const f: FakeIdentity = {
    calls: [],
    responses: new Map(),
    async resolveIdentity(req) {
      f.calls.push(req);
      await f.onCall?.(req);
      return f.responses.get(req.did) ?? err(makeFailure('network', 'down'));
    },
  };
  return f;
}

export interface FakeRepo extends Pick<RepoSource, 'describeRepo'> {
  readonly calls: RepoRequest[];
  responses: Map<Did, ReturnType<typeof ok<RepoDescription>> | ReturnType<typeof err>>;
}
export function fakeRepo(): FakeRepo {
  const f: FakeRepo = {
    calls: [],
    responses: new Map(),
    async describeRepo(req) {
      f.calls.push(req);
      return f.responses.get(req.did) ?? err(makeFailure('network', 'down'));
    },
  };
  return f;
}

export function fakeClock(start = '2026-01-01T00:00:00.000Z'): Clock & { set(iso: string): void } {
  let iso = start;
  return {
    now: () => iso as ReturnType<Clock['now']>,
    nowMs: () => Date.parse(iso),
    set(next: string) {
      iso = next;
    },
  };
}

export interface MemStore extends KeyValueStore {
  readonly data: Map<string, string>;
  readonly setCalls: number;
  throwOnGet: boolean;
  throwOnSet: boolean;
  throwOnRemove: boolean;
}
export function memStore(initial?: Record<string, string>): MemStore {
  let setCalls = 0;
  const s: MemStore = {
    data: new Map(Object.entries(initial ?? {})),
    get setCalls() {
      return setCalls;
    },
    throwOnGet: false,
    throwOnSet: false,
    throwOnRemove: false,
    getItem(k) {
      if (s.throwOnGet) throw new Error('denied');
      return s.data.get(k) ?? null;
    },
    setItem(k, v) {
      setCalls++;
      if (s.throwOnSet) throw new Error('quota');
      s.data.set(k, v);
    },
    removeItem(k) {
      if (s.throwOnRemove) throw new Error('denied');
      s.data.delete(k);
    },
  };
  return s;
}

export type { Failure };
