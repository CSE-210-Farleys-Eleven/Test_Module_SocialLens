// Public API of M7a `ui/views/`.
import type { CreateViews, Views } from './contract';
import { createAccounts, type DraftHolder } from './accounts';
import { createActivity } from './activity';
import { createEngagement } from './engagement';
import { createOverview } from './overview';
import { createPrivacy } from './privacy';
import { createShell } from './shell';

export { mountApp } from './mount';
export { TEST_IDS } from './contract';

export const createViews: CreateViews = (deps) => {
  const draft: DraftHolder = { value: '' };
  const dataViews: Omit<Views, 'shell'> = {
    overview: createOverview(deps),
    activity: createActivity(deps),
    engagement: createEngagement(deps),
    privacy: createPrivacy(deps),
    accounts: createAccounts(deps, draft),
  };
  return { ...dataViews, shell: createShell(deps, dataViews) };
};
