import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  'out',
  'vendor',
]);

export const MAX_SOURCE_BYTES = 1_000_000;

export function resolveInput(input: string): string {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${input}`);
  }
  return resolved;
}

export function displayPath(root: string, file: string): string {
  const base = fs.statSync(root).isFile() ? path.dirname(root) : root;
  const relative = path.relative(base, file);
  const posix = relative.split(path.sep).join('/');
  return posix === '' ? path.basename(file) : posix;
}

export function listSourceFiles(root: string): string[] {
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];

  const files: string[] = [];
  const walk = (directory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(full);
    }
  };
  walk(root);
  files.sort();
  return files;
}
