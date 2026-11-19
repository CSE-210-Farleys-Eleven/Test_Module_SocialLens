import { describe, expect, it } from 'vitest';
import type { Did, Nsid, RecordKey } from './contract';
import {
  didMethodOf,
  makeAtUri,
  parseAtUri,
  parseCid,
  parseDid,
  parseHandle,
  parseHttpsOrigin,
  parseNsid,
  parseRecordKey,
} from './syntax';

const PLC = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';

describe('parseDid', () => {
  it('accepts a 24-char did:plc and a did:web hostname', () => {
    expect(parseDid(PLC)).toBe(PLC);
    expect(parseDid('did:web:example.com')).toBe('did:web:example.com');
    expect(parseDid('did:web:pds.example.org')).toBe('did:web:pds.example.org');
  });
  it.each([
    ['did:plc with 23 chars', 'did:plc:ewvi7nxzyoun6zhxrhs64oi'],
    ['did:plc with 25 chars', 'did:plc:ewvi7nxzyoun6zhxrhs64oizz'],
    ['did:plc upper case', 'did:plc:EWVI7NXZYOUN6ZHXRHS64OIZ'],
    ['did:plc with forbidden digit', 'did:plc:ewvi7nxzyoun6zhxrhs64oi1'],
    ['upper-case method', 'DID:PLC:ewvi7nxzyoun6zhxrhs64oiz'],
    ['did:web:localhost', 'did:web:localhost'],
    ['did:web path segment', 'did:web:example.com:path'],
    ['did:web encoded port', 'did:web:example.com%3A8080'],
    ['did:web single label', 'did:web:intranet'],
    ['did:web IPv4', 'did:web:10.0.0.1'],
    ['did:web .local', 'did:web:printer.local'],
    ['did:web .internal', 'did:web:svc.internal'],
    ['did:web upper case host', 'did:web:Example.com'],
    ['did:web empty', 'did:web:'],
    ['did:key', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'],
    ['missing prefix', 'plc:ewvi7nxzyoun6zhxrhs64oiz'],
    ['leading space', ` ${PLC}`],
    ['trailing newline', `${PLC}\n`],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(parseDid(value)).toBeNull();
  });
  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, [PLC], new String(PLC)]) expect(parseDid(v)).toBeNull();
  });
  it('rejects did:web longer than 2048 chars', () => {
    const host = `${'a'.repeat(60)}.`.repeat(40) + 'com';
    expect(parseDid(`did:web:${host}`)).toBeNull();
  });
});

describe('didMethodOf', () => {
  it('returns plc or web', () => {
    expect(didMethodOf(PLC as Did)).toBe('plc');
    expect(didMethodOf('did:web:example.com' as Did)).toBe('web');
  });
});

describe('parseHandle', () => {
  it('lower-cases and accepts Alice.Example.COM', () => {
    expect(parseHandle('Alice.Example.COM')).toBe('alice.example.com');
  });
  it('trims surrounding whitespace', () => {
    expect(parseHandle('  alice.bsky.social \n')).toBe('alice.bsky.social');
  });
  it('accepts handle.invalid and other syntactically valid handles', () => {
    expect(parseHandle('handle.invalid')).toBe('handle.invalid');
    expect(parseHandle('4chan.org')).toBe('4chan.org');
    expect(parseHandle('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    expect(parseHandle('a.co')).toBe('a.co');
  });
  it.each([
    ['leading @', '@alice.test'],
    ['single label', 'alice'],
    ['leading hyphen', '-a.com'],
    ['trailing hyphen label', 'a-.com'],
    ['empty label', 'a..com'],
    ['trailing dot', 'alice.test.'],
    ['email', 'alice@example.com'],
    ['url', 'https://alice.example.com'],
    ['TLD starts with digit', 'alice.1com'],
    ['underscore', 'al_ice.test'],
    ['label > 63', `${'a'.repeat(64)}.com`],
    ['inner space', 'ali ce.test'],
    ['empty', ''],
    ['only spaces', '   '],
  ])('rejects %s', (_label, value) => {
    expect(parseHandle(value)).toBeNull();
  });
  it('rejects a 254-char string but accepts 253', () => {
    const label = 'a'.repeat(61);
    const h253 = `${label}.${label}.${label}.${label}.${'b'.repeat(5)}`; // 61*4+4+5 = 253
    expect(h253.length).toBe(253);
    expect(parseHandle(h253)).toBe(h253);
    const h254 = `${label}.${label}.${label}.${label}.${'b'.repeat(6)}`;
    expect(h254.length).toBe(254);
    expect(parseHandle(h254)).toBeNull();
  });
  it('rejects non-strings', () => {
    expect(parseHandle(null)).toBeNull();
    expect(parseHandle(7)).toBeNull();
  });
});

describe('parseNsid', () => {
  it('accepts valid NSIDs', () => {
    expect(parseNsid('app.bsky.feed.post')).toBe('app.bsky.feed.post');
    expect(parseNsid('site.standard.document')).toBe('site.standard.document');
    expect(parseNsid('com.atproto.repo.listRecords')).toBe('com.atproto.repo.listRecords');
    expect(parseNsid('com.example.fooBar2')).toBe('com.example.fooBar2');
  });
  it.each([
    ['one segment', 'app'],
    ['two segments', 'app.bsky'],
    ['trailing dot', 'app.bsky.'],
    ['slash', 'app.bsky.feed.post/x'],
    ['name with hyphen', 'app.bsky.feed-post'],
    ['name with leading digit', 'app.bsky.1post'],
    ['first segment leading digit', '1app.bsky.post'],
    ['empty segment', 'app..post'],
    ['hash', 'app.bsky.feed.post#main'],
    ['empty', ''],
  ])('rejects %s', (_l, v) => {
    expect(parseNsid(v)).toBeNull();
  });
  it('rejects non-strings', () => expect(parseNsid(1)).toBeNull());
});

describe('parseRecordKey', () => {
  it('accepts TIDs, self and allowed punctuation', () => {
    for (const v of ['3kabc2defgh22', 'self', 'a.b-c_d:e~f', 'A', 'x'.repeat(512)]) {
      expect(parseRecordKey(v)).toBe(v);
    }
  });
  it('rejects ., .., empty, too long, bad characters', () => {
    for (const v of ['.', '..', '', 'x'.repeat(513), 'a/b', 'a b', 'a%20', 'a?b', 'a#b']) {
      expect(parseRecordKey(v)).toBeNull();
    }
    expect(parseRecordKey(undefined)).toBeNull();
  });
});

describe('parseCid', () => {
  const cid = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm';
  it('accepts a 59-char bafyrei… string', () => {
    expect(cid.length).toBe(59);
    expect(parseCid(cid)).toBe(cid);
    expect(parseCid('abcdefgh')).toBe('abcdefgh');
  });
  it('rejects empty, 7-char, over-long and non-alphanumeric strings', () => {
    expect(parseCid('')).toBeNull();
    expect(parseCid('abcdefg')).toBeNull();
    expect(parseCid('a'.repeat(257))).toBeNull();
    expect(parseCid('bafyrei-abc')).toBeNull();
    expect(parseCid(12345678)).toBeNull();
  });
});

describe('parseAtUri / makeAtUri', () => {
  const uri = `at://${PLC}/app.bsky.feed.post/3kabc2defgh22`;
  it('returns parts for a full record URI', () => {
    expect(parseAtUri(uri)).toEqual({
      uri,
      did: PLC,
      collection: 'app.bsky.feed.post',
      rkey: '3kabc2defgh22',
    });
  });
  it('accepts a did:web authority', () => {
    const p = parseAtUri('at://did:web:example.com/site.standard.document/self');
    expect(p?.did).toBe('did:web:example.com');
  });
  it.each([
    ['handle authority', 'at://alice.bsky.social/app.bsky.feed.post/3kabc2defgh22'],
    ['missing rkey', `at://${PLC}/app.bsky.feed.post`],
    ['empty rkey', `at://${PLC}/app.bsky.feed.post/`],
    ['extra path segment', `at://${PLC}/app.bsky.feed.post/3kabc2defgh22/x`],
    ['query', `${uri}?query`],
    ['fragment', `${uri}#fragment`],
    ['bad collection', `at://${PLC}/app/3kabc2defgh22`],
    ['bad rkey', `at://${PLC}/app.bsky.feed.post/..`],
    ['wrong scheme', `https://${PLC}/app.bsky.feed.post/3kabc2defgh22`],
    ['bad did', 'at://did:plc:short/app.bsky.feed.post/3kabc2defgh22'],
    ['over 8 KB', `at://${PLC}/app.bsky.feed.post/${'a'.repeat(8192)}`],
  ])('rejects %s', (_l, v) => {
    expect(parseAtUri(v)).toBeNull();
  });
  it('rejects non-strings', () => expect(parseAtUri({ uri })).toBeNull());
  it('makeAtUri concatenates and round-trips', () => {
    const made = makeAtUri(PLC as Did, 'app.bsky.feed.post' as Nsid, '3kabc2defgh22' as RecordKey);
    expect(made).toBe(uri);
    expect(parseAtUri(made)?.uri).toBe(uri);
  });
});

describe('parseHttpsOrigin', () => {
  it.each([
    ['https://bsky.social', 'https://bsky.social'],
    ['https://morel.us-east.host.bsky.network', 'https://morel.us-east.host.bsky.network'],
    ['https://pds.example.org/', 'https://pds.example.org'],
    ['https://pds.synthetic-demo.invalid', 'https://pds.synthetic-demo.invalid'],
    ['https://PDS.Example.ORG', 'https://pds.example.org'],
  ])('accepts %s', (input, expected) => {
    expect(parseHttpsOrigin(input)).toEqual({ ok: true, value: expected });
  });
  it.each([
    'http://bsky.social',
    'https://bsky.social:8443',
    'https://bsky.social:443',
    'https://bsky.social/xrpc',
    'https://bsky.social?x=1',
    'https://bsky.social/?',
    'https://bsky.social#frag',
    'https://user:pass@bsky.social',
    'https://user@bsky.social',
    'https://localhost',
    'https://app.localhost',
    'https://pds.local',
    'https://svc.internal',
    'https://router.lan',
    'https://nas.home.arpa',
    'https://10.0.0.1',
    'https://127.1',
    'https://[::1]',
    'https://intranet',
    'https://bsky.social.',
    ' https://bsky.social',
    'https://bsky.social\\',
    'ftp://bsky.social',
    'bsky.social',
    'not a url',
    '',
  ])('rejects %j with blocked-origin and origin = input', (input) => {
    const r = parseHttpsOrigin(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('blocked-origin');
      expect(r.failure.origin).toBe(input);
    }
  });
  it('rejects non-strings with origin null', () => {
    const r = parseHttpsOrigin(42);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('blocked-origin');
      expect(r.failure.origin).toBeNull();
    }
  });
});
