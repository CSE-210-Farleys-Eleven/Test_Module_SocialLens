import { describe, expect, it } from 'vitest';
import type { Did, SessionRef } from './contract';
import { checkSelf } from './guards';

const me = 'did:plc:abcdefghijklmnopqrstuvwx' as Did;
const other = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' as Did;

describe('checkSelf', () => {
  it('null session → access-denied', () => {
    const r = checkSelf(null, me);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('access-denied');
      expect(r.failure.message).toBe('Analysis is limited to the signed-in account.');
    }
  });
  it('different DID → access-denied', () => {
    const session: SessionRef = { did: me, source: 'oauth' };
    const r = checkSelf(session, other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('access-denied');
  });
  it('same DID → ok(target)', () => {
    expect(checkSelf({ did: me, source: 'oauth' }, me)).toEqual({ ok: true, value: me });
    expect(checkSelf({ did: me, source: 'demo' }, me)).toEqual({ ok: true, value: me });
  });
});
