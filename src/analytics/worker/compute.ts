import type { CreateComputeAnalysis } from './contract';

export const createComputeAnalysis: CreateComputeAnalysis =
  ({ computeAnalytics, computePrivacy }) =>
  (job) => ({
    analytics: computeAnalytics({ snapshot: job.snapshot, registry: job.registry, options: job.analytics }),
    privacy: computePrivacy({ snapshot: job.snapshot, registry: job.registry, options: job.privacy }),
  });
