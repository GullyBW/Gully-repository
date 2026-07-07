# Plugin SDK (Phase 3, WS5)

Motse is an extensible platform: new modules install without modifying the core.

## Plugin package

```js
module.exports = {
  manifest: {
    name: 'community-marketplace', version: '1.0.0', api_version: '1.0.0',
    permissions: ['store:namespaced', 'ledger:read', 'events:publish', 'notifications:send'],
    dependencies: { 'other-plugin': '^1.0.0' },
    routes_prefix: 'marketplace',        // mounted at /v1/ext/marketplace
  },
  register(host) {                       // host is permission-scoped (the sandbox)
    const listings = host.collection('listings');   // store:namespaced
    const router = require('express').Router();
    router.get('/listings', (req, res) => res.json({ items: listings.find() }));
    return { routes: router, hooks: { onEnable() {}, onDisable() {} } };
  },
};
```

## Guarantees

- **Digital signature verification** — install verifies an HMAC over the manifest + code
  hash; unsigned or tampered packages (including privilege-escalation attempts that alter
  the manifest) are refused. `manager.sign(manifest, codeHash)` produces the signature.
- **Permission sandbox** — `register(host)` receives ONLY the capability facets its
  manifest declares. A plugin without `ledger:write` literally has no `host.transfer`.
  Facets: `identity:read`, `ledger:read`, `ledger:write`, `search:read`, `search:index`,
  `events:subscribe`, `events:publish`, `notifications:send`, `audit:append`,
  `store:namespaced` (its own prefixed collections — no access to core rows).
- **Dependency + api-version + semver** checks at load time.
- **Hot enable/disable** — mounts/unmounts routes on a live router; no restart. Data
  persists across a disable.
- Every lifecycle transition is audited (`plugin:<name>` chain).

Plugin mutations honour the same gateway rules as everything else (Idempotency-Key,
problem-details errors). Example plugin: `src/plugins/examples/marketplace.plugin.js`.

## API

```
GET  /v1/admin/plugins
POST /v1/admin/plugins/{name}/enable | /disable
GET  /v1/ext/{prefix}/…                 the plugin's own routes (authenticated)
```
