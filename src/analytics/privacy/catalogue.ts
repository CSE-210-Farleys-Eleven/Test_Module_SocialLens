// The eight privacy observations, worded exactly as docs/architecture/GLOSSARY.md Part C.
// Wording is binding: change GLOSSARY.md first, then this file.

import { OBSERVATION_IDS } from '../../shared/contract';
import type { ObservationId, SourceId } from '../../shared/contract';

export interface CatalogueEntry {
  readonly id: ObservationId;
  readonly title: string;
  readonly sourceId: SourceId;
  readonly limitation: string;
  readonly action: string;
}

const ENTRIES: Readonly<Record<ObservationId, CatalogueEntry>> = {
  'public-likes': {
    id: 'public-likes',
    title: 'Your likes are public records',
    sourceId: 'bsky-privacy-policy',
    limitation:
      'The Bluesky app does not show other people a list of your likes, but each like is a public record that any software can read. SocialLens shows only what it fetched and cannot tell who has read these records. Removing a like deletes the record; copies may remain in third-party indexes.',
    action:
      'Open a sample record to see exactly what is published. Unlike anything you would not want publicly tied to this account.',
  },
  'public-follows': {
    id: 'public-follows',
    title: 'Your follows are public records',
    sourceId: 'bsky-privacy-policy',
    limitation:
      'This counts follow records you created. It says nothing about who follows you, and the date on each record shows when you followed.',
    action:
      'Review who you follow if the list itself could reveal something you want to keep private; unfollowing deletes the record.',
  },
  'public-blocks': {
    id: 'public-blocks',
    title: 'Your blocks are public records',
    sourceId: 'bsky-docs-following',
    limitation:
      'This is only about blocks you created. SocialLens does not look up who blocks you. Blocking an account does not hide the fact that you blocked it.',
    action:
      'If you want to stop seeing an account without publishing that fact, unblock and mute instead: mutes are private and are not stored in your public repository.',
  },
  'public-lists': {
    id: 'public-lists',
    title: 'Lists you created are public records',
    sourceId: 'atproto-blog-spaces',
    limitation:
      'This covers lists you made and the accounts you added to them. Lists that other people put you on are not looked up.',
    action:
      'Check list names and descriptions: they are public text. Remove entries or delete lists you no longer want published.',
  },
  'cross-app-identity': {
    id: 'cross-app-identity',
    title: 'One identity links your activity across apps',
    sourceId: 'atproto-blog-spaces',
    limitation:
      'The shared repository links these records to each other. It does not link them to other accounts or to a real-world identity.',
    action:
      'Use a separate account when you need a separate public context; using a different app with the same account does not separate anything.',
  },
  'posting-time-pattern': {
    id: 'posting-time-pattern',
    title: 'Your posting times form a visible pattern',
    sourceId: 'atproto-blog-spaces',
    limitation:
      'Timestamps are written by the app you post with and can be scheduled or imported. This pattern is not evidence of a time zone, location, sleep schedule or job.',
    action: 'Treat post times as part of what you publish. Do not rely on timing to hide where you are.',
  },
  'handle-validity': {
    id: 'handle-validity',
    title: 'Your handle could not be confirmed',
    sourceId: 'atproto-spec-handle',
    limitation:
      "SocialLens relies on your PDS's own check and did not query DNS itself. Your DID, not your handle, is what identifies the account.",
    action: "Check the handle's DNS or well-known setup in your account settings, then reload.",
  },
  'incomplete-coverage': {
    id: 'incomplete-coverage',
    title: 'This view is not your whole footprint',
    sourceId: 'lexicon-list-records',
    limitation:
      'An absence here is not evidence that a record is private or does not exist. Other apps, deleted records and copies held elsewhere are not evaluated.',
    action: 'Read the coverage table on the Accounts view and reload to retry a failed read.',
  },
};

/** In OBSERVATION_IDS order. */
export const CATALOGUE: readonly CatalogueEntry[] = OBSERVATION_IDS.map((id) => ENTRIES[id]);

export function catalogueEntry(id: ObservationId): CatalogueEntry {
  return ENTRIES[id];
}

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** Not-triggered reasons (exact GLOSSARY wording; numbers come from PrivacyOptions). */
export const NOT_TRIGGERED = {
  noLikes: 'No like records were fetched.',
  noFollows: 'No follow records were fetched.',
  noBlocks: 'No block records were fetched.',
  noLists: 'No list records were fetched.',
  oneApp: 'Records from only one app were fetched.',
  fewItems: (min: number): string => `Fewer than ${min} dated content items were fetched.`,
  noBand: (threshold: number, bandHours: number): string =>
    `No ${bandHours}-hour UTC band holds ${percent(threshold)} or more of your dated content items.`,
  handleValid: 'Your PDS confirms the handle resolves to this account.',
  coverageComplete: 'Every analysed collection was read completely.',
  notRead: (label: string): string => `The ${label} collection could not be read, so this was not assessed.`,
} as const;
