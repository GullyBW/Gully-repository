'use strict';

const { v4: uuidv4 } = require('uuid');
const metrics = require('../services/metrics.service');

/**
 * Assigns a request id (honouring an inbound `x-request-id`), echoes it back on
 * the response for correlation across logs/traces, and feeds the metrics
 * counters on completion.
 */
function requestId(req, res, next) {
  req.id = req.get('x-request-id') || uuidv4();
  res.set('x-request-id', req.id);
  res.on('finish', () => metrics.record(res.statusCode));
  next();
}

module.exports = { requestId };
