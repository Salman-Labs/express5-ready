import fs from 'node:fs';
import type { ApiSite } from './parse.js';
import { analyzeSource } from './parse.js';
import { assessPath } from './paths.js';
import { MAX_SOURCE_BYTES, displayPath, listSourceFiles, resolveInput } from './files.js';
import type { Finding, ScanResult } from './types.js';

function apiText(api: ApiSite): { message: string; hint: string } {
  switch (api.kind) {
    case 'sendfile':
      return { message: 'res.sendfile() was removed.', hint: 'Use res.sendFile().' };
    case 'param':
      return {
        message: 'req.param() was removed.',
        hint: 'Read the value from req.params, req.query, or req.body.',
      };
    case 'del':
      return { message: 'app.del() was removed.', hint: 'Use app.delete().' };
    case 'json':
      return {
        message: 'res.json() no longer accepts a status argument.',
        hint: 'Use res.status(code).json(body).',
      };
    case 'send-arity':
      return {
        message: 'res.send() no longer accepts a status argument.',
        hint: 'Use res.status(code).send(body).',
      };
    case 'send-status':
      return {
        message: `res.send(${api.detail ?? 'status'}) sends the number as the body. Express 5 does not use it as a status code.`,
        hint: 'Use res.sendStatus(code). Quote the value when the number itself is the body.',
      };
  }
}

function push(findings: Finding[], finding: Finding): void {
  findings.push(finding);
}

export function scan(dir: string): ScanResult {
  const root = resolveInput(dir);
  const files = listSourceFiles(root);
  const analyzed = files.map((file) => {
    const stat = fs.statSync(file);
    if (stat.size > MAX_SOURCE_BYTES) {
      return { file, facts: null, skipped: 'larger than 1MB' as const };
    }
    const code = fs.readFileSync(file, 'utf8');
    if (code.includes('\0')) return { file, facts: null, skipped: 'not text' as const };
    return { file, facts: analyzeSource(code, file), skipped: null };
  });
  const parserMounted = analyzed.some((item) => item.facts?.hasBodyParser);
  const findings: Finding[] = [];

  for (const item of analyzed) {
    const file = displayPath(root, item.file);
    if (item.skipped) {
      push(findings, {
        file,
        line: 1,
        column: 1,
        severity: 'warning',
        rule: 'skipped',
        message: `Skipped ${file} (${item.skipped}).`,
        hint: 'Scan the source file directly if this route table still needs a look.',
      });
      continue;
    }
    const facts = item.facts;
    if (!facts) continue;
    if (facts.parseError) {
      push(findings, {
        file,
        line: facts.parseError.line,
        column: facts.parseError.column,
        severity: 'warning',
        rule: 'parse',
        message: `Could not parse ${file} completely: ${facts.parseError.message}`,
        hint: 'Fix the syntax error and scan again. Findings below this point in the file may be missing.',
      });
    }
    for (const route of facts.routes) {
      const assessed = assessPath(route.path);
      if (!assessed) continue;
      push(findings, {
        file,
        line: route.line,
        column: route.column,
        severity: assessed.severity,
        rule: assessed.rule,
        message: assessed.message,
        hint: assessed.hint,
        path: route.path,
      });
    }
    for (const api of facts.apis) {
      const text = apiText(api);
      push(findings, {
        file,
        line: api.line,
        column: api.column,
        severity: 'error',
        rule: 'removed-api',
        message: text.message,
        hint: text.hint,
      });
    }
    for (const query of facts.query) {
      push(findings, {
        file,
        line: query.line,
        column: query.column,
        severity: 'warning',
        rule: query.kind === 'reassign' ? 'query-assign' : 'query-mutate',
        message:
          query.kind === 'reassign'
            ? 'Assigning to req.query fails under Express 5 because req.query is a getter.'
            : 'Writing a property of req.query is discarded. Express 5 returns a new object on every read.',
        hint:
          query.kind === 'reassign'
            ? 'Do not assign req.query. In strict mode the assignment throws; in sloppy mode it is ignored.'
            : 'Copy the fields you need into a local object. A write to req.query.page does not survive the next read.',
      });
    }
    for (const params of facts.paramsIndex) {
      push(findings, {
        file,
        line: params.line,
        column: params.column,
        severity: 'warning',
        rule: 'numeric-params',
        message: `req.params[${params.index}] is not filled from string paths in Express 5.`,
        hint: 'Name the capture (:name or *splat) and read that key. A RegExp route can still expose numeric indexes.',
      });
    }
    if (!parserMounted && facts.body.length > 0) {
      const body = facts.body[0];
      if (body) {
        push(findings, {
          file,
          line: body.line,
          column: body.column,
          severity: 'warning',
          rule: 'body-undefined',
          message: 'req.body is undefined when no body parser is mounted.',
          hint: 'Mount express.json() or express.urlencoded() before this read. Without a parser, req.body stays undefined.',
        });
      }
    }
  }

  findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  return { findings, errorCount, warningCount: findings.length - errorCount };
}
