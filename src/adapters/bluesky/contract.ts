/**
 * M4b `adapters/bluesky/` — FROZEN CONTRACT.
 * Public interaction counters for the user's OWN posts from the public Bluesky AppView.
 * Types only.
 */
import type { AtUri, Clock, Engagement, EngagementCoverage, HttpClient, SessionRef } from '../../shared/contract';

export interface CountsProgress {
  /** 1-based index of the batch just finished. */
  readonly batch: number;
  readonly batches: number;
}

export interface EngagementRequest {
  readonly session: SessionRef;
  /** Post URIs to look up. Only URIs whose authority is `session.did` and whose collection is `app.bsky.feed.post` are ever sent. */
  readonly uris: readonly AtUri[];
  readonly signal: AbortSignal;
  readonly onProgress: ((progress: CountsProgress) => void) | null;
}

export interface EngagementResult {
  readonly uri: AtUri;
  /** Never `{ status: 'not-available' }`: this adapter only answers for a source that exists. */
  readonly engagement: Engagement;
}

export interface EngagementLookup {
  /** Exactly one entry per DISTINCT requested URI, in first-occurrence request order. */
  readonly results: readonly EngagementResult[];
  readonly coverage: EngagementCoverage;
}

export interface EngagementSource {
  /**
   * Batched `app.bsky.feed.getPosts` (≤ 25 URIs per call), sequential.
   * A failed batch yields `unknown`, never zero. Rejects only with the caller's AbortError.
   */
  getCounts(request: EngagementRequest): Promise<EngagementLookup>;
}

export interface BlueskyAdapterDeps {
  readonly http: HttpClient;
  readonly clock: Clock;
}

export type CreateBlueskyAdapter = (deps: BlueskyAdapterDeps) => EngagementSource;
