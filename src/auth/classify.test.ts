import { describe, expect, it } from 'vitest';
import { classifySessionEnd } from './classify';

class TokenRefreshError extends Error {}
class TokenRevokedError extends Error {}
class TokenInvalidError extends Error {}
const classes = { TokenRefreshError, TokenRevokedError, TokenInvalidError };

describe('classifySessionEnd', () => {
  it('maps the three library error classes', () => {
    expect(classifySessionEnd(new TokenRefreshError('x'), classes)).toBe('expired');
    expect(classifySessionEnd(new TokenRevokedError('x'), classes)).toBe('revoked');
    expect(classifySessionEnd(new TokenInvalidError('x'), classes)).toBe('invalid');
  });

  it.each([new Error('boom'), 'TokenRefreshError', undefined, null, {}])('maps %j to unknown', (cause) => {
    expect(classifySessionEnd(cause, classes)).toBe('unknown');
  });
});
