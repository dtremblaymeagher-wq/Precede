'use strict';
/**
 * utils/integration-utils.js
 *
 * makeIntegrationUtils(supabase) → { loadIntegrationConfig, validateJiraBaseUrl }
 * Shared by integration-routes.js and import-routes.js.
 */

const { makeHelpers }        = require('./db-helpers');
const { decrypt }            = require('./credentials-crypto');

function makeIntegrationUtils(supabase) {
    const { instanceSelect } = makeHelpers(supabase);

    /** Load integration config with apiKey decrypted. Returns null if not configured. */
    async function loadIntegrationConfig(userId, instanceId) {
        const { data, error } = await instanceSelect('integrations', 'type, config', userId, instanceId)
            .single();
        if (error || !data) return null;
        const config = { ...data.config };
        if (config.apiKey) config.apiKey = decrypt(config.apiKey);
        return { type: data.type, ...config };
    }

    /** Returns an error string if the URL is unacceptable for SSRF reasons, or null if valid. */
    function validateJiraBaseUrl(raw) {
        let parsed;
        try { parsed = new URL(raw); } catch { return 'baseUrl must be a valid URL'; }
        if (parsed.protocol !== 'https:') return 'baseUrl must use the https:// scheme';
        const host = parsed.hostname.toLowerCase();
        const blocked = [
            /^localhost$/,
            /^127\./,
            /^0\.0\.0\.0$/,
            /^::1$/,
            /^\[::1\]$/,
            /^169\.254\./,
            /^10\./,
            /^172\.(1[6-9]|2\d|3[01])\./,
            /^192\.168\./,
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
            /\.internal$/,
            /\.local$/,
            /^metadata\.google\.internal$/,
        ];
        if (blocked.some(re => re.test(host))) return 'baseUrl hostname is not allowed';
        return null;
    }

    return { loadIntegrationConfig, validateJiraBaseUrl };
}

module.exports = { makeIntegrationUtils };
