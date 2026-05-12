'use strict';
/**
 * tests/grooming.test.js
 *
 * Tests for POST /api/grooming/generate.
 *
 * Queue:
 *   [0] resolveInstance   → instances.single()
 *   [1] settings          → settings.single()   (Promise.all slot 0)
 *   [2] learning_vault    → learning_vault.then() (Promise.all slot 1)
 *   Claude via global.fetch
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = jest.fn();
});
afterAll(() => { global.fetch = savedFetch; });

function mockClaude(text = 'Groomed story content.') {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text }] }),
    });
}

function setupQueues() {
    db.__q([instanceOk()]);
    db.__qTable('settings',       [{ data: { data: { vision: 'Ship faster', objectives: ['Grow ARR'] } }, error: null }]);
    db.__qTable('learning_vault', [{ data: [], error: null }]);
}

// ── POST /api/grooming/generate ───────────────────────────────────────────────

describe('POST /api/grooming/generate', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/grooming/generate',
            { storyInput: 'As a user I want to search' });
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate',
            { storyInput: 'As a user I want to search' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('400 when storyInput is missing', async () => {
        db.__q([instanceOk()]);
        db.__qTable('settings',       [{ data: { data: {} }, error: null }]);
        db.__qTable('learning_vault', [{ data: [], error: null }]);
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate', {});
        expect(res.status).toBe(400);
    });

    test('400 when storyInput is blank whitespace', async () => {
        db.__q([instanceOk()]);
        db.__qTable('settings',       [{ data: { data: {} }, error: null }]);
        db.__qTable('learning_vault', [{ data: [], error: null }]);
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate', { storyInput: '   ' });
        expect(res.status).toBe(400);
    });

    test('200 returns { content: [{ text }] } for valid storyInput', async () => {
        mockClaude('Refined story with acceptance criteria.');
        setupQueues();
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate',
            { storyInput: 'As a user I want to search my backlog' });
        expect(res.status).toBe(200);
        expect(res.body.content).toBeDefined();
        expect(res.body.content[0].text).toBe('Refined story with acceptance criteria.');
    });

    test('returns content array compatible with story-grooming.js', async () => {
        mockClaude('## Refined\nAs a user...');
        setupQueues();
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate',
            { storyInput: 'Search feature' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.content)).toBe(true);
        expect(typeof res.body.content[0].text).toBe('string');
    });
});

describe('POST /api/grooming/generate — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        setupQueues();
        const res = await makeAuthRequest(app, 'post', '/api/grooming/generate',
            { storyInput: 'Write a search story' });
        expect(res.status).toBe(500);
    });
});
