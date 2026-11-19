/**
 * M6a `analytics/privacy/` — FROZEN CONTRACT.
 * Evidence-backed observations about what the person's OWN public records reveal.
 * Pure; plain structured-cloneable input and output. Types only.
 */
import type { AtUri, Citation, Did, IsoDateTime, Nsid, ObservationId, Snapshot } from '../../shared/contract';
import type { NonRepoDataNote, RegistryData } from '../../registry/contract';

export interface PrivacyOptions {
  /** Max sample AT-URIs per observation (LIMITS.sampleUris). */
  readonly sampleUris: number;
  /** Posting-time observation thresholds (LIMITS.patternMinItems / patternBandHours / patternShareThreshold). */
  readonly patternMinItems: number;
  readonly patternBandHours: number;
  readonly patternShareThreshold: number;
}

export interface PrivacyInput {
  readonly snapshot: Snapshot;
  readonly registry: RegistryData;
  readonly options: PrivacyOptions;
}

export interface EvidenceDetail {
  readonly label: string;
  readonly value: string;
}

/** What the statement rests on. Sample URIs are always the person's OWN record URIs. */
export interface ObservationEvidence {
  /** Number of own records the observation is about; null when the count is unknown. */
  readonly count: number | null;
  readonly countCertainty: 'exact' | 'lower-bound' | 'unknown';
  /** Up to `sampleUris` own record URIs, newest first (ties by URI ascending). Render as text. */
  readonly sampleUris: readonly AtUri[];
  /** Earliest / latest author-supplied timestamp among the evidence records; null when none is dated. */
  readonly earliestAt: IsoDateTime | null;
  readonly latestAt: IsoDateTime | null;
  /** Collections the evidence came from. */
  readonly collections: readonly Nsid[];
  /** Extra label/value facts (e.g. "Busiest band" → "18:00–23:59 UTC"). Never a subject DID or handle. */
  readonly details: readonly EvidenceDetail[];
}

/** Every observation has all four parts: evidence, source, limitation, action. */
export interface PrivacyObservation {
  readonly id: ObservationId;
  readonly title: string;
  /** One or two plain sentences stating the fact, prefixed for demo data. */
  readonly summary: string;
  readonly evidence: ObservationEvidence;
  readonly source: Citation;
  readonly limitation: string;
  readonly action: string;
}

export interface NotTriggered {
  readonly id: ObservationId;
  /** Why the rule did not fire, e.g. "No block records were fetched." */
  readonly reason: string;
}

export interface PrivacyReport {
  readonly schemaVersion: 1;
  readonly did: Did;
  readonly fetchedAt: IsoDateTime;
  readonly mode: 'live' | 'demo';
  /** Triggered observations in OBSERVATION_IDS order. */
  readonly observations: readonly PrivacyObservation[];
  /** Every catalogue id that did not trigger, in OBSERVATION_IDS order. */
  readonly notTriggered: readonly NotTriggered[];
  /** Copied from the registry: what is not in the public repo and therefore not assessed. */
  readonly notAssessed: readonly NonRepoDataNote[];
}

/** Pure, deterministic, synchronous, total. Never predicts identity, location, health or personality. */
export type ComputePrivacy = (input: PrivacyInput) => PrivacyReport;
