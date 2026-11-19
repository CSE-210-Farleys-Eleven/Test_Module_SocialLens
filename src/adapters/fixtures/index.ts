// Public API of adapters/fixtures (M4c): fully synthetic, HTTP-shaped demo data.

import type { Did, IsoDateTime } from '../../shared/contract';
import { parseIsoDateTime } from '../../shared';
import { DEMO_ACCOUNT, type CreateFixtures, type DemoScenarioInfo } from './contract';
import { buildManifest } from './manifest';
import { createFixtureServer } from './server';

export { DEMO_ACCOUNT, DEMO_SCENARIO_IDS } from './contract';

const SCENARIOS: readonly DemoScenarioInfo[] = [
  {
    id: 'complete',
    label: 'Complete sample',
    description: 'A fictional account whose every collection reads completely, with counters for every post.',
  },
  {
    id: 'partial',
    label: 'Partial and unavailable reads',
    description: 'A fictional account where some pages fail, some records are malformed and some counters are missing.',
  },
  {
    id: 'empty',
    label: 'Empty account',
    description: 'A fictional account with no records at all, so every count is an observed zero.',
  },
];

export const createFixtures: CreateFixtures = () => ({
  scenarios: SCENARIOS,
  session: { did: DEMO_ACCOUNT.did as Did, source: 'demo' },
  now: parseIsoDateTime(DEMO_ACCOUNT.now) ?? (DEMO_ACCOUNT.now as IsoDateTime),
  manifest: (scenario) => buildManifest(scenario),
  createServer: (scenario, options) => createFixtureServer(scenario, options),
});
