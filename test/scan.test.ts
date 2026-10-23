import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mechanicalFix } from '../src/paths.js';
import { scan } from '../src/scan.js';

const routesDir = path.join(import.meta.dirname, 'fixtures/routes');

const PATH_ERRORS = [
  'app.js *',
  'app.js /*',
  'app.js /files/*',
  'app.js /foo/*/bar',
  'app.js /:id?',
  'app.js /users/:id?',
  'app.js /:id?/:name?',
  'app.js /api/:version?/:id?',
  'app.js /(.*)',
  'app.js /foo/(.*)',
  'app.js /(.*)/bar',
  String.raw`app.js /:id(\d+)`,
  'app.js /:file.:ext?',
  'app.js /[discussion|page]/:slug',
  'app.js /foo+',
  'app.js **',
  'app.js /foo*',
  'app.js /:status?',
  'app.js /:template?',
  'app.js /double/:id?',
  'app.js /route/:id?',
  'app.js /mounted/:id?',
  'app.js /server/:id?',
  'app.js /from-api/*',
  'app.js /inline/*',
  'app.js /optional/:id?',
  'app.js /computed/:id?',
  String.raw`extra.ts /:id(\d+)`,
  'extra.ts /files/*',
  'esm.mjs /esm/:id?',
  'legacy.ts /legacy/*',
];

describe('scan', () => {
  const result = scan(routesDir);

  it('flags every crashing route and no decoys', () => {
    const paths = result.findings.filter((finding) => finding.rule === 'path-syntax').map((finding) => `${finding.file} ${finding.path}`);
    expect(paths.sort()).toEqual([...PATH_ERRORS].sort());
    expect(result.findings.some((finding) => finding.file === 'decoy.js')).toBe(false);
    expect(result.findings.some((finding) => finding.path === '/decoy/:id?' || finding.path === '/decoy/(.*)' || finding.path === '/decoy/*')).toBe(
      false,
    );
    expect(result.findings.some((finding) => finding.path === '/{*splat}' || finding.path === '/users/:id' || finding.path === '/:file{.:ext}')).toBe(
      false,
    );
  });

  it('points each finding at the source line', () => {
    for (const finding of result.findings) {
      const text = fs.readFileSync(path.join(routesDir, finding.file), 'utf8').split('\n')[finding.line - 1] ?? '';
      expect(text.length).toBeGreaterThan(0);
      if (finding.path) {
        const encoded = finding.path.replaceAll('\\', '\\\\');
        expect(text.includes(finding.path) || text.includes(encoded)).toBe(true);
        expect(['"', "'", '`']).toContain(text[finding.column - 1]);
        const fixed = mechanicalFix(finding.path);
        if (fixed) expect(finding.hint).toContain(fixed);
      }
    }
  });

  it('reports removed APIs as errors and silent changes as warnings', () => {
    const rules = result.findings.filter((finding) => finding.rule !== 'path-syntax').map((finding) => `${finding.severity} ${finding.rule}`);
    expect(rules.sort()).toEqual(
      [
        'error removed-api',
        'error removed-api',
        'error removed-api',
        'error removed-api',
        'error removed-api',
        'error removed-api',
        'error removed-api',
        'warning numeric-params',
        'warning numeric-params',
        'warning query-assign',
        'warning query-mutate',
        'warning splat-root',
      ].sort(),
    );
    const splat = result.findings.find((finding) => finding.rule === 'splat-root');
    expect(splat?.path).toBe('/*splat');
    expect(splat?.hint).toContain('/{*splat}');
    expect(result.errorCount).toBe(PATH_ERRORS.length + 7);
  });

  it('warns about req.body only when the project has no parser', () => {
    const missing = scan(path.join(import.meta.dirname, 'fixtures/no-parser'));
    expect(missing.findings.map((finding) => finding.rule)).toEqual(['body-undefined']);
    expect(missing.errorCount).toBe(0);

    const parsed = scan(path.join(import.meta.dirname, 'fixtures/parser'));
    expect(parsed.findings).toEqual([]);

    const split = scan(path.join(import.meta.dirname, 'fixtures/parser-split'));
    expect(split.findings).toEqual([]);
  });

  it('warns instead of throwing when a file cannot be parsed', () => {
    const broken = scan(path.join(import.meta.dirname, 'fixtures/broken'));
    expect(broken.errorCount).toBe(0);
    expect(broken.findings.some((finding) => finding.rule === 'parse')).toBe(true);
  });
});
