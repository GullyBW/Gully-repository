'use strict';

/**
 * Crash-reporting hook points. Wires Sentry when `SENTRY_DSN` is set and
 * `@sentry/node` is installed (kept optional so the app runs without it), and
 * always installs process-level guards that log fatal errors. Replace the
 * `report` body to integrate another provider.
 */
let sentry = null;

function init() {
  if (process.env.SENTRY_DSN) {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      sentry = require('@sentry/node');
      sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
    } catch (_err) {
      sentry = null; // @sentry/node not installed — degrade to console
    }
  }

  process.on('unhandledRejection', (reason) => report(reason, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    report(err, 'uncaughtException');
    // Let the process manager restart us after a fatal uncaught exception.
    process.exit(1);
  });
}

function report(error, context) {
  // eslint-disable-next-line no-console
  console.error(`[crash:${context || 'manual'}]`, error);
  if (sentry) sentry.captureException(error);
}

module.exports = { init, report };
