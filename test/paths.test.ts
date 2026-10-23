import { match, pathToRegexp } from 'path-to-regexp';
import { describe, expect, it } from 'vitest';
import { assessPath, mechanicalFix } from '../src/paths.js';

describe('mechanicalFix', () => {
  it('rewrites the three safe patterns', () => {
    expect(mechanicalFix('*')).toBe('/*splat');
    expect(mechanicalFix('/*')).toBe('/*splat');
    expect(mechanicalFix('/files/*')).toBe('/files/*splat');
    expect(mechanicalFix('/foo/*/bar')).toBe('/foo/*splat/bar');
    expect(mechanicalFix('/:id?')).toBe('{/:id}');
    expect(mechanicalFix('/users/:id?')).toBe('/users{/:id}');
    expect(mechanicalFix('/:id?/:name?')).toBe('{/:id}{/:name}');
    expect(mechanicalFix('/(.*)')).toBe('/*splat');
    expect(mechanicalFix('/foo/(.*)')).toBe('/foo/*splat');
    expect(mechanicalFix('/(.*)/bar')).toBe('/*splat/bar');
    expect(mechanicalFix('/:_id?')).toBe('{/:_id}');
    expect(mechanicalFix('/:$id?')).toBe('{/:$id}');
    expect(mechanicalFix('/:id?/*')).toBe('{/:id}/*splat');
  });

  it('leaves paths that are already valid or unsafe to rewrite', () => {
    for (const path of ['/*splat', '/{*splat}', '/users/:id', '/:file{.:ext}', '/files{/*name}']) {
      expect(mechanicalFix(path)).toBeNull();
      expect(() => pathToRegexp(path)).not.toThrow();
    }
    for (const path of ['/:file.:ext?', String.raw`/:id(\d+)`, '**', '/foo*', '/foo+', '/[a|b]']) {
      expect(mechanicalFix(path)).toBeNull();
      expect(() => pathToRegexp(path)).toThrow();
    }
  });
});

describe('assessPath', () => {
  it('warns when a named catch-all misses /', () => {
    const assessed = assessPath('/*splat');
    expect(assessed?.rule).toBe('splat-root');
    expect(assessed?.severity).toBe('warning');
    expect(match('/*splat')('/')).toBe(false);
    expect(match('/{*splat}')('/')).toBeTruthy();
    expect(assessPath('/{*splat}')).toBeNull();
    expect(assessPath('/files/*filepath')?.rule).not.toBe('splat-root');
  });
});
