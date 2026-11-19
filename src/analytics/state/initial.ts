import type { RangeId } from '../../shared/contract';
import type { AnalysisState, AppState, CreateInitialState } from './contract';

export function idleAnalysis(range: RangeId): AnalysisState {
  return { status: 'idle', range, result: null, ranIn: null, fallbackReason: null, durationMs: null, failure: null };
}

export const createInitialState: CreateInitialState = () => ({
  auth: { status: 'initialising', disclosure: null, failure: null, signInPending: false },
  mode: 'none',
  demoScenario: null,
  accounts: [],
  activeDid: null,
  view: 'overview',
  range: '30d',
  load: { status: 'idle', runId: 0, progress: null, failure: null, acquisitionMs: null },
  snapshot: null,
  analysis: idleAnalysis('30d'),
  notices: [],
});
