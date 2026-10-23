import { match, pathToRegexp } from 'path-to-regexp';

const IDENT_START = /[\p{ID_Start}]/u;

function isIdentStart(char: string): boolean {
  return char === '$' || char === '_' || IDENT_START.test(char);
}

/**
 * Give a bare `*` a name when it is the whole path or its own segment.
 * `*` becomes `/*splat`. `/*` and `/files/*` become `/*splat` and `/files/*splat`.
 * A star glued to other text (`/foo*`) is left alone.
 */
function nameBareStars(path: string): string {
  let out = '';
  for (let index = 0; index < path.length; index += 1) {
    const char = path[index] ?? '';
    if (char !== '*') {
      out += char;
      continue;
    }
    const next = path[index + 1] ?? '';
    if (next === '"' || isIdentStart(next)) {
      out += '*';
      continue;
    }
    const prev = path[index - 1] ?? '';
    if (prev === '\\') {
      out += '*';
      continue;
    }
    const boundary = next === '' || next === '/';
    if (boundary && prev === '/') {
      out += '*splat';
      continue;
    }
    if (boundary && index === 0) {
      out += '/*splat';
      continue;
    }
    out += '*';
  }
  return out;
}

/** Rewrite only the three mechanical patterns, and only when the result compiles. */
export function mechanicalFix(path: string): string | null {
  const optional = /\/:((?:\$|_|[\p{ID_Start}])(?:\$|_|[\p{ID_Continue}])*)\?/gu;
  const next = nameBareStars(path.replaceAll('/(.*)', '/*splat').replace(optional, '{/:$1}'));
  if (next === path) return null;
  try {
    pathToRegexp(next);
  } catch {
    return null;
  }
  return next;
}

function compilerMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0]?.replace(/;\s*visit https:\/\/git\.new\/pathToRegexpError.*$/, '') ?? message;
}

function manualHint(path: string): string {
  if (/:(?:\$|_|[\p{ID_Start}])(?:\$|_|[\p{ID_Continue}])*[(]/u.test(path)) {
    return 'Parameter regular expressions were removed. Use a plain :name and validate the value in the handler, or pass a RegExp instead of a string.';
  }
  if (path.includes('(.*)')) {
    return 'Replace "/(.*)" with "/*splat". This group is not a standalone "/(.*)" segment, so it was not rewritten.';
  }
  if (/\.:(?:\$|_|[\p{ID_Start}])/u.test(path) && path.includes('?')) {
    return 'Optional "?" was removed. Use braces around the optional text: "/:file.:ext?" becomes "/:file{.:ext}".';
  }
  if (path.includes('?')) {
    return 'Optional "?" was removed. An optional segment "/:name?" becomes "{/:name}".';
  }
  if (path.includes('*')) {
    return 'Name the wildcard. A bare "*" or "/*" becomes "/*splat". Use "/{*splat}" when the route must also match "/".';
  }
  if (/[[\]()+!]/.test(path)) {
    return 'path-to-regexp v8 reserves ()[]?+!. Escape a literal with a backslash, list alternatives as an array of paths, or pass a RegExp.';
  }
  return 'Rewrite the path with path-to-regexp v8 syntax: :name, *name, and {optional} braces.';
}

export interface PathAssessment {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  hint: string;
}

/** Classify one route path. `null` means the path is fine under path-to-regexp v8. */
export function assessPath(path: string): PathAssessment | null {
  try {
    pathToRegexp(path);
  } catch (error) {
    const fixed = mechanicalFix(path);
    const detail = compilerMessage(error);
    return {
      severity: 'error',
      rule: 'path-syntax',
      message: `Path ${JSON.stringify(path)} is rejected by path-to-regexp v8: ${detail}`,
      hint: fixed
        ? `Replace ${JSON.stringify(path)} with ${JSON.stringify(fixed)}.`
        : manualHint(path),
    };
  }

  const named = /^\/\*([A-Za-z_$][\w$]*|"[^"]+")$/.exec(path);
  if (!named) return null;
  let matchedRoot = false;
  try {
    matchedRoot = Boolean(match(path)('/'));
  } catch {
    return null;
  }
  if (matchedRoot) return null;
  const name = named[1] ?? 'splat';
  return {
    severity: 'warning',
    rule: 'splat-root',
    message: `Path ${JSON.stringify(path)} does not match "/".`,
    hint: `Use "/{*${name}}" to match "/" as well.`,
  };
}
