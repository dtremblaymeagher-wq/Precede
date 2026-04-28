'use strict';
/**
 * tests/velocity.test.js
 *
 * Unit tests for utils/velocity.js.
 * No DB, no server, no HTTP — pure computation.
 *
 * computeVelocityStats is the most critical business-logic function:
 * it drives the roadmap projection and the exec forward-looking view.
 * Every code path that touches PRIORITY_SHARES or DEFAULT_CREEP
 * (CLAUDE.md §6) must have a test here.
 */

const { sprintForDate, calcFeatureSplit, computeVelocityStats } = require('../utils/velocity');

const SPRINT_1 = { name: 'Sprint 1', start_date: '2024-01-01', end_date: '2024-01-14' };
const SPRINT_2 = { name: 'Sprint 2', start_date: '2024-01-15', end_date: '2024-01-28' };
const SPRINT_3 = { name: 'Sprint 3', start_date: '2024-01-29', end_date: '2024-02-11' };

// ── sprintForDate ──────────────────────────────────────────────────────────────

describe('sprintForDate', () => {
    const sprints = [SPRINT_1, SPRINT_2];

    test('returns sprint when date falls inside its range', () => {
        expect(sprintForDate('2024-01-07', sprints)?.name).toBe('Sprint 1');
        expect(sprintForDate('2024-01-20', sprints)?.name).toBe('Sprint 2');
    });

    test('matches on sprint end date (end of day inclusive)', () => {
        expect(sprintForDate('2024-01-14', sprints)?.name).toBe('Sprint 1');
    });

    test('returns null when date is before all sprints', () => {
        expect(sprintForDate('2023-12-31', sprints)).toBeNull();
    });

    test('returns null when date is after all sprints', () => {
        expect(sprintForDate('2024-02-01', sprints)).toBeNull();
    });

    test('returns null for empty sprints array', () => {
        expect(sprintForDate('2024-01-07', [])).toBeNull();
    });

    test('returns null for null dateStr', () => {
        expect(sprintForDate(null, sprints)).toBeNull();
    });

    test('skips sprints missing start_date or end_date', () => {
        const incomplete = [{ name: 'X', start_date: null, end_date: null }, SPRINT_1];
        expect(sprintForDate('2024-01-07', incomplete)?.name).toBe('Sprint 1');
    });
});

// ── calcFeatureSplit ───────────────────────────────────────────────────────────

describe('calcFeatureSplit', () => {
    test('all stories are new_value when no labels', () => {
        const stories = [{ data: {} }, { data: {} }];
        const { new: n, maint, tech } = calcFeatureSplit(stories);
        expect(n).toBeGreaterThan(0);
        expect(maint).toBe(0);
        expect(tech).toBe(0);
    });

    test('split sums to ≤ 1 (rounding tolerance)', () => {
        const stories = [
            { data: { labels: ['Tech Debt'] } },
            { data: { labels: ['Maintenance'] } },
            { data: {} },
        ];
        const { new: n, maint, tech } = calcFeatureSplit(stories);
        expect(n + maint + tech).toBeLessThanOrEqual(1.01);
    });

    test('empty array returns safe defaults (new ≥ 0)', () => {
        const { new: n } = calcFeatureSplit([]);
        expect(n).toBeGreaterThanOrEqual(0);
    });
});

// ── computeVelocityStats ───────────────────────────────────────────────────────

describe('computeVelocityStats — empty / edge cases', () => {
    test('returns safe defaults when no stories and no sprints', () => {
        const result = computeVelocityStats([], []);
        expect(result.avgStoriesPerSprint).toBeGreaterThanOrEqual(1);
        expect(result.carryOverRate).toBe(0.15);   // DEFAULT_CREEP fallback
        expect(result.lowConfidence).toBe(true);
        expect(result.minVelocity).toBeGreaterThanOrEqual(1);
        expect(result.maxVelocity).toBeGreaterThan(0);
    });

    test('all done stories but no matching sprints → low confidence', () => {
        const stories = [
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
        ];
        const result = computeVelocityStats(stories, []);
        expect(result.lowConfidence).toBe(true);
    });
});

describe('computeVelocityStats — velocity computation', () => {
    test('computes avgStoriesPerSprint from a single sprint', () => {
        const stories = [
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
            { data: { status: 'done', updatedAt: '2024-01-08' }, created_at: '2024-01-03' },
        ];
        const result = computeVelocityStats(stories, [SPRINT_1]);
        expect(result.avgStoriesPerSprint).toBe(2);
        expect(result.deliveryCounts).toEqual([2]);
    });

    test('averages delivery across multiple sprints', () => {
        const stories = [
            // Sprint 1: 3 stories
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
            { data: { status: 'done', updatedAt: '2024-01-06' }, created_at: '2024-01-02' },
            { data: { status: 'done', updatedAt: '2024-01-07' }, created_at: '2024-01-02' },
            // Sprint 2: 1 story
            { data: { status: 'done', updatedAt: '2024-01-20' }, created_at: '2024-01-15' },
        ];
        const result = computeVelocityStats(stories, [SPRINT_1, SPRINT_2]);
        expect(result.avgStoriesPerSprint).toBe(2);   // (3+1)/2
        expect(result.lowConfidence).toBe(false);
    });

    test('lowConfidence is true with fewer than 2 sprint data points', () => {
        const stories = [
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
        ];
        expect(computeVelocityStats(stories, [SPRINT_1]).lowConfidence).toBe(true);
    });

    test('lowConfidence is false with 2+ sprint data points', () => {
        const stories = [
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
            { data: { status: 'done', updatedAt: '2024-01-20' }, created_at: '2024-01-15' },
        ];
        expect(computeVelocityStats(stories, [SPRINT_1, SPRINT_2]).lowConfidence).toBe(false);
    });

    test('minVelocity and maxVelocity reflect sprint range', () => {
        const stories = [
            // Sprint 1: 1 story
            { data: { status: 'done', updatedAt: '2024-01-05' }, created_at: '2024-01-02' },
            // Sprint 2: 4 stories
            { data: { status: 'done', updatedAt: '2024-01-16' }, created_at: '2024-01-15' },
            { data: { status: 'done', updatedAt: '2024-01-17' }, created_at: '2024-01-15' },
            { data: { status: 'done', updatedAt: '2024-01-18' }, created_at: '2024-01-15' },
            { data: { status: 'done', updatedAt: '2024-01-19' }, created_at: '2024-01-15' },
        ];
        const result = computeVelocityStats(stories, [SPRINT_1, SPRINT_2]);
        expect(result.minVelocity).toBe(1);
        expect(result.maxVelocity).toBe(4);
    });
});

describe('computeVelocityStats — carry-over rate', () => {
    test('defaults to 0.15 when no sprint assignment data', () => {
        const stories = [{ data: { status: 'done' } }];
        expect(computeVelocityStats(stories, []).carryOverRate).toBe(0.15);
    });

    test('ignores sprints with ≤ 2 stories (noise filter)', () => {
        // Only 2 stories in Sprint 1 → filtered out → fallback 0.15
        const stories = [
            { data: { status: 'done',        sprintName: 'Sprint 1' } },
            { data: { status: 'in progress', sprintName: 'Sprint 1' } },
        ];
        expect(computeVelocityStats(stories, []).carryOverRate).toBe(0.15);
    });

    test('computes carry-over rate from unfinished sprint work', () => {
        // 4 stories planned, 1 done → carry rate = 3/4 = 0.75
        const stories = [
            { data: { status: 'done',        sprintName: 'Sprint 1' } },
            { data: { status: 'in progress', sprintName: 'Sprint 1' } },
            { data: { status: 'in progress', sprintName: 'Sprint 1' } },
            { data: { status: 'in progress', sprintName: 'Sprint 1' } },
        ];
        const result = computeVelocityStats(stories, []);
        expect(result.carryOverRate).toBeCloseTo(0.75, 2);
    });
});
