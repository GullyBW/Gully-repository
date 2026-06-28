'use strict';

const { getStorage } = require('../services/storage');
const ApiError = require('../utils/ApiError');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// The upload targets the marketplace supports.
const ALLOWED_KINDS = [
  'customer_photo',
  'provider_photo',
  'business_logo',
  'portfolio',
  'certificate',
  'job_photo',
  'review_photo',
  'message_image',
];

const UploadController = {
  // POST /api/uploads/:kind  (multipart, field "image")
  upload: asyncHandler(async (req, res) => {
    const { kind } = req.params;
    if (!ALLOWED_KINDS.includes(kind)) {
      throw ApiError.badRequest(`Unknown upload kind '${kind}'`);
    }
    const result = await getStorage().save(req.file, { kind, ownerId: req.user.id });
    res.status(201).json({ success: true, data: result });
  }),
};

module.exports = { UploadController, ALLOWED_KINDS };
