// The only file that touches @atproto/oauth-client-browser (MIT). Loaded lazily so tests and
// the demo never pull it in. Verified against the installed 0.5.15 types. No scope, responseMode
// or fetch override is ever passed: the loopback client id built by the library from
// window.location carries no scope parameter, so the default `atproto` applies; a hosted
// client uses the scope declared in its published metadata.
import { classifySessionEnd } from './classify';
import type { CreateOAuthClient } from './contract';

export const createBrowserOAuthClient: CreateOAuthClient = async (config, hooks) => {
  const lib = await import('@atproto/oauth-client-browser');
  const onSessionDeleted = (sub: string, cause: unknown): void => {
    hooks.onSessionDeleted(sub, classifySessionEnd(cause, lib));
  };
  if (config.clientKind === 'loopback') {
    return new lib.BrowserOAuthClient({ handleResolver: config.handleResolver, onSessionDeleted });
  }
  if (config.clientId === null) throw new TypeError('A hosted OAuth client needs a client id.');
  return lib.BrowserOAuthClient.load({ clientId: config.clientId, handleResolver: config.handleResolver, onSessionDeleted });
};
