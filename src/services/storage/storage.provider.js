'use strict';

/**
 * Storage provider contract. Implementations persist an uploaded image and
 * return public URLs. Swapping local ↔ S3/GCS/R2/Azure requires only a new
 * subclass — business logic and controllers depend on this interface alone.
 */
class StorageProvider {
  /**
   * @param {object} file { buffer, mimetype, originalname }
   * @param {object} opts { kind, ownerId }
   * @returns {Promise<{ url: string, thumbnailUrl: string, key: string }>}
   */
  async save() {
    throw new Error('StorageProvider.save not implemented');
  }

  async remove() {
    throw new Error('StorageProvider.remove not implemented');
  }
}

module.exports = StorageProvider;
