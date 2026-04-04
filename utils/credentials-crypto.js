'use strict';
/**
 * utils/credentials-crypto.js
 *
 * AES-256-GCM encryption for Jira credentials stored in Supabase.
 * Requires CREDENTIALS_SECRET env var (64-char hex = 32 bytes).
 *
 * Encrypted format: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Backward compatible: values not starting with "enc:v1:" are returned as-is.
 */

const crypto    = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const PREFIX    = 'enc:v1:';

let _key = null;
function getKey() {
    if (_key) return _key;
    const hex = process.env.CREDENTIALS_SECRET;
    if (!hex || hex.length < 64) {
        if (!getKey._warned) {
            console.warn('⚠️  CREDENTIALS_SECRET not set — Jira credentials stored as plaintext. Add a 64-char hex string to .env to enable encryption.');
            getKey._warned = true;
        }
        return null;
    }
    _key = Buffer.from(hex.slice(0, 64), 'hex');
    return _key;
}

function encrypt(plaintext) {
    if (!plaintext) return plaintext;
    const key = getKey();
    if (!key) return plaintext;
    const iv         = crypto.randomBytes(12);
    const cipher     = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag    = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decrypt(value) {
    if (!value || !value.startsWith(PREFIX)) return value; // plaintext or legacy
    const key = getKey();
    if (!key) throw new Error('CREDENTIALS_SECRET is required to decrypt stored credentials — check your .env');
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted credential format');
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, 'hex')),
        decipher.final(),
    ]).toString('utf8');
}

module.exports = { encrypt, decrypt };
