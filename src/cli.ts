#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { checkDeps } from './deps.js';
import { fix } from './fix.js';
import { scan } from './scan.js';
import type { Finding } from './types.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIO = {
  stdout: (text) => {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  },
  stderr: (text) => {
    process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  },
};

const HELP = `express5-ready <command> [dir]

Commands:
  scan [dir]     Report route paths and APIs that break on Express 5
  fix [dir]      Rewrite safe route paths in place
  deps [dir]     Flag middleware that breaks on Express 5

Options:
  scan --json       Print the scan result as JSON
  fix --dry-run     Print a unified diff and do not write files

The directory defaults to the current working directory.
scan exits 1 when a route path or removed API would break the app.
deps exits 1 when package.json lists incompatible middleware.
`;

interface Args {
  command: string;
  dir: string;
  json: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  let json = false;
  let dryRun = false;
  let help = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length > 2) throw new Error('Too many arguments.');
  return { command: positionals[0] ?? '', dir: positionals[1] ?? '.', json, dryRun, help };
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line}:${finding.column} ${finding.severity} ${finding.rule} ${finding.message}\n  ${finding.hint}`;
}

export function main(argv: string[], io: CliIO = defaultIo): number {
  try {
    const args = parseArgs(argv);
    if (args.help || args.command === '') {
      io.stdout(HELP);
      return args.command === '' && !args.help ? 1 : 0;
    }
    if (args.command === 'scan') {
      if (args.dryRun) throw new Error('--dry-run is only valid with fix.');
      const result = scan(args.dir);
      if (args.json) {
        io.stdout(JSON.stringify(result, null, 2));
      } else if (result.findings.length === 0) {
        io.stdout(`No Express 5 migration issues found.\n${plural(0, 'error')}, ${plural(0, 'warning')}`);
      } else {
        io.stdout(
          `${result.findings.map(formatFinding).join('\n\n')}\n\n${plural(result.errorCount, 'error')}, ${plural(result.warningCount, 'warning')}`,
        );
      }
      return result.errorCount > 0 ? 1 : 0;
    }
    if (args.command === 'fix') {
      if (args.json) throw new Error('--json is only valid with scan.');
      const result = fix(args.dir, { dryRun: args.dryRun });
      if (result.changes.length === 0) {
        io.stdout('No safe mechanical fixes.');
        return 0;
      }
      if (args.dryRun) {
        io.stdout(result.diff);
        return 0;
      }
      const files = new Set(result.changes.map((change) => change.file));
      io.stdout(
        `${result.changes.map((change) => `${change.file}:${change.line} ${change.before} -> ${change.after}`).join('\n')}\nUpdated ${files.size} ${files.size === 1 ? 'file' : 'files'}.`,
      );
      return 0;
    }
    if (args.command === 'deps') {
      if (args.json || args.dryRun) throw new Error('deps does not take options.');
      const result = checkDeps(args.dir);
      if (!result.packageFile) {
        io.stderr(`No package.json found in ${args.dir}`);
        return 1;
      }
      if (result.findings.length === 0) {
        io.stdout('No incompatible middleware listed in package.json.');
        return 0;
      }
      io.stdout(
        result.findings
          .map((finding) => `${finding.file}:${finding.line} ${finding.name}@${finding.version}\n  ${finding.reason}`)
          .join('\n\n'),
      );
      return 1;
    }
    throw new Error(`Unknown command ${args.command}.`);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main(process.argv.slice(2)));
}
