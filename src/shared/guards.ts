import type { Did, Result, SessionRef } from './contract';
import { err, makeFailure, ok } from './result';

/** The single definition of "self" (invariant I-1): the target must be the signed-in DID. */
export function checkSelf(session: SessionRef | null, target: Did): Result<Did> {
  if (session !== null && session.did === target) return ok(target);
  return err(makeFailure('access-denied', 'Analysis is limited to the signed-in account.'));
}
