'use strict';

const express = require('express');
const FavouriteController = require('../controllers/favourite.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', FavouriteController.list);
router.post('/:providerId', FavouriteController.add);
router.delete('/:providerId', FavouriteController.remove);

module.exports = router;
