'use strict';
/**
 * utils/validate.js
 *
 * Lightweight request-body validation — no external dependencies.
 *
 * Usage:
 *   const { body, param } = require('../utils/validate');
 *
 *   router.post('/route', body({ name: 'string', count: 'number?' }), handler);
 *   router.get('/route/:id', param('id'), handler);
 *
 * Type tokens:
 *   'string'   — required, must be non-empty string
 *   'number'   — required, must be finite number
 *   'boolean'  — required, must be boolean
 *   'array'    — required, must be array
 *   'object'   — required, must be plain object
 *   'any'      — required, any non-null/undefined value
 *   Append '?' to make optional  (e.g. 'string?', 'number?')
 *
 * Returns 400 JSON { error: '...' } on first validation failure.
 */

const CHECKERS = {
    string:  (v) => typeof v === 'string' && v.length > 0,
    number:  (v) => typeof v === 'number' && Number.isFinite(v),
    boolean: (v) => typeof v === 'boolean',
    array:   (v) => Array.isArray(v),
    object:  (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    any:     (v) => v !== null && v !== undefined,
};

/**
 * Validate req.body against a schema map.
 * @param {Record<string, string>} schema  e.g. { name: 'string', age: 'number?' }
 */
function body(schema) {
    const entries = Object.entries(schema).map(([key, token]) => {
        const optional = token.endsWith('?');
        const type = optional ? token.slice(0, -1) : token;
        const check = CHECKERS[type];
        if (!check) throw new Error(`validate.body: unknown type token "${token}" for field "${key}"`);
        return { key, type, optional, check };
    });

    return function validateBody(req, res, next) {
        for (const { key, type, optional, check } of entries) {
            const val = req.body?.[key];
            if (val === undefined || val === null) {
                if (!optional) return res.status(400).json({ error: `Missing required field: ${key}` });
                continue;
            }
            if (!check(val)) {
                return res.status(400).json({ error: `Invalid field "${key}": expected ${type}` });
            }
        }
        next();
    };
}

/**
 * Validate one or more URL params are present and non-empty strings.
 * @param {...string} names  e.g. param('id')  or  param('orgId', 'projectId')
 */
function param(...names) {
    return function validateParam(req, res, next) {
        for (const name of names) {
            const val = req.params?.[name];
            if (typeof val !== 'string' || val.length === 0) {
                return res.status(400).json({ error: `Missing required URL parameter: ${name}` });
            }
        }
        next();
    };
}

/**
 * Validate req.query fields.
 * @param {Record<string, string>} schema  e.g. { page: 'number?', filter: 'string?' }
 *
 * Note: query values arrive as strings. Numeric fields are coerced and
 * replaced on req.query so downstream handlers get numbers directly.
 */
function query(schema) {
    const entries = Object.entries(schema).map(([key, token]) => {
        const optional = token.endsWith('?');
        const type = optional ? token.slice(0, -1) : token;
        return { key, type, optional };
    });

    return function validateQuery(req, res, next) {
        for (const { key, type, optional } of entries) {
            const raw = req.query?.[key];
            if (raw === undefined || raw === '') {
                if (!optional) return res.status(400).json({ error: `Missing required query parameter: ${key}` });
                continue;
            }
            if (type === 'number') {
                const n = Number(raw);
                if (!Number.isFinite(n)) return res.status(400).json({ error: `Invalid query parameter "${key}": expected number` });
                req.query[key] = n;
            } else if (type === 'boolean') {
                if (raw !== 'true' && raw !== 'false') return res.status(400).json({ error: `Invalid query parameter "${key}": expected true or false` });
                req.query[key] = raw === 'true';
            }
            // string / any: no coercion needed
        }
        next();
    };
}

module.exports = { body, param, query };
