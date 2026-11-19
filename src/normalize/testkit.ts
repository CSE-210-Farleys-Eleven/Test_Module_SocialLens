// Test helpers only (hand-written fake registry; no import of registry/ implementation).
import type { CollectionDefinition, NormalizerId, Registry } from '../registry/contract';
import type { AppId, Cid, Did, JsonObject, Nsid, RawRecord, RecordKey, RecordKind } from '../shared';

export const DID = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
export const OTHER_DID = 'did:plc:zyxwvutsrqponmlkjihgfedc';
export const TID = '3jzfcijpj2z2a'; // decodes to a 2022 instant

function def(
  nsid: string,
  appId: AppId,
  normalizerId: NormalizerId,
  timestampField: 'createdAt' | 'publishedAt' | null,
  engagementSource: 'bluesky-appview' | null,
): CollectionDefinition {
  return {
    nsid: nsid as Nsid,
    appId,
    label: nsid,
    normalizerId,
    kinds: [] as readonly RecordKind[],
    visibility: 'public-repo',
    visibilitySource: 'atproto-repo-public',
    timestampField,
    engagementSource,
    pageSize: 100,
  } as unknown as CollectionDefinition;
}

export const DEFS: readonly CollectionDefinition[] = [
  def('app.bsky.feed.post', 'bluesky', 'bsky.post', 'createdAt', 'bluesky-appview'),
  def('app.bsky.feed.repost', 'bluesky', 'bsky.repost', 'createdAt', null),
  def('app.bsky.feed.like', 'bluesky', 'bsky.like', 'createdAt', null),
  def('app.bsky.graph.follow', 'bluesky', 'bsky.follow', 'createdAt', null),
  def('app.bsky.graph.block', 'bluesky', 'bsky.block', 'createdAt', null),
  def('app.bsky.graph.list', 'bluesky', 'bsky.list', 'createdAt', null),
  def('app.bsky.graph.listitem', 'bluesky', 'bsky.listitem', 'createdAt', null),
  def('app.bsky.actor.profile', 'bluesky', 'bsky.profile', null, null),
  def('site.standard.document', 'standard-site', 'standard.document', 'publishedAt', null),
  def('site.standard.publication', 'standard-site', 'standard.publication', null, null),
];

export const fakeRegistry: Registry = {
  data: { version: 'test', apps: [], collections: DEFS, nonRepoData: [] },
  collection: (nsid: string) => DEFS.find((d) => d.nsid === nsid) ?? null,
  analysedCollections: () => DEFS,
  app: () => {
    throw new Error('unused');
  },
  inventory: () => {
    throw new Error('unused');
  },
};

export function raw(collection: string, value: unknown, opts: { rkey?: string; did?: string; type?: string | null } = {}): RawRecord {
  const rkey = opts.rkey ?? TID;
  const body = { ...(value as object) } as Record<string, unknown>;
  if (opts.type !== null && opts.type !== undefined) body.$type = opts.type;
  return {
    uri: `at://${opts.did ?? DID}/${collection}/${rkey}` as RawRecord['uri'],
    cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' as Cid,
    collection: collection as Nsid,
    rkey: rkey as RecordKey,
    value: body as JsonObject,
  };
}

export const POST = 'app.bsky.feed.post';
export const AT_POST = `at://${DID}/app.bsky.feed.post/3jzfcijpj2z2b`;
