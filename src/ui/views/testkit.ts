// Test-only helpers for src/ui/views: a fake Components that records every call,
// fake AppActions that record calls, and hand-built AppState values.
// Not part of the public API; imported only by *.test.ts files in this folder.
import type {
  AppId,
  AtUri,
  Coverage,
  Did,
  Handle,
  HttpsOrigin,
  IsoDate,
  IsoDateTime,
  MetricId,
  MetricValue,
  Notice,
  Nsid,
  Snapshot,
  ValueStatus,
} from '../../shared/contract';
import { GLOSSARY, STATUS_LABEL_TEXT } from '../../shared';
import type { RegistryData } from '../../registry/contract';
import type { DemoScenarioInfo } from '../../adapters/fixtures/contract';
import type { AppActions, AppState } from '../../analytics/state/contract';
import type { AnalyticsReport, KindTotal } from '../../analytics/contract';
import type { PrivacyObservation, PrivacyReport } from '../../analytics/privacy/contract';
import type { LinkedAccount } from '../../accounts/contract';
import type { AuthDisclosure } from '../../auth/contract';
import type { Attrs, Child, Components } from '../components/contract';

// ───────────────────────────── fake components ─────────────────────────────

export interface ComponentCall {
  readonly name: keyof Components;
  readonly props: unknown;
}

export interface FakeComponents extends Components {
  readonly calls: ComponentCall[];
  callsOf(name: keyof Components): unknown[];
}

const FORBIDDEN_ATTR = /^(on.*|style|srcdoc|href)$/i;

export function createFakeComponents(doc: Document): FakeComponents {
  const calls: ComponentCall[] = [];
  const record = (name: keyof Components, props: unknown): void => {
    calls.push({ name, props });
  };

  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] => {
    if (tag === 'script' || tag === 'iframe' || tag === 'img') throw new TypeError(`forbidden tag ${tag}`);
    const el = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (FORBIDDEN_ATTR.test(key)) throw new TypeError(`forbidden attribute ${key}`);
      if (value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
    append(el, children);
    return el;
  };

  const append = (el: Element, children: readonly Child[]): void => {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (typeof child === 'string' || typeof child === 'number') el.appendChild(doc.createTextNode(String(child)));
      else el.appendChild(child);
    }
  };

  const fakeFormat = (v: MetricValue): string => {
    if (v.status === 'not-available') return 'Not available';
    if (v.status === 'unknown' || v.value === null) return 'Unknown';
    if (v.status === 'partial' && v.isLowerBound) return `At least ${v.value}`;
    return String(v.value);
  };

  const components: FakeComponents = {
    calls,
    callsOf: (name) => calls.filter((c) => c.name === name).map((c) => c.props),
    h,
    button(props) {
      record('button', props);
      const el = doc.createElement('button');
      el.setAttribute('type', 'button');
      el.setAttribute('data-variant', props.variant);
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      if (props.disabled) el.disabled = true;
      if (props.current) el.setAttribute('aria-current', 'page');
      el.appendChild(doc.createTextNode(props.label));
      el.addEventListener('click', () => {
        if (!el.disabled) props.onClick();
      });
      return el;
    },
    select(props) {
      record('select', props);
      const wrap = doc.createElement('div');
      const label = doc.createElement('label');
      label.setAttribute('for', props.id);
      label.appendChild(doc.createTextNode(props.label));
      const sel = doc.createElement('select');
      sel.id = props.id;
      if (props.testId !== null) sel.setAttribute('data-testid', props.testId);
      for (const o of props.options) {
        const opt = doc.createElement('option');
        opt.value = o.value;
        opt.appendChild(doc.createTextNode(o.label));
        if (o.value === props.value) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => props.onChange(sel.value));
      wrap.append(label, sel);
      return wrap;
    },
    textInput(props) {
      record('textInput', props);
      const wrap = doc.createElement('div');
      const label = doc.createElement('label');
      label.setAttribute('for', props.id);
      label.appendChild(doc.createTextNode(props.label));
      const input = doc.createElement('input');
      input.type = 'text';
      input.id = props.id;
      input.value = props.value;
      input.placeholder = props.placeholder;
      input.maxLength = props.maxLength;
      if (props.testId !== null) input.setAttribute('data-testid', props.testId);
      input.addEventListener('input', () => props.onInput(input.value));
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') props.onSubmit(input.value);
      });
      wrap.append(label, input);
      if (props.description !== null) {
        const p = doc.createElement('p');
        p.appendChild(doc.createTextNode(props.description));
        wrap.appendChild(p);
      }
      return wrap;
    },
    card(props) {
      record('card', props);
      const el = doc.createElement('section');
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      const h2 = doc.createElement('h2');
      h2.appendChild(doc.createTextNode(props.title));
      el.appendChild(h2);
      if (props.subtitle !== null) {
        const p = doc.createElement('p');
        p.appendChild(doc.createTextNode(props.subtitle));
        el.appendChild(p);
      }
      append(el, props.children);
      return el;
    },
    statusLabel(label) {
      record('statusLabel', label);
      const el = doc.createElement('span');
      el.setAttribute('data-status', label);
      el.appendChild(doc.createTextNode(STATUS_LABEL_TEXT[label]));
      return el;
    },
    metricCard(props) {
      record('metricCard', props);
      const el = doc.createElement('div');
      el.setAttribute('data-component', 'metric-card');
      el.setAttribute('data-metric-id', props.value.metricId);
      el.setAttribute('data-status', props.value.status);
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      el.appendChild(doc.createTextNode(`${props.label ?? props.value.metricId}: ${fakeFormat(props.value)}`));
      if (props.detail !== null) el.appendChild(doc.createTextNode(` (${props.detail})`));
      return el;
    },
    dataTable(props) {
      record('dataTable', props);
      const el = doc.createElement('div');
      el.setAttribute('data-component', 'data-table');
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      const table = doc.createElement('table');
      const caption = doc.createElement('caption');
      caption.appendChild(doc.createTextNode(props.caption));
      table.appendChild(caption);
      const tbody = doc.createElement('tbody');
      for (const row of props.rows) {
        const tr = doc.createElement('tr');
        for (const cell of row) {
          const td = doc.createElement('td');
          append(td, [cell]);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      el.appendChild(table);
      if (props.rows.length === 0) {
        const p = doc.createElement('p');
        p.appendChild(doc.createTextNode(props.emptyText));
        el.appendChild(p);
      }
      return el;
    },
    barChart(props) {
      record('barChart', props);
      const el = doc.createElement('div');
      el.setAttribute('data-component', 'bar-chart');
      el.setAttribute('data-title', props.title);
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      el.appendChild(doc.createTextNode(props.title));
      return el;
    },
    banner(props) {
      record('banner', props);
      const el = doc.createElement('div');
      el.setAttribute('role', 'status');
      el.setAttribute('data-tone', props.tone);
      if (props.testId !== null) el.setAttribute('data-testid', props.testId);
      el.appendChild(doc.createTextNode(`${props.badge} ${props.text}`));
      return el;
    },
    noticeList(props) {
      record('noticeList', props);
      const ul = doc.createElement('ul');
      for (const n of props.notices) {
        const li = doc.createElement('li');
        li.setAttribute('data-notice-code', n.code);
        li.appendChild(doc.createTextNode(n.message));
        const b = doc.createElement('button');
        b.appendChild(doc.createTextNode('Dismiss'));
        b.addEventListener('click', () => props.onDismiss(n.code));
        li.appendChild(b);
        ul.appendChild(li);
      }
      return ul;
    },
    glossaryTerm(props) {
      record('glossaryTerm', props);
      const el = doc.createElement('span');
      el.appendChild(doc.createTextNode(props.text ?? props.metricId));
      return el;
    },
    atUriList(props) {
      record('atUriList', props);
      const el = doc.createElement('div');
      el.setAttribute('data-component', 'at-uri-list');
      el.appendChild(doc.createTextNode(props.label));
      const ul = doc.createElement('ul');
      for (const uri of props.uris) {
        const li = doc.createElement('li');
        const code = doc.createElement('code');
        code.appendChild(doc.createTextNode(uri));
        li.appendChild(code);
        ul.appendChild(li);
      }
      el.appendChild(ul);
      if (props.uris.length === 0) el.appendChild(doc.createTextNode(props.emptyText));
      return el;
    },
    citationLink(props) {
      record('citationLink', props);
      const el = doc.createElement('span');
      el.setAttribute('data-component', 'citation');
      el.setAttribute('data-source-id', props.citation.sourceId);
      el.appendChild(doc.createTextNode(`${props.citation.title} — ${props.citation.publisher}`));
      return el;
    },
    definitionList(items) {
      record('definitionList', items);
      const dl = doc.createElement('dl');
      for (const item of items) {
        const dt = doc.createElement('dt');
        dt.appendChild(doc.createTextNode(item.term));
        const dd = doc.createElement('dd');
        append(dd, [item.description]);
        dl.append(dt, dd);
      }
      return dl;
    },
    emptyState(props) {
      record('emptyState', props);
      const el = doc.createElement('div');
      el.setAttribute('data-component', 'empty-state');
      el.appendChild(doc.createTextNode(`${props.title} ${props.detail}`));
      return el;
    },
  };
  return components;
}

// ───────────────────────────── fake actions ─────────────────────────────

export type ActionCall = readonly [keyof AppActions, ...unknown[]];

export interface FakeActions extends AppActions {
  readonly calls: ActionCall[];
}

export function createFakeActions(): FakeActions {
  const calls: ActionCall[] = [];
  const p = (name: keyof AppActions, ...args: unknown[]): Promise<void> => {
    calls.push([name, ...args]);
    return Promise.resolve();
  };
  const v = (name: keyof AppActions, ...args: unknown[]): void => {
    calls.push([name, ...args]);
  };
  return {
    calls,
    start: () => p('start'),
    signIn: (handle) => p('signIn', handle),
    switchAccount: (did) => p('switchAccount', did),
    signOut: (did) => p('signOut', did),
    removeAccount: (did) => p('removeAccount', did),
    enterDemo: (s) => p('enterDemo', s),
    exitDemo: () => v('exitDemo'),
    reload: () => p('reload'),
    cancelLoad: () => v('cancelLoad'),
    selectView: (view) => v('selectView', view),
    selectRange: (range) => p('selectRange', range),
    clearData: () => v('clearData'),
    dismissNotice: (code) => v('dismissNotice', code),
  };
}

// ───────────────────────────── static deps ─────────────────────────────

const nsid = (s: string): Nsid => s as Nsid;

export const DEMO_DID = 'did:plc:demosyntheticaccount2222' as Did;
export const LIVE_DID = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
export const OTHER_DID = 'did:plc:zyxwvutsrqponmlkjihgfedc' as Did;

const COLLECTIONS: ReadonlyArray<readonly [string, AppId, string, RecordKind]> = [
  ['app.bsky.feed.post', 'bluesky', 'Posts & replies', 'post'],
  ['app.bsky.feed.repost', 'bluesky', 'Reposts', 'repost'],
  ['app.bsky.feed.like', 'bluesky', 'Likes given', 'like'],
  ['app.bsky.graph.follow', 'bluesky', 'Follows', 'follow'],
  ['app.bsky.graph.block', 'bluesky', 'Blocks', 'block'],
  ['app.bsky.graph.list', 'bluesky', 'Lists', 'list'],
  ['app.bsky.graph.listitem', 'bluesky', 'List memberships you created', 'list-item'],
  ['app.bsky.actor.profile', 'bluesky', 'Profile', 'profile'],
  ['site.standard.document', 'standard-site', 'Documents', 'document'],
  ['site.standard.publication', 'standard-site', 'Publications', 'publication'],
];
type RecordKind = KindTotal['kind'];

export const REGISTRY: RegistryData = {
  version: 'test',
  apps: [
    {
      id: 'bluesky',
      displayName: 'Bluesky',
      kindLabels: {
        post: 'Post',
        reply: 'Reply',
        repost: 'Repost',
        like: 'Like given',
        follow: 'Follow',
        block: 'Block',
        list: 'List',
        'list-item': 'List membership you created',
        profile: 'Profile',
      },
      collections: COLLECTIONS.filter((c) => c[1] === 'bluesky').map((c) => nsid(c[0])),
      capability: { appId: 'bluesky', metrics: [], unavailable: [], engagementCounts: true, history: 'h', freshness: 'f' },
      source: 'bsky-privacy-policy',
    },
    {
      id: 'standard-site',
      displayName: 'Standard.site',
      kindLabels: { document: 'Document', publication: 'Publication' },
      collections: COLLECTIONS.filter((c) => c[1] === 'standard-site').map((c) => nsid(c[0])),
      capability: { appId: 'standard-site', metrics: [], unavailable: [], engagementCounts: false, history: 'h', freshness: 'f' },
      source: 'standard-site',
    },
  ],
  collections: COLLECTIONS.map(([n, app, label, kind]) => ({
    nsid: nsid(n),
    appId: app,
    label,
    normalizerId: 'bsky.post',
    kinds: kind === 'post' ? ['post', 'reply'] : [kind],
    visibility: 'public-repo',
    visibilitySource: 'bsky-privacy-policy',
    timestampField: 'createdAt',
    engagementSource: kind === 'post' ? 'bluesky-appview' : null,
    pageSize: 100,
  })),
  nonRepoData: [
    { label: 'Mutes', visibility: 'private-app', explanation: 'Mutes are stored by the Bluesky app.', source: 'bsky-docs-following' },
    { label: 'Direct messages', visibility: 'private-service', explanation: 'Direct messages are not public records.', source: 'bsky-privacy-policy' },
    { label: 'Permissioned spaces', visibility: 'future-permissioned', explanation: 'Access-controlled data is in alpha.', source: 'atproto-blog-spaces' },
  ],
};

export const DEMO_SCENARIOS: readonly DemoScenarioInfo[] = [
  { id: 'complete', label: 'Complete read', description: 'Everything read.' },
  { id: 'partial', label: 'Partial read', description: 'Some failures.' },
  { id: 'empty', label: 'Empty account', description: 'Nothing.' },
];

export function makeDeps(doc: Document = document) {
  const components = createFakeComponents(doc);
  return { components, registry: REGISTRY, glossary: GLOSSARY, demoScenarios: DEMO_SCENARIOS, document: doc };
}

// ───────────────────────────── values ─────────────────────────────

export function mv(metricId: MetricId, value: number | null, status: ValueStatus = 'exact', extra: Partial<MetricValue> = {}): MetricValue {
  return {
    metricId,
    value,
    status,
    isLowerBound: status === 'partial',
    reason: status === 'exact' ? null : 'A reason.',
    numerator: null,
    denominator: null,
    contributingApps: ['bluesky', 'standard-site'],
    ...extra,
  };
}

const iso = (s: string): IsoDateTime => s as IsoDateTime;
const day = (s: string): IsoDate => s as IsoDate;
export const uri = (did: Did, coll: string, rkey: string): AtUri => `at://${did}/${coll}/${rkey}` as AtUri;

export function coverageRow(n: string, status: Coverage['status'] = 'complete', accepted = 10): Coverage {
  return {
    collection: nsid(n),
    status,
    reasonCode: status === 'complete' ? 'ok' : status === 'partial' ? 'page-cap' : 'first-page-failed',
    reason: status === 'complete' ? 'All pages read.' : status === 'partial' ? 'Stopped at the 10-page limit.' : 'The first page could not be read.',
    pagesFetched: status === 'unavailable' ? 0 : 1,
    returned: accepted,
    accepted: status === 'unavailable' ? 0 : accepted,
    rejected: 0,
    duplicates: 0,
    failure: null,
  };
}

export function makeSnapshot(mode: 'live' | 'demo' = 'demo', overrides: Partial<Snapshot> = {}): Snapshot {
  const did = mode === 'demo' ? DEMO_DID : LIVE_DID;
  return {
    schemaVersion: 1,
    mode,
    demoScenario: mode === 'demo' ? 'complete' : null,
    account: {
      did,
      didMethod: 'plc',
      handle: (mode === 'demo' ? 'synthetic-demo.example' : 'alice.example.com') as Handle,
      handleStatus: 'valid',
      handleCheck: 'pds-attested',
      pdsOrigin: (mode === 'demo' ? 'https://pds.synthetic-demo.invalid' : 'https://pds.example.com') as HttpsOrigin,
      verifiedAt: iso('2026-11-10T23:59:59.000Z'),
    },
    fetchedAt: iso('2026-11-10T23:59:59.000Z'),
    records: [],
    skipped: [],
    coverage: COLLECTIONS.map(([n]) => coverageRow(n)),
    engagementCoverage: { status: 'complete', requested: 12, known: 12, unknown: 0, batches: 1, batchesFailed: 0, failure: null, reason: 'All counters read.' },
    inventoryStatus: 'known',
    unanalysedCollections: [],
    notices: mode === 'demo' ? [{ code: 'demo-synthetic', level: 'info', message: 'Synthetic demo data.' }] : [],
    ...overrides,
  };
}

export function makeObservation(id: PrivacyObservation['id'], did: Did = DEMO_DID, overrides: Partial<PrivacyObservation> = {}): PrivacyObservation {
  return {
    id,
    title: `Title of ${id}`,
    summary: `Summary of ${id}.`,
    evidence: {
      count: 40,
      countCertainty: 'exact',
      sampleUris: [uri(did, 'app.bsky.feed.like', '3kaaa'), uri(did, 'app.bsky.feed.like', '3kaab')],
      earliestAt: iso('2026-01-02T03:04:05.000Z'),
      latestAt: iso('2026-11-09T10:00:00.000Z'),
      collections: [nsid('app.bsky.feed.like')],
      details: [{ label: 'Busiest band', value: '18:00–23:59 UTC' }],
    },
    source: { sourceId: 'bsky-privacy-policy', title: 'Privacy Policy', publisher: 'Bluesky Social PBC', url: 'https://bsky.social/about/support/privacy-policy', accessed: '2026-11-18' },
    limitation: `Limitation of ${id}.`,
    action: `Action for ${id}.`,
    ...overrides,
  };
}

const KINDS: readonly RecordKind[] = ['post', 'reply', 'repost', 'like', 'follow', 'block', 'list', 'list-item', 'profile', 'document', 'publication'];

export function makeAnalytics(did: Did = DEMO_DID, overrides: Partial<AnalyticsReport> = {}): AnalyticsReport {
  const apps: readonly AppId[] = ['bluesky', 'standard-site'];
  return {
    schemaVersion: 1,
    did,
    fetchedAt: iso('2026-11-10T23:59:59.000Z'),
    mode: 'demo',
    window: { range: '30d', timezone: 'UTC', start: iso('2026-10-12T00:00:00.000Z'), end: iso('2026-11-10T23:59:59.000Z'), startDate: day('2026-10-12'), endDate: day('2026-11-10'), days: 30 },
    coverageComplete: true,
    overview: {
      includedApps: apps,
      contentItems: mv('content.items', 124),
      activeDays: mv('activity.activeDays', 20),
      recordsTotal: mv('records.total', 214),
      lastContentAt: iso('2026-11-10T14:00:00.000Z'),
    },
    byKind: KINDS.map((kind) => ({ kind, appId: kind === 'document' || kind === 'publication' ? 'standard-site' : 'bluesky', count: mv('records.byKind', kind === 'like' ? 40 : 3) })),
    byApp: apps.map((appId) => ({ appId, records: mv('records.byApp', 100), contentItems: mv('content.items', 60) })),
    undated: 0,
    futureDated: 0,
    engagement: {
      eligiblePosts: 14,
      knownPosts: 12,
      unknownPosts: 2,
      settlingPosts: 0,
      likes: mv('engagement.likes', 30, 'exact', { contributingApps: ['bluesky'] }),
      reposts: mv('engagement.reposts', 5, 'exact', { contributingApps: ['bluesky'] }),
      replies: mv('engagement.replies', 4, 'exact', { contributingApps: ['bluesky'] }),
      quotes: mv('engagement.quotes', 1, 'exact', { contributingApps: ['bluesky'] }),
      interactions: mv('engagement.interactions', 40, 'exact', { contributingApps: ['bluesky'] }),
      interactionsPerPost: mv('engagement.interactionsPerPost', 40 / 12, 'partial', { isLowerBound: false, numerator: 40, denominator: 12, contributingApps: ['bluesky'] }),
      knownShare: mv('engagement.knownShare', 12 / 14, 'partial', { isLowerBound: false, numerator: 12, denominator: 14, contributingApps: ['bluesky'] }),
      perApp: [
        { appId: 'bluesky', available: true, reason: null },
        { appId: 'standard-site', available: false, reason: 'Standard.site has no public interaction counters.' },
      ],
    },
    topPosts: [
      {
        rank: 1,
        uri: uri(did, 'app.bsky.feed.post', '3kpost1'),
        kind: 'post',
        createdAt: iso('2026-11-08T12:00:00.000Z'),
        textPreview: 'Hello world',
        counts: { likes: 10, reposts: 2, replies: 1, quotes: 0 },
        interactions: 13,
        settling: false,
      },
    ],
    hourHistogram: {
      metricId: 'activity.hourHistogram',
      timezone: 'UTC',
      bins: Array.from({ length: 24 }, (_, i) => ({ index: i, label: String(i).padStart(2, '0'), count: i % 3 })),
      total: 23,
      status: 'exact',
    },
    weekdayHistogram: {
      metricId: 'activity.weekdayHistogram',
      timezone: 'UTC',
      bins: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => ({ index, label, count: index })),
      total: 21,
      status: 'exact',
    },
    timeline: {
      metricId: 'activity.dailyTimeline',
      timezone: 'UTC',
      days: [
        { date: day('2026-11-09'), content: { bluesky: 2, 'standard-site': 1 }, outbound: 4 },
        { date: day('2026-11-10'), content: { bluesky: 0, 'standard-site': 0 }, outbound: 1 },
      ],
      truncated: false,
      status: 'exact',
    },
    streak: {
      current: mv('activity.streak.current', 2),
      longest: mv('activity.streak.longest', 5),
      currentStart: day('2026-11-09'),
      currentEnd: day('2026-11-10'),
      longestStart: day('2026-10-01'),
      longestEnd: day('2026-10-05'),
    },
    weekOverWeek: {
      current: { startDate: day('2026-11-04'), endDate: day('2026-11-10'), contentItems: mv('activity.weekOverWeek', 5) },
      previous: { startDate: day('2026-10-28'), endDate: day('2026-11-03'), contentItems: mv('activity.weekOverWeek', 2) },
      delta: 3,
      deltaFraction: 1.5,
    },
    ...overrides,
  };
}

export function makePrivacy(did: Did = DEMO_DID, overrides: Partial<PrivacyReport> = {}): PrivacyReport {
  return {
    schemaVersion: 1,
    did,
    fetchedAt: iso('2026-11-10T23:59:59.000Z'),
    mode: 'demo',
    observations: [makeObservation('public-likes', did), makeObservation('public-follows', did)],
    notTriggered: [{ id: 'public-blocks', reason: 'No block records were fetched.' }],
    notAssessed: REGISTRY.nonRepoData,
    ...overrides,
  };
}

const DISCLOSURE: AuthDisclosure = {
  scope: 'atproto',
  clientKind: 'loopback',
  handleResolverOrigin: 'https://bsky.social',
  handleResolverIsThirdParty: true,
  resolverNotice: 'The handle you type and your IP address are sent to https://bsky.social to find your account.',
  storageNotice: 'Sign-in tokens are kept in this browser by the OAuth library.',
  source: 'oauth-client-browser-readme',
};

export function initialState(overrides: Partial<AppState> = {}): AppState {
  return {
    auth: { status: 'ready', disclosure: DISCLOSURE, failure: null, signInPending: false },
    mode: 'none',
    demoScenario: null,
    accounts: [],
    activeDid: null,
    view: 'overview',
    range: '30d',
    load: { status: 'idle', runId: 0, progress: null, failure: null, acquisitionMs: null },
    snapshot: null,
    analysis: { status: 'idle', range: '30d', result: null, ranIn: null, fallbackReason: null, durationMs: null, failure: null },
    notices: [],
    ...overrides,
  };
}

export function demoReadyState(overrides: Partial<AppState> = {}): AppState {
  return initialState({
    mode: 'demo',
    demoScenario: 'complete',
    activeDid: DEMO_DID,
    load: { status: 'ready', runId: 1, progress: null, failure: null, acquisitionMs: 120 },
    snapshot: makeSnapshot('demo'),
    analysis: {
      status: 'ready',
      range: '30d',
      result: { analytics: makeAnalytics(DEMO_DID), privacy: makePrivacy(DEMO_DID) },
      ranIn: 'worker',
      fallbackReason: null,
      durationMs: 42,
      failure: null,
    },
    ...overrides,
  });
}

export function linkedAccount(did: Did, overrides: Partial<LinkedAccount> = {}): LinkedAccount {
  return {
    did,
    didMethod: 'plc',
    handle: 'alice.example.com' as Handle,
    handleStatus: 'valid',
    pdsOrigin: 'https://pds.example.com' as HttpsOrigin,
    status: 'verified',
    verifiedAt: iso('2026-11-10T23:59:59.000Z'),
    addedAt: iso('2026-11-01T00:00:00.000Z'),
    lastFailure: null,
    ...overrides,
  };
}

export function liveReadyState(overrides: Partial<AppState> = {}): AppState {
  const analytics = makeAnalytics(LIVE_DID, { mode: 'live' });
  return demoReadyState({
    mode: 'live',
    demoScenario: null,
    activeDid: LIVE_DID,
    accounts: [linkedAccount(LIVE_DID), linkedAccount(OTHER_DID, { handle: 'bob.example.com' as Handle, status: 'needs-sign-in' })],
    snapshot: makeSnapshot('live'),
    analysis: {
      status: 'ready',
      range: '30d',
      result: { analytics, privacy: makePrivacy(LIVE_DID, { mode: 'live' }) },
      ranIn: 'main-thread',
      fallbackReason: 'worker-timeout',
      durationMs: 7,
      failure: null,
    },
    ...overrides,
  });
}

export const NOTICE = (code: Notice['code'], message = `Notice ${code}`): Notice => ({ code, level: 'warning', message });

/** Render `views.shell` into a fresh root attached to the document. */
export function renderInto(el: HTMLElement): HTMLElement {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  root.appendChild(el);
  return root;
}

export const byTestId = (root: ParentNode, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);
