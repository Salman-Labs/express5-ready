# express5-ready

Find and fix Express 4 code that breaks on Express 5.

It reports route paths that `path-to-regexp` v8 rejects, removed response and request APIs, and silent behavior changes. `fix` rewrites only three patterns, and only when the rewritten path compiles.

## Install

```bash
npm install --save-dev express5-ready
```

Node.js 18 or newer. The `express5-ready` command is the package bin.

## CLI

```bash
npx express5-ready scan [dir]
npx express5-ready scan [dir] --json
npx express5-ready fix [dir] --dry-run
npx express5-ready fix [dir]
npx express5-ready deps [dir]
```

`dir` defaults to the current directory. `scan` and `fix` read `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` files and skip `node_modules`, `dist`, and `build`. Route calls are found with `@babel/parser`, then each path string is compiled with `path-to-regexp` v8.

`scan` prints `file:line:column`, a severity, and a fix hint. `--json` prints `{ findings, errorCount, warningCount }`. The process exits with status 1 when there is an error.

`fix --dry-run` prints a unified diff and does not write. `fix` writes the same edits.

`deps` reads `dependencies`, `devDependencies`, and `optionalDependencies` in `package.json`. It exits with status 1 when a listed package is one that breaks on Express 5.

### Errors

These fail `scan` because the app throws, or a removed call no longer does what it says:

| Rule | What it catches |
| --- | --- |
| `path-syntax` | A route path `path-to-regexp` v8 rejects: bare `*`, `:id?`, `(.*)`, `:id(\d+)`, and the other reserved characters `()[]?+!` |
| `removed-api` | `res.sendfile`, `req.param()`, `app.del`, `res.json(body, status)`, `res.send(body, status)`, and `res.send(status)` when `status` is a number |

### Warnings

These still run, with different behavior:

| Rule | What it catches |
| --- | --- |
| `splat-root` | `/*splat` does not match `/`. `/{*splat}` does |
| `numeric-params` | `req.params[0]` and other numeric indexes, which string paths no longer fill |
| `query-assign` | `req.query = ...`. The property is a getter, so strict mode throws and sloppy mode ignores the write |
| `query-mutate` | `req.query.page = ...`. Each read parses a new object, so the write is discarded |
| `body-undefined` | A read of `req.body` in a project that never mounts `express.json()`, `express.urlencoded()`, `express.raw()`, `express.text()`, or the same helpers from `body-parser` |

### What `fix` rewrites

| Express 4 | Express 5 |
| --- | --- |
| `*` or `/*` or `/files/*` | `/*splat` or `/files/*splat` |
| `/:id?` or `/users/:id?` | `{/:id}` or `/users{/:id}` |
| `/(.*)` or `/foo/(.*)` | `/*splat` or `/foo/*splat` |

A rewrite is skipped when the result still does not compile. `fix` does not rewrite `:id(\d+)`, `/:file.:ext?`, character classes, `+`, or a `*` glued to other text (`/foo*`). It also leaves `/*splat` as-is; use `/{*splat}` when that route must match `/`.

## Middleware

`deps` reports a package only when a request under Express 5 was reproduced to fail:

| Package | What happens |
| --- | --- |
| `express-mongo-sanitize` | Assigns `req.query` and throws `TypeError: Cannot set property query ... which has only a getter` |
| `xss-clean` | Assigns `req.query` and throws the same getter error |
| `express-query-boolean` | Calls `hasOwnProperty` on the null-prototype query object and throws |
| `express-query-int` | Same `hasOwnProperty` failure |
| `hpp` | Writes the filtered query onto an object Express discards, so `/?a=1&a=2` still arrives as an array |

## Programmatic API

```ts
import { checkDeps, fix, scan } from 'express5-ready';

const report = scan('./src');
const changes = fix('./src', { dryRun: true });
const deps = checkDeps('.');
```

`scan` returns `ScanResult`. `fix` returns `FixResult` (`changes` and a unified `diff`). `checkDeps` returns `DepsResult`.

## Development

```bash
npm test
npm run build
```

The tests install the middleware that `deps` reports, so `express5-ready deps` inside this repository lists those devDependencies.

## License

MIT, copyright Salman Labs.
