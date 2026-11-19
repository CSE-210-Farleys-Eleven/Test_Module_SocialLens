/**
 * Pure reducer for AppState. Never mutates its input; returns the SAME reference for any
 * event that fails its guard (stale runId, wrong phase, no change) — the second line of
 * defence behind the controller's abort checks (PLAN §8, I-6).
 */
import type { Notice, NoticeCode } from '../../shared/contract';
import type { AppEvent, AppState, Reduce } from './contract';
import { idleAnalysis } from './initial';

const AUTH_UNAVAILABLE_NOTICE: Notice = {
  code: 'auth-unavailable',
  level: 'warning',
  message: 'Live sign-in is unavailable. The synthetic demo still works.',
};

const SESSION_ENDED_NOTICE: Notice = {
  code: 'session-ended',
  level: 'info',
  message: 'Your sign-in for this account ended, so its data was cleared. Sign in again to continue.',
};

/** Notices that belong to the previous load and are dropped when a new one starts. */
const CLEARED_ON_LOAD: readonly NoticeCode[] = ['session-ended', 'analysis-fallback'];

function addNotice(notices: readonly Notice[], notice: Notice): readonly Notice[] {
  const index = notices.findIndex((n) => n.code === notice.code);
  if (index === -1) return [...notices, notice];
  return notices.map((n, i) => (i === index ? notice : n));
}

function clearData(state: AppState): AppState {
  return {
    ...state,
    mode: 'none',
    demoScenario: null,
    activeDid: null,
    snapshot: null,
    analysis: idleAnalysis(state.range),
    load: { status: 'idle', runId: state.load.runId + 1, progress: null, failure: null, acquisitionMs: null },
  };
}

/** True for a load event of the current run while that run is still loading. */
function isCurrentLoading(state: AppState, runId: number): boolean {
  return runId === state.load.runId && state.load.status === 'loading';
}

export const reduce: Reduce = (state: AppState, event: AppEvent): AppState => {
  switch (event.type) {
    case 'auth/ready':
      return { ...state, auth: { ...state.auth, status: 'ready', disclosure: event.disclosure, failure: null } };

    case 'auth/unavailable':
      return {
        ...state,
        auth: { ...state.auth, status: 'unavailable', failure: event.failure, signInPending: false },
        notices: addNotice(state.notices, AUTH_UNAVAILABLE_NOTICE),
      };

    case 'auth/sign-in-started':
      if (state.auth.status !== 'ready') return state;
      return { ...state, auth: { ...state.auth, signInPending: true, failure: null } };

    case 'auth/sign-in-failed':
      return { ...state, auth: { ...state.auth, signInPending: false, failure: event.failure } };

    case 'accounts/changed':
      return { ...state, accounts: event.accounts };

    case 'session/ended': {
      if (state.mode !== 'live' || event.did !== state.activeDid) return state;
      const cleared = clearData(state);
      if (event.reason === 'signed-out') return cleared;
      return { ...cleared, notices: addNotice(cleared.notices, SESSION_ENDED_NOTICE) };
    }

    case 'load/started':
      if (event.runId !== state.load.runId + 1) return state;
      return {
        ...state,
        mode: event.mode,
        activeDid: event.did,
        demoScenario: event.demoScenario,
        load: { status: 'loading', runId: event.runId, progress: null, failure: null, acquisitionMs: null },
        snapshot: null,
        analysis: idleAnalysis(state.range),
        notices: state.notices.filter((n) => !CLEARED_ON_LOAD.includes(n.code)),
      };

    case 'load/progress':
      if (!isCurrentLoading(state, event.runId)) return state;
      return { ...state, load: { ...state.load, progress: event.progress } };

    case 'load/snapshot-ready':
      if (!isCurrentLoading(state, event.runId)) return state;
      return {
        ...state,
        snapshot: event.snapshot,
        load: { ...state.load, status: 'ready', progress: null, acquisitionMs: event.acquisitionMs },
      };

    case 'load/failed':
      if (!isCurrentLoading(state, event.runId)) return state;
      return { ...state, load: { ...state.load, status: 'failed', failure: event.failure, progress: null } };

    case 'load/cancelled':
      if (!isCurrentLoading(state, event.runId)) return state;
      return { ...state, load: { ...state.load, status: 'cancelled', progress: null } };

    case 'analysis/started':
      if (event.runId !== state.load.runId || state.snapshot === null) return state;
      return { ...state, analysis: { ...idleAnalysis(event.range), status: 'running' } };

    case 'analysis/ready':
      if (event.runId !== state.load.runId || state.snapshot === null || event.range !== state.range) return state;
      return {
        ...state,
        analysis: {
          status: 'ready',
          range: event.range,
          result: event.result,
          ranIn: event.ranIn,
          fallbackReason: event.fallbackReason,
          durationMs: event.durationMs,
          failure: null,
        },
      };

    case 'analysis/failed':
      if (event.runId !== state.load.runId || state.snapshot === null || event.range !== state.range) return state;
      return { ...state, analysis: { ...idleAnalysis(event.range), status: 'failed', failure: event.failure } };

    case 'view/selected':
      if (event.view === state.view) return state;
      return { ...state, view: event.view };

    case 'range/selected':
      if (event.range === state.range) return state;
      return { ...state, range: event.range };

    case 'data/cleared':
      return clearData(state);

    case 'notice/added':
      return { ...state, notices: addNotice(state.notices, event.notice) };

    case 'notice/dismissed':
      if (!state.notices.some((n) => n.code === event.code)) return state;
      return { ...state, notices: state.notices.filter((n) => n.code !== event.code) };
  }
};
