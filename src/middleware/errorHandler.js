'use strict';

const ApiError = require('../utils/ApiError');
const config = require('../config');

// 404 fallthrough for unmatched routes.
function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// Central error translator: turns thrown errors into consistent JSON.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError && config.env !== 'test') {
    // Surface unexpected failures in the logs for debugging.
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message: isServerError ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
