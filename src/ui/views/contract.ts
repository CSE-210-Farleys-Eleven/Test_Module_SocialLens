/**
 * M7a `ui/views/` — FROZEN CONTRACT.
 * Overview · Activity · Engagement · Privacy · Accounts, plus the app shell and the mount loop.
 * Views are functions of (AppState, AppActions): they never fetch and never compute metrics.
 */
import type { Glossary } from '../../shared/contract';
import type { RegistryData } from '../../registry/contract';
import type { DemoScenarioInfo } from '../../adapters/fixtures/contract';
import type { AppActions, AppState, AppStoreReader } from '../../analytics/state/contract';
import type { Components } from '../components/contract';

export interface ViewProps {
  readonly state: AppState;
  readonly actions: AppActions;
}

export type ViewRenderer = (props: ViewProps) => HTMLElement;

export interface Views {
  /** Whole application: skip link, demo banner, navigation, notices, loading / landing / active view. */
  shell: ViewRenderer;
  overview: ViewRenderer;
  activity: ViewRenderer;
  engagement: ViewRenderer;
  privacy: ViewRenderer;
  accounts: ViewRenderer;
}

export interface ViewsDeps {
  readonly components: Components;
  readonly registry: RegistryData;
  readonly glossary: Glossary;
  /** Scenarios offered by the demo picker. */
  readonly demoScenarios: readonly DemoScenarioInfo[];
  readonly document: Document;
}

export type CreateViews = (deps: ViewsDeps) => Views;

export interface MountDeps {
  readonly root: HTMLElement;
  readonly store: AppStoreReader;
  readonly actions: AppActions;
  readonly views: Views;
}

export interface MountedApp {
  /** Stop listening to the store and empty the root. */
  unmount(): void;
}

/** Render `views.shell` now and after every state change (replaceChildren), preserving keyboard focus by element id. */
export type MountApp = (deps: MountDeps) => MountedApp;

/** Stable `data-testid` values. Views must set them; tests and the integration suite select by them. */
export const TEST_IDS = {
  demoBanner: 'demo-banner',
  liveBanner: 'live-banner',
  nav: 'main-nav',
  navItem: 'nav-item', // suffixed: `nav-item-<ViewId>`
  rangeSelect: 'range-select',
  noticeList: 'notice-list',
  landing: 'landing',
  demoStart: 'demo-start', // suffixed: `demo-start-<DemoScenarioId>`
  loading: 'loading',
  cancelLoad: 'cancel-load',
  loadFailed: 'load-failed',
  viewOverview: 'view-overview',
  viewActivity: 'view-activity',
  viewEngagement: 'view-engagement',
  viewPrivacy: 'view-privacy',
  viewAccounts: 'view-accounts',
  includesNote: 'includes-apps-note',
  coverageTable: 'coverage-table',
  unanalysedList: 'unanalysed-collections',
  skippedTable: 'skipped-table',
  observation: 'observation', // suffixed: `observation-<ObservationId>`
  notAvailableList: 'not-available-metrics',
  signInForm: 'sign-in-form',
  handleInput: 'handle-input',
  resolverDisclosure: 'resolver-disclosure',
  accountRow: 'account-row', // suffixed: `account-row-<did>`
  removeAccount: 'remove-account',
  removeScopeNote: 'remove-scope-note',
  clearData: 'clear-data',
} as const;
export type TestId = (typeof TEST_IDS)[keyof typeof TEST_IDS];
