import { err, makeFailure, ok, ORIGINS } from '../shared';
import type { ResolveAuthConfig } from './contract';

/** Hostnames served by a loopback interface (the library redirects `localhost` to `127.0.0.1` itself). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost']);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export const resolveAuthConfig: ResolveAuthConfig = (location, hostedClientId) => {
  if (LOOPBACK_HOSTNAMES.has(location.hostname)) {
    return ok({ clientKind: 'loopback', clientId: null, handleResolver: ORIGINS.oauthHandleResolver, scope: 'atproto' });
  }
  if (hostedClientId !== null && isHttpsUrl(hostedClientId)) {
    return ok({
      clientKind: 'hosted',
      clientId: hostedClientId,
      handleResolver: ORIGINS.oauthHandleResolver,
      scope: 'atproto',
    });
  }
  return err(makeFailure('unsupported', 'Live sign-in is not configured for this site.'));
};
