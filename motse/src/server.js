'use strict';

const { createApp } = require('./app');

const PORT = process.env.MOTSE_PORT || 4100;
const { app } = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Motse core listening on :${PORT} (modular monolith, /v1)`);
});
