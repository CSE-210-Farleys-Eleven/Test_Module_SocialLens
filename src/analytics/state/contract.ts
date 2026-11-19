/**
 * M6c `analytics/state/` — FROZEN CONTRACT.
 * "What the app currently knows": one immutable AppState, a pure reducer, a store,
 * and the controller that sequences the ports and is the ONLY publisher of results.
 * Types only.
 */
import type { Did, Failure, Notice, NoticeCode, Nsid, RangeId, SessionRef, Snapshot, Unsubscribe } from '../../shared/contract';
import type { AuthDisclosure, AuthService, SessionEndReason } from '../../auth/contract';
import type { AccountsService, LinkedAccount } from '../../accounts/contract';
import type { RepoSource } from '../../adapters/atproto/contract';
import type { EngagementSource } from '../../adapters/bluesky/contract';
import type { DemoScenarioId } from '../../adapters/fixtures/contract';
import type { Registry } from '../../registry/contract';
import type { Normalizer } from '../../normalize/contract';
import type { AnalyticsOptions } from '../contract';
import type { PrivacyOptions } from '../privacy/contract';
import type { AnalysisResult, AnalysisRunner, FallbackReason } from '../worker/contract';

export type ViewId = 'overview' | 'activity' | 'engagement' | 'privacy' | 'accounts';
export const VIEW_IDS = ['overview', 'activity', 'engagement', 'privacy', 'accounts'] as const satisfies readonly ViewId[];

export type AppMode = 'none' | 'live' | 'demo';

export interface AuthState {
  /** 'unavailable' = live sign-in cannot be used in this build/browser; the demo still works. */
  readonly status: 'initialising' | 'ready' | 'unavailable';
  readonly disclosure: AuthDisclosure | null;
  readonly failure: Failure | null;
  /** True between a signIn call and its failure (success navigates away). */
  readonly signInPending: boolean;
}

export type LoadPhase = 'verifying-account' | 'reading-records' | 'reading-counts' | 'normalising';

export interface LoadProgress {
  readonly phase: LoadPhase;
  /** Collection being read, during 'reading-records'; else null. */
  readonly collection: Nsid | null;
  /** Steps finished / total within the phase (collections, or count batches). */
  readonly done: number;
  readonly total: number;
  /** Plain-language status line. */
  readonly message: string;
}

export interface LoadState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed' | 'cancelled';
  /** Generation counter. Starts at 0; every new load or reset increments it. Events with another runId are ignored. */
  readonly runId: number;
  readonly progress: LoadProgress | null;
  readonly failure: Failure | null;
  /** Measured wall-clock acquisition time of the last finished load; null otherwise. */
  readonly acquisitionMs: number | null;
}

export interface AnalysisState {
  readonly status: 'idle' | 'running' | 'ready' | 'failed';
  /** The range `result` was computed for. */
  readonly range: RangeId;
  readonly result: AnalysisResult | null;
  readonly ranIn: 'worker' | 'main-thread' | null;
  readonly fallbackReason: FallbackReason | null;
  readonly durationMs: number | null;
  readonly failure: Failure | null;
}

/** The single source of truth the UI renders from. Immutable; replaced, never mutated. */
export interface AppState {
  readonly auth: AuthState;
  readonly mode: AppMode;
  readonly demoScenario: DemoScenarioId | null;
  /** Live linked accounts (never contains the demo account). */
  readonly accounts: readonly LinkedAccount[];
  /** DID whose data is (being) shown: the live session DID, or the demo DID. */
  readonly activeDid: Did | null;
  readonly view: ViewId;
  readonly range: RangeId;
  readonly load: LoadState;
  readonly snapshot: Snapshot | null;
  readonly analysis: AnalysisState;
  /** At most one notice per code (a later one replaces the earlier). */
  readonly notices: readonly Notice[];
}

export type AppEvent =
  | { readonly type: 'auth/ready'; readonly disclosure: AuthDisclosure }
  | { readonly type: 'auth/unavailable'; readonly failure: Failure }
  | { readonly type: 'auth/sign-in-started' }
  | { readonly type: 'auth/sign-in-failed'; readonly failure: Failure }
  | { readonly type: 'accounts/changed'; readonly accounts: readonly LinkedAccount[] }
  | { readonly type: 'session/ended'; readonly did: Did; readonly reason: SessionEndReason }
  | {
      readonly type: 'load/started';
      /** Must be `state.load.runId + 1`. Clears snapshot, analysis and load failure. */
      readonly runId: number;
      readonly mode: 'live' | 'demo';
      readonly did: Did;
      readonly demoScenario: DemoScenarioId | null;
    }
  | { readonly type: 'load/progress'; readonly runId: number; readonly progress: LoadProgress }
  | { readonly type: 'load/snapshot-ready'; readonly runId: number; readonly snapshot: Snapshot; readonly acquisitionMs: number }
  | { readonly type: 'load/failed'; readonly runId: number; readonly failure: Failure }
  | { readonly type: 'load/cancelled'; readonly runId: number }
  | { readonly type: 'analysis/started'; readonly runId: number; readonly range: RangeId }
  | {
      readonly type: 'analysis/ready';
      readonly runId: number;
      readonly range: RangeId;
      readonly result: AnalysisResult;
      readonly ranIn: 'worker' | 'main-thread';
      readonly fallbackReason: FallbackReason | null;
      readonly durationMs: number;
    }
  | { readonly type: 'analysis/failed'; readonly runId: number; readonly range: RangeId; readonly failure: Failure }
  | { readonly type: 'view/selected'; readonly view: ViewId }
  | { readonly type: 'range/selected'; readonly range: RangeId }
  /** Back to mode 'none': drops snapshot, analysis, activeDid; increments runId. Keeps accounts and auth. */
  | { readonly type: 'data/cleared' }
  | { readonly type: 'notice/added'; readonly notice: Notice }
  | { readonly type: 'notice/dismissed'; readonly code: NoticeCode };

/** Pure. Returns the SAME reference when the event is stale or changes nothing. */
export type Reduce = (state: AppState, event: AppEvent) => AppState;

export type CreateInitialState = () => AppState;

export interface AppStoreReader {
  getState(): AppState;
  /** Listener runs synchronously after every dispatch that produced a new state reference. */
  subscribe(listener: (state: AppState) => void): Unsubscribe;
}

export interface AppStore extends AppStoreReader {
  dispatch(event: AppEvent): void;
}

export type CreateAppStore = (initial: AppState | null) => AppStore;

/** Everything the UI may ask for. No method ever rejects; every outcome lands in AppState. */
export interface AppActions {
  /** Start-up: initialise auth, load the account list, and load the restored session's data if there is one. */
  start(): Promise<void>;
  signIn(handle: string): Promise<void>;
  /** Make another linked account active and load it. */
  switchAccount(did: Did): Promise<void>;
  /** End the OAuth session for `did`; the account stays listed as 'needs-sign-in'. */
  signOut(did: Did): Promise<void>;
  /** Sign out (best effort) and forget the account on this browser. Local only. */
  removeAccount(did: Did): Promise<void>;
  enterDemo(scenario: DemoScenarioId): Promise<void>;
  /** Leave demo mode and drop its data. */
  exitDemo(): void;
  /** Re-read the active account (live or demo). */
  reload(): Promise<void>;
  cancelLoad(): void;
  selectView(view: ViewId): void;
  /** Change the date range and recompute analysis on the existing snapshot (no network). */
  selectRange(range: RangeId): Promise<void>;
  /** Drop the displayed data without signing out. */
  clearData(): void;
  dismissNotice(code: NoticeCode): void;
}

/** The read ports one data source (live or demo) provides. */
export interface DataPorts {
  readonly accounts: AccountsService;
  readonly repo: RepoSource;
  readonly engagement: EngagementSource;
  /** Supplies `Snapshot.fetchedAt`. Fixed for demo. */
  readonly now: () => Snapshot['fetchedAt'];
}

export interface DemoPorts extends DataPorts {
  readonly session: SessionRef;
}

export interface AppControllerDeps {
  readonly store: AppStore;
  /** null when live sign-in is unavailable in this build. */
  readonly auth: AuthService | null;
  readonly live: DataPorts;
  /** Builds fresh, isolated ports over the fixture fetch for one scenario. */
  readonly demo: (scenario: DemoScenarioId) => DemoPorts;
  readonly registry: Registry;
  readonly normalizer: Normalizer;
  readonly runner: AnalysisRunner;
  /** Defaults for every analysis run; `range` is overridden by `AppState.range`. */
  readonly analytics: Omit<AnalyticsOptions, 'range'>;
  readonly privacy: PrivacyOptions;
  /** Page cap per collection (LIMITS.maxPagesPerCollection). */
  readonly maxPagesPerCollection: number;
  readonly nowMs: () => number;
}

export type CreateAppController = (deps: AppControllerDeps) => AppActions;
