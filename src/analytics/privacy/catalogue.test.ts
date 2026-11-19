import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OBSERVATION_IDS, SOURCES } from '../../shared/contract';
import { CATALOGUE, NOT_TRIGGERED } from './catalogue';

const allTexts = (): string[] => [
  ...CATALOGUE.flatMap((e) => [e.title, e.limitation, e.action]),
  NOT_TRIGGERED.noLikes,
  NOT_TRIGGERED.noFollows,
  NOT_TRIGGERED.noBlocks,
  NOT_TRIGGERED.noLists,
  NOT_TRIGGERED.oneApp,
  NOT_TRIGGERED.fewItems(10),
  NOT_TRIGGERED.noBand(0.4, 6),
  NOT_TRIGGERED.handleValid,
  NOT_TRIGGERED.coverageComplete,
  NOT_TRIGGERED.notRead('Likes'),
];

describe('catalogue', () => {
  it('has exactly the eight ids in OBSERVATION_IDS order, each with title, limitation, action and a known source', () => {
    expect(CATALOGUE.map((e) => e.id)).toEqual([...OBSERVATION_IDS]);
    for (const e of CATALOGUE) {
      expect(e.title.trim()).not.toBe('');
      expect(e.limitation.trim()).not.toBe('');
      expect(e.action.trim()).not.toBe('');
      expect(Object.keys(SOURCES)).toContain(e.sourceId);
    }
  });

  it('cites the catalogue sources (blocks → bsky-docs-following, handle → atproto-spec-handle)', () => {
    const src = Object.fromEntries(CATALOGUE.map((e) => [e.id, e.sourceId]));
    expect(src).toEqual({
      'public-likes': 'bsky-privacy-policy',
      'public-follows': 'bsky-privacy-policy',
      'public-blocks': 'bsky-docs-following',
      'public-lists': 'atproto-blog-spaces',
      'cross-app-identity': 'atproto-blog-spaces',
      'posting-time-pattern': 'atproto-blog-spaces',
      'handle-validity': 'atproto-spec-handle',
      'incomplete-coverage': 'lexicon-list-records',
    });
  });

  it('uses the exact GLOSSARY wording for titles', () => {
    expect(CATALOGUE.map((e) => e.title)).toEqual([
      'Your likes are public records',
      'Your follows are public records',
      'Your blocks are public records',
      'Lists you created are public records',
      'One identity links your activity across apps',
      'Your posting times form a visible pattern',
      'Your handle could not be confirmed',
      'This view is not your whole footprint',
    ]);
  });

  it('the block action mentions muting as the private alternative', () => {
    const block = CATALOGUE.find((e) => e.id === 'public-blocks');
    expect(block?.action).toMatch(/mute/i);
    expect(block?.action).toMatch(/private/i);
  });

  it('never offers "who blocks you" as a feature (only as a disclaimer)', () => {
    for (const t of allTexts()) {
      const occurrences = t.match(/who blocks you/gi)?.length ?? 0;
      const disclaimed = t.match(/does not look up who blocks you/gi)?.length ?? 0;
      expect(occurrences).toBe(disclaimed);
      expect(t).not.toMatch(/who blocked you|blocked by/i);
    }
  });

  it('asserts no unproven user beliefs and no score', () => {
    for (const t of allTexts()) {
      expect(t).not.toMatch(/(you|users) (may )?(do not|don't|might not|may not) (know|realise|realize)/i);
      expect(t).not.toMatch(/\bscore\b|\bseverity\b|\brisk level\b/i);
    }
  });

  it('formats the not-triggered reasons exactly', () => {
    expect(NOT_TRIGGERED.notRead('Likes')).toBe('The Likes collection could not be read, so this was not assessed.');
    expect(NOT_TRIGGERED.fewItems(10)).toBe('Fewer than 10 dated content items were fetched.');
    expect(NOT_TRIGGERED.noBand(0.4, 6)).toBe('No 6-hour UTC band holds 40% or more of your dated content items.');
    expect(NOT_TRIGGERED.coverageComplete).toBe('Every analysed collection was read completely.');
  });

  it('runtime source names no network index and uses no clock, DOM or network', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/clearsky|constellation/i);
      expect(src).not.toMatch(/Date\.now|new Date\(|fetch\(|document\.|window\.|Math\.random/);
    }
  });
});
