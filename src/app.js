'use strict';

const express = require('express');
const paymentRoutes = require('./routes/payment.routes');
const authRoutes = require('./routes/auth.routes');
const bookingRoutes = require('./routes/booking.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

/**
 * Builds the Express app. Exported separately from the server so tests can
 * import it without binding to a port, and so it can be mounted inside the
 * larger Tirelo backend as a sub-app.
 */
function createApp() {
  const app = express();

  // Capture the raw body so webhook signatures can be verified byte-for-byte.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'tirelo-services-api' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
