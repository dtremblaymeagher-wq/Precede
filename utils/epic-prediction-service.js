'use strict';
/**
 * utils/epic-prediction-service.js
 *
 * Pure helpers and AI functions for epic prediction.
 * Extracted from routes/epic-prediction-routes.js so they can be shared
 * with the sprint-end cron (sprint-end-jobs.js) without importing a route file.
 *
 * Exports: EPIC_TYPES, epicComplete, storyHash, byEpic, parseJsonResponse,
 *          categorizeCompleted, matchActiveEpics
 */

const { isDone, detectPhase, sprintNumFromName } = require('./story-constants');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts = require('../shared/prompts');

const EPIC_TYPES = ['feature', 'integration', 'refactor', 'ux', 'data', 'infra', 'security'];

function epicComplete(stories) {
    if (!stories.length) return false;
    const donePct   = stories.filter(isDone).length / stories.length;
    const hasActive = stories.some(s => !isDone(s) && (s.data?.sprintState ?? '').toLowerCase() === 'active');
    return donePct >= 0.9 && !hasActive;
}

/** Deterministic fingerprint — skip recalc when unchanged */
function storyHash(stories) {
    const labels = [...new Set(stories.flatMap(s => s.data?.labels ?? []))].sort().join(',');
    const raw    = `${stories.length}|${stories.filter(isDone).length}|${labels}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = Math.imul(31, h) + raw.charCodeAt(i) | 0; }
    return (h >>> 0).toString(16);
}

/** Group story rows by epic. Returns Map<epicKey, { epicKey, epicName, stories[] }> */
function byEpic(stories) {
    const map = new Map();
    for (const s of stories) {
        const key  = s.data?.epicKey ?? s.data?.epicName ?? null;
        if (!key) continue;
        const name = s.data?.epicName ?? key;
        if (!map.has(key)) map.set(key, { epicKey: key, epicName: name, stories: [] });
        map.get(key).stories.push(s);
    }
    return map;
}

/** Parse JSON array/object from Claude's raw text response */
function parseJsonResponse(text) {
    const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (!match) throw new Error('Claude returned no JSON');
    return JSON.parse(match[0]);
}

/**
 * Categorize a batch of completed epics in one Claude call.
 * Returns [{ epicKey, tshirt_size, epic_type, rationale }]
 */
async function categorizeCompleted(epics, req, batchId) {
    const epicList = epics.map(e => ({
        epicKey:       e.epicKey,
        epicName:      e.epicName,
        finalStories:  e.stories.length,
        scopeCreepPct: (() => {
            const indices = e.stories.map(s => {
                const id = Number(s.data?.sprintId);
                if (!isNaN(id) && id > 0) return id;
                return sprintNumFromName(s.data?.sprintName);
            }).filter(v => v !== null);
            if (!indices.length) return 0;
            const min  = Math.min(...indices);
            const thr  = min + Math.max(1, (Math.max(...indices) - min) * 0.10);
            const init = indices.filter(v => v <= thr).length;
            return init > 0 ? Math.round(((e.stories.length - init) / init) * 100) : 0;
        })(),
        sampleTitles: e.stories.slice(0, 6).map(s => s.data?.title ?? '').filter(Boolean),
        labels:       [...new Set(e.stories.flatMap(s => s.data?.labels ?? []))].slice(0, 8),
    }));

    const rawText = await callAI({
        model:        MODELS.sonnet,
        maxTokens:    1500,
        messages:     [{ role: 'user', content: prompts.buildEpicCategorizePrompt({ epicList }) }],
        callType:     'epic_categorize',
        req,
        deliveryMode: 'batch',
        batchId,
    });
    const result = parseJsonResponse(rawText);
    if (!Array.isArray(result)) throw new Error('Categorization: expected array');
    return result;
}

/**
 * Match active epics against categorized completed epics, and project scope creep.
 * Returns [{ epicKey, confidence_level, matched_epic_keys, scope_projection, tshirt_size, epic_type, rationale }]
 */
async function matchActiveEpics(activeEpics, completedPredictions, req, batchId) {
    if (!activeEpics.length) return [];

    const historicalContext = completedPredictions.map(p => ({
        epicKey:         p.epic_key,
        epicName:        p.epic_name,
        tshirt_size:     p.tshirt_override ?? p.tshirt_size,
        epic_type:       p.type_override   ?? p.epic_type,
        scopeCreepPct:   p.scope_projection?.creepPct ?? 0,
        durationSprints: p.scope_projection?.durationSprints ?? null,
    }));

    const activeContext = activeEpics.map(e => ({
        epicKey:        e.epicKey,
        epicName:       e.epicName,
        currentStories: e.stories.length,
        doneStories:    e.stories.filter(isDone).length,
        phase:          detectPhase(e.stories),
        sampleTitles:   e.stories.slice(0, 6).map(s => s.data?.title ?? '').filter(Boolean),
        labels:         [...new Set(e.stories.flatMap(s => s.data?.labels ?? []))].slice(0, 8),
    }));

    const rawText = await callAI({
        model:        MODELS.sonnet,
        maxTokens:    2000,
        messages:     [{ role: 'user', content: prompts.buildEpicMatchPrompt({ historicalContext, activeContext }) }],
        callType:     'epic_match',
        req,
        deliveryMode: 'batch',
        batchId,
    });
    const result = parseJsonResponse(rawText);
    if (!Array.isArray(result)) throw new Error('Matching: expected array');
    return result;
}

module.exports = {
    EPIC_TYPES,
    epicComplete,
    storyHash,
    byEpic,
    parseJsonResponse,
    categorizeCompleted,
    matchActiveEpics,
};
