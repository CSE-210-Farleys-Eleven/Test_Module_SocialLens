/**
 * IT-11 (module boundaries) and IT-12 (hygiene), docs/architecture/PLAN.md §11.
 * These scan the source text, so the module rule is enforced by a test, not by convention.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../src');

/** Module folders, deepest first so nested modules win. */
const MODULES = [
  'analytics/privacy', 'analytics/worker', 'analytics/state', 'analytics',
  'adapters/atproto', 'adapters/bluesky', 'adapters/fixtures',
  'ui/components', 'ui/views',
  'auth', 'accounts', 'registry', 'normalize', 'shared',
] as const;

/** The only files allowed to import module implementations. */
const COMPOSITION_ROOTS = new Set(['main.ts', 'worker-main.ts', 'compose.ts']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const moduleOf = (path: string) => MODULES.find((m) => path === m || path.startsWith(`${m}/`)) ?? null;
const isTestSupport = (path: string) => /\.test\.ts$|(^|\/)(testkit|fakes|fake-http|test-helpers)\.ts$/.test(path);

interface ImportLine { readonly typeOnly: boolean; readonly specifier: string }

function importsOf(raw: string): ImportLine[] {
  // Doc comments may quote import statements; only real code counts.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: ImportLine[] = [];
  const pattern = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) found.push({ typeOnly: match[2] !== undefined, specifier: match[3] ?? '' });
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({ typeOnly: false, specifier: match[1] ?? '' });
  return found;
}

const files = walk(SRC).map((file) => ({ file, path: rel(file), source: readFileSync(file, 'utf8') }));
const runtimeFiles = files.filter((f) => !isTestSupport(f.path));

describe('IT-11 module boundaries', () => {
  it('finds all fourteen modules', () => {
    const seen = new Set(files.map((f) => moduleOf(f.path)).filter((m) => m !== null));
    expect([...seen].sort()).toEqual([...MODULES].sort());
  });

  it('a module imports runtime code only from itself and shared; other modules by type-only contract imports', () => {
    const violations: string[] = [];
    for (const f of runtimeFiles) {
      if (COMPOSITION_ROOTS.has(f.path)) continue;
      const own = moduleOf(f.path);
      for (const imp of importsOf(f.source)) {
        if (!imp.specifier.startsWith('.')) continue;
        const target = rel(resolve(dirname(f.file), imp.specifier));
        const targetModule = moduleOf(target);
        if (targetModule === own) continue;
        if (targetModule === 'shared') continue;
        const isContract = /(^|\/)contract$/.test(target);
        if (imp.typeOnly && isContract) continue;
        violations.push(`${f.path} imports ${imp.specifier}${imp.typeOnly ? ' (type)' : ''}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('every contract.ts imports types only', () => {
    const violations: string[] = [];
    for (const f of files.filter((x) => x.path.endsWith('/contract.ts'))) {
      for (const imp of importsOf(f.source)) if (!imp.typeOnly) violations.push(`${f.path}: ${imp.specifier}`);
    }
    expect(violations).toEqual([]);
  });

  it('only auth/browser-client.ts imports the OAuth library', () => {
    const importers = runtimeFiles.filter((f) => importsOf(f.source).some((imp) => imp.specifier.startsWith('@atproto/'))).map((f) => f.path);
    expect(importers).toEqual(['auth/browser-client.ts']);
  });

  it('the Worker entry imports only the pure analysis modules', () => {
    const entry = files.find((f) => f.path === 'worker-main.ts');
    expect(importsOf(entry?.source ?? '').map((imp) => imp.specifier).sort()).toEqual(['./analytics', './analytics/privacy', './analytics/worker', './analytics/worker/contract']);
  });

  it('the pure analysis modules touch no DOM, network, clock or randomness', () => {
    const banned = [/\bdocument\./, /\bwindow\./, /\bfetch\(/, /Date\.now\(/, /new Date\(\)/, /Math\.random\(/, /localStorage/];
    const violations: string[] = [];
    for (const f of runtimeFiles) {
      const m = moduleOf(f.path);
      if (m !== 'analytics' && m !== 'analytics/privacy' && m !== 'normalize' && m !== 'registry') continue;
      if (f.path.endsWith('contract.ts')) continue;
      for (const pattern of banned) if (pattern.test(f.source)) violations.push(`${f.path}: ${pattern.source}`);
    }
    expect(violations).toEqual([]);
  });
});

describe('IT-12 hygiene', () => {
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Words that must not appear in runtime source, and the files allowed to contain each. */
  const banned: readonly { readonly word: RegExp; readonly allow: readonly string[]; readonly why: string }[] = [
    { word: /innerHTML|outerHTML|insertAdjacentHTML|document\.write/i, allow: [], why: 'source content is rendered as text only' },
    { word: /transition:generic/i, allow: [], why: 'OAuth scope is atproto only' },
    { word: /app[ _-]?password/i, allow: [], why: 'no app passwords' },
    { word: /clearsky|constellation/i, allow: [], why: 'no network indexes' },
    { word: /getFollowers|getBlocks\b|getKnownFollowers/i, allow: [], why: 'no reads about other people' },
    { word: /createRecord|putRecord|deleteRecord|applyWrites/i, allow: [], why: 'read-only: no repo writes' },
    // The phrase may appear only where the UI explains why the metric does NOT exist.
    { word: /engagement rate/i, allow: ['shared/glossary.ts', 'ui/views/engagement.ts'], why: 'there is no exposure denominator' },
  ];

  for (const rule of banned) {
    it(`runtime source does not contain ${rule.word.source} (${rule.why})`, () => {
      const hits = runtimeFiles
        .filter((f) => !rule.allow.includes(f.path))
        .filter((f) => rule.word.test(stripComments(f.source)))
        .map((f) => f.path);
      expect(hits).toEqual([]);
    });
  }

  it('the only requested OAuth scope is the literal atproto', () => {
    const scopes = new Set<string>();
    for (const f of runtimeFiles.filter((x) => x.path.startsWith('auth/'))) {
      for (const match of stripComments(f.source).matchAll(/scope:\s*'([^']+)'/g)) scopes.add(match[1] ?? '');
    }
    expect([...scopes]).toEqual(['atproto']);
  });

  it('where "engagement rate" is allowed, it is only to say it is not shown', () => {
    const glossary = files.find((f) => f.path === 'shared/glossary.ts')?.source ?? '';
    const view = files.find((f) => f.path === 'ui/views/engagement.ts')?.source ?? '';
    expect(view).toContain('This is not an engagement rate');
    expect(glossary).toMatch(/engagement[- ]rate/i);
    expect(glossary).not.toMatch(/label:\s*'Engagement rate'[\s\S]{0,200}sharedByAllApps:\s*true/);
  });
});
