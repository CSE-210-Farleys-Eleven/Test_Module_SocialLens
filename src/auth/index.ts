// Public API of `auth/` (M1). Must not statically import the OAuth library:
// `browser-client.ts` loads it with a dynamic import only.
import { createAuth as createAuthImpl } from './auth';
import { createBrowserOAuthClient as createBrowserOAuthClientImpl } from './browser-client';
import { classifySessionEnd as classifySessionEndImpl } from './classify';
import { resolveAuthConfig as resolveAuthConfigImpl } from './config';
import type { ClassifySessionEnd, CreateAuth, CreateOAuthClient, ResolveAuthConfig } from './contract';

export const createAuth: CreateAuth = createAuthImpl;
export const resolveAuthConfig: ResolveAuthConfig = resolveAuthConfigImpl;
export const createBrowserOAuthClient: CreateOAuthClient = createBrowserOAuthClientImpl;
export const classifySessionEnd: ClassifySessionEnd = classifySessionEndImpl;
