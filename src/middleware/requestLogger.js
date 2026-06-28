'use strict';

const config = require('../config');

/**
 * Minimal structured request logger. Emits one line per request with method,
 * path, status and latency. Silent under test to keep output clean.
 */
function requestLogger(req, res, next) {
  if (config.env === 'test') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(ms),
      })
    );
  });
  return next();
}

module.exports = { requestLogger };
