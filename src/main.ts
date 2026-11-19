/**
 * Page entry (composition root). Construction only; see docs/architecture/PLAN.md §10.
 */
import './styles.css';
import { composeApp } from './compose';
import { createAuth, createBrowserOAuthClient, resolveAuthConfig } from './auth';
import { adaptWorker } from './analytics/worker';
import { GLOSSARY, realSleep, systemClock } from './shared';
import { createComponents } from './ui/components';
import { createViews, mountApp } from './ui/views';
import type { KeyValueStore } from './shared/contract';

function safeLocalStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const hostedClientId: unknown = import.meta.env['VITE_OAUTH_CLIENT_ID'];
const authConfig = resolveAuthConfig(window.location, typeof hostedClientId === 'string' && hostedClientId !== '' ? hostedClientId : null);

const app = composeApp({
  fetch: (url, init) => globalThis.fetch(url, init),
  storage: safeLocalStorage(),
  auth: authConfig.ok ? createAuth({ config: authConfig.value, createClient: createBrowserOAuthClient }) : null,
  spawnWorker:
    typeof Worker === 'undefined'
      ? null
      : () => adaptWorker(new Worker(new URL('./worker-main.ts', import.meta.url), { type: 'module' })),
  sleep: realSleep,
  clock: systemClock,
  timers: {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  },
  demoLatencyMs: 0,
});

const root = document.getElementById('app');
if (root === null) throw new Error('Missing #app root element');

const components = createComponents({ document, glossary: GLOSSARY });
const views = createViews({
  components,
  registry: app.registry.data,
  glossary: GLOSSARY,
  demoScenarios: app.fixtures.scenarios,
  document,
});
mountApp({ root, store: app.store, actions: app.actions, views });
void app.actions.start();
