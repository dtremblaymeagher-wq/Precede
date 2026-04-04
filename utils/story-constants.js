'use strict';
/**
 * utils/story-constants.js
 * Shared story/epic status helpers and T-shirt size model used across route files.
 * Single source of truth — do not redefine locally in route files.
 *
 * CLIENT-SIDE MIRROR: roadmap.js and epic-lifecycle.html each maintain local
 * copies of the sprint ranges / midpoints (vanilla JS can't require Node modules).
 * If you change the size model here, update those two files manually:
 *   - roadmap.js          → TSHIRT_MIDPOINTS
 *   - epic-lifecycle.html → TSHIRT_SPRINT_RANGES
 */

// ─── Sprint name helpers ──────────────────────────────────────────────────────

/** Extract trailing number from a sprint name — "Sprint 14" → 14, null if none. */
function sprintNumFromName(name) {
    const m = String(name ?? '').match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
}

// ─── Story category inference ─────────────────────────────────────────────────

const TECH_DEBT_RE  = /tech.?debt|refactor|cleanup|upgrade|migration/;
const MAINTENANCE_RE = /bug|fix|hotfix|incident|crash|error|maintenance|chore/;

/**
 * Infer story category from its title + labels.
 * @param {object} storyData  — the `data` field of a story row
 * @returns {'tech_debt'|'maintenance'|'new_value'}
 */
function inferStoryCategory(storyData) {
    const title  = (storyData?.title  ?? '').toLowerCase();
    const labels = (storyData?.labels ?? []).map(l => String(l).toLowerCase());
    const all    = [title, ...labels].join(' ');
    if (TECH_DEBT_RE.test(all))   return 'tech_debt';
    if (MAINTENANCE_RE.test(all)) return 'maintenance';
    return 'new_value';
}

// ─── Status sets ──────────────────────────────────────────────────────────────

const DONE_STATUSES = new Set([
    'done', 'closed', 'complete', 'completed', 'resolved', 'accepted',
]);

const ACTIVE_STATUSES = new Set([
    'in progress', 'in-progress', 'inprogress', 'doing',
    'in development', 'in dev', 'dev', 'in review', 'review',
    'ready for dev', 'ready for development',
]);

const isDone   = s => DONE_STATUSES.has((s.data?.status ?? '').toLowerCase().trim());
const isActive = s => ACTIVE_STATUSES.has((s.data?.status ?? '').toLowerCase().trim());

/**
 * Infer epic lifecycle phase from its story set.
 * discovery → refinement → development → completion
 */
function detectPhase(stories) {
    const total = stories.length;
    if (total < 3) return 'discovery';
    const doneCount = stories.filter(isDone).length;
    if (doneCount / total > 0.80) return 'completion';
    if (stories.some(isActive))   return 'development';
    return 'refinement';
}

// ─── T-shirt size model ───────────────────────────────────────────────────────

/**
 * Sprint-duration buckets for each T-shirt size.
 * Format: [size, minSprints (inclusive), maxSprints (exclusive)]
 * Midpoints (used client-side in roadmap.js as TSHIRT_MIDPOINTS):
 *   XS→1  S→3  M→6  L→11.5  XL→20  XXL→37.5
 */
const TSHIRT_RANGES = [
    ['XS',   0,        2],
    ['S',    2,        4],
    ['M',    4,        8],
    ['L',    8,       15],
    ['XL',  15,       25],
    ['XXL', 25, Infinity],
];

/** Ordered list of valid T-shirt size strings — derived from TSHIRT_RANGES. */
const TSHIRT_SIZES = TSHIRT_RANGES.map(([sz]) => sz); // ['XS','S','M','L','XL','XXL']

/**
 * Story-count thresholds for sizing completed epics.
 * (Active epics use duration-based sizing via durationToTshirt instead.)
 */
const SIZE_THRESHOLDS = { XS: 5, S: 10, M: 20, L: 35 }; // L+ → XL

/** Map sprint duration → T-shirt size label. */
function durationToTshirt(sprints) {
    for (const [size, min, max] of TSHIRT_RANGES) {
        if (sprints >= min && sprints < max) return size;
    }
    return 'XXL';
}

/** Map story count → T-shirt size label (completed epics only). */
function countToSize(n) {
    if (n <= SIZE_THRESHOLDS.XS) return 'XS';
    if (n <= SIZE_THRESHOLDS.S)  return 'S';
    if (n <= SIZE_THRESHOLDS.M)  return 'M';
    if (n <= SIZE_THRESHOLDS.L)  return 'L';
    return 'XL';
}

module.exports = {
    sprintNumFromName,
    inferStoryCategory,
    DONE_STATUSES, ACTIVE_STATUSES,
    isDone, isActive, detectPhase,
    TSHIRT_RANGES, TSHIRT_SIZES, SIZE_THRESHOLDS,
    durationToTshirt, countToSize,
};
