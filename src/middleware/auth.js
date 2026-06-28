'use strict';

const AuthService = require('../services/auth.service');
const ApiError = require('../utils/ApiError');

/**
 * Express middleware that requires a valid Bearer token. On success it attaches
 * `req.user = { id, role, email }` decoded from the JWT.
 */
function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = AuthService.verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Role guard. Use after `authenticate`, e.g. `authorize('provider', 'admin')`.
 */
function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to perform this action'));
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
