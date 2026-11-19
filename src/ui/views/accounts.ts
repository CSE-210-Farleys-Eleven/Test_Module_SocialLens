// Accounts: active account, sign-in (own account only), linked accounts, what was read, network, timings.
import { citation, ORIGINS } from '../../shared';
import type { Snapshot } from '../../shared/contract';
import type { LinkedAccount } from '../../accounts/contract';
import type { AppActions, AppState } from '../../analytics/state/contract';
import type { Child } from '../components/contract';
import type { ViewRenderer, ViewsDeps } from './contract';
import { TEST_IDS } from './contract';
import { collectionLabel, formatDateTime, formatInt, handleStatusText, viewRoot } from './common';

/** The only view-local state: the unsubmitted handle draft. */
export interface DraftHolder {
  value: string;
}

const SKIPPED_MAX = 50;
const HANDLE_MAX = 253;

const COVERAGE_STATUS_TEXT = { complete: 'Complete', partial: 'Partial', unavailable: 'Unavailable' } as const;

const FALLBACK_RESOLVER_NOTICE = `When you sign in, the handle you type and this device's IP address are sent to ${ORIGINS.oauthHandleResolver} to find your account.`;
const FALLBACK_STORAGE_NOTICE = 'Sign-in tokens are kept in this browser by the OAuth library; SocialLens never reads them.';

export function createAccounts(deps: ViewsDeps, draft: DraftHolder): ViewRenderer {
  const c = deps.components;
  const btn = (label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'text' | 'danger', testId: string | null = null, disabled = false, id: string | null = null) => {
    const el = c.button({ label, onClick, variant, disabled, testId, current: false });
    if (id !== null) el.id = id;
    return el;
  };

  const activeAccount = (state: AppState): HTMLElement | null => {
    const snap = state.snapshot;
    const linked = state.mode === 'live' && state.activeDid !== null ? (state.accounts.find((a) => a.did === state.activeDid) ?? null) : null;
    if (snap === null && linked === null) return null;
    const did = snap?.account.did ?? linked!.did;
    const handle = snap?.account.handle ?? linked?.handle ?? null;
    const status = snap?.account.handleStatus ?? linked!.handleStatus;
    const checked = snap !== null ? snap.account.handleCheck === 'pds-attested' : status !== 'unverified';
    const pds = snap?.account.pdsOrigin ?? linked?.pdsOrigin ?? null;
    const verifiedAt = snap?.account.verifiedAt ?? linked?.verifiedAt ?? null;
    const label = handleStatusText(status);
    return c.card({
      title: state.mode === 'demo' ? 'Synthetic demo account' : 'Active account',
      subtitle: null,
      testId: 'active-account',
      children: [
        c.h(
          'p',
          { class: 'identity-handle' },
          handle ?? 'no handle',
          ' ',
          label === null ? null : c.h('span', { class: `handle-status handle-status-${status}` }, label),
          label === null ? null : ' ',
          c.h('span', { class: 'muted' }, checked ? '(checked by your PDS)' : '(not checked)'),
        ),
        c.h('p', { class: 'identity-did' }, c.h('code', null, did)),
        c.definitionList([
          { term: 'PDS', description: pds ?? 'Unknown' },
          { term: 'Verified at', description: verifiedAt === null ? 'Not verified' : `${formatDateTime(verifiedAt)} UTC` },
        ]),
      ],
    });
  };

  const signIn = (state: AppState, actions: AppActions): HTMLElement => {
    const auth = state.auth;
    const disabled = auth.signInPending || auth.status !== 'ready';
    const submit = (value: string) => {
      draft.value = value;
      if (state.auth.signInPending || state.auth.status !== 'ready') return;
      void actions.signIn(draft.value.trim());
    };
    const disclosure = auth.disclosure;
    return c.h(
      'section',
      { class: 'sign-in', 'data-testid': TEST_IDS.signInForm, 'aria-labelledby': 'sign-in-title' },
      c.h('h2', { id: 'sign-in-title' }, 'Sign in to your own account'),
      c.h('p', { class: 'muted' }, 'SocialLens reads only the account you sign in to. It asks for no write permission.'),
      c.h(
        'div',
        { class: 'disclosure', 'data-testid': TEST_IDS.resolverDisclosure },
        c.h('p', null, disclosure?.resolverNotice ?? FALLBACK_RESOLVER_NOTICE),
        c.h('p', null, disclosure?.storageNotice ?? FALLBACK_STORAGE_NOTICE),
        c.h('p', { class: 'muted' }, 'Source: ', c.citationLink({ citation: citation(disclosure?.source ?? 'oauth-client-browser-readme') })),
      ),
      c.textInput({
        id: TEST_IDS.handleInput,
        label: 'Your handle',
        placeholder: 'name.example.com',
        value: draft.value,
        maxLength: HANDLE_MAX,
        description: null,
        onInput: (v) => {
          draft.value = v;
        },
        onSubmit: submit,
        testId: TEST_IDS.handleInput,
      }),
      btn('Sign in with AT Protocol', () => submit(draft.value), 'primary', 'sign-in-submit', disabled, 'sign-in-submit'),
      auth.signInPending ? c.h('p', { class: 'muted', role: 'status' }, 'Opening your sign-in page…') : null,
      auth.status === 'initialising' ? c.h('p', { class: 'muted', role: 'status' }, 'Preparing sign-in…') : null,
      auth.status === 'unavailable' ? c.h('p', { class: 'sign-in-unavailable' }, 'Live sign-in is unavailable here. The synthetic demo still works.') : null,
      auth.failure !== null ? c.h('p', { class: 'sign-in-error', role: 'alert' }, auth.failure.message) : null,
    );
  };

  const accountStatus = (a: LinkedAccount): string => {
    if (a.status === 'verified') return 'Verified';
    if (a.status === 'could-not-verify') return a.lastFailure === null ? 'Could not verify' : `Could not verify — ${a.lastFailure.message}`;
    return 'Needs sign-in';
  };

  const linked = (state: AppState, actions: AppActions): HTMLElement => {
    const activeDid = state.mode === 'live' ? state.activeDid : null;
    const row = (a: LinkedAccount): Child[] => {
      const isActive = a.did === activeDid;
      const tr = c.h(
        'span',
        { class: 'account-actions' },
        isActive ? c.h('span', { class: 'muted' }, 'Active') : btn('Switch to', () => void actions.switchAccount(a.did), 'secondary', null, false, `switch-${a.did}`),
        a.status === 'needs-sign-in' ? null : btn('Sign out', () => void actions.signOut(a.did), 'text', null, false, `sign-out-${a.did}`),
        btn('Remove', () => void actions.removeAccount(a.did), 'danger', TEST_IDS.removeAccount, false, `remove-${a.did}`),
      );
      return [
        c.h('span', { 'data-testid': `${TEST_IDS.accountRow}-${a.did}`, class: 'account-handle' }, a.handle ?? 'no handle'),
        c.h('code', null, a.did),
        accountStatus(a),
        tr,
      ];
    };
    const table = c.dataTable({
      caption: 'Accounts linked on this browser',
      columns: [
        { header: 'Handle', align: 'start' },
        { header: 'DID', align: 'start' },
        { header: 'Status', align: 'start' },
        { header: 'Actions', align: 'start' },
      ],
      rows: state.accounts.map(row),
      emptyText: 'No accounts are linked on this browser.',
      testId: 'linked-accounts',
    });
    // The row test id must sit on the row; tag each <tr> that holds a marked cell.
    for (const marker of table.querySelectorAll(`[data-testid^="${TEST_IDS.accountRow}-"]`)) {
      const tr = marker.closest('tr');
      if (tr !== null) {
        tr.setAttribute('data-testid', marker.getAttribute('data-testid') ?? '');
        marker.removeAttribute('data-testid');
      }
    }
    return c.card({
      title: 'Linked accounts',
      subtitle: 'Accounts you have signed in to on this browser.',
      testId: null,
      children: [
        table,
        c.h(
          'p',
          { class: 'remove-scope-note', 'data-testid': TEST_IDS.removeScopeNote },
          "Remove clears this browser's saved data for that account only. Nothing is deleted from your account, your PDS or the network.",
        ),
      ],
    });
  };

  const coverage = (snap: Snapshot): HTMLElement => {
    const skippedBy = (nsid: string) => snap.skipped.filter((s) => s.collection === nsid).length;
    const rows: Child[][] = snap.coverage.map((r) => [
      c.h('span', { class: 'collection-name' }, collectionLabel(deps.registry, r.collection), ' ', c.h('code', null, r.collection)),
      COVERAGE_STATUS_TEXT[r.status],
      r.status === 'unavailable' ? 'Unknown' : r.status === 'partial' ? `At least ${formatInt(r.accepted)}` : formatInt(r.accepted),
      formatInt(r.pagesFetched),
      formatInt(skippedBy(r.collection)),
      r.reason,
    ]);
    const e = snap.engagementCoverage;
    rows.push([
      c.h('span', { class: 'collection-name' }, 'Interaction counters ', c.h('code', null, ORIGINS.appView)),
      COVERAGE_STATUS_TEXT[e.status],
      `${formatInt(e.known)} of ${formatInt(e.requested)} posts`,
      `${formatInt(e.batches)} batch(es), ${formatInt(e.batchesFailed)} failed`,
      '—',
      e.reason,
    ]);
    const unanalysed =
      snap.inventoryStatus === 'unknown'
        ? c.h('p', null, "Unknown: your repository's collection list could not be read.")
        : snap.unanalysedCollections.length === 0
          ? c.h('p', null, 'none')
          : c.h('ul', null, ...snap.unanalysedCollections.map((n) => c.h('li', null, c.h('code', null, n))));
    const skipped = snap.skipped.slice(0, SKIPPED_MAX);
    return c.card({
      title: 'What was read',
      subtitle: 'Coverage of the whole read, independent of the date range.',
      testId: null,
      children: [
        c.dataTable({
          caption: 'Coverage of the whole read, independent of the date range.',
          columns: [
            { header: 'Collection', align: 'start' },
            { header: 'Status', align: 'start' },
            { header: 'Records', align: 'end' },
            { header: 'Pages', align: 'end' },
            { header: 'Set aside', align: 'end' },
            { header: 'Reason', align: 'start' },
          ],
          rows,
          emptyText: 'No collections were read.',
          testId: TEST_IDS.coverageTable,
        }),
        c.h('div', { class: 'unanalysed', 'data-testid': TEST_IDS.unanalysedList }, c.h('h3', null, 'Present, not analysed'), unanalysed),
        c.h(
          'div',
          { class: 'skipped' },
          c.h('h3', null, 'Set aside'),
          c.dataTable({
            caption: 'Records set aside with a reason',
            columns: [
              { header: 'Record', align: 'start' },
              { header: 'Collection', align: 'start' },
              { header: 'Reason', align: 'start' },
              { header: 'Detail', align: 'start' },
            ],
            rows: skipped.map((s): Child[] => [s.uri ?? '—', s.collection, s.reasonCode, s.detail]),
            emptyText: 'No records were set aside.',
            testId: TEST_IDS.skippedTable,
          }),
          c.h(
            'p',
            { class: 'muted' },
            `${formatInt(snap.skipped.length)} record(s) set aside in total.`,
            snap.skipped.length > SKIPPED_MAX ? ` Showing the first ${SKIPPED_MAX}.` : null,
          ),
        ),
      ],
    });
  };

  const network = (state: AppState): HTMLElement => {
    const pds =
      state.snapshot?.account.pdsOrigin ??
      (state.mode === 'live' ? (state.accounts.find((a) => a.did === state.activeDid)?.pdsOrigin ?? null) : null);
    const resolver = state.auth.disclosure?.handleResolverOrigin ?? ORIGINS.oauthHandleResolver;
    const item = (origin: string, what: string) => c.h('li', null, c.h('code', null, origin), ` — ${what}`);
    return c.card({
      title: 'Network',
      subtitle:
        state.mode === 'demo'
          ? 'In the synthetic demo nothing leaves this browser; a built-in fixture answers in place of these origins.'
          : 'The origins a read contacts. Requests carry no cookies and no sign-in token.',
      testId: 'network-origins',
      children: [
        c.h(
          'ul',
          { class: 'origin-list' },
          pds === null ? c.h('li', null, 'Your PDS — named in your DID document') : item(pds, 'your PDS (records and repository description)'),
          item(ORIGINS.plcDirectory, 'DID document lookup'),
          item(ORIGINS.appView, 'public interaction counters'),
          item(resolver, 'handle resolution, at sign-in only'),
        ),
      ],
    });
  };

  const measured = (state: AppState): HTMLElement | null => {
    const acq = state.load.acquisitionMs;
    if (acq === null) return null;
    const a = state.analysis;
    const analysis =
      a.status === 'ready' && a.durationMs !== null && a.ranIn !== null
        ? `analysis ran ${a.ranIn === 'worker' ? 'in a background worker' : 'on the main thread'} in ${formatInt(a.durationMs)} ms.`
        : 'analysis has not finished.';
    return c.h('p', { class: 'measured' }, `Reading took ${formatInt(acq)} ms; ${analysis}`);
  };

  return ({ state, actions }) => {
    const loading =
      state.load.status === 'loading'
        ? c.h(
            'div',
            { class: 'accounts-loading' },
            c.h('p', { role: 'status', 'aria-live': 'polite' }, state.load.progress?.message ?? 'Reading records…'),
            btn('Cancel', () => actions.cancelLoad(), 'secondary', TEST_IDS.cancelLoad, false, 'cancel-load'),
          )
        : null;
    const hasSession = state.snapshot !== null || state.mode !== 'none';
    const controls = c.h(
      'div',
      { class: 'account-controls' },
      hasSession && state.load.status !== 'loading' ? btn('Read again', () => void actions.reload(), 'secondary', null, false, 'read-again') : null,
      state.snapshot !== null ? btn('Clear displayed data', () => actions.clearData(), 'secondary', TEST_IDS.clearData, false, 'clear-data') : null,
      state.mode === 'demo' ? btn('Leave demo', () => actions.exitDemo(), 'secondary', null, false, 'leave-demo') : null,
    );
    return viewRoot(
      c,
      'accounts',
      TEST_IDS.viewAccounts,
      loading,
      activeAccount(state),
      controls,
      signIn(state, actions),
      linked(state, actions),
      state.snapshot === null ? null : coverage(state.snapshot),
      network(state),
      measured(state),
    );
  };
}

