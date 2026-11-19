import type { ClassifySessionEnd } from './contract';

export const classifySessionEnd: ClassifySessionEnd = (cause, classes) => {
  if (cause instanceof classes.TokenRefreshError) return 'expired';
  if (cause instanceof classes.TokenRevokedError) return 'revoked';
  if (cause instanceof classes.TokenInvalidError) return 'invalid';
  return 'unknown';
};
