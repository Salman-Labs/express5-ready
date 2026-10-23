import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match, pathToRegexp } from 'path-to-regexp';
import { describe, expect, it } from 'vitest';
import { fix } from '../src/fix.js';
import { scan } from '../src/scan.js';
import { request } from './request.js';

const routesDir = path.join(import.meta.dirname, 'fixtures/routes');

function concrete(pattern: string): string[] {
  const name = '(?:"[^"]+"|(?:\\$|_|[\\p{ID_Start}])(?:\\$|_|[\\p{ID_Continue}])*)';
  const filled = pattern
    .replace(new RegExp(`\\{/:${name}\\}`, 'gu'), '/sample')
    .replace(new RegExp(`/:${name}`, 'gu'), '/sample')
    .replace(new RegExp(`\\/\\*${name}`, 'gu'), '/sample')
    .replace(/[{}]/g, '');
  const omitted = pattern
    .replace(new RegExp(`\\{/:${name}\\}`, 'gu'), '')
    .replace(new RegExp(`\\/\\*${name}`, 'gu'), '/sample')
    .replace(/[{}]/g, '');
  return [...new Set([filled, omitted].map((url) => (url === '' ? '/' : url.startsWith('/') ? url : `/${url}`)))];
}

describe('path-to-regexp v8 and Express 5', () => {
  it('rejects every flagged path and serves every mechanical fix', async () => {
    const flagged = scan(routesDir).findings.filter((finding) => finding.rule === 'path-syntax' && finding.path);
    expect(flagged.length).toBeGreaterThan(0);

    for (const finding of flagged) {
      const routePath = finding.path ?? '';
      expect(() => pathToRegexp(routePath)).toThrow();
      const crashing = express();
      expect(() => crashing.get(routePath, (_req, res) => res.end('ok'))).toThrow();
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express5-ready-proof-'));
    fs.cpSync(routesDir, dir, { recursive: true });
    const fixed = fix(dir);
    expect(fixed.changes.length).toBeGreaterThan(0);

    for (const change of fixed.changes) {
      expect(() => pathToRegexp(change.before)).toThrow();
      expect(() => pathToRegexp(change.after)).not.toThrow();
      const app = express();
      expect(() => app.get(change.after, (_req, res) => res.end('hit'))).not.toThrow();
      app.get(change.after, (_req, res) => {
        res.end('hit');
      });
      const urls = concrete(change.after);
      const responses = [];
      for (const url of urls) {
        responses.push({ url, status: (await request(app, url)).status });
      }
      expect(responses.some((response) => response.status === 200)).toBe(true);
      expect(urls.some((url) => match(change.after)(url))).toBe(true);
    }

    const root = express();
    root.get('/*splat', (_req, res) => res.end('hit'));
    expect((await request(root, '/')).status).toBe(404);
    expect((await request(root, '/sample')).status).toBe(200);

    const optional = express();
    optional.get('{/:id}', (req, res) => res.end(req.params.id ?? 'root'));
    expect((await request(optional, '/')).body).toBe('root');
    expect((await request(optional, '/sample')).body).toBe('sample');

    const group = express();
    group.get('/*splat', (_req, res) => res.end('group'));
    expect((await request(group, '/files/a')).body).toBe('group');
  });

  it('shows the runtime behavior behind the other findings', async () => {
    const queryApp = express();
    queryApp.get('/', (req, res) => {
      let assigned = 'ok';
      try {
        req.query = { forced: '1' };
      } catch (error) {
        assigned = error instanceof Error ? error.message : String(error);
      }
      req.query.page = '9';
      res.json({ assigned, page: req.query.page ?? null });
    });
    const query = JSON.parse((await request(queryApp, '/?page=1')).body) as { assigned: string; page: string | null };
    expect(query.assigned).toMatch(/getter/);
    expect(query.page).toBe('1');

    const bodyApp = express();
    bodyApp.post('/', (req, res) => {
      res.json({ type: req.body === undefined ? 'undefined' : 'set' });
    });
    const withoutParser = JSON.parse(
      (
        await request(bodyApp, '/', {
          method: 'POST',
          body: '{"a":1}',
          headers: { 'content-type': 'application/json' },
        })
      ).body,
    ) as { type: string };
    expect(withoutParser.type).toBe('undefined');

    const parsedApp = express();
    parsedApp.use(express.json());
    parsedApp.post('/', (req, res) => {
      res.json({ value: req.body.a });
    });
    const withParser = JSON.parse(
      (
        await request(parsedApp, '/', {
          method: 'POST',
          body: '{"a":1}',
          headers: { 'content-type': 'application/json' },
        })
      ).body,
    ) as { value: number };
    expect(withParser.value).toBe(1);

    const removed = express();
    removed.get('/param/:id', (req, res) => {
      res.json({ value: req.param('id') });
    });
    removed.get('/file', (req, res) => {
      res.sendfile('/tmp/x');
    });
    removed.get('/json', (_req, res) => {
      res.json({ ok: true }, 201);
    });
    removed.get('/status', (_req, res) => {
      res.send(404);
    });
    expect((await request(removed, '/param/5')).status).toBe(500);
    expect((await request(removed, '/file')).status).toBe(500);
    expect((await request(removed, '/json')).status).toBe(200);
    const sent = await request(removed, '/status');
    expect(sent.status).toBe(200);
    expect(sent.body).toBe('404');

    const app = express();
    expect(() => app.del('/users/:id', (_req, res) => res.end('no'))).toThrow(/del/);
  });
});
