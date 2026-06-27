'use strict';

/**
 * Operational error carrying an HTTP status code. Thrown anywhere in the
 * service and translated to a JSON response by the error handler.
 */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message) {
    return new ApiError(409, message);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }
}

module.exports = ApiError;
