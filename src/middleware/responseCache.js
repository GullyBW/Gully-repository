'use strict';

const cache = require('../services/cache.service');

/**
 * Caches successful GET responses for public, cacheable endpoints (e.g. service
 * categories). Keyed by the full URL. Skips any authenticated request so a
 * user's private data is never cached. Adds an X-Cache header for observability.
 */
function responseCache(ttlSeconds = 60) {
  return async (req, res, next) => {
    if (req.method !== 'GET' || req.get('authorization')) return next();

    const key = `httpcache:${req.originalUrl}`;
    try {
      const hit = await cache.get(key);
      if (hit) {
        res.set('X-Cache', 'HIT');
        return res.status(200).json(hit);
      }
    } catch (_err) {
      /* cache failures must never break the request */
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        cache.set(key, body, ttlSeconds).catch(() => {});
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };
    return next();
  };
}

module.exports = { responseCache };
