'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StorageProvider = require('./storage.provider');
const config = require('../../config');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Local filesystem storage (development default). Writes randomised filenames
 * under `STORAGE_LOCAL_DIR/<kind>/` and serves them via the `/uploads` static
 * route. Generates an optimised thumbnail when `sharp` (optionalDependency) is
 * installed; otherwise the original is used for both URLs.
 */
class LocalStorageProvider extends StorageProvider {
  get baseUrl() {
    return config.storage.publicBaseUrl || `${config.publicBaseUrl}/uploads`;
  }

  _dirFor(kind) {
    const dir = path.join(config.storage.localDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async save(file, { kind = 'misc' } = {}) {
    const ext = EXT_BY_MIME[file.mimetype] || 'bin';
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const dir = this._dirFor(kind);
    const fullPath = path.join(dir, name);

    const sharp = LocalStorageProvider._sharp();
    let thumbnailUrl;
    if (sharp && file.mimetype !== 'image/gif') {
      // Optimise the main image and produce a 200px thumbnail.
      await sharp(file.buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).toFile(fullPath);
      const thumbName = name.replace(`.${ext}`, `_thumb.${ext}`);
      await sharp(file.buffer).rotate().resize({ width: 200, height: 200, fit: 'cover' }).toFile(path.join(dir, thumbName));
      thumbnailUrl = `${this.baseUrl}/${kind}/${thumbName}`;
    } else {
      fs.writeFileSync(fullPath, file.buffer);
    }

    const url = `${this.baseUrl}/${kind}/${name}`;
    return { url, thumbnailUrl: thumbnailUrl || url, key: `${kind}/${name}` };
  }

  async remove(key) {
    const target = path.join(config.storage.localDir, key);
    try {
      fs.unlinkSync(target);
      return true;
    } catch (_err) {
      return false;
    }
  }

  static _sharp() {
    if (LocalStorageProvider.__sharp !== undefined) return LocalStorageProvider.__sharp;
    try {
      // eslint-disable-next-line global-require
      LocalStorageProvider.__sharp = require('sharp');
    } catch (_err) {
      LocalStorageProvider.__sharp = null;
    }
    return LocalStorageProvider.__sharp;
  }
}

module.exports = LocalStorageProvider;
