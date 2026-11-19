/**
 * The one controller: turns UI intents into port calls and port results into AppEvents.
 * Closure state: the current load AbortController, the current analysis AbortController
 * (a child of the load), the current live SessionRef, and the auth-events subscription.
 * No action ever rejects or throws: every outcome lands in AppState.
 */
import { makeFailure } from '../../shared';
import type { Did, NoticeCode, RangeId, SessionRef } from '../../shared/contract';
import type { SessionEndedEvent } from '../../auth/contract';
import type { DemoScenarioId } from '../../adapters/fixtures/contract';
import type { AppActions, AppControllerDeps, AppEvent, CreateAppController, DataPorts, ViewId } from './contract';
import { acquire, analyse, type PipelineContext } from './pipeline';

const INTERNAL_LOAD_MESSAGE = 'Something went wrong while reading this account.';
const STORAGE_NOTICE_MESSAGE =
  'Saved accounts could not be read from or written to this browser’s storage; the account list only lasts for this visit.';

export const createAppController: CreateAppController = (deps: AppControllerDeps): AppActions => {
  const { store, auth, live } = deps;

  let loadController: AbortController | null = null;
  let analysisController: AbortController | null = null;
  /** The live session whose data is (being) shown; used by reload(). Never a demo session. */
  let liveSession: SessionRef | null = null;
  let started = false;
  /** Auth-events subscription. The controller lives as long as the page, so it is never released in the MVP. */
  let unsubscribeAuth: (() => void) | null = null;

  /** Dispatch that never throws out of an action (the store already isolates listeners). */
  const dispatch = (event: AppEvent): void => {
    try {
      store.dispatch(event);
    } catch (error) {
      console.error('AppStore dispatch threw', error);
    }
  };

  const ctx: PipelineContext = {
    dispatch,
    getState: () => store.getState(),
    registry: deps.registry,
    normalizer: deps.normalizer,
    runner: deps.runner,
    analytics: deps.analytics,
    privacy: deps.privacy,
    maxPagesPerCollection: deps.maxPagesPerCollection,
    nowMs: deps.nowMs,
  };

  function abortRun(): void {
    analysisController?.abort();
    analysisController = null;
    loadController?.abort();
    loadController = null;
  }

  function isActiveLive(did: Did): boolean {
    const s = store.getState();
    return s.mode === 'live' && s.activeDid === did;
  }

  /** Run one analysis on its own controller, chained to the load signal. Never rejects. */
  async function runAnalysis(runId: number, parent: AbortSignal | null): Promise<void> {
    analysisController?.abort();
    const controller = new AbortController();
    analysisController = controller;
    const onParentAbort = (): void => controller.abort(parent?.reason);
    if (parent?.aborted === true) controller.abort(parent.reason);
    else parent?.addEventListener('abort', onParentAbort, { once: true });
    try {
      const state = store.getState();
      if (state.snapshot === null || state.load.runId !== runId) return;
      await analyse(ctx, { runId, snapshot: state.snapshot, range: state.range, signal: controller.signal });
    } finally {
      parent?.removeEventListener('abort', onParentAbort);
      if (analysisController === controller) analysisController = null;
    }
  }

  /** The only place that reads data. Never rejects. */
  async function load(mode: 'live' | 'demo', session: SessionRef, ports: DataPorts, scenario: DemoScenarioId | null): Promise<void> {
    // I-1 / demo isolation: a live read needs an OAuth session; a demo read needs the demo session.
    if (mode === 'live' && session.source !== 'oauth') return;
    if (mode === 'demo' && session.source !== 'demo') return;

    abortRun();
    const controller = new AbortController();
    loadController = controller;
    const { signal } = controller;
    const runId = store.getState().load.runId + 1;
    if (mode === 'live') liveSession = session;
    dispatch({ type: 'load/started', runId, mode, did: session.did, demoScenario: scenario });

    try {
      const snapshot = await acquire(ctx, { runId, mode, session, ports, scenario, signal });
      if (snapshot === null) return;
      await runAnalysis(runId, signal);
    } catch {
      // Aborted: the action that aborted has already dispatched the state change.
      if (signal.aborted) return;
      dispatch({ type: 'load/failed', runId, failure: makeFailure('internal', INTERNAL_LOAD_MESSAGE) });
    } finally {
      if (loadController === controller && store.getState().load.status !== 'ready') {
        // Keep the controller of a ready run (range changes chain to it); drop finished/failed ones.
        loadController = null;
      }
    }
  }

  function refreshAccounts(): void {
    dispatch({ type: 'accounts/changed', accounts: live.accounts.list() });
  }

  function onSessionEnded(event: SessionEndedEvent): void {
    try {
      live.accounts.markNeedsSignIn(event.did);
      refreshAccounts();
      if (liveSession?.did === event.did) liveSession = null;
      if (isActiveLive(event.did)) {
        abortRun();
        dispatch({ type: 'session/ended', did: event.did, reason: event.reason });
      }
    } catch (error) {
      console.error('session-ended handling failed', error);
    }
  }

  /** Shared by signOut and removeAccount. Local data is cleared whatever the remote outcome. */
  async function endSession(did: Did): Promise<void> {
    if (liveSession?.did === did) liveSession = null;
    if (isActiveLive(did)) {
      abortRun();
      // Clear immediately so the account's data is never on screen while revocation runs.
      dispatch({ type: 'session/ended', did, reason: 'signed-out' });
    }
    if (auth !== null) {
      try {
        await auth.signOut(did);
      } catch {
        // Best effort: local state is cleared regardless.
      }
    }
    live.accounts.markNeedsSignIn(did);
    refreshAccounts();
    // The account may have become active again while revocation ran (a concurrent switchAccount).
    if (isActiveLive(did)) {
      abortRun();
      dispatch({ type: 'session/ended', did, reason: 'signed-out' });
    }
  }

  async function guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      console.error('SocialLens action failed unexpectedly', error);
    }
  }

  function guardSync(action: () => void): void {
    try {
      action();
    } catch (error) {
      console.error('SocialLens action failed unexpectedly', error);
    }
  }

  async function enterDemo(scenario: DemoScenarioId): Promise<void> {
    await guard(async () => {
      const ports = deps.demo(scenario);
      await load('demo', ports.session, ports, scenario);
    });
  }

  return {
    start: () =>
      guard(async () => {
        if (started) return;
        started = true;
        if (auth === null) {
          dispatch({ type: 'auth/unavailable', failure: makeFailure('unsupported', 'Live sign-in is not available in this build.') });
          return;
        }
        unsubscribeAuth ??= auth.onSessionEnded(onSessionEnded);
        let result;
        try {
          result = await auth.init();
        } catch {
          result = { ok: false as const, failure: makeFailure('internal', 'Live sign-in could not be started.') };
        }
        if (!result.ok) {
          dispatch({ type: 'auth/unavailable', failure: result.failure });
          return;
        }
        dispatch({ type: 'auth/ready', disclosure: auth.disclosure });
        if (result.value.problem !== null) dispatch({ type: 'auth/sign-in-failed', failure: result.value.problem });
        refreshAccounts();
        if (live.accounts.storageFailure() !== null) {
          dispatch({ type: 'notice/added', notice: { code: 'storage-unavailable', level: 'warning', message: STORAGE_NOTICE_MESSAGE } });
        }
        const session = result.value.session;
        if (session !== null) await load('live', session, live, null);
      }),

    signIn: (handle: string) =>
      guard(async () => {
        if (auth === null || store.getState().auth.status !== 'ready') return;
        dispatch({ type: 'auth/sign-in-started' });
        let result;
        try {
          result = await auth.signIn(handle);
        } catch {
          result = { ok: false as const, failure: makeFailure('auth', 'Sign-in could not be started. Try again.') };
        }
        if (!result.ok) dispatch({ type: 'auth/sign-in-failed', failure: result.failure });
      }),

    switchAccount: (did: Did) =>
      guard(async () => {
        if (auth === null) return;
        let result;
        try {
          result = await auth.restore(did);
        } catch {
          result = { ok: false as const, failure: makeFailure('auth', 'This account needs to sign in again.') };
        }
        if (!result.ok) {
          live.accounts.markNeedsSignIn(did);
          refreshAccounts();
          dispatch({ type: 'auth/sign-in-failed', failure: result.failure });
          return;
        }
        await load('live', result.value, live, null);
      }),

    signOut: (did: Did) => guard(() => endSession(did)),

    removeAccount: (did: Did) =>
      guard(async () => {
        await endSession(did);
        live.accounts.remove(did);
        refreshAccounts();
      }),

    enterDemo,

    exitDemo: () =>
      guardSync(() => {
        if (store.getState().mode !== 'demo') return;
        abortRun();
        dispatch({ type: 'data/cleared' });
      }),

    reload: () =>
      guard(async () => {
        const state = store.getState();
        if (state.mode === 'live' && liveSession !== null && state.activeDid === liveSession.did) {
          await load('live', liveSession, live, null);
        } else if (state.mode === 'demo' && state.demoScenario !== null) {
          await enterDemo(state.demoScenario);
        }
      }),

    cancelLoad: () =>
      guardSync(() => {
        const { load: current } = store.getState();
        if (current.status !== 'loading') return;
        const runId = current.runId;
        abortRun();
        dispatch({ type: 'load/cancelled', runId });
      }),

    selectView: (view: ViewId) => guardSync(() => dispatch({ type: 'view/selected', view })),

    selectRange: (range: RangeId) =>
      guard(async () => {
        dispatch({ type: 'range/selected', range });
        const state = store.getState();
        if (state.snapshot === null) return;
        // Abort only the previous analysis; the snapshot and its load stay.
        await runAnalysis(state.load.runId, loadController?.signal ?? null);
      }),

    clearData: () =>
      guardSync(() => {
        abortRun();
        dispatch({ type: 'data/cleared' });
      }),

    dismissNotice: (code: NoticeCode) => guardSync(() => dispatch({ type: 'notice/dismissed', code })),
  };
};
