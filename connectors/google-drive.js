'use strict';
/**
 * connectors/google-drive.js
 *
 * Lightweight Google Drive API client using native fetch (no googleapis package).
 * Handles OAuth token lifecycle and Drive file operations.
 *
 * Connector interface (all connectors should implement):
 *   getAuthUrl(state)
 *   exchangeCode(code)
 *   getValidToken(tokens, supabase, userId, instanceId)
 *   listFolders(accessToken, parentId?)
 *   listFilesInFolder(accessToken, folderId)
 *   downloadFile(accessToken, fileId)
 *   getUserInfo(accessToken)
 */

const crypto = require('crypto');

const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const REVOKE_URL   = 'https://oauth2.googleapis.com/revoke';
const DRIVE_BASE   = 'https://www.googleapis.com/drive/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DRIVE_SCOPE  = 'https://www.googleapis.com/auth/drive.readonly';

const SUPPORTED_MIMES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    // Google native formats — exported on download
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.document',
];

// Google native MIME → export target MIME
const GOOGLE_EXPORT_MAP = {
    'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.document':    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// ── State signing (encodes userId + instanceId for the OAuth callback) ─────────

function createState(userId, instanceId) {
    const payload = `${userId}:${instanceId}:${Date.now()}`;
    const encoded = Buffer.from(payload).toString('base64url');
    const sig = crypto
        .createHmac('sha256', process.env.CREDENTIALS_SECRET || 'fallback')
        .update(encoded)
        .digest('base64url');
    return `${encoded}.${sig}`;
}

function verifyState(state) {
    if (!state) return null;
    const dot = state.lastIndexOf('.');
    if (dot === -1) return null;
    const encoded = state.slice(0, dot);
    const sig     = state.slice(dot + 1);
    const expected = crypto
        .createHmac('sha256', process.env.CREDENTIALS_SECRET || 'fallback')
        .update(encoded)
        .digest('base64url');
    if (sig !== expected) return null;
    const parts = Buffer.from(encoded, 'base64url').toString().split(':');
    if (parts.length < 3) return null;
    const [userId, instanceId, ts] = parts;
    if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null; // 10-min TTL
    return { userId, instanceId };
}

// ── OAuth ──────────────────────────────────────────────────────────────────────

function getAuthUrl(userId, instanceId) {
    const state = createState(userId, instanceId);
    const params = new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope:         DRIVE_SCOPE,
        access_type:   'offline',
        prompt:        'consent',
        state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id:     process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
            grant_type:    'authorization_code',
        }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expiry_date:   Date.now() + data.expires_in * 1000,
    };
}

async function refreshAccessToken(refreshToken) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id:     process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type:    'refresh_token',
        }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data;
}

async function getValidToken(tokens, supabase, userId, instanceId) {
    if (Date.now() < (tokens.expiry_date || 0) - 60_000) return tokens.access_token;
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    const updated = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry_date:  Date.now() + refreshed.expires_in * 1000,
    };
    const { encrypt } = require('../utils/credentials-crypto');
    await supabase.from('connector_tokens')
        .update({ tokens: encrypt(JSON.stringify(updated)), updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('instance_id', instanceId).eq('provider', 'google-drive');
    return updated.access_token;
}

async function revokeToken(accessToken) {
    await fetch(`${REVOKE_URL}?token=${accessToken}`).catch(() => {});
}

// ── Drive API ──────────────────────────────────────────────────────────────────

async function driveGet(path, accessToken, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${DRIVE_BASE}${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data;
}

async function getUserInfo(accessToken) {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    return res.json();
}

async function listFolders(accessToken, parentId = 'root') {
    const q = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const data = await driveGet('/files', accessToken, { q, fields: 'files(id,name)', pageSize: '100', orderBy: 'name' });
    return data.files || [];
}

async function listFilesInFolder(accessToken, folderId) {
    const mimeFilter = SUPPORTED_MIMES.map(m => `mimeType='${m}'`).join(' or ');
    const baseQ = `'${folderId}' in parents and trashed=false`;

    const [supportedData, allData] = await Promise.all([
        driveGet('/files', accessToken, {
            q:      `${baseQ} and (${mimeFilter})`,
            fields: 'files(id,name,mimeType,size,createdTime)',
            pageSize: '200',
        }),
        driveGet('/files', accessToken, {
            q:      baseQ,
            fields: 'files(id,name,mimeType,size,createdTime)',
            pageSize: '200',
        }),
    ]);

    const supported   = supportedData.files || [];
    const supportedIds = new Set(supported.map(f => f.id));
    const unsupported  = (allData.files || []).filter(f => !supportedIds.has(f.id));

    return { supported, unsupported };
}

async function downloadFile(accessToken, fileId, mimeType) {
    // Google-native files must be exported, not downloaded directly
    const exportMime = GOOGLE_EXPORT_MAP[mimeType];
    const url = exportMime
        ? `${DRIVE_BASE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
        : `${DRIVE_BASE}/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Drive download failed: ${res.status}`);
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), effectiveMime: exportMime || mimeType };
}

module.exports = {
    createState, verifyState,
    getAuthUrl, exchangeCode, getValidToken, revokeToken,
    getUserInfo, listFolders, listFilesInFolder, downloadFile,
    GOOGLE_EXPORT_MAP,
};
