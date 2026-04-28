'use strict';
/**
 * utils/velocity.js
 *
 * Shared velocity helpers used by both roadmap-routes.js and exec-routes.js.
 * Single source of truth for the effective-velocity formula (CLAUDE.md §6).
 *
 * Exports:
 *   sprintForDate(dateStr, sprints)         — map a date to its sprint
 *   calcFeatureSplit(stories)               — new/maint/tech-debt split
 *   computeVelocityStats(stories, sprints)  — all velocity primitives
 */

const { DONE_STATUSES, isDone, sprintNumFromName, inferStoryCategory } = require('./story-constants');

// Find the sprint a completion date belongs to (sprints sorted by start_date asc).
function sprintForDate(dateStr, sprints) {
    if (!dateStr || !sprints.length) return null;
    const d = new Date(dateStr).getTime();
    for (const s of sprints) {
        if (!s.start_date || !s.end_date) continue;
        const start = new Date(s.start_date).getTime();
        const end   = new Date(s.end_date).getTime() + 86399000; // end of day
        if (d >= start && d <= end) return s;
    }
    return null;
}

// Feature/maintenance/tech-debt split from story labels.
function calcFeatureSplit(stories) {
    let maint = 0, tech = 0, total = stories.length || 1;
    for (const s of stories) {
        const cat = inferStoryCategory(s.data);
        if (cat === 'tech_debt')        tech++;
        else if (cat === 'maintenance') maint++;
    }
    const techPct  = Math.round(tech  / total * 100) / 100;
    const maintPct = Math.round(maint / total * 100) / 100;
    const newPct   = Math.round((1 - techPct - maintPct) * 100) / 100;
    return { new: Math.max(0, newPct), maint: maintPct, tech: techPct };
}

/**
 * Returns all velocity primitives needed by roadmap and exec routes.
 * Implements the CLAUDE.md §6 effective-velocity formula.
 *
 * @returns {{
 *   sprintBuckets:       object,   — per-sprint { stories[], points }
 *   recentKeys:          string[], — last ≤6 sprint names (sorted)
 *   lowConfidence:       boolean,  — fewer than 2 data points
 *   deliveryCounts:      number[], — stories completed per recent sprint
 *   avgStoriesPerSprint: number,
 *   avgPointsPerSprint:  number,
 *   carryOverRate:       number,   — fraction of sprint work not delivered
 *   split:               object,   — { new, maint, tech }
 *   minVelocity:         number,
 *   maxVelocity:         number,
 * }}
 */
function computeVelocityStats(stories, historicalSprints) {
    // Sprint bucketing: map each completed story to the sprint it finished in
    const sprintBuckets = {};
    for (const s of stories) {
        const history     = (s.data?.history ?? []).filter(h => h.field === 'status');
        const doneEvent   = history.find(h => DONE_STATUSES.has((h.to ?? '').toLowerCase().trim()));
        const completedAt = doneEvent?.changedAt
            ?? (isDone(s) ? (s.data?.updatedAt ?? s.created_at ?? null) : null);
        if (!completedAt) continue;
        const sprint = sprintForDate(completedAt, historicalSprints);
        if (!sprint) continue;
        if (!sprintBuckets[sprint.name]) sprintBuckets[sprint.name] = { stories: [], points: 0 };
        sprintBuckets[sprint.name].stories.push(s);
        sprintBuckets[sprint.name].points += Number(s.data?.importedEffort) || 0;
    }

    const recentKeys = Object.keys(sprintBuckets)
        .sort((a, b) => {
            const na = sprintNumFromName(a), nb = sprintNumFromName(b);
            return typeof na === 'number' && typeof nb === 'number'
                ? na - nb : a.localeCompare(b);
        })
        .slice(-6);

    const lowConfidence    = recentKeys.length < 2;
    const deliveryCounts   = recentKeys.map(k => sprintBuckets[k].stories.length);
    const pointsCounts     = recentKeys.map(k => sprintBuckets[k].points);

    const avgStoriesPerSprint = deliveryCounts.length
        ? deliveryCounts.reduce((a, b) => a + b, 0) / deliveryCounts.length
        : Math.max(stories.filter(isDone).length, 1);
    const avgPointsPerSprint  = pointsCounts.length
        ? pointsCounts.reduce((a, b) => a + b, 0) / pointsCounts.length
        : 0;

    // Carry-over rate: per sprint, stories assigned but not done / total assigned
    const sprintAssignment = {};
    for (const s of stories) {
        const sn = s.data?.sprintName;
        if (!sn) continue;
        if (!sprintAssignment[sn]) sprintAssignment[sn] = { planned: 0, done: 0 };
        sprintAssignment[sn].planned++;
        if (isDone(s)) sprintAssignment[sn].done++;
    }
    const carryRates = Object.values(sprintAssignment)
        .filter(b => b.planned > 2) // ignore tiny sprints (noise)
        .map(b => Math.max(0, 1 - b.done / b.planned));
    const carryOverRate = carryRates.length
        ? carryRates.reduce((a, b) => a + b, 0) / carryRates.length
        : 0.15;

    const split = calcFeatureSplit(stories);

    // Min/max raw velocity (used for confidence bounds)
    const minVelocity = deliveryCounts.length
        ? Math.max(1, Math.min(...deliveryCounts))
        : Math.max(1, avgStoriesPerSprint * 0.5);
    const maxVelocity = deliveryCounts.length
        ? Math.max(...deliveryCounts)
        : avgStoriesPerSprint * 1.4;

    return {
        sprintBuckets, recentKeys, lowConfidence, deliveryCounts,
        avgStoriesPerSprint, avgPointsPerSprint,
        carryOverRate, split,
        minVelocity, maxVelocity,
    };
}

module.exports = { sprintForDate, calcFeatureSplit, computeVelocityStats };
