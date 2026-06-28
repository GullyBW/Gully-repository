'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const { responseCache } = require('./middleware/responseCache');
const { requestId } = require('./middleware/requestId');
const config = require('./config');
const cache = require('./services/cache.service');
const metrics = require('./services/metrics.service');

// Routes
const authRoutes = require('./routes/auth.routes');
const categoryRoutes = require('./routes/category.routes');
const providerRoutes = require('./routes/provider.routes');
const reviewRoutes = require('./routes/review.routes');
const favouriteRoutes = require('./routes/favourite.routes');
const availabilityRoutes = require('./routes/availability.routes');
const notificationRoutes = require('./routes/notification.routes');
const geoRoutes = require('./routes/geo.routes');
const bookingRoutes = require('./routes/booking.routes');
const paymentRoutes = require('./routes/payment.routes');
const uploadRoutes = require('./routes/upload.routes');
const savedAddressRoutes = require('./routes/savedAddress.routes');
const adminRoutes = require('./routes/admin.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const messageRoutes = require('./routes/message.routes');
const blockRoutes = require('./routes/block.routes');

/**
 * Builds the Express app. Exported separately from the server so tests can
 * import it without binding to a port or a database.
 */
function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers + gzip. CSP defaults on; allow uploaded images to be
  // embedded cross-origin by the Ionic app.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(compression());
  app.use(requestId);
  app.use(requestLogger);

  // Capture the raw body so payment webhook signatures verify byte-for-byte.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  // Abuse protection on the API surface (disabled under test).
  if (config.env !== 'test') {
    app.use(
      '/api',
      rateLimit({
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
      })
    );
  }

  // Health / readiness probes.
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tirelo-services-api' }));
  app.get('/health/live', (_req, res) => res.json({ status: 'live' }));
  app.get('/health/ready', (_req, res) => {
    const dbReady = config.env === 'test' || mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({
      status: dbReady ? 'ready' : 'not-ready',
      db: dbReady,
      cache: cache.backend,
    });
  });
  app.get('/metrics', (_req, res) => res.json({ success: true, data: metrics.snapshot() }));

  // Static serving for locally-stored uploads.
  if (config.storage.driver === 'local') {
    app.use('/uploads', express.static(config.storage.localDir));
  }

  // API routes.
  app.use('/api/auth', authRoutes);
  app.use('/api/categories', responseCache(300), categoryRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/favourites', favouriteRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/geo', geoRoutes);
  app.use('/api/addresses', savedAddressRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/blocks', blockRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
