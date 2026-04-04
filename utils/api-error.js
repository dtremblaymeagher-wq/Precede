'use strict';
/**
 * utils/api-error.js
 * Centralised 500-error handler.
 * Logs the full error (message + stack) internally and returns a safe
 * generic message to the client so internal details are never leaked.
 */

function apiError(res, err, tag) {
    const label = tag ? `❌ ${tag}` : '❌ internal';
    console.error(label, err?.message ?? err);
    if (err?.stack) console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
}

module.exports = { apiError };
