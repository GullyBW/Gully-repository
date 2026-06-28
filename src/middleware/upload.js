'use strict';

const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Multer middleware for a single image upload. Buffers in memory (so the
 * StorageService controls where bytes land), enforces an image-only MIME
 * allow-list and a max size, and rejects everything else.
 */
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    return cb(new ApiError(400, 'Only JPEG, PNG, WebP or GIF images are allowed'));
  },
});

/** Wrap multer so its errors become our ApiError JSON shape. */
function singleImage(field = 'image') {
  const handler = memoryUpload.single(field);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.badRequest(`Image exceeds the ${config.storage.maxBytes} byte limit`));
        }
        return next(ApiError.badRequest(err.message));
      }
      if (err) return next(err);
      if (!req.file) return next(ApiError.badRequest('No image uploaded (field "image")'));
      return next();
    });
}

module.exports = { singleImage, ALLOWED_MIME };
