// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'src/ui/views');
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testkit.ts');

const BANNED: readonly RegExp[] = [
  /inner(HTML)/i,
  /outer(HTML)/i,
  /insertAdjacent(HTML)/i,
  /document\.write/,
  /DOM(Parser)/,
  /\beval\s*\(/,
  /\bfetch\s*\(/,
  /localStorage|sessionStorage|indexedDB/,
  /createElement\(\s*['"](img|iframe|script)/,
  /['"]style['"]/,
  /setAttribute\(\s*['"]on/i,
  /javascript:/i,
];

describe('hygiene', () => {
  it('finds the view sources', () => {
    expect(sources).toEqual(expect.arrayContaining(['index.ts', 'shell.ts', 'mount.ts']));
  });
  it.each(sources)('%s uses no banned API and imports only shared at runtime', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const re of BANNED) expect(text).not.toMatch(re);
    for (const line of text.split('\n').filter((l) => /^import\s/.test(l) && /from '\.\.\//.test(l))) {
      const runtimeOk = /from '\.\.\/\.\.\/shared(\/contract)?'/.test(line);
      expect(line.startsWith('import type') || runtimeOk, line).toBe(true);
    }
  });
});
