// Static, versioned registry data. NSIDs verified against the lexicon files:
//   app.bsky.* : atproto/packages/api/lexicons/app/bsky/** (MIT)
//   site.standard.* : BS/social-app/lexicons/site/standard/{document,publication}.json (MIT)
// Nothing is copied from those files; only NSIDs and our own labels are stored.
import { METRIC_IDS } from '../shared';
import type { MetricId, Nsid, RecordKind } from '../shared/contract';
import type { AppDefinition, CollectionDefinition, NonRepoDataNote, RegistryData, UnavailableOnApp } from './contract';

const nsid = (s: string): Nsid => s as Nsid;

const bsky = (
  n: string,
  label: string,
  normalizerId: CollectionDefinition['normalizerId'],
  kinds: readonly RecordKind[],
  visibilitySource: CollectionDefinition['visibilitySource'],
  engagementSource: CollectionDefinition['engagementSource'] = null,
): CollectionDefinition => ({
  nsid: nsid(n),
  appId: 'bluesky',
  label,
  normalizerId,
  kinds,
  visibility: 'public-repo',
  visibilitySource,
  timestampField: 'createdAt',
  engagementSource,
  pageSize: 100,
});

const collections: readonly CollectionDefinition[] = [
  bsky('app.bsky.feed.post', 'Posts & replies', 'bsky.post', ['post', 'reply'], 'bsky-privacy-policy', 'bluesky-appview'),
  bsky('app.bsky.feed.repost', 'Reposts', 'bsky.repost', ['repost'], 'atproto-blog-spaces'),
  bsky('app.bsky.feed.like', 'Likes given', 'bsky.like', ['like'], 'bsky-privacy-policy'),
  bsky('app.bsky.graph.follow', 'Follows', 'bsky.follow', ['follow'], 'bsky-privacy-policy'),
  bsky('app.bsky.graph.block', 'Blocks', 'bsky.block', ['block'], 'bsky-docs-following'),
  bsky('app.bsky.graph.list', 'Lists', 'bsky.list', ['list'], 'atproto-blog-spaces'),
  bsky('app.bsky.graph.listitem', 'List memberships you created', 'bsky.listitem', ['list-item'], 'atproto-blog-spaces'),
  bsky('app.bsky.actor.profile', 'Profile', 'bsky.profile', ['profile'], 'atproto-blog-spaces'),
  {
    nsid: nsid('site.standard.document'),
    appId: 'standard-site',
    label: 'Documents',
    normalizerId: 'standard.document',
    kinds: ['document'],
    visibility: 'public-repo',
    visibilitySource: 'atproto-blog-spaces',
    timestampField: 'publishedAt',
    engagementSource: null,
    // Document bodies can be large; 50 keeps a page under LIMITS.httpMaxResponseBytes.
    pageSize: 50,
  },
  {
    nsid: nsid('site.standard.publication'),
    appId: 'standard-site',
    label: 'Publications',
    normalizerId: 'standard.publication',
    kinds: ['publication'],
    visibility: 'public-repo',
    visibilitySource: 'atproto-blog-spaces',
    timestampField: null,
    engagementSource: null,
    pageSize: 100,
  },
];

const nsidsOf = (appId: CollectionDefinition['appId']): readonly Nsid[] => collections.filter((c) => c.appId === appId).map((c) => c.nsid);

const HISTORY = 'Records that are in your repository now, newest first, up to 1,000 per collection. Deleted records are gone.';

const ENGAGEMENT_IDS = METRIC_IDS.filter((m) => m.startsWith('engagement.'));
const STANDARD_NO_ENGAGEMENT = 'Standard.site has no public interaction counters, and SocialLens does not query network indexes.';
const NO_PUBLIC_COUNTER = 'Not available from public records: no public view counter exists.';

const bluesky: AppDefinition = {
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
  collections: nsidsOf('bluesky'),
  capability: {
    appId: 'bluesky',
    metrics: [...METRIC_IDS],
    unavailable: [
      { metricId: 'impressions', reason: NO_PUBLIC_COUNTER },
      { metricId: 'reach', reason: 'Not available from public records.' },
      {
        metricId: 'follower-growth',
        reason:
          'Unknown: your repository holds only records you created. Follows of you live in other people’s repositories and the profile API returns only the current total.',
      },
      { metricId: 'unfollows', reason: 'Unknown: a deleted follow record disappears.' },
      {
        metricId: 'who-blocks-me',
        reason: 'Deliberately excluded. It needs a network-wide index of other people’s records, and SocialLens is self-only.',
      },
      {
        metricId: 'bookmarks',
        reason: 'Not shown: whether the public counter is populated for non-viewers was not verified.',
      },
    ],
    engagementCounts: true,
    history: HISTORY,
    freshness:
      'Records are read live from your PDS. Counters come from the public Bluesky API (cached for about 30 seconds) and are flagged ‘settling’ for posts under 36 hours old.',
  },
  source: 'bsky-privacy-policy',
};

const standardMetrics: readonly MetricId[] = METRIC_IDS.filter(
  (m) => m.startsWith('records.') || m === 'content.items' || m.startsWith('activity.'),
);

const standardUnavailable: readonly UnavailableOnApp[] = [
  ...ENGAGEMENT_IDS.map((metricId) => ({ metricId, reason: STANDARD_NO_ENGAGEMENT })),
  { metricId: 'impressions', reason: NO_PUBLIC_COUNTER },
  { metricId: 'reach', reason: 'Not available from public records.' },
];

const standardSite: AppDefinition = {
  id: 'standard-site',
  displayName: 'Standard.site',
  kindLabels: { document: 'Document', publication: 'Publication' },
  collections: nsidsOf('standard-site'),
  capability: {
    appId: 'standard-site',
    metrics: standardMetrics,
    unavailable: standardUnavailable,
    engagementCounts: false,
    history: HISTORY,
    freshness: 'Records are read live from your PDS.',
  },
  source: 'standard-site',
};

const nonRepoData: readonly NonRepoDataNote[] = [
  {
    label: 'Mutes',
    visibility: 'private-app',
    explanation: 'Mutes are stored by the Bluesky app, not in your public repository, so SocialLens cannot and does not read them.',
    source: 'bsky-docs-following',
  },
  {
    label: 'Direct messages',
    visibility: 'private-service',
    explanation: 'Direct messages are not public records (and are not end-to-end encrypted).',
    source: 'bsky-privacy-policy',
  },
  {
    label: 'Permissioned spaces',
    visibility: 'future-permissioned',
    explanation: 'Access-controlled data is in alpha; SocialLens reads only public records.',
    source: 'atproto-blog-spaces',
  },
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export const REGISTRY_DATA: RegistryData = deepFreeze({
  version: '2026-11-18.1',
  apps: [bluesky, standardSite],
  collections,
  nonRepoData,
});
