'use strict';

/**
 * OpenAPI 3.0 generator (Phase 3, WS11). Introspects the Express app's
 * registered routes and emits a spec at sdk/openapi.json — the source
 * for auto-generated clients (openapi-generator, swagger-codegen, etc.).
 *   node motse/scripts/generate-openapi.js
 */
process.env.MOTSE_LOG_LEVEL = 'silent';
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/app');

const { app } = createApp();

function collectRoutes(stack, prefix = '') {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      const p = prefix + layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        routes.push({ method: method.toUpperCase(), path: p });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // Best-effort mount-path recovery for nested routers.
      routes.push(...collectRoutes(layer.handle.stack, prefix));
    }
  }
  return routes;
}

const routes = collectRoutes(app._router.stack).filter((r) => r.path.startsWith('/v1') || r.path.startsWith('/health') || r.path === '/metrics');

const paths = {};
for (const { method, path: p } of routes) {
  // Express :param → OpenAPI {param}.
  const openapiPath = p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  paths[openapiPath] = paths[openapiPath] || {};
  const params = (openapiPath.match(/{([A-Za-z0-9_]+)}/g) || []).map((m) => ({
    name: m.slice(1, -1),
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const isMutation = method !== 'GET';
  paths[openapiPath][method.toLowerCase()] = {
    summary: `${method} ${openapiPath}`,
    parameters: [
      ...params,
      ...(isMutation && openapiPath.startsWith('/v1') && !openapiPath.includes('/webhooks/')
        ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }]
        : []),
    ],
    responses: {
      200: { description: 'Success' },
      400: { description: 'Problem details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
    },
    security: needsAuth(openapiPath) ? [{ bearerAuth: [] }] : [],
  };
}

function needsAuth(p) {
  return (
    p.startsWith('/v1/admin') ||
    p.startsWith('/v1/wallet') ||
    p.startsWith('/v1/lelapa') ||
    p.startsWith('/v1/puo/progress') ||
    p.startsWith('/v1/payments/payouts') ||
    p.startsWith('/v1/notifications')
  );
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Motse Platform API',
    version: '3.0.0',
    description: 'Civic, cultural and financial platform for Botswana. All mutations require an Idempotency-Key; errors use the problem-details envelope.',
  },
  servers: [
    { url: 'https://api.motse.bw', description: 'production' },
    { url: 'https://api.staging.motse.bw', description: 'staging' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
    schemas: {
      Problem: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          domain_reason: { type: 'string', nullable: true },
          retryable: { type: 'boolean' },
          trace_id: { type: 'string' },
        },
      },
    },
  },
  paths,
};

const outDir = path.join(__dirname, '..', 'sdk');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(`Wrote sdk/openapi.json — ${Object.keys(paths).length} paths`);
