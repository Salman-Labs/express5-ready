import fs from 'node:fs';
import path from 'node:path';
import type { DepFinding, DepsResult } from './types.js';
import { resolveInput } from './files.js';

/**
 * Middleware reproduced against Express 5. Each entry throws, or silently
 * fails to do its job, on a real request. Packages that still work are absent.
 */
export const INCOMPATIBLE_MIDDLEWARE: readonly { name: string; reason: string }[] = [
  {
    name: 'express-mongo-sanitize',
    reason:
      'On every request it assigns req.query (and req.body, req.params, and req.headers). Express 5 defines req.query as a getter with no setter, and this package runs in strict mode, so the request throws TypeError: Cannot set property query of IncomingMessage which has only a getter.',
  },
  {
    name: 'xss-clean',
    reason:
      'When req.query is present it assigns req.query = clean(req.query). Express 5 defines req.query as a getter with no setter, and this package runs in strict mode, so the request throws TypeError: Cannot set property query of IncomingMessage which has only a getter.',
  },
  {
    name: 'express-query-boolean',
    reason:
      'It walks req.query with hasOwnProperty and then assigns the result back to req.query. Express 5 gives req.query a null prototype, so a request that has a query string throws TypeError: obj.hasOwnProperty is not a function.',
  },
  {
    name: 'express-query-int',
    reason:
      'It walks req.query with hasOwnProperty and then assigns the result back to req.query. Express 5 gives req.query a null prototype, so a request that has a query string throws TypeError: obj.hasOwnProperty is not a function.',
  },
  {
    name: 'hpp',
    reason:
      'It filters duplicate query keys by writing onto the object it just read from req.query. Express 5 parses a new object on every read, so the write is discarded and a request such as /?a=1&a=2 still exposes both values.',
  },
];

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

function lineOf(text: string, name: string): number {
  const needle = `"${name}"`;
  const index = text.indexOf(needle);
  if (index < 0) return 1;
  return text.slice(0, index).split('\n').length;
}

function packageJsonPath(input: string): string | null {
  const resolved = resolveInput(input);
  const stat = fs.statSync(resolved);
  const file = stat.isFile() ? resolved : path.join(resolved, 'package.json');
  if (!fs.existsSync(file) || path.basename(file) !== 'package.json') return null;
  return file;
}

export function checkDeps(dir: string): DepsResult {
  const file = packageJsonPath(dir);
  if (!file) return { packageFile: null, findings: [] };

  const text = fs.readFileSync(file, 'utf8');
  let manifest: unknown;
  try {
    manifest = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${file}: ${message}`);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Cannot parse ${file}: package.json is not an object`);
  }

  const record = manifest as Record<string, unknown>;
  const base = fs.statSync(resolveInput(dir)).isFile() ? path.dirname(file) : resolveInput(dir);
  const display = path.relative(base, file).split(path.sep).join('/') || 'package.json';
  const findings: DepFinding[] = [];
  const seen = new Set<string>();

  for (const field of DEPENDENCY_FIELDS) {
    const section = record[field];
    if (!section || typeof section !== 'object') continue;
    const deps = section as Record<string, unknown>;
    for (const item of INCOMPATIBLE_MIDDLEWARE) {
      if (seen.has(item.name) || !Object.prototype.hasOwnProperty.call(deps, item.name)) continue;
      seen.add(item.name);
      const version = deps[item.name];
      findings.push({
        file: display,
        line: lineOf(text, item.name),
        name: item.name,
        version: typeof version === 'string' ? version : JSON.stringify(version),
        reason: item.reason,
      });
    }
  }

  return { packageFile: file, findings };
}
