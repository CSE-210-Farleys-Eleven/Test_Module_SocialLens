import type { CreateBlueskyAdapter } from './contract';
import { getCounts } from './counts';

export const createBlueskyAdapter: CreateBlueskyAdapter = ({ http, clock }) => ({
  getCounts: (request) => getCounts(http, clock, request),
});
