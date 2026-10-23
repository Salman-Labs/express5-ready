import fs from 'node:fs';
import { analyzeSource } from './parse.js';
import { mechanicalFix } from './paths.js';
import { MAX_SOURCE_BYTES, displayPath, listSourceFiles, resolveInput } from './files.js';
import type { FixChange, FixOptions, FixResult } from './types.js';

interface Edit {
  start: number;
  end: number;
  line: number;
  column: number;
  before: string;
  after: string;
}

function quoteLike(raw: string, value: string): string {
  const quote = raw.startsWith('`') || raw.startsWith('"') || raw.startsWith("'") ? raw[0] : "'";
  if (quote === '`') {
    return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
  }
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(quote ?? "'", `\\${quote ?? "'"}`);
  return `${quote ?? "'"}${escaped}${quote ?? "'"}`;
}

function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return '';
  const previous = before.split('\n');
  const next = after.split('\n');
  const lines = [`--- ${file}`, `+++ ${file}`];
  const limit = Math.max(previous.length, next.length);
  let index = 0;
  while (index < limit) {
    if (previous[index] === next[index]) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < limit && previous[end] !== next[end]) end += 1;
    const removed = previous.slice(index, Math.min(end, previous.length));
    const added = next.slice(index, Math.min(end, next.length));
    lines.push(`@@ -${index + 1},${removed.length} +${index + 1},${added.length} @@`);
    for (const line of removed) lines.push(`-${line}`);
    for (const line of added) lines.push(`+${line}`);
    index = end;
  }
  return `${lines.join('\n')}\n`;
}

export function fix(dir: string, options: FixOptions = {}): FixResult {
  const root = resolveInput(dir);
  const dryRun = options.dryRun === true;
  const changes: FixChange[] = [];
  const diffs: string[] = [];

  for (const file of listSourceFiles(root)) {
    const stat = fs.statSync(file);
    if (stat.size > MAX_SOURCE_BYTES) continue;
    const original = fs.readFileSync(file, 'utf8');
    if (original.includes('\0')) continue;
    const facts = analyzeSource(original, file);
    const edits: Edit[] = [];
    for (const route of facts.routes) {
      const after = mechanicalFix(route.path);
      if (!after) continue;
      edits.push({
        start: route.start,
        end: route.end,
        line: route.line,
        column: route.column,
        before: route.path,
        after,
      });
    }
    edits.sort((left, right) => right.start - left.start);

    let updated = original;
    let cursor = Number.POSITIVE_INFINITY;
    const applied: Edit[] = [];
    for (const edit of edits) {
      if (edit.end > cursor) continue;
      const raw = updated.slice(edit.start, edit.end);
      updated = `${updated.slice(0, edit.start)}${quoteLike(raw, edit.after)}${updated.slice(edit.end)}`;
      cursor = edit.start;
      applied.push(edit);
    }
    if (updated === original) continue;

    const display = displayPath(root, file);
    for (const edit of applied) {
      changes.push({
        file: display,
        line: edit.line,
        column: edit.column,
        before: edit.before,
        after: edit.after,
      });
    }
    diffs.push(unifiedDiff(display, original, updated));
    if (!dryRun) fs.writeFileSync(file, updated);
  }

  changes.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
  return { dryRun, changes, diff: diffs.join('') };
}
