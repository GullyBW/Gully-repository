'use strict';

const config = require('../../config');
const LocalStorageProvider = require('./local.provider');

/**
 * Storage factory. Returns the configured provider. Cloud drivers (s3, gcs, r2,
 * azure) plug in here behind the same StorageProvider interface; until one is
 * wired we fall back to local storage so development always works.
 */
let provider;

function getStorage() {
  if (provider) return provider;
  switch (config.storage.driver) {
    // case 's3': provider = new S3StorageProvider(); break;
    // case 'gcs': provider = new GcsStorageProvider(); break;
    case 'local':
    default:
      provider = new LocalStorageProvider();
  }
  return provider;
}

/** Test/seed helper to inject a provider. */
function setStorage(p) {
  provider = p;
}

module.exports = { getStorage, setStorage };
