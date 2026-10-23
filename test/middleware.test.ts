import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import queryBoolean from 'express-query-boolean';
import queryInt from 'express-query-int';
import hpp from 'hpp';
import { describe, expect, it } from 'vitest';
import xssClean from 'xss-clean';
import { INCOMPATIBLE_MIDDLEWARE } from '../src/deps.js';
import { request } from './request.js';

interface Case {
  name: string;
  url: string;
  create: () => express.RequestHandler;
  assert: (status: number, body: string) => void;
}

const cases: Case[] = [
  {
    name: 'express-mongo-sanitize',
    url: '/',
    create: () => mongoSanitize(),
    assert: (status, body) => {
      expect(status).toBe(500);
      expect(body).toMatch(/only a getter/);
    },
  },
  {
    name: 'xss-clean',
    url: '/',
    create: () => xssClean(),
    assert: (status, body) => {
      expect(status).toBe(500);
      expect(body).toMatch(/only a getter/);
    },
  },
  {
    name: 'express-query-boolean',
    url: '/?flag=true',
    create: () => queryBoolean(),
    assert: (status, body) => {
      expect(status).toBe(500);
      expect(body).toMatch(/hasOwnProperty/);
    },
  },
  {
    name: 'express-query-int',
    url: '/?n=10',
    create: () => queryInt(),
    assert: (status, body) => {
      expect(status).toBe(500);
      expect(body).toMatch(/hasOwnProperty/);
    },
  },
  {
    name: 'hpp',
    url: '/?a=1&a=2',
    create: () => hpp(),
    assert: (status, body) => {
      expect(status).toBe(200);
      const payload = JSON.parse(body) as { query: { a: unknown } };
      expect(payload.query.a).toEqual(['1', '2']);
    },
  },
];

function appWith(middleware: express.RequestHandler): express.Express {
  const app = express();
  app.use(middleware);
  app.get('/{*splat}', (req, res) => {
    res.json({ query: req.query });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ name: err.name, message: err.message });
  });
  return app;
}

describe('incompatible middleware on Express 5', () => {
  it('lists only the packages this file reproduces', () => {
    expect(cases.map((item) => item.name).sort()).toEqual(INCOMPATIBLE_MIDDLEWARE.map((item) => item.name).sort());
  });

  for (const item of cases) {
    it(`${item.name} breaks on a real request`, async () => {
      const response = await request(appWith(item.create()), item.url);
      item.assert(response.status, response.body);
    });
  }

  it('hpp still filters a plain object, which is how the Express 5 failure shows up', () => {
    const req = { query: { a: ['1', '2'], b: 'x' } };
    hpp()(req, {} as express.Response, () => undefined);
    expect(req.query.a).toBe('2');
  });
});
