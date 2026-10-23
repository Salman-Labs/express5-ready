import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDeps } from '../src/deps.js';

function writePackage(manifest: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express5-ready-deps-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

describe('checkDeps', () => {
  it('flags only reproduced middleware and keeps the declared version', () => {
    const dir = writePackage({
      dependencies: {
        express: '^5.1.0',
        'express-mongo-sanitize': '^2.2.0',
        helmet: '^8.0.0',
      },
      devDependencies: {
        'express-query-boolean': '2.0.0',
      },
      optionalDependencies: {
        hpp: '~0.2.3',
      },
    });
    const result = checkDeps(dir);
    expect(result.findings.map((finding) => `${finding.name}@${finding.version}`).sort()).toEqual([
      'express-mongo-sanitize@^2.2.0',
      'express-query-boolean@2.0.0',
      'hpp@~0.2.3',
    ]);
    expect(result.findings.every((finding) => finding.reason.length > 40)).toBe(true);
    expect(result.findings.every((finding) => finding.file === 'package.json' && finding.line > 1)).toBe(true);
  });

  it('returns no findings for a package.json that does not list them', () => {
    const dir = writePackage({ dependencies: { express: '^4.21.0' } });
    expect(checkDeps(dir).findings).toEqual([]);
  });

  it('reports a missing package.json and rejects invalid JSON', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'express5-ready-empty-'));
    expect(checkDeps(empty).packageFile).toBeNull();
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'express5-ready-bad-json-'));
    fs.writeFileSync(path.join(broken, 'package.json'), '{');
    expect(() => checkDeps(broken)).toThrow(/Cannot parse/);
  });
});
