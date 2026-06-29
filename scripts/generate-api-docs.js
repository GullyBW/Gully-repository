'use strict';

/**
 * Generates API documentation artifacts from docs/api/api-spec.js:
 *   - docs/api/openapi.json                         (OpenAPI 3.0 — import into Postman, Swagger UI, etc.)
 *   - docs/api/tirelo-services.postman_collection.json   (Postman v2.1 collection)
 *   - docs/api/tirelo-services.postman_environment.json  (Postman environment)
 *
 * Run with: npm run docs:api
 *
 * The collection wires up Bearer auth via a {{accessToken}} variable and
 * auto-captures tokens from the login/register/refresh responses, so importing
 * it and hitting "Login" leaves every authenticated request ready to send.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { info, groups } = require('../docs/api/api-spec');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'api');
const DEFAULT_BASE_URL = 'http://localhost:4000';

// ---- helpers ---------------------------------------------------------------

function fullPath(base, p) {
  if (p === '/') return base || '/';
  return `${base}${p}`;
}

function pathParams(p) {
  return (p.match(/:([A-Za-z0-9_]+)/g) || []).map((s) => s.slice(1));
}

function toOpenApiPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const isTokenEndpoint = (full) =>
  ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'].includes(full);

// ---- OpenAPI ---------------------------------------------------------------

function buildOpenApi() {
  const doc = {
    openapi: '3.0.3',
    info,
    servers: [
      { url: '{baseUrl}', description: 'Configurable base URL', variables: { baseUrl: { default: DEFAULT_BASE_URL } } },
    ],
    tags: groups.map((g) => ({ name: g.tag, description: g.description })),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        SuccessEnvelope: {
          type: 'object',
          properties: { success: { type: 'boolean', example: true }, data: {} },
        },
        ErrorEnvelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: { message: { type: 'string' }, details: { type: 'object' } },
            },
          },
        },
      },
    },
    paths: {},
  };

  for (const group of groups) {
    for (const ep of group.endpoints) {
      const full = fullPath(group.base, ep.path);
      const oaPath = toOpenApiPath(full);
      const item = doc.paths[oaPath] || (doc.paths[oaPath] = {});
      const secured = ep.auth !== 'public';

      const parameters = [];
      for (const name of pathParams(ep.path)) {
        parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
      }
      for (const q of ep.query || []) {
        parameters.push({
          name: q.name,
          in: 'query',
          required: !!q.required,
          description: q.description,
          schema: { type: 'string' },
          example: q.example,
        });
      }
      for (const h of ep.headers || []) {
        parameters.push({
          name: h.name, in: 'header', required: false, description: h.description, schema: { type: 'string' }, example: h.example,
        });
      }

      const operation = {
        tags: [group.tag],
        summary: ep.summary,
        operationId: `${ep.method} ${full}`.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        parameters,
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
        },
      };
      if (ep.note) operation.description = ep.note;
      if (secured) {
        operation.security = [{ bearerAuth: [] }];
        operation.responses[401] = { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
        if (ep.auth === 'admin' || ep.auth === 'provider') {
          operation.responses[403] = { description: 'Forbidden (insufficient role)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
        }
      }
      if (pathParams(ep.path).length) {
        operation.responses[404] = { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
      }
      if (ep.body) {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: { type: 'object' }, example: ep.body } },
        };
      } else if (ep.form) {
        const props = {};
        for (const f of ep.form) props[f.name] = f.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' };
        operation.requestBody = {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: props } } },
        };
      }

      item[ep.method.toLowerCase()] = operation;
    }
  }
  return doc;
}

// ---- Postman ---------------------------------------------------------------

function postmanUrl(full, ep) {
  const segments = full.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? `:${s.slice(1)}` : s));
  const url = {
    raw: `{{baseUrl}}${full}`,
    host: ['{{baseUrl}}'],
    path: segments,
  };
  const variable = pathParams(ep.path).map((name) => ({ key: name, value: `<${name}>` }));
  if (variable.length) url.variable = variable;
  if (ep.query && ep.query.length) {
    url.query = ep.query.map((q) => ({ key: q.name, value: q.example != null ? String(q.example) : '', description: q.description, disabled: !q.required }));
    url.raw += `?${url.query.filter((q) => !q.disabled).map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join('&')}`;
  }
  return url;
}

function buildRequest(group, ep) {
  const full = fullPath(group.base, ep.path);
  const secured = ep.auth !== 'public';
  const header = [];
  if (ep.body) header.push({ key: 'Content-Type', value: 'application/json' });
  for (const h of ep.headers || []) header.push({ key: h.name, value: h.example || '', description: h.description });

  const request = {
    method: ep.method,
    header,
    url: postmanUrl(full, ep),
    description: [ep.summary, ep.note, `Auth: ${ep.auth}`].filter(Boolean).join('\n\n'),
  };
  // Public endpoints opt out of the collection-level bearer auth.
  if (!secured) request.auth = { type: 'noauth' };

  if (ep.body) {
    request.body = { mode: 'raw', raw: JSON.stringify(ep.body, null, 2), options: { raw: { language: 'json' } } };
  } else if (ep.form) {
    request.body = {
      mode: 'formdata',
      formdata: ep.form.map((f) => (f.type === 'file' ? { key: f.name, type: 'file', src: [], description: f.description } : { key: f.name, type: 'text', value: '', description: f.description })),
    };
  }

  const item = { name: `${ep.method} ${full}  —  ${ep.summary}`, request, response: [] };

  if (isTokenEndpoint(full)) {
    item.event = [{
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          '// Auto-capture auth tokens from the response into collection variables.',
          'try {',
          '  const j = pm.response.json();',
          '  const d = (j && j.data) || {};',
          "  if (d.token) pm.collectionVariables.set('accessToken', d.token);",
          "  if (d.refreshToken) pm.collectionVariables.set('refreshToken', d.refreshToken);",
          "  if (d.token) console.log('Saved accessToken to collection variables');",
          '} catch (e) { /* non-JSON or error response */ }',
        ],
      },
    }];
  }
  return item;
}

function buildPostmanCollection() {
  return {
    info: {
      _postman_id: crypto.randomUUID(),
      name: `${info.title} (v${info.version})`,
      description: info.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: DEFAULT_BASE_URL, type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
      { key: 'refreshToken', value: '', type: 'string' },
    ],
    item: groups.map((group) => ({
      name: group.tag,
      description: group.description,
      item: group.endpoints.map((ep) => buildRequest(group, ep)),
    })),
  };
}

function buildPostmanEnvironment() {
  return {
    id: crypto.randomUUID(),
    name: 'Tirelo Services — Local',
    values: [
      { key: 'baseUrl', value: DEFAULT_BASE_URL, enabled: true },
      { key: 'accessToken', value: '', enabled: true },
      { key: 'refreshToken', value: '', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}

// ---- write -----------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const openapi = buildOpenApi();
  const collection = buildPostmanCollection();
  const environment = buildPostmanEnvironment();

  fs.writeFileSync(path.join(OUT_DIR, 'openapi.json'), JSON.stringify(openapi, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'tirelo-services.postman_collection.json'), JSON.stringify(collection, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'tirelo-services.postman_environment.json'), JSON.stringify(environment, null, 2));

  const endpointCount = groups.reduce((n, g) => n + g.endpoints.length, 0);
  console.log(`[docs:api] ${groups.length} tags, ${endpointCount} endpoints`);
  console.log(`[docs:api] wrote openapi.json, postman collection + environment to docs/api/`);
  return { openapi, collection, environment, endpointCount };
}

if (require.main === module) main();
module.exports = { buildOpenApi, buildPostmanCollection, buildPostmanEnvironment, main };
