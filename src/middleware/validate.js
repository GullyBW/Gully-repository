'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Returns an Express middleware that validates `req.body` against a Joi schema.
 * On success the body is replaced with the sanitised, type-coerced value.
 */
function validateBody(schema) {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map((d) => d.message);
      return next(ApiError.badRequest('Validation failed', details));
    }
    req.body = value;
    return next();
  };
}

module.exports = { validateBody };
