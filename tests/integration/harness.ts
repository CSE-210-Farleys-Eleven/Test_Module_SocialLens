/** Shared wiring for integration tests: the real modules composed exactly as in the app, over fake environment ports. */
import { composeApp } from '../../src/compose';
import type { ComposeEnv, ComposedApp } from '../../src/compose';
import { realSleep, systemClock } from '../../src/shared';
import type { AuthService } from '../../src/auth/contract';
import type { FetchLike, KeyValueStore } from '../../src/shared/contract';

export function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** A fetch that must never be reached (demo mode must not touch the live network path). */
export const forbiddenFetch: FetchLike = (url) => Promise.reject(new TypeError(`unexpected live request: ${url}`));

export function compose(overrides: Partial<ComposeEnv> = {}): ComposedApp {
  return composeApp({
    fetch: forbiddenFetch,
    storage: null,
    auth: null as AuthService | null,
    spawnWorker: null,
    sleep: realSleep,
    clock: systemClock,
    timers: {
      setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    },
    demoLatencyMs: 0,
    ...overrides,
  });
}

import { ORIGINS, ok } from '../../src/shared';
import type { SessionEndedEvent } from '../../src/auth/contract';
import type { Did } from '../../src/shared/contract';

/** A fake AuthService: the real OAuth redirect flow cannot run in a test. */
export function fakeAuth(did: Did): AuthService & { end(event: SessionEndedEvent): void } {
  const listeners = new Set<(event: SessionEndedEvent) => void>();
  return {
    disclosure: {
      scope: 'atproto',
      clientKind: 'loopback',
      handleResolverOrigin: ORIGINS.oauthHandleResolver,
      handleResolverIsThirdParty: true,
      resolverNotice: 'test resolver notice',
      storageNotice: 'test storage notice',
      source: 'oauth-client-browser-readme',
    },
    init: () => Promise.resolve(ok({ session: { did, source: 'oauth' }, via: 'restore', problem: null })),
    signIn: () => Promise.resolve(ok(null)),
    restore: (target) => Promise.resolve(ok({ did: target, source: 'oauth' })),
    signOut: () => Promise.resolve(ok(null)),
    onSessionEnded: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    end: (event) => listeners.forEach((listener) => listener(event)),
  };
}
