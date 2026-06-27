'use strict';

const mongoose = require('mongoose');
const createApp = require('./app');
const config = require('./config');

async function start() {
  try {
    await mongoose.connect(config.db.uri);
    // eslint-disable-next-line no-console
    console.log(`[tirelo-payments] connected to MongoDB`);

    const app = createApp();
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[tirelo-payments] listening on port ${config.port} (${config.env})`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tirelo-payments] failed to start', err);
    process.exit(1);
  }
}

start();
