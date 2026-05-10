'use strict';
/**
 * utils/analyze-helpers.js
 *
 * Shared helpers for the decomposed /api/analyze/* routes.
 * Pure functions + thin DB wrappers — no Express, no Claude calls.
 */

const supabase = require('../database/db');

// ── instanceSelect (same pattern as server.js) ────────────────────────────────
const instanceSelect = (table, cols, userId, instanceId) =>
    supabase.from(table).select(cols).eq('user_id', userId).eq('instance_id', instanceId);

// ── Temporal weighting ────────────────────────────────────────────────────────
function getTemporalWeight(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date)) return 'medium';
    const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 14) return 'high';
    if (daysAgo <= 60) return 'medium';
    return 'background';
}

function bucketByWeight(entries) {
    const weighted = entries.map(e => ({ ...e, _weight: getTemporalWeight(e.date || e.createdAt) }));
    return {
        high:       weighted.filter(e => e._weight === 'high'),
        medium:     weighted.filter(e => e._weight === 'medium'),
        background: weighted.filter(e => e._weight === 'background'),
    };
}

// ── Data loaders ──────────────────────────────────────────────────────────────
async function loadEntries(userId, instanceId) {
    const { data, error } = await instanceSelect('intelligence_entries', 'data', userId, instanceId)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
    if (error) throw new Error('Failed to load Hub entries: ' + error.message);
    return (data ?? []).map(row => row.data);
}

async function loadSignalSummaries(userId, instanceId) {
    try {
        const { data } = await instanceSelect(
            'signal_summaries',
            'summary_id, period_start, period_end, summary, signal_count',
            userId, instanceId
        )
            .eq('period_type', 'monthly')
            .order('period_start', { ascending: true });
        return data ?? [];
    } catch (_) { return []; }
}

async function loadContext(userId, instanceId) {
    const ctx = { vision: 'Not defined', okrs: [], personas: 'Not defined' };
    try {
        const { data: visionRow } = await instanceSelect('vision', 'data', userId, instanceId).single();
        if (visionRow?.data?.vision) ctx.vision = visionRow.data.vision;
    } catch (_) { /* non-fatal */ }
    try {
        const { data: settingsRow } = await instanceSelect('settings', 'data', userId, instanceId).single();
        const s = settingsRow?.data;
        if (s) {
            ctx.okrs     = s.objectives || [];
            ctx.personas = s.personas ? s.personas.map(p => p.name).join(', ') : ctx.personas;
        }
    } catch (_) { /* non-fatal */ }
    return ctx;
}

async function loadSprintMemory(userId, instanceId) {
    try {
        const { data } = await instanceSelect('radar_memory', 'data', userId, instanceId).single();
        return data?.data ?? null;
    } catch (_) { return null; }
}

async function getSprintStats(userId, instanceId) {
    try {
        const { data } = await instanceSelect('analysis_history', 'created_at', userId, instanceId)
            .like('filename', 'radar-%')
            .order('created_at', { ascending: true });
        if (!data?.length) return { count: 0, oldestDaysAgo: 0 };
        const oldestDaysAgo = (Date.now() - new Date(data[0].created_at).getTime()) / (1000 * 60 * 60 * 24);
        return { count: data.length, oldestDaysAgo };
    } catch (_) { return { count: 0, oldestDaysAgo: 0 }; }
}

async function loadHistoricalSnapshots(userId, instanceId) {
    try {
        const { data } = await instanceSelect('analysis_history', 'data, created_at', userId, instanceId)
            .like('filename', 'radar-%')
            .order('created_at', { ascending: true });
        return (data ?? []).map(row => {
            try {
                const analysis = row.data.analysis || row.data;
                return {
                    date:          new Date(row.created_at).toISOString().split('T')[0],
                    summary:       analysis.summary || '',
                    trends:        (analysis.trends || []).map(t => ({ topic: t.topic, alignment: t.strategic_alignment, evolution: t.evolution })),
                    opportunities: (analysis.opportunities || []).map(o => o.title || o),
                    risks:         (analysis.risks || []).map(r => r.title || r),
                };
            } catch (_) { return null; }
        }).filter(Boolean);
    } catch (_) { return []; }
}

// ── Persistence helpers ───────────────────────────────────────────────────────
async function saveAnalysis(userId, instanceId, analysisType, payload) {
    const fileName = `${analysisType}-${Date.now()}.json`;
    const { error } = await supabase
        .from('analysis_history')
        .insert({ user_id: userId, instance_id: instanceId, filename: fileName, data: payload, analysis_type: analysisType });
    if (error) console.error(`❌ analyze-helpers saveAnalysis [${analysisType}]:`, error.message);
    return fileName;
}

// ── JSON parse helper ─────────────────────────────────────────────────────────
function parseJSON(rawText) {
    const match = rawText?.match(/[\[{][\s\S]*/);
    if (!match) throw new Error('AI response contained no JSON');
    return JSON.parse(match[0]);
}

module.exports = {
    getTemporalWeight,
    bucketByWeight,
    loadEntries,
    loadSignalSummaries,
    loadContext,
    loadSprintMemory,
    getSprintStats,
    loadHistoricalSnapshots,
    saveAnalysis,
    parseJSON,
};
