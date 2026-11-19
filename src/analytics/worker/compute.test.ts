import { describe, expect, it, vi } from 'vitest';
import type { AnalysisJob } from './contract';
import { createComputeAnalysis } from './index';

export const makeJob = (jobId = 'job-1'): AnalysisJob =>
  ({
    jobId,
    snapshot: { tag: 'snapshot' },
    registry: { tag: 'registry' },
    analytics: { tag: 'analytics-options' },
    privacy: { tag: 'privacy-options' },
  }) as unknown as AnalysisJob;

describe('createComputeAnalysis', () => {
  it('calls both functions once with the job parts and returns both reports', () => {
    const analytics = { tag: 'A' };
    const privacy = { tag: 'P' };
    const computeAnalytics = vi.fn(() => analytics);
    const computePrivacy = vi.fn(() => privacy);
    const compute = createComputeAnalysis({ computeAnalytics, computePrivacy } as never);
    const job = makeJob();
    expect(compute(job)).toEqual({ analytics, privacy });
    expect(computeAnalytics).toHaveBeenCalledTimes(1);
    expect(computeAnalytics).toHaveBeenCalledWith({ snapshot: job.snapshot, registry: job.registry, options: job.analytics });
    expect(computePrivacy).toHaveBeenCalledTimes(1);
    expect(computePrivacy).toHaveBeenCalledWith({ snapshot: job.snapshot, registry: job.registry, options: job.privacy });
  });

  it('does not catch errors', () => {
    const compute = createComputeAnalysis({
      computeAnalytics: () => {
        throw new Error('boom');
      },
      computePrivacy: () => ({}),
    } as never);
    expect(() => compute(makeJob())).toThrow('boom');
  });
});
