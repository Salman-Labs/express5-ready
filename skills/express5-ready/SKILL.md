---
name: express5-ready
description: Upgrade an Express 4 app to Express 5. Use when migrating Express, fixing path-to-regexp v8 route crashes, removing Express 4 APIs, or checking middleware that breaks on Express 5.
---

# Express 5 migration

Use the `express5-ready` CLI. Do the steps in order. Do not invent extra codemods.

## 1. Check middleware

```bash
npx express5-ready deps
```

A non-zero exit means `package.json` lists middleware that fails on a real Express 5 request. Remove or replace it before upgrading `express`:

- `express-mongo-sanitize` and `xss-clean` assign `req.query`. Express 5 defines `req.query` as a getter, and the assignment throws.
- `express-query-boolean` and `express-query-int` call `hasOwnProperty` on `req.query`. The query object has a null prototype, so the call throws.
- `hpp` writes onto the object from `req.query`. The next read parses the query again, so duplicate keys stay arrays.

Do not keep these packages and wrap the throw. The middleware cannot see a stable `req.query`.

## 2. Scan

```bash
npx express5-ready scan
```

Add `--json` when you need machine-readable output. Findings are `file:line:column` plus a hint.

Errors fail the command:

- `path-syntax` — the route string throws when the app registers it. Trust the hint. Typical fixes are `/*splat`, `{/:id}`, and an array of paths or a real `RegExp` where a custom regular expression used to be.
- `removed-api` — `app.del` becomes `app.delete`, `res.sendfile` becomes `res.sendFile`, `req.param('id')` becomes `req.params` / `req.query` / `req.body`, `res.json(body, status)` becomes `res.status(status).json(body)`, and `res.send(404)` becomes `res.sendStatus(404)`.

Warnings do not fail the command. Read them before you call the migration done:

- `/*splat` does not match `/`. Change that route to `/{*splat}` only when `/` must match.
- `req.params[0]` is empty for string paths. Read the named key instead.
- Do not assign `req.query` and do not write `req.query.page`. Copy values into a local object.
- `req.body` stays `undefined` until `express.json()` or `express.urlencoded()` is mounted.

## 3. Apply the mechanical fixes

```bash
npx express5-ready fix --dry-run
npx express5-ready fix
```

Review the dry-run diff before writing. `fix` rewrites only:

- `*` / `/*` / `/files/*` → `/*splat` / `/files/*splat`
- `/:id?` → `{/:id}`
- `/(.*)` → `/*splat`

It skips a rewrite that still does not compile, and it does not touch `:id(\d+)`, `/:file.:ext?`, `+`, or `/foo*`. After `fix`, run `scan` again and hand-fix the errors that remain, using each hint.

## 4. Upgrade and run the app

Bump `express` to 5 (Node 18+) and run the application's tests. `/*splat` matching `/sample` and not `/` is expected. `/{*splat}` matches both.

## Programmatic use

`scan(dir)`, `fix(dir, { dryRun })`, and `checkDeps(dir)` are the typed exports. Use them when a script should gate the migration. Shell out to the CLI when you are editing the repo by hand.
