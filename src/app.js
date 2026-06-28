'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const paymentRoutes = require('./routes/payment.routes');
const authRoutes = require('./routes/auth.routes');
const bookingRoutes = require('./routes/booking.routes');
const providerRoutes = require('./routes/provider.routes');
const categoryRoutes = require('./routes/category.routes');
const reviewRoutes = require('./routes/review.routes');
const favouriteRoutes = require('./routes/favourite.routes');
const availabilityRoutes = require('./routes/availability.routes');
const notificationRoutes = require('./routes/notification.routes');
const geoRoutes = require('./routes/geo.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const config = require('./config');

/**
 * Builds the Express app. Exported separately from the server so tests can
 * import it without binding to a port, and so it can be mounted inside a larger
 * deployment as a sub-app.
 */
function createApp() {
  const app = express();

  // Security headers.
  app.use(helmet());

  // Capture the raw body so webhook signatures can be verified byte-for-byte.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  // Basic abuse protection on the API surface (disabled under test).
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

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tirelo-services-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/favourites', favouriteRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/geo', geoRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
