/**
 * M5 `normalize/` — FROZEN CONTRACT.
 * App-specific records → one shared `ActivityRecord` model, without losing uncertainty.
 * Pure and synchronous. Types only.
 */
import type { ActivityRecord, Did, RawRecord, SkippedRecord } from '../shared/contract';
import type { EngagementResult } from '../adapters/bluesky/contract';
import type { Registry } from '../registry/contract';

export interface NormalizeInput {
  /** Repository owner. Every record's URI authority must equal it. */
  readonly did: Did;
  /** Accepted raw records from any mix of collections, in any order. */
  readonly records: readonly RawRecord[];
  /** Counter lookups for own posts; may be empty (then eligible records get `unknown / not-requested`). */
  readonly engagement: readonly EngagementResult[];
}

export interface NormalizeResult {
  /** One entry per mappable input record, in input order. */
  readonly records: readonly ActivityRecord[];
  /** One entry per input record that could not be mapped, in input order, each with a reason. */
  readonly skipped: readonly SkippedRecord[];
}

export interface Normalizer {
  /**
   * Total function: never throws, never drops silently.
   * `records.length + skipped.length === input.records.length` always holds.
   */
  normalize(input: NormalizeInput): NormalizeResult;
}

export interface NormalizerDeps {
  readonly registry: Registry;
}

export type CreateNormalizer = (deps: NormalizerDeps) => Normalizer;
