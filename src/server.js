'use strict';

const http = require('http');
const mongoose = require('mongoose');
const createApp = require('./app');
const config = require('./config');
const cache = require('./services/cache.service');
const { attachSocket } = require('./realtime/socket');

async function start() {
  try {
    await mongoose.connect(config.db.uri);
    // eslint-disable-next-line no-console
    console.log('[tirelo] connected to MongoDB');

    const app = createApp();
    const server = http.createServer(app);

    // Real-time chat gateway (Socket.IO) shares the HTTP server + JWT auth.
    attachSocket(server, { cors: { origin: process.env.CORS_ORIGIN || '*' } });

    server.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[tirelo] listening on port ${config.port} (${config.env})`);
    });

    setupGracefulShutdown(server);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tirelo] failed to start', err);
    process.exit(1);
  }
}

function setupGracefulShutdown(server) {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[tirelo] ${signal} received — shutting down gracefully`);

    // Stop accepting new connections, then drain dependencies.
    server.close(async () => {
      try {
        await mongoose.connection.close();
        await cache.close();
      } catch (_err) {
        /* ignore */
      }
      // eslint-disable-next-line no-console
      console.log('[tirelo] shutdown complete');
      process.exit(0);
    });

    // Force-exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
}

start();
