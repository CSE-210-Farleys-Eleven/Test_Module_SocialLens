import { err, makeFailure, ok, parseDid, parseHandle } from '../shared';
import type { Did, Result } from '../shared/contract';
import type {
  AuthConfig,
  AuthDisclosure,
  AuthInitResult,
  CreateAuth,
  OAuthClientHooks,
  OAuthClientLike,
  SessionEndedEvent,
} from './contract';

const MSG_UNAVAILABLE = 'Sign-in is not available in this browser.';
const MSG_INIT_FAILED = 'Your earlier sign-in could not be restored or completed. Sign in again to continue.';
const MSG_UNSUPPORTED_ID = 'This account identifier is not supported.';
const MSG_INVALID_HANDLE = 'Enter your handle, such as name.example.com — not a password, an email address or a URL.';
const MSG_SIGN_IN_FAILED = 'Sign-in was cancelled or could not be started.';
const MSG_RESTORE_FAILED = 'This account needs to sign in again.';

function resolverParts(handleResolver: string): { origin: string; host: string } {
  try {
    const url = new URL(handleResolver);
    return { origin: url.origin, host: url.host };
  } catch {
    return { origin: handleResolver, host: handleResolver };
  }
}

function buildDisclosure(config: AuthConfig): AuthDisclosure {
  const { origin, host } = resolverParts(config.handleResolver);
  return {
    scope: 'atproto',
    clientKind: config.clientKind,
    handleResolverOrigin: origin,
    handleResolverIsThirdParty: true,
    resolverNotice: `To find your account, your handle and this device's IP address are sent to ${host}, which looks up handles for sign-in.`,
    storageNotice:
      'Sign-in tokens are kept in this browser by the official AT Protocol OAuth library. SocialLens requests only the identity scope: it cannot post, edit, delete or read private data.',
    source: 'oauth-client-browser-readme',
  };
}

export const createAuth: CreateAuth = ({ config, createClient }) => {
  const listeners = new Set<{ readonly fn: (event: SessionEndedEvent) => void }>();
  /** DIDs whose end was already reported; cleared when init/restore returns the DID again. */
  const ended = new Set<Did>();
  /** DIDs currently being signed out by this app (the library's own hook is a duplicate). */
  const signingOut = new Set<Did>();
  let clientPromise: Promise<OAuthClientLike> | null = null;
  let initPromise: Promise<Result<AuthInitResult>> | null = null;

  function emit(event: SessionEndedEvent): void {
    ended.add(event.did);
    for (const listener of [...listeners]) {
      try {
        listener.fn(event);
      } catch {
        // A faulty listener must not stop delivery to the others.
      }
    }
  }

  const hooks: OAuthClientHooks = {
    onSessionDeleted(sub, reason) {
      const did = parseDid(sub);
      if (did === null || signingOut.has(did) || ended.has(did)) return;
      emit({ did, reason });
    },
  };

  /** Lazily create and memoise the client; a failed creation is not cached. Resolves null on failure. */
  async function getClient(): Promise<OAuthClientLike | null> {
    if (clientPromise === null) {
      const attempt = createClient(config, hooks);
      clientPromise = attempt;
      attempt.catch(() => {
        if (clientPromise === attempt) clientPromise = null;
      });
    }
    try {
      return await clientPromise;
    } catch {
      return null;
    }
  }

  async function runInit(): Promise<Result<AuthInitResult>> {
    const client = await getClient();
    if (client === null) return err(makeFailure('auth', MSG_UNAVAILABLE));
    let result: Awaited<ReturnType<OAuthClientLike['init']>>;
    try {
      result = await client.init();
    } catch {
      return ok({ session: null, via: 'none', problem: makeFailure('auth', MSG_INIT_FAILED) });
    }
    if (result === undefined) return ok({ session: null, via: 'none', problem: null });
    const did = parseDid(result.session.sub);
    if (did === null) {
      return ok({ session: null, via: 'none', problem: makeFailure('unsupported', MSG_UNSUPPORTED_ID) });
    }
    ended.delete(did);
    return ok({
      session: { did, source: 'oauth' },
      via: 'state' in result ? 'callback' : 'restore',
      problem: null,
    });
  }

  return {
    disclosure: buildDisclosure(config),

    init() {
      initPromise ??= runInit();
      return initPromise;
    },

    async signIn(input) {
      const trimmed = input.trim();
      const handle = parseHandle(trimmed.startsWith('@') ? trimmed.slice(1) : trimmed);
      if (handle === null) return err(makeFailure('validation', MSG_INVALID_HANDLE));
      const client = await getClient();
      if (client === null) return err(makeFailure('auth', MSG_UNAVAILABLE));
      try {
        await client.signIn(handle);
        return ok(null);
      } catch {
        return err(makeFailure('auth', MSG_SIGN_IN_FAILED));
      }
    },

    async restore(did) {
      const client = await getClient();
      if (client === null) return err(makeFailure('auth', MSG_UNAVAILABLE));
      try {
        const session = await client.restore(did);
        if (session.sub !== did) return err(makeFailure('auth', MSG_RESTORE_FAILED));
      } catch {
        return err(makeFailure('auth', MSG_RESTORE_FAILED));
      }
      ended.delete(did);
      return ok({ did, source: 'oauth' });
    },

    async signOut(did) {
      const client = await getClient();
      if (client === null) return err(makeFailure('auth', MSG_UNAVAILABLE));
      signingOut.add(did);
      try {
        await client.revoke(did);
      } catch {
        // The library deletes the local session in a `finally`, even when remote revocation fails.
      } finally {
        signingOut.delete(did);
      }
      if (!ended.has(did)) emit({ did, reason: 'signed-out' });
      return ok(null);
    },

    onSessionEnded(fn) {
      const entry = { fn };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
};
