'use strict';

const express = require('express');

/**
 * Example plugin: Community Marketplace (Phase 3, WS5).
 *
 * A self-contained extension that adds a small classifieds board on top
 * of the platform WITHOUT touching the core. It uses only its declared
 * permissions: namespaced storage for its listings, ledger reads to
 * price in a member's wallet context, event publishing for its own
 * domain events, and notifications. It never reaches core collections.
 *
 * Registered at /v1/ext/marketplace when enabled.
 */
const manifest = {
  name: 'community-marketplace',
  version: '1.0.0',
  api_version: '1.0.0',
  description: 'Ward-scoped classifieds board',
  permissions: ['store:namespaced', 'ledger:read', 'events:publish', 'notifications:send', 'audit:append'],
  dependencies: {},
  routes_prefix: 'marketplace',
};

function register(host) {
  host.require('store:namespaced');
  const listings = host.collection('listings');
  host.register('ext.marketplace.listed', 1, ['listing_id', 'seller_ref']);

  const router = express.Router();
  router.use(express.json());

  // The plugin trusts the host to have authenticated the caller; the
  // core app passes req.actor through to mounted plugin routers.
  router.post('/listings', (req, res) => {
    const listing = listings.insert({
      id: `mkl_${Math.random().toString(36).slice(2, 12)}`,
      seller_ref: req.actor || 'anonymous',
      title: req.body.title,
      price_minor: req.body.price_minor,
      ward_ref: req.body.ward_ref || null,
      state: 'active',
      created_at: host.clock.nowIso(),
    });
    host.publish('ext.marketplace.listed', { listing_id: listing.id, seller_ref: listing.seller_ref });
    host.append(req.actor || 'anonymous', 'listed', `marketplace:${listing.id}`, null, {
      title: listing.title,
    });
    res.json(listing);
  });

  router.get('/listings', (req, res) => {
    const rows = listings.find((l) => l.state === 'active' && (!req.query.ward || l.ward_ref === req.query.ward));
    res.json({ items: rows });
  });

  return {
    routes: router,
    hooks: {
      onEnable: () => {},
      onDisable: () => {},
    },
  };
}

module.exports = { manifest, register };
