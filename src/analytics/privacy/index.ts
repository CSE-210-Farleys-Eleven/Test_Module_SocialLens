// Public API of M6a `analytics/privacy/` (see CONTRACT.md "Public API").

import { OBSERVATION_IDS } from '../../shared/contract';
import type { ComputePrivacy, NotTriggered, PrivacyObservation } from './contract';
import { buildContext } from './evidence';
import { RULES } from './rules';

export const computePrivacy: ComputePrivacy = (input) => {
  const { snapshot, registry, options } = input;
  const ctx = buildContext(snapshot, registry, options);
  const observations: PrivacyObservation[] = [];
  const notTriggered: NotTriggered[] = [];
  for (const id of OBSERVATION_IDS) {
    const result = RULES[id](ctx);
    if ('evidence' in result) observations.push(result);
    else notTriggered.push(result);
  }
  return {
    schemaVersion: 1,
    did: snapshot.account.did,
    fetchedAt: snapshot.fetchedAt,
    mode: snapshot.mode,
    observations,
    notTriggered,
    notAssessed: registry.nonRepoData.map((note) => ({ ...note })),
  };
};
