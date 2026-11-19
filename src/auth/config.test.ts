import { describe, expect, it } from 'vitest';
import { resolveAuthConfig } from './config';

const loc = (hostname: string, origin: string) => ({ hostname, origin });

describe('resolveAuthConfig', () => {
  it.each([
    ['127.0.0.1', 'http://127.0.0.1:5173'],
    ['[::1]', 'http://[::1]:5173'],
    ['localhost', 'http://localhost:5173'],
  ])('%s → loopback config', (hostname, origin) => {
    const r = resolveAuthConfig(loc(hostname, origin), 'https://ignored.example.com/client-metadata.json');
    expect(r).toEqual({
      ok: true,
      value: { clientKind: 'loopback', clientId: null, handleResolver: 'https://bsky.social', scope: 'atproto' },
    });
  });

  it('another host with an https hostedClientId → hosted config', () => {
    const id = 'https://sociallens.example.com/client-metadata.json';
    const r = resolveAuthConfig(loc('sociallens.example.com', 'https://sociallens.example.com'), id);
    expect(r).toEqual({
      ok: true,
      value: { clientKind: 'hosted', clientId: id, handleResolver: 'https://bsky.social', scope: 'atproto' },
    });
  });

  it.each([null, 'http://sociallens.example.com/client-metadata.json', 'not a url', ''])(
    'another host with client id %j → err(unsupported)',
    (id) => {
      const r = resolveAuthConfig(loc('sociallens.example.com', 'https://sociallens.example.com'), id);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failure.kind).toBe('unsupported');
        expect(r.failure.message).toBe('Live sign-in is not configured for this site.');
      }
    },
  );
});
