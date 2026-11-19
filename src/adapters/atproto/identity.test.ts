import { describe, expect, it } from 'vitest';
import type { Did, JsonValue, SessionRef } from '../../shared/contract';
import { createFakeHttp, failWith, fakeClock, hangUntilAbort, okJson } from './fake-http';
import { createAtprotoAdapter } from './index';

const me = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
const other = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' as Did;
const webMe = 'did:web:alice.example.com' as Did;
const session: SessionRef = { did: me, source: 'oauth' };
const webSession: SessionRef = { did: webMe, source: 'oauth' };
const PLC_URL = `https://plc.directory/${me}`;
const WEB_URL = 'https://alice.example.com/.well-known/did.json';
const PDS = 'https://morel.us-east.host.bsky.network';

/** Shaped like a real plc.directory response for a bsky.social-hosted account (extra fields included). */
function plcDoc(overrides: Record<string, JsonValue> = {}, did: string = me): JsonValue {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    alsoKnownAs: ['at://alice.bsky.social'],
    verificationMethod: [
      { id: `${did}#atproto`, type: 'Multikey', controller: did, publicKeyMultibase: 'zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF' },
    ],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    ...overrides,
  };
}

function setup() {
  const http = createFakeHttp();
  const adapter = createAtprotoAdapter({ http, clock: fakeClock });
  return { http, adapter, signal: new AbortController().signal };
}

describe('resolveIdentity — self-only', () => {
  it('rejects a target DID different from the session DID with access-denied and makes 0 requests', async () => {
    const { http, adapter, signal } = setup();
    http.on(`https://plc.directory/${other}`, okJson(plcDoc({}, other)));
    const r = await adapter.resolveIdentity({ session, did: other, signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('access-denied');
    expect(http.calls).toEqual([]);
    expect(http.permits).toEqual([]);
  });

  it('rejects a null-equivalent mismatch even when the PDS would be valid (0 requests)', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc()));
    const nullish = null as unknown as SessionRef;
    const r1 = await adapter.resolveIdentity({ session: nullish, did: me, signal });
    const r2 = await adapter.resolveIdentity({ session: { did: '' as Did, source: 'oauth' }, did: me, signal });
    for (const r of [r1, r2]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.kind).toBe('access-denied');
    }
    expect(http.calls).toEqual([]);
    expect(http.permits).toEqual([]);
  });
});

describe('resolveIdentity — did:plc', () => {
  it('requests https://plc.directory/<did> and returns the PDS origin and claimed handle', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc()));
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(http.calls).toEqual([PLC_URL]);
    expect(r).toEqual({
      ok: true,
      value: { did: me, didMethod: 'plc', pdsOrigin: PDS, claimedHandle: 'alice.bsky.social', resolvedFrom: 'https://plc.directory' },
    });
  });

  it('permits the PDS origin with basis pds-from-did-document', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc()));
    await adapter.resolveIdentity({ session, did: me, signal });
    expect(http.permits).toEqual([{ origin: PDS, basis: 'pds-from-did-document' }]);
  });

  it('normalises a PDS endpoint with a trailing slash / upper case to its origin', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://Morel.us-east.host.bsky.network/' }] })));
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(r.ok && r.value.pdsOrigin).toBe(PDS);
    expect(http.permits).toEqual([{ origin: PDS, basis: 'pds-from-did-document' }]);
  });
});

describe('resolveIdentity — did:web', () => {
  it('permits https://<host> with basis did-web-host, then requests /.well-known/did.json', async () => {
    const { http, adapter, signal } = setup();
    http.on(WEB_URL, okJson(plcDoc({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com' }] }, webMe)));
    const r = await adapter.resolveIdentity({ session: webSession, did: webMe, signal });
    expect(http.events.slice(0, 2)).toEqual([
      { type: 'permit', origin: 'https://alice.example.com', basis: 'did-web-host' },
      { type: 'get', url: WEB_URL },
    ]);
    expect(r).toEqual({
      ok: true,
      value: {
        did: webMe,
        didMethod: 'web',
        pdsOrigin: 'https://pds.example.com',
        claimedHandle: 'alice.bsky.social',
        resolvedFrom: 'https://alice.example.com',
      },
    });
    expect(http.permits[1]).toEqual({ origin: 'https://pds.example.com', basis: 'pds-from-did-document' });
  });

  it('did:web network failure (CORS) is returned as network unchanged', async () => {
    const { http, adapter, signal } = setup();
    const failure = failWith('network', { origin: 'https://alice.example.com' });
    http.on(WEB_URL, failure);
    const r = await adapter.resolveIdentity({ session: webSession, did: webMe, signal });
    expect(r).toEqual(failure);
    expect(http.permits).toEqual([{ origin: 'https://alice.example.com', basis: 'did-web-host' }]);
  });
});

describe('resolveIdentity — document validation', () => {
  it('document id mismatch → invalid-response', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc({ id: other })));
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('invalid-response');
      expect(r.failure.message).toBe('The DID document does not match this account.');
    }
    expect(http.permits).toEqual([]);
  });

  it('non-object document (array, string, null) → invalid-response', async () => {
    for (const body of [[plcDoc()], 'x', null] as JsonValue[]) {
      const { http, adapter, signal } = setup();
      http.on(PLC_URL, okJson(body));
      const r = await adapter.resolveIdentity({ session, did: me, signal });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.kind).toBe('invalid-response');
    }
  });

  it('no AtprotoPersonalDataServer service → invalid-response', async () => {
    const cases: JsonValue[] = [
      [],
      [{ id: '#atproto_pds', type: 'SomethingElse', serviceEndpoint: PDS }],
      [{ id: '#atproto_labeler', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
      [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: { origin: PDS } }],
      [null, 'x'],
      { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
    ];
    for (const service of cases) {
      const { http, adapter, signal } = setup();
      http.on(PLC_URL, okJson(plcDoc({ service })));
      const r = await adapter.resolveIdentity({ session, did: me, signal });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failure.kind).toBe('invalid-response');
        expect(r.failure.message).toBe('No PDS is listed for this account.');
      }
      expect(http.permits).toEqual([]);
    }
    // service missing entirely
    const { http, adapter, signal } = setup();
    const doc = plcDoc() as Record<string, JsonValue>;
    const { service: _omit, ...withoutService } = doc;
    http.on(PLC_URL, okJson(withoutService));
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(!r.ok && r.failure.kind).toBe('invalid-response');
  });

  it('service with id <did>#atproto_pds is accepted (and other services before it are skipped)', async () => {
    const { http, adapter, signal } = setup();
    http.on(
      PLC_URL,
      okJson(
        plcDoc({
          service: [
            { id: '#atproto_labeler', type: 'AtprotoLabeler', serviceEndpoint: 'https://labeler.example.com' },
            { id: `${me}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
          ],
        }),
      ),
    );
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(r.ok && r.value.pdsOrigin).toBe(PDS);
  });

  it('PDS endpoint http://, with a port, an IP address, or localhost → blocked-origin, not permitted', async () => {
    for (const endpoint of [
      'http://pds.example.com',
      'https://pds.example.com:2583',
      'https://203.0.113.7',
      'https://[::1]',
      'https://localhost',
      'https://pds.example.com/xrpc',
    ]) {
      const { http, adapter, signal } = setup();
      http.on(PLC_URL, okJson(plcDoc({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint }] })));
      const r = await adapter.resolveIdentity({ session, did: me, signal });
      expect(r.ok, endpoint).toBe(false);
      if (!r.ok) {
        expect(r.failure.kind).toBe('blocked-origin');
        expect(r.failure.message).toBe("This account's PDS address is not supported by SocialLens.");
      }
      expect(http.permits).toEqual([]);
      expect(http.calls).toEqual([PLC_URL]);
    }
  });
});

describe('resolveIdentity — claimed handle', () => {
  it('alsoKnownAs missing, without an at:// entry, or with an invalid handle → claimedHandle null', async () => {
    const variants: (Record<string, JsonValue> | 'omit')[] = [
      'omit',
      { alsoKnownAs: [] },
      { alsoKnownAs: ['https://alice.example.com'] },
      { alsoKnownAs: ['at://not a handle'] },
      { alsoKnownAs: 'at://alice.bsky.social' },
      { alsoKnownAs: [42, null] },
    ];
    for (const v of variants) {
      const { http, adapter, signal } = setup();
      let doc = plcDoc() as Record<string, JsonValue>;
      if (v === 'omit') {
        const { alsoKnownAs: _omit, ...rest } = doc;
        doc = rest;
      } else {
        doc = { ...doc, ...v };
      }
      http.on(PLC_URL, okJson(doc));
      const r = await adapter.resolveIdentity({ session, did: me, signal });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.claimedHandle).toBeNull();
    }
  });

  it('uses the first at:// entry, skipping non-at:// strings, lower-cased', async () => {
    const { http, adapter, signal } = setup();
    http.on(PLC_URL, okJson(plcDoc({ alsoKnownAs: ['https://x.example', 'at://Alice.Example.COM', 'at://second.bsky.social'] })));
    const r = await adapter.resolveIdentity({ session, did: me, signal });
    expect(r.ok && r.value.claimedHandle).toBe('alice.example.com');
  });
});

describe('resolveIdentity — failures and abort', () => {
  it('HTTP failures from plc.directory are returned unchanged', async () => {
    const { http, adapter, signal } = setup();
    const failure = failWith('http', { status: 404, origin: 'https://plc.directory' });
    http.on(PLC_URL, failure);
    expect(await adapter.resolveIdentity({ session, did: me, signal })).toEqual(failure);
  });

  it('abort during the request rejects with the abort reason', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    const reason = new DOMException('stop', 'AbortError');
    http.on(PLC_URL, hangUntilAbort(() => queueMicrotask(() => controller.abort(reason))));
    await expect(adapter.resolveIdentity({ session, did: me, signal: controller.signal })).rejects.toBe(reason);
    expect(http.permits).toEqual([]);
  });

  it('an already-aborted signal rejects before any request', async () => {
    const { http, adapter } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.resolveIdentity({ session, did: me, signal: controller.signal })).rejects.toSatisfy((e) => e === controller.signal.reason && controller.signal.aborted);
    expect(http.calls).toEqual([]);
  });
});
