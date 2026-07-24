'use strict';
// Government Developer Platform (Phase 39). Generates a client SDK, mock services, integration
// templates, and a testing harness FROM the live OpenAPI contract, so integrators build
// against the STABLE ports. Deterministic (same spec → same SDK). Zero-dependency output.

// Generate a zero-dependency JS client SDK string from the OpenAPI spec. Each operationId
// becomes a method that calls the documented method+path.
function generateClientSdk(spec, { className = 'NjtipClient' } = {}) {
  const ops = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      const name = op.operationId || camel(`${method}_${path}`);
      const needsBody = ['post', 'put', 'patch'].includes(method);
      ops.push(`  ${name}(params = {}${needsBody ? ', body = {}' : ''}) { return this._call('${method.toUpperCase()}', this._path('${path}', params)${needsBody ? ', body' : ''}); }`);
    }
  }
  return [
    `// AUTO-GENERATED SDK for ${(spec.info && spec.info.title) || 'NJTIP'} v${(spec.info && spec.info.version) || '1'} — do not edit by hand.`,
    `'use strict';`,
    `class ${className} {`,
    `  constructor({ baseUrl = '', token } = {}) { this._base = baseUrl; this._token = token; }`,
    `  _path(tpl, params) { return tpl.replace(/\\{(\\w+)\\}/g, (_, k) => encodeURIComponent(params[k])); }`,
    `  async _call(method, path, body) { /* integrator supplies transport (fetch/http) */ return { method, path, body }; }`,
    ...ops,
    `}`,
    `module.exports = { ${className} };`,
  ].join('\n') + '\n';
}
function camel(s) { return s.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, ''); }

// Mock service: a deterministic responder over the spec (returns a documented-shape stub),
// so integrators can develop offline without the real backend.
function mockService(spec) {
  return {
    handle(method, path) {
      const ops = spec.paths[path]; const op = ops && ops[method.toLowerCase()];
      if (!op) return { status: 404, body: { error: 'not-found' } };
      const okCode = Object.keys(op.responses || { 200: {} }).find((c) => c.startsWith('2')) || '200';
      return { status: Number(okCode), body: { mock: true, operationId: op.operationId || null } };
    },
  };
}

// Integration template: a minimal, reviewable adapter skeleton for a named port.
function integrationTemplate(portName) {
  return `// Integration template for the '${portName}' port. Implement these methods against\n`
    + `// your backend; keep the SAME signatures so it drops in behind the stable port.\n`
    + `module.exports = class ${camel(portName)}Adapter {\n  // TODO: implement the port's methods (see docs/production-adapters.md)\n};\n`;
}

// Testing harness: a deterministic self-check that every operationId is unique + documented.
function testHarness(spec) {
  const ids = []; const issues = [];
  for (const methods of Object.values(spec.paths || {})) for (const op of Object.values(methods)) { if (op.operationId) ids.push(op.operationId); else issues.push('missing operationId'); }
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) issues.push('duplicate operationIds: ' + [...new Set(dupes)].join(', '));
  return { operations: ids.length, issues, ok: issues.length === 0 };
}

module.exports = { generateClientSdk, mockService, integrationTemplate, testHarness };
