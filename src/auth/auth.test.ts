import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Did } from '../shared/contract';
import type {
  AuthConfig,
  CreateOAuthClient,
  OAuthClientHooks,
  OAuthClientLike,
  OAuthInitLike,
  OAuthSessionLike,
  SessionEndedEvent,
} from './contract';
import { createAuth } from './auth';

const DID_A = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' as Did;

const loopback: AuthConfig = { clientKind: 'loopback', clientId: null, handleResolver: 'https://bsky.social', scope: 'atproto' };

interface FakeOptions {
  init?: () => Promise<OAuthInitLike | undefined>;
  signIn?: (input: string) => Promise<unknown>;
  restore?: (sub: string) => Promise<OAuthSessionLike>;
  revoke?: (sub: string) => Promise<void>;
}

function setup(opts: FakeOptions = {}, createFails = false) {
  let hooks: OAuthClientHooks | null = null;
  const client = {
    init: vi.fn(opts.init ?? (() => Promise.resolve(undefined))),
    signIn: vi.fn(opts.signIn ?? (() => new Promise<unknown>(() => {}))),
    restore: vi.fn(opts.restore ?? ((sub: string) => Promise.resolve({ sub }))),
    revoke: vi.fn(opts.revoke ?? (() => Promise.resolve())),
  } satisfies OAuthClientLike;
  const createClient = vi.fn<CreateOAuthClient>((_config, h) => {
    hooks = h;
    return createFails ? Promise.reject(new Error('WebCrypto API is required')) : Promise.resolve(client);
  });
  const auth = createAuth({ config: loopback, createClient });
  const events: SessionEndedEvent[] = [];
  auth.onSessionEnded((e) => events.push(e));
  const hook = (sub: string, reason: Parameters<OAuthClientHooks['onSessionDeleted']>[1]) => {
    if (!hooks) throw new Error('client not created yet');
    hooks.onSessionDeleted(sub, reason);
  };
  return { auth, client, createClient, events, hook };
}

/** Deep-scan for token-like keys. */
function tokenKeys(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const found: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (/token|dpop|secret|password/i.test(k)) found.push(k);
    found.push(...tokenKeys(v, seen));
  }
  return found;
}

describe('disclosure', () => {
  it('names the resolver host, says IP address and handle are sent, available before init', () => {
    const { auth, createClient } = setup();
    const d = auth.disclosure;
    expect(createClient).not.toHaveBeenCalled();
    expect(d.resolverNotice).toBe(
      "To find your account, your handle and this device's IP address are sent to bsky.social, which looks up handles for sign-in.",
    );
    expect(d.resolverNotice).toContain('IP address');
    expect(d.resolverNotice).toContain('handle');
    expect(d.handleResolverOrigin).toBe('https://bsky.social');
    expect(d.storageNotice).toBe(
      'Sign-in tokens are kept in this browser by the official AT Protocol OAuth library. SocialLens requests only the identity scope: it cannot post, edit, delete or read private data.',
    );
    expect(d.source).toBe('oauth-client-browser-readme');
    expect(d.clientKind).toBe('loopback');
  });

  it('scope is atproto and the resolver is third-party', () => {
    const { auth } = setup();
    expect(auth.disclosure.scope).toBe('atproto');
    expect(auth.disclosure.handleResolverIsThirdParty).toBe(true);
  });
});

describe('init', () => {
  it('client returns undefined → signed out, no problem', async () => {
    const { auth } = setup();
    expect(await auth.init()).toEqual({ ok: true, value: { session: null, via: 'none', problem: null } });
  });

  it('client returns { session } → via restore, oauth SessionRef with DID = sub', async () => {
    const { auth } = setup({ init: () => Promise.resolve({ session: { sub: DID_A } }) });
    expect(await auth.init()).toEqual({
      ok: true,
      value: { session: { did: DID_A, source: 'oauth' }, via: 'restore', problem: null },
    });
  });

  it('client returns { session, state: null } → via callback', async () => {
    const { auth } = setup({ init: () => Promise.resolve({ session: { sub: DID_A }, state: null }) });
    const r = await auth.init();
    expect(r.ok && r.value.via).toBe('callback');
    expect(r.ok && r.value.session).toEqual({ did: DID_A, source: 'oauth' });
  });

  it('sub is did:key → no session, unsupported problem', async () => {
    const { auth } = setup({
      init: () => Promise.resolve({ session: { sub: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' } }),
    });
    const r = await auth.init();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.session).toBeNull();
      expect(r.value.via).toBe('none');
      expect(r.value.problem?.kind).toBe('unsupported');
      expect(r.value.problem?.message).toBe('This account identifier is not supported.');
    }
  });

  it('client.init() rejects → ok with session null and an auth problem', async () => {
    const { auth } = setup({ init: () => Promise.reject(new Error('secret-state-xyz invalid_grant')) });
    const r = await auth.init();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.session).toBeNull();
      expect(r.value.via).toBe('none');
      expect(r.value.problem?.kind).toBe('auth');
      expect(r.value.problem?.message).toBe(
        'Your earlier sign-in could not be restored or completed. Sign in again to continue.',
      );
      expect(JSON.stringify(r)).not.toContain('secret-state-xyz');
    }
  });

  it('createClient rejects → err(auth)', async () => {
    const { auth } = setup({}, true);
    const r = await auth.init();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('auth');
      expect(r.failure.message).toBe('Sign-in is not available in this browser.');
    }
  });

  it('two init() calls → createClient and client.init each called once', async () => {
    const { auth, client, createClient } = setup({ init: () => Promise.resolve({ session: { sub: DID_A } }) });
    const p1 = auth.init();
    const p2 = auth.init();
    expect(p2).toBe(p1);
    await Promise.all([p1, p2]);
    await auth.init();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.init).toHaveBeenCalledTimes(1);
  });
});

describe('signIn', () => {
  it("'@Alice.Example.com ' → client receives alice.example.com, with no options", async () => {
    const { auth, client } = setup({ signIn: () => Promise.resolve(undefined) });
    expect(await auth.signIn('@Alice.Example.com ')).toEqual({ ok: true, value: null });
    expect(client.signIn).toHaveBeenCalledTimes(1);
    expect(client.signIn.mock.calls[0]).toEqual(['alice.example.com']);
  });

  it.each([
    'hunter2!',
    'abcd-efgh-ijkl-mnop',
    'alice@example.com',
    'https://bsky.social',
    'bsky.social/profile/alice',
    DID_A,
    '',
    '   ',
    '@@alice.example.com',
  ])('%j → err(validation) and the client is never created', async (input) => {
    const { auth, createClient } = setup();
    const r = await auth.signIn(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('validation');
      expect(r.failure.message).toBe(
        'Enter your handle, such as name.example.com — not a password, an email address or a URL.',
      );
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('client rejects → err(auth) without the rejection message', async () => {
    const { auth } = setup({ signIn: () => Promise.reject(new Error('User navigated back state=abc123')) });
    const r = await auth.signIn('alice.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('auth');
      expect(r.failure.message).toBe('Sign-in was cancelled or could not be started.');
      expect(JSON.stringify(r)).not.toContain('navigated back');
      expect(JSON.stringify(r)).not.toContain('abc123');
    }
  });

  it('createClient rejects → err(auth)', async () => {
    const { auth } = setup({}, true);
    const r = await auth.signIn('alice.example.com');
    expect(!r.ok && r.failure.kind).toBe('auth');
  });
});

describe('restore', () => {
  it('same DID → ok SessionRef', async () => {
    const { auth, client } = setup();
    expect(await auth.restore(DID_A)).toEqual({ ok: true, value: { did: DID_A, source: 'oauth' } });
    expect(client.restore).toHaveBeenCalledWith(DID_A);
  });

  it('different sub → err(auth)', async () => {
    const { auth } = setup({ restore: () => Promise.resolve({ sub: DID_B }) });
    const r = await auth.restore(DID_A);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('auth');
      expect(r.failure.message).toBe('This account needs to sign in again.');
    }
  });

  it('rejection → err(auth)', async () => {
    const { auth } = setup({ restore: () => Promise.reject(new Error('TokenRefreshError')) });
    const r = await auth.restore(DID_A);
    expect(!r.ok && r.failure.message).toBe('This account needs to sign in again.');
  });
});

describe('signOut', () => {
  it('calls revoke(did) and resolves ok even when revoke rejects', async () => {
    const { auth, client } = setup({ revoke: () => Promise.reject(new Error('network down')) });
    expect(await auth.signOut(DID_A)).toEqual({ ok: true, value: null });
    expect(client.revoke).toHaveBeenCalledWith(DID_A);
  });

  it('emits exactly one signed-out event; a hook call during or after it emits nothing more', async () => {
    const ctx = setup();
    ctx.client.revoke.mockImplementation((sub: string) => {
      ctx.hook(sub, 'unknown'); // the library fires its hook inside revoke's finally
      return Promise.resolve();
    });
    await ctx.auth.signOut(DID_A);
    ctx.hook(DID_A, 'revoked');
    expect(ctx.events).toEqual([{ did: DID_A, reason: 'signed-out' }]);
  });

  it('createClient rejects → err(auth), no event', async () => {
    const { auth, events } = setup({}, true);
    const r = await auth.signOut(DID_A);
    expect(!r.ok && r.failure.kind).toBe('auth');
    expect(events).toEqual([]);
  });
});

describe('session-ended events', () => {
  it('hook with reason expired → listeners get { did, reason: expired }', async () => {
    const ctx = setup();
    await ctx.auth.init();
    ctx.hook(DID_A, 'expired');
    expect(ctx.events).toEqual([{ did: DID_A, reason: 'expired' }]);
  });

  it('two hook calls for the same DID → one event; after restore succeeds, a new hook call emits again', async () => {
    const ctx = setup();
    await ctx.auth.init();
    ctx.hook(DID_A, 'expired');
    ctx.hook(DID_A, 'revoked');
    ctx.hook(DID_B, 'invalid');
    expect(ctx.events).toEqual([
      { did: DID_A, reason: 'expired' },
      { did: DID_B, reason: 'invalid' },
    ]);
    await ctx.auth.restore(DID_A);
    ctx.hook(DID_A, 'revoked');
    expect(ctx.events).toHaveLength(3);
    expect(ctx.events[2]).toEqual({ did: DID_A, reason: 'revoked' });
  });

  it('after init returns the DID, a new hook call emits again', async () => {
    const ctx = setup({ init: () => Promise.resolve({ session: { sub: DID_A } }) });
    await ctx.auth.signOut(DID_A);
    await ctx.auth.init();
    ctx.hook(DID_A, 'expired');
    expect(ctx.events).toEqual([
      { did: DID_A, reason: 'signed-out' },
      { did: DID_A, reason: 'expired' },
    ]);
  });

  it('hook with an unparseable sub → no event', async () => {
    const ctx = setup();
    await ctx.auth.init();
    ctx.hook('did:key:z6Mk', 'expired');
    ctx.hook('not a did', 'unknown');
    expect(ctx.events).toEqual([]);
  });

  it('unsubscribe stops delivery; a throwing listener does not stop the next one', async () => {
    const ctx = setup();
    await ctx.auth.init();
    const thrower = vi.fn(() => {
      throw new Error('listener bug');
    });
    const later: SessionEndedEvent[] = [];
    const removable: SessionEndedEvent[] = [];
    ctx.auth.onSessionEnded(thrower);
    ctx.auth.onSessionEnded((e) => later.push(e));
    const unsubscribe = ctx.auth.onSessionEnded((e) => removable.push(e));
    unsubscribe();
    ctx.hook(DID_A, 'expired');
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(later).toEqual([{ did: DID_A, reason: 'expired' }]);
    expect(removable).toEqual([]);
  });
});

describe('hygiene', () => {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

  it('index.ts, auth.ts, config.ts and classify.ts never import the OAuth library', () => {
    for (const file of ['./index.ts', './auth.ts', './config.ts', './classify.ts']) {
      expect(read(file), file).not.toMatch(/@atproto\/oauth-client/);
    }
  });

  it('browser-client.ts loads the library only through a dynamic import and never sets a scope', () => {
    const src = read('./browser-client.ts');
    expect(src).not.toMatch(/^\s*import\s[^(]*['"]@atproto\/oauth-client-browser['"]/m);
    expect(src).toMatch(/await import\(['"]@atproto\/oauth-client-browser['"]\)/);
    expect(src).not.toMatch(/\bscope\s*:/);
    expect(src).not.toMatch(/responseMode\s*:|transition:|fetch\s*:|clientMetadata\s*:/);
  });

  it('no returned object contains a token-like property', async () => {
    const leaky = { sub: DID_A, access_token: 'AT', refresh_token: 'RT', dpopKey: { d: 'x' } } as OAuthSessionLike;
    const ctx = setup({
      init: () => Promise.resolve({ session: leaky, state: 'st' }),
      restore: () => Promise.resolve(leaky),
    });
    const results: unknown[] = [
      ctx.auth.disclosure,
      await ctx.auth.init(),
      await ctx.auth.restore(DID_A),
      await ctx.auth.signOut(DID_A),
      ...ctx.events,
    ];
    for (const r of results) expect(tokenKeys(r)).toEqual([]);
    expect(JSON.stringify(results)).not.toMatch(/"AT"|"RT"|"st"/);
  });
});
