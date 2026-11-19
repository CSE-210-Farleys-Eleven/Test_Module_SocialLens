import { describe, expect, it } from 'vitest';
import type { EngagementResult } from '../adapters/bluesky/contract';
import type { AtUri, Engagement } from '../shared';
import { createNormalizer } from './index';
import { DID, fakeRegistry, OTHER_DID, POST, raw } from './testkit';

const n = createNormalizer({ registry: fakeRegistry });
const post = raw(POST, { text: 'hi', createdAt: '2024-05-01T12:00:00Z' });
const known: Engagement = { status: 'known', counts: { likes: 1, reposts: 0, replies: 2, quotes: 0 }, observedAt: '2024-05-02T00:00:00.000Z' as never };
const eng = (uri: string, engagement: Engagement): EngagementResult => ({ uri: uri as AtUri, engagement });

describe('engagement', () => {
  it('passes a known result through', () => {
    expect(n.normalize({ did: DID, records: [post], engagement: [eng(post.uri, known)] }).records[0]?.engagement).toEqual(known);
  });
  it('unknown / not-requested when no result', () => {
    expect(n.normalize({ did: DID, records: [post], engagement: [] }).records[0]?.engagement).toEqual({ status: 'unknown', reason: 'not-requested' });
  });
  it('passes through unknown / lookup-failed', () => {
    const e: Engagement = { status: 'unknown', reason: 'lookup-failed' };
    expect(n.normalize({ did: DID, records: [post], engagement: [eng(post.uri, e)] }).records[0]?.engagement).toEqual(e);
  });
  it('first matching result wins', () => {
    const e: Engagement = { status: 'unknown', reason: 'not-returned' };
    expect(n.normalize({ did: DID, records: [post], engagement: [eng(post.uri, e), eng(post.uri, known)] }).records[0]?.engagement).toEqual(e);
  });
  it('not-available for apps/kinds without a source, even if a result is supplied', () => {
    const recs = [
      raw('app.bsky.feed.like', { subject: { uri: post.uri } }),
      raw('app.bsky.graph.follow', { subject: OTHER_DID }),
      raw('site.standard.document', { title: 't', site: 'https://x.example' }),
      raw('site.standard.publication', { name: 'n', url: 'https://x.example' }),
    ];
    const out = n.normalize({ did: DID, records: recs, engagement: recs.map((r) => eng(r.uri, known)) });
    expect(out.records).toHaveLength(4);
    for (const r of out.records) expect(r.engagement).toEqual({ status: 'not-available' });
  });
});

describe('skipped bucket and totals', () => {
  it('unregistered collection', () => {
    const out = n.normalize({ did: DID, records: [raw('com.example.thing', { a: 1 })], engagement: [] });
    expect(out.skipped[0]).toMatchObject({ reasonCode: 'unregistered-collection', stage: 'normalize', collection: 'com.example.thing' });
  });
  it('$type mismatch skipped, absent accepted, matching accepted', () => {
    const out = n.normalize({
      did: DID,
      records: [raw(POST, { text: 'a' }, { type: 'app.bsky.feed.like' }), raw(POST, { text: 'a' }), raw(POST, { text: 'a' }, { type: POST })],
      engagement: [],
    });
    expect(out.skipped.map((s) => s.reasonCode)).toEqual(['type-mismatch']);
    expect(out.records).toHaveLength(2);
  });
  it('foreign owner and wrong collection', () => {
    const foreign = raw(POST, { text: 'a' }, { did: OTHER_DID });
    const wrong = { ...raw(POST, { text: 'a' }), collection: 'app.bsky.feed.like' as never };
    const out = n.normalize({ did: DID, records: [foreign, wrong], engagement: [] });
    expect(out.skipped.map((s) => s.reasonCode)).toEqual(['foreign-owner', 'wrong-collection']);
    expect(out.skipped[0]?.uri).toBe(foreign.uri);
  });
  it('mixed input of 6 with 2 bad keeps order and totals', () => {
    const recs = [
      raw(POST, { text: '1' }, { rkey: '3jzfcijpj2z2a' }),
      raw(POST, { text: 2 }, { rkey: '3jzfcijpj2z2b' }),
      raw(POST, { text: '3' }, { rkey: '3jzfcijpj2z2c' }),
      raw('app.bsky.graph.follow', { subject: OTHER_DID }, { rkey: '3jzfcijpj2z2d' }),
      raw('x.y.z', {}, { rkey: '3jzfcijpj2z2e' }),
      raw(POST, { text: '6' }, { rkey: '3jzfcijpj2z2f' }),
    ];
    const out = n.normalize({ did: DID, records: recs, engagement: [] });
    expect(out.records.map((r) => r.rkey)).toEqual(['3jzfcijpj2z2a', '3jzfcijpj2z2c', '3jzfcijpj2z2d', '3jzfcijpj2z2f']);
    expect(out.skipped.map((s) => s.uri)).toEqual([recs[1]?.uri, recs[4]?.uri]);
    expect(out.records.length + out.skipped.length).toBe(recs.length);
  });
  it('empty input', () => {
    expect(n.normalize({ did: DID, records: [], engagement: [] })).toEqual({ records: [], skipped: [] });
  });
  it('skip detail never includes the record body', () => {
    const out = n.normalize({ did: DID, records: [raw(POST, { text: 42, secret: 'SECRET' })], engagement: [] });
    expect(JSON.stringify(out.skipped)).not.toContain('SECRET');
  });
});

describe('robustness', () => {
  it('hostile bodies do not throw or pollute', () => {
    let deep: unknown[] = [];
    for (let i = 0; i < 5000; i++) deep = [deep];
    const body = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"text":"x","tags":["a"]}') as Record<string, unknown>;
    body.deep = deep;
    const recs = [raw(POST, body), raw(POST, { text: 'x', facets: deep, reply: deep, tags: deep })];
    const out = n.normalize({ did: DID, records: recs, engagement: [] });
    expect(out.records).toHaveLength(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('malformed values never throw and are all accounted for', () => {
    const values: unknown[] = [{ text: {} }, { text: [] }, { subject: null }, { $type: 5, text: 'a' }, { text: 'a', createdAt: {} }, { text: 'a', tags: 'nope', facets: 3 }];
    const recs = values.flatMap((v) => ['app.bsky.feed.post', 'app.bsky.feed.like', 'app.bsky.graph.listitem', 'site.standard.document'].map((c) => raw(c, v)));
    const out = n.normalize({ did: DID, records: recs, engagement: [] });
    expect(out.records.length + out.skipped.length).toBe(recs.length);
    expect(out.skipped.every((s) => s.detail.length > 0)).toBe(true);
  });
  it('a throwing registry for one record becomes a skip', () => {
    const bomb = createNormalizer({ registry: { ...fakeRegistry, collection: () => { throw new Error('boom'); } } });
    const out = bomb.normalize({ did: DID, records: [post], engagement: [] });
    expect(out.skipped[0]).toMatchObject({ reasonCode: 'invalid-field', detail: 'unexpected record shape' });
  });
  it('output survives structuredClone and JSON round trip; pure', () => {
    const input = { did: DID, records: [post, raw('app.bsky.graph.follow', { subject: OTHER_DID }), raw(POST, { text: 1 })], engagement: [eng(post.uri, known)] };
    const a = n.normalize(input);
    expect(structuredClone(a)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(n.normalize(input)).toEqual(a);
    for (const r of a.records) expect(r.did).toBe(DID);
  });
});
