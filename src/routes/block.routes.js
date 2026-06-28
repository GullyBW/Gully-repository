'use strict';

const express = require('express');
const BlockController = require('../controllers/block.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', BlockController.list);
router.post('/:userId', BlockController.block);
router.delete('/:userId', BlockController.unblock);

module.exports = router;
