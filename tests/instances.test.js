/**
 * tests/instances.test.js
 *
 * Tests for /api/instances CRUD.
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 */

const { makeAuthRequest, USER_A, USER_B, INSTANCE_A, INSTANCE_B } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── GET /api/instances ───────────────────────────────────────────────────────
describe('GET /api/instances', () => {
    test('returns array for authenticated user', async () => {
        const rows = [
            { id: INSTANCE_A, name: 'Work', color: '#6366f1', instance_type: 'pm', created_at: '2025-01-01' },
        ];
        db.__q([{ data: rows, error: null }]);

        const supertest = require('supertest');
        const res = await supertest(app)
            .get('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].id).toBe(INSTANCE_A);
    });

    test('returns empty array if user has no instances', async () => {
        db.__q([{ data: [], error: null }]);

        const supertest = require('supertest');
        const res = await supertest(app)
            .get('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ── POST /api/instances ──────────────────────────────────────────────────────
describe('POST /api/instances', () => {
    test('creates instance with name + color', async () => {
        const created = { id: INSTANCE_A, name: 'New Project', color: '#ff0000', instance_type: 'pm', created_at: '2025-01-01' };
        db.__q([{ data: created, error: null }]);

        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ name: 'New Project', color: '#ff0000' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('New Project');
    });

    test('returns 400 if name missing', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ color: '#ff0000' }); // no name

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/name/i);
    });

    test('returns 400 if name is empty string', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ name: '   ' }); // whitespace only

        expect(res.status).toBe(400);
    });
});

// ── DELETE /api/instances/:id ────────────────────────────────────────────────
describe('DELETE /api/instances/:id', () => {
    test('returns 400 if trying to delete last instance', async () => {
        // select count returns 1
        db.__q([{ count: 1, error: null }]);

        const supertest = require('supertest');
        const res = await supertest(app)
            .delete(`/api/instances/${INSTANCE_A}`)
            .set('Authorization', `Bearer ${USER_A}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/only instance/i);
    });

    test('deletes successfully when user has multiple instances', async () => {
        // count = 2 → safe to delete
        db.__q([
            { count: 2, error: null },         // count check
            { data: null, error: null },       // delete
        ]);

        const supertest = require('supertest');
        const res = await supertest(app)
            .delete(`/api/instances/${INSTANCE_A}`)
            .set('Authorization', `Bearer ${USER_A}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
