import type { CreateAccounts } from './contract';
import { createAccountsService } from './accounts';

export const createAccounts: CreateAccounts = (deps) => createAccountsService(deps);
