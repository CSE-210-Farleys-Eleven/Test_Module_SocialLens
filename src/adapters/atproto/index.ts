// M4a `adapters/atproto/` public API.
import type { CreateAtprotoAdapter } from './contract';
import { resolveIdentity } from './identity';
import { describeRepo, listCollection } from './repo';

export const createAtprotoAdapter: CreateAtprotoAdapter = ({ http }) => ({
  resolveIdentity: (request) => resolveIdentity(http, request),
  describeRepo: (request) => describeRepo(http, request),
  listCollection: (request) => listCollection(http, request),
});
