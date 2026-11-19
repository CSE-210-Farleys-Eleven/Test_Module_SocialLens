/**
 * Web Worker entry (composition root). Imports only the pure analysis modules,
 * so the worker bundle contains no DOM, auth or network code.
 */
import { computeAnalytics } from './analytics';
import { computePrivacy } from './analytics/privacy';
import { createComputeAnalysis, installWorkerHandler } from './analytics/worker';
import type { WorkerScopeLike } from './analytics/worker/contract';

installWorkerHandler(self as unknown as WorkerScopeLike, createComputeAnalysis({ computeAnalytics, computePrivacy }));
