'use strict';

const { createApp } = require('./app');

const PORT = process.env.MOTSE_PORT || 4100;
const { app, platform } = createApp();

// Mission 5: begin runtime-intelligence sampling only when actually serving
// (kept out of the container so imports/tests never spin a background timer).
platform.runtime.start();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Motse core listening on :${PORT} (modular monolith, /v1)`);
});

// Graceful shutdown: stop sampling, flush spans, close the listener.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    platform.runtime.stop();
    platform.otel.flush();
    server.close(() => process.exit(0));
  });
}
