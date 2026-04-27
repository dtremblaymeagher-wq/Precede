'use strict';
/**
 * __mocks__/@clerk/express.js
 *
 * Jest manual mock for Clerk authentication middleware.
 * Used automatically when tests call jest.mock('@clerk/express').
 *
 * Behaviour:
 *   - clerkMiddleware() is a no-op pass-through.
 *   - getAuth(req) returns { userId: <token value> } from Authorization: Bearer <token>.
 *     Returns { userId: null } when header is absent — triggers 401 in server auth middleware.
 */

module.exports = {
    clerkMiddleware: () => (req, res, next) => next(),
    getAuth: (req) => ({ userId: req.headers.authorization?.replace('Bearer ', '') ?? null }),
};
