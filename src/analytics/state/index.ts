// Public API of `analytics/state/` (M6c). Exactly the names under "Public API" in CONTRACT.md.
import type { CreateAppController, CreateAppStore, CreateInitialState, Reduce } from './contract';
import { createAppController as controller } from './controller';
import { createInitialState as initial } from './initial';
import { reduce as reducer } from './reducer';
import { createAppStore as store } from './store';

export const createInitialState: CreateInitialState = initial;
export const reduce: Reduce = reducer;
export const createAppStore: CreateAppStore = store;
export const createAppController: CreateAppController = controller;
