import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

describe('cli', () => {
  const routes = path.join(import.meta.dirname, 'fixtures/routes');
  const clean = path.join(import.meta.dirname, 'fixtures/clean');

  it('scan --json exits 1 when paths throw', () => {
    const result = run(['scan', routes, '--json']);
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errorCount: number; findings: Array<{ file: string; line: number; hint: string }> };
    expect(parsed.errorCount).toBeGreaterThan(0);
    expect(parsed.findings[0]?.file).toMatch(/\.(js|ts|mjs)$/);
    expect(parsed.findings[0]?.line).toBeGreaterThan(0);
    expect(parsed.findings.every((finding) => finding.hint.length > 0)).toBe(true);
    expect(result.stderr).toBe('');
  });

  it('prints file:line text and exits 0 when the only hit is a warning', () => {
    const json = run(['--json', 'scan', clean]);
    expect(json.code).toBe(0);
    const human = run(['scan', clean]);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/app\.js:\d+:\d+ warning splat-root/);
    expect(human.stdout).toContain('0 errors, 1 warning');
  });

  it('fix --dry-run prints a diff', () => {
    const result = run(['fix', routes, '--dry-run']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--- app.js');
    expect(result.stdout).toContain('+++ app.js');
  });

  it('rejects unknown options', () => {
    expect(run(['scan', '--dry-run']).code).toBe(1);
    expect(run(['deps', '--json']).stderr).toMatch(/does not take options/);
    expect(run(['nope']).code).toBe(1);
  });
});
