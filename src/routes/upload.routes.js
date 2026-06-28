'use strict';

const express = require('express');
const { UploadController } = require('../controllers/upload.controller');
const { singleImage } = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Authenticated, image-only, single file in field "image".
router.post('/:kind', authenticate, singleImage('image'), UploadController.upload);

module.exports = router;
