import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fix } from '../src/fix.js';
import { scan } from '../src/scan.js';

const routesDir = path.join(import.meta.dirname, 'fixtures/routes');

function copyRoutes(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express5-ready-'));
  fs.cpSync(routesDir, dir, { recursive: true });
  return dir;
}

describe('fix', () => {
  it('prints a diff on dry-run and leaves files alone', () => {
    const dir = copyRoutes();
    const before = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    const result = fix(dir, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.diff).toContain('--- app.js');
    expect(result.diff).toContain("+app.get('/*splat'");
    expect(result.diff).toContain("+app.get('{/:id}'");
    expect(fs.readFileSync(path.join(dir, 'app.js'), 'utf8')).toBe(before);
    expect(result.changes.some((change) => change.before === '/decoy/:id?')).toBe(false);
  });

  it('rewrites only the mechanical patterns and keeps the original quotes', () => {
    const dir = copyRoutes();
    const result = fix(dir);
    const source = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    expect(source).toContain("app.get('/*splat'");
    expect(source).toContain("app.get('{/:id}'");
    expect(source).toContain('app.get(`{/:template}`');
    expect(source).toContain('app.get("/double{/:id}"');
    expect(source).toContain("app.get('/decoy/(.*)'");
    expect(source).toContain("cache.get('/decoy/:id?')");
    expect(source).toContain("app.get('/:id(\\\\d+)'");
    expect(source).toContain("app.get('/:file.:ext?'");
    expect(source).toContain("app.get('/foo*'");
    expect(fix(dir).changes).toEqual([]);

    const unfixed = [
      String.raw`/:id(\d+)`,
      '/:file.:ext?',
      '/[discussion|page]/:slug',
      '/foo+',
      '**',
      '/foo*',
    ];
    const remaining = scan(dir).findings.filter((finding) => finding.rule === 'path-syntax').map((finding) => finding.path);
    expect(remaining.sort()).toEqual([...unfixed, String.raw`/:id(\d+)`].sort());
    expect(result.changes.every((change) => !unfixed.includes(change.before))).toBe(true);
  });
});
