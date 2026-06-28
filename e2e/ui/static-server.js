'use strict';

/**
 * Minimal static server for the built Ionic PWA (mobile/www) with SPA fallback.
 * Used only by the browser UI E2E harness (playwright.ui.config.ts).
 *
 *   UI_STATIC_PORT=8100 node e2e/ui/static-server.js
 */
const path = require('path');
const fs = require('fs');
const express = require('express');

const root = path.resolve(__dirname, '../../mobile/www');
const port = parseInt(process.env.UI_STATIC_PORT, 10) || 8100;
const app = express();

app.use(express.static(root));
// SPA fallback — serve index.html for any non-asset route.
app.get('*', (_req, res) => res.sendFile(path.join(root, 'index.html')));

if (!fs.existsSync(path.join(root, 'index.html'))) {
  // eslint-disable-next-line no-console
  console.error(`[ui-static] build missing: ${root}/index.html (run ng build first)`);
}
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[ui-static] serving ${root} on ${port}`);
});
