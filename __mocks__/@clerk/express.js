'use strict';
/**
 * __mocks__/@clerk/express.js
 *
 * Jest manual mock for Clerk authentication middleware.
 * Used automatically when tests call jest.mock('@clerk/express').
 *
 * Behaviour:
 *   - requireAuth() passes the request if Authorization: Bearer <token> is present.
 *   - getAuth(req) returns { userId: <token value> }.
 *   - clerkMiddleware() is a no-op pass-through.
 */

module.exports = {
    clerkMiddleware: () => (req, res, next) => next(),
    requireAuth: () => (req, res, next) => {
        if (!req.headers.authorization?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    },
    getAuth: (req) => ({ userId: req.headers.authorization?.replace('Bearer ', '') ?? null }),
};
