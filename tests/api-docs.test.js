'use strict';

/**
 * Guards the generated API docs (OpenAPI + Postman) against drift and keeps the
 * generator producing valid, importable artifacts. Pure — no DB or network — so
 * it runs in the normal `npm test` suite.
 */
const { buildOpenApi, buildPostmanCollection, buildPostmanEnvironment } = require('../scripts/generate-api-docs');
const { groups } = require('../docs/api/api-spec');

const endpointCount = groups.reduce((n, g) => n + g.endpoints.length, 0);

describe('OpenAPI document', () => {
  const oa = buildOpenApi();

  test('is OpenAPI 3.0 with bearer security scheme', () => {
    expect(oa.openapi).toMatch(/^3\.0/);
    expect(oa.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  test('covers every endpoint as an operation', () => {
    let ops = 0;
    for (const p of Object.keys(oa.paths)) ops += Object.keys(oa.paths[p]).length;
    expect(ops).toBe(endpointCount);
  });

  test('uses {param} path templating and requires path params', () => {
    const op = oa.paths['/api/bookings/{reference}'].get;
    const ref = op.parameters.find((p) => p.name === 'reference' && p.in === 'path');
    expect(ref).toBeTruthy();
    expect(ref.required).toBe(true);
  });

  test('secured operations declare bearer security; public ones do not', () => {
    expect(oa.paths['/api/auth/me'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(oa.paths['/api/auth/login'].post.security).toBeUndefined();
  });

  test('admin operations document a 403 response', () => {
    expect(oa.paths['/api/admin/dashboard'].get.responses['403']).toBeTruthy();
  });
});

describe('Postman collection', () => {
  const col = buildPostmanCollection();

  test('is a v2.1 collection with collection-level bearer auth + variables', () => {
    expect(col.info.schema).toContain('v2.1.0');
    expect(col.auth.type).toBe('bearer');
    const keys = col.variable.map((v) => v.key);
    expect(keys).toEqual(expect.arrayContaining(['baseUrl', 'accessToken', 'refreshToken']));
  });

  test('has one folder per tag and one request per endpoint', () => {
    expect(col.item).toHaveLength(groups.length);
    const requests = col.item.reduce((n, f) => n + f.item.length, 0);
    expect(requests).toBe(endpointCount);
  });

  test('login captures tokens via a test script', () => {
    const login = col.item.find((f) => f.name === 'Auth').item.find((i) => i.name.includes('/api/auth/login'));
    expect(login.event[0].listen).toBe('test');
    expect(login.event[0].script.exec.join('\n')).toContain("set('accessToken'");
  });

  test('public endpoints opt out of bearer auth', () => {
    const categories = col.item.find((f) => f.name === 'Categories').item[0];
    expect(categories.request.auth).toEqual({ type: 'noauth' });
  });

  test('every request targets the {{baseUrl}} variable', () => {
    for (const folder of col.item) {
      for (const item of folder.item) {
        expect(item.request.url.raw.startsWith('{{baseUrl}}')).toBe(true);
      }
    }
  });
});

describe('Postman environment', () => {
  test('declares the expected variables', () => {
    const env = buildPostmanEnvironment();
    expect(env.values.map((v) => v.key)).toEqual(['baseUrl', 'accessToken', 'refreshToken']);
  });
});
