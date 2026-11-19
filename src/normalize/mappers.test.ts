import { describe, expect, it } from 'vitest';
import { createNormalizer } from './index';
import { AT_POST, DID, fakeRegistry, OTHER_DID, POST, raw, TID } from './testkit';

const run = (...records: ReturnType<typeof raw>[]) => createNormalizer({ registry: fakeRegistry }).normalize({ did: DID, records, engagement: [] });
const one = (r: ReturnType<typeof raw>) => {
  const out = run(r);
  return { rec: out.records[0], skip: out.skipped[0] };
};
const T = '2024-05-01T12:00:00.000Z';
const NOW = { createdAt: T };

describe('bsky.post', () => {
  it('maps a post', () => {
    const { rec } = one(raw(POST, { text: 'hi', ...NOW, langs: ['en'], embed: { $type: 'x' }, unknownField: 1 }));
    expect(rec).toMatchObject({ kind: 'post', text: 'hi', title: null, timeSource: 'createdAt', createdAt: T, app: 'bluesky', did: DID, subjectUri: null, subjectDid: null });
  });
  it('maps a reply with parent uri; malformed parent still reply', () => {
    expect(one(raw(POST, { text: 'a', ...NOW, reply: { parent: { uri: AT_POST }, root: { uri: AT_POST } } })).rec).toMatchObject({ kind: 'reply', subjectUri: AT_POST });
    expect(one(raw(POST, { text: 'a', ...NOW, reply: { parent: { uri: 'nope' } } })).rec).toMatchObject({ kind: 'reply', subjectUri: null });
    expect(one(raw(POST, { text: 'a', ...NOW, reply: {} })).rec).toMatchObject({ kind: 'reply', subjectUri: null });
  });
  it('skips missing / wrong-typed text', () => {
    expect(one(raw(POST, NOW)).skip).toMatchObject({ reasonCode: 'missing-required-field', detail: expect.stringContaining('text') });
    expect(one(raw(POST, { text: 42, ...NOW })).skip).toMatchObject({ reasonCode: 'invalid-field', detail: expect.stringContaining('text') });
    expect(one(raw(POST, { text: null })).skip).toMatchObject({ reasonCode: 'invalid-field' });
  });
  it('accepts empty text', () => {
    expect(one(raw(POST, { text: '', ...NOW })).rec?.text).toBe('');
  });
  it('merges tags and tag facets, trims, dedups, ignores other facets', () => {
    const { rec } = one(
      raw(POST, {
        text: 'x',
        tags: [' a ', 'b', '', 7, 'a'],
        facets: [
          { features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'c' }, { $type: 'app.bsky.richtext.facet#mention', did: DID }, { $type: 'app.bsky.richtext.facet#link', uri: 'https://x.y' }] },
          { features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'b' }] },
          'garbage',
          { features: 'garbage' },
        ],
      }),
    );
    expect(rec?.tags).toEqual(['a', 'b', 'c']);
  });
  it('caps tags at 30 and 80 chars each', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect(one(raw(POST, { text: 'x', tags })).rec?.tags).toHaveLength(30);
    expect(one(raw(POST, { text: 'x', tags: ['z'.repeat(200)] })).rec?.tags[0]).toHaveLength(80);
  });
  it('truncates long text to 10,000', () => {
    expect(one(raw(POST, { text: 'a'.repeat(20_000) })).rec?.text).toHaveLength(10_000);
  });
});

describe('like / repost', () => {
  it.each(['app.bsky.feed.like', 'app.bsky.feed.repost'])('%s sets subjectUri and keeps time', (c) => {
    const { rec } = one(raw(c, { subject: { uri: AT_POST, cid: 'x' }, ...NOW }));
    expect(rec).toMatchObject({ subjectUri: AT_POST, createdAt: T, subjectDid: null });
    expect(rec?.kind).toBe(c.endsWith('like') ? 'like' : 'repost');
  });
  it.each(['app.bsky.feed.like', 'app.bsky.feed.repost'])('%s validates subject', (c) => {
    expect(one(raw(c, NOW)).skip?.reasonCode).toBe('missing-required-field');
    expect(one(raw(c, { subject: {} })).skip).toMatchObject({ reasonCode: 'missing-required-field', detail: 'subject.uri is missing' });
    expect(one(raw(c, { subject: { uri: 'at://alice.example/app.bsky.feed.post/3jzfcijpj2z2b' } })).skip).toMatchObject({ reasonCode: 'invalid-field', detail: 'subject.uri is not an AT-URI' });
    expect(one(raw(c, { subject: 'str' })).skip?.reasonCode).toBe('missing-required-field');
  });
});

describe('follow / block', () => {
  it.each([['app.bsky.graph.follow', 'follow'], ['app.bsky.graph.block', 'block']])('%s', (c, kind) => {
    expect(one(raw(c, { subject: OTHER_DID, ...NOW })).rec).toMatchObject({ kind, subjectDid: OTHER_DID, createdAt: T, subjectUri: null });
    expect(one(raw(c, { subject: 'alice.example' })).skip?.reasonCode).toBe('invalid-field');
    expect(one(raw(c, {})).skip?.reasonCode).toBe('missing-required-field');
  });
});

describe('list / listitem', () => {
  const L = 'app.bsky.graph.list';
  it('list requires name and purpose; description optional', () => {
    expect(one(raw(L, { name: 'N', purpose: 'app.bsky.graph.defs#curatelist', ...NOW })).rec).toMatchObject({ kind: 'list', title: 'N', text: null });
    expect(one(raw(L, { name: 'N', purpose: 'p', description: 'D' })).rec?.text).toBe('D');
    expect(one(raw(L, { purpose: 'p' })).skip?.reasonCode).toBe('missing-required-field');
    expect(one(raw(L, { name: 'N' })).skip).toMatchObject({ reasonCode: 'missing-required-field', detail: expect.stringContaining('purpose') });
    expect(one(raw(L, { name: 3, purpose: 'p' })).skip?.reasonCode).toBe('invalid-field');
    expect(one(raw(L, { name: 'N', purpose: 'p', description: 5 })).rec?.text).toBeNull();
  });
  it('list-item sets subjectDid and subjectUri', () => {
    const list = `at://${DID}/app.bsky.graph.list/3jzfcijpj2z2b`;
    expect(one(raw('app.bsky.graph.listitem', { subject: OTHER_DID, list, ...NOW })).rec).toMatchObject({ kind: 'list-item', subjectDid: OTHER_DID, subjectUri: list });
    expect(one(raw('app.bsky.graph.listitem', { subject: OTHER_DID })).skip?.reasonCode).toBe('missing-required-field');
    expect(one(raw('app.bsky.graph.listitem', { subject: 'x', list })).skip?.reasonCode).toBe('invalid-field');
  });
});

describe('profile', () => {
  it('accepts an empty profile', () => {
    expect(one(raw('app.bsky.actor.profile', {}, { rkey: 'self' })).rec).toMatchObject({ kind: 'profile', title: null, text: null, createdAt: null, timeSource: 'none', rkeyTime: null });
  });
  it('uses displayName / description when strings', () => {
    expect(one(raw('app.bsky.actor.profile', { displayName: 'A', description: 'B' }, { rkey: 'self' })).rec).toMatchObject({ title: 'A', text: 'B' });
    expect(one(raw('app.bsky.actor.profile', { displayName: 1, description: [] }, { rkey: 'self' })).rec).toMatchObject({ title: null, text: null });
  });
});

describe('standard.site', () => {
  const D = 'site.standard.document';
  const pub = `at://${DID}/site.standard.publication/3jzfcijpj2z2b`;
  it('document uses publishedAt', () => {
    expect(one(raw(D, { title: 'T', site: pub, publishedAt: T, description: 'd', tags: ['x'] })).rec).toMatchObject({ kind: 'document', title: 'T', text: 'd', createdAt: T, timeSource: 'publishedAt', subjectUri: pub, tags: ['x'], app: 'standard-site' });
  });
  it('https site gives null subjectUri; textContent fallback', () => {
    expect(one(raw(D, { title: 'T', site: 'https://x.example', textContent: 'body' })).rec).toMatchObject({ subjectUri: null, text: 'body' });
  });
  it('requires title and site', () => {
    expect(one(raw(D, { site: pub })).skip?.reasonCode).toBe('missing-required-field');
    expect(one(raw(D, { title: 'T' })).skip).toMatchObject({ reasonCode: 'missing-required-field', detail: expect.stringContaining('site') });
    expect(one(raw(D, { title: 'T', site: 3 })).skip?.reasonCode).toBe('invalid-field');
  });
  it('invalid publishedAt with valid updatedAt gives null time (never updatedAt)', () => {
    expect(one(raw(D, { title: 'T', site: pub, publishedAt: 'x', updatedAt: T })).rec).toMatchObject({ createdAt: null, timeSource: 'none' });
  });
  it('publication never has a time', () => {
    expect(one(raw('site.standard.publication', { name: 'N', url: 'https://x.example', createdAt: T, description: 'd' })).rec).toMatchObject({ kind: 'publication', title: 'N', text: 'd', createdAt: null, timeSource: 'none' });
    expect(one(raw('site.standard.publication', { name: 'N' })).skip?.reasonCode).toBe('missing-required-field');
  });
});

describe('time and keys', () => {
  it('normalises offsets to UTC Z', () => {
    expect(one(raw(POST, { text: 'a', createdAt: '2024-05-01T05:00:00-07:00' })).rec?.createdAt).toBe(T);
  });
  it.each([['yesterday'], [undefined], [12345], [null]])('bad createdAt %s keeps record with null time', (v) => {
    const body: Record<string, unknown> = { text: 'a' };
    if (v !== undefined) body.createdAt = v;
    expect(one(raw(POST, body)).rec).toMatchObject({ createdAt: null, timeSource: 'none' });
  });
  it('rkeyTime from TID, null for self', () => {
    expect(one(raw(POST, { text: 'a' })).rec?.rkeyTime).toMatch(/^20\d\d-/);
    expect(one(raw('app.bsky.actor.profile', {}, { rkey: 'self' })).rec?.rkeyTime).toBeNull();
    expect(TID).toBeTruthy();
  });
});
