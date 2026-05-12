'use strict';
/**
 * utils/sprint-cron.js
 *
 * Two scheduled jobs:
 *
 * 1. Sprint-end (22:00 UTC daily)
 *    Runs epic prediction for every (user_id, instance_id) whose Jira sprint
 *    ended within the last 24 hours (catch-up window covers missed runs).
 *
 * 2. Change-detection (08:00 UTC daily)
 *    Runs radar analysis for every instance that has new intelligence_entries
 *    since its last full analysis, provided at least 6 hours have passed since
 *    that last analysis (prevents re-trigger loops).
 *
 * Both jobs fire-and-forget per instance — one failure does not block others.
 *
 * Usage: require('./utils/sprint-cron').startCrons()
 */

const cron     = require('node-cron');
const supabase = require('../database/db');
const { runRadarAnalysis, runEpicPrediction, runAgentRadar, runUntrackedDemand } = require('./sprint-end-jobs');
const { compressOldSignals } = require('./signal-compressor');

// Demo account is excluded from all cron jobs — it has seeded data that would
// trigger nightly analysis and burn real Claude API tokens on fictitious content.
const DEMO_USER_ID = 'user_3D4i7FnU8qME3E88vdREjtl09JK';

// ── Signal compression job ────────────────────────────────────────────────────

function scheduleSignalCompression() {
    // 04:00 UTC daily — before agent-radar (06:00) and change-detection (08:00)
    cron.schedule('0 4 * * *', async () => {
        console.log('[sprint-cron] signal-compression check running...');
        try {
            const cutoff = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString();

            // Find distinct (user_id, instance_id) pairs with archivable signals
            const { data: rows, error } = await supabase
                .from('intelligence_entries')
                .select('user_id, instance_id')
                .lt('created_at', cutoff)
                .is('archived_at', null);

            if (error) { console.error('[sprint-cron] compression query error:', error.message); return; }
            if (!rows?.length) return;

            // Deduplicate
            const seen    = new Set();
            const targets = rows.filter(r => {
                const key = `${r.user_id}:${r.instance_id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            console.log(`[sprint-cron] compressing signals for ${targets.length} instance(s)`);
            for (const { user_id, instance_id } of targets) {
                compressOldSignals(supabase, user_id, instance_id)
                    .then(({ created, archived }) => {
                        if (created || archived) {
                            console.log(`[sprint-cron] compression ${user_id}/${instance_id}: created=${created} archived=${archived}`);
                        }
                    })
                    .catch(err => console.error(`[sprint-cron] compression failed ${user_id}/${instance_id}:`, err.message));
            }
        } catch (err) {
            console.error('[sprint-cron] signal-compression error:', err.message);
        }
    }, { timezone: 'UTC' });
}

// ── Sprint-end job ────────────────────────────────────────────────────────────

function scheduleSprintEndJobs() {
    // 22:00 UTC daily
    cron.schedule('0 22 * * *', async () => {
        console.log('[sprint-cron] sprint-end check running...');
        try {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const today     = new Date().toISOString().split('T')[0];

            const { data: sprints, error } = await supabase
                .from('sprints')
                .select('user_id, instance_id')
                .gte('end_date', yesterday)
                .lte('end_date', today);

            if (error) { console.error('[sprint-cron] sprint query error:', error.message); return; }
            if (!sprints?.length) return;

            // Deduplicate (user_id, instance_id) pairs
            const seen    = new Set();
            const targets = sprints.filter(s => {
                const key = `${s.user_id}:${s.instance_id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const filtered = targets.filter(t => t.user_id !== DEMO_USER_ID);
            console.log(`[sprint-cron] triggering epic prediction for ${filtered.length} instance(s)`);
            for (const { user_id, instance_id } of filtered) {
                runEpicPrediction(supabase, user_id, instance_id)
                    .catch(err => console.error(`[sprint-cron] epic prediction failed ${user_id}/${instance_id}:`, err.message));
            }
        } catch (err) {
            console.error('[sprint-cron] sprint-end error:', err.message);
        }
    }, { timezone: 'UTC' });
}

// ── Change-detection job ──────────────────────────────────────────────────────

function scheduleChangeDetection() {
    const MIN_GAP_MS = 6 * 60 * 60 * 1000; // 6 hours

    // 08:00 UTC daily
    cron.schedule('0 8 * * *', async () => {
        console.log('[sprint-cron] change-detection check running...');
        try {
            // Fetch all intelligence_entries ordered desc — one query, deduplicate in memory
            const { data: entryRows, error: eErr } = await supabase
                .from('intelligence_entries')
                .select('user_id, instance_id, created_at')
                .order('created_at', { ascending: false });

            if (eErr) { console.error('[sprint-cron] entries query error:', eErr.message); return; }
            if (!entryRows?.length) return;

            // Build map of latest entry per instance
            const latestEntry = new Map();
            for (const row of entryRows) {
                const key = `${row.user_id}:${row.instance_id}`;
                if (!latestEntry.has(key)) latestEntry.set(key, row);
            }

            const now = Date.now();
            for (const [, entry] of latestEntry) {
                const { user_id, instance_id, created_at: latestEntryDate } = entry;

                if (user_id === DEMO_USER_ID) continue;

                // Get latest radar analysis for this instance
                const { data: latestAnalysis } = await supabase
                    .from('analysis_history')
                    .select('created_at')
                    .eq('user_id', user_id)
                    .eq('instance_id', instance_id)
                    .like('filename', 'radar-%')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const lastAnalyzedAt = latestAnalysis?.created_at ? new Date(latestAnalysis.created_at) : null;

                // Skip if no new entries since last analysis
                if (lastAnalyzedAt && new Date(latestEntryDate) <= lastAnalyzedAt) continue;

                // Skip if last analysis was less than 6 hours ago (prevent rapid re-triggers)
                if (lastAnalyzedAt && now - lastAnalyzedAt.getTime() < MIN_GAP_MS) continue;

                runRadarAnalysis(supabase, user_id, instance_id)
                    .then(() => runUntrackedDemand(supabase, user_id, instance_id))
                    .catch(err => console.error(`[sprint-cron] radar/untracked failed ${user_id}/${instance_id}:`, err.message));
            }
        } catch (err) {
            console.error('[sprint-cron] change-detection error:', err.message);
        }
    }, { timezone: 'UTC' });
}

// ── Agent Radar job ───────────────────────────────────────────────────────────

function scheduleAgentRadar() {
    const MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20 hours

    // 06:00 UTC daily — before the change-detection run
    cron.schedule('0 6 * * *', async () => {
        console.log('[sprint-cron] agent-radar check running...');
        try {
            const { data: entryRows, error: eErr } = await supabase
                .from('intelligence_entries')
                .select('user_id, instance_id, created_at')
                .order('created_at', { ascending: false });

            if (eErr) { console.error('[sprint-cron] agent-radar entries error:', eErr.message); return; }
            if (!entryRows?.length) return;

            // Latest entry per instance
            const latestEntry = new Map();
            for (const row of entryRows) {
                const key = `${row.user_id}:${row.instance_id}`;
                if (!latestEntry.has(key)) latestEntry.set(key, row);
            }

            const now = Date.now();
            for (const [, entry] of latestEntry) {
                const { user_id, instance_id, created_at: latestEntryDate } = entry;

                if (user_id === DEMO_USER_ID) continue;

                const { data: lastRun } = await supabase
                    .from('analysis_history')
                    .select('created_at')
                    .eq('user_id', user_id).eq('instance_id', instance_id)
                    .eq('analysis_type', 'agent_radar')
                    .order('created_at', { ascending: false })
                    .limit(1).maybeSingle();

                const lastRunAt = lastRun?.created_at ? new Date(lastRun.created_at) : null;

                // Skip if no new entries since last run
                if (lastRunAt && new Date(latestEntryDate) <= lastRunAt) continue;

                // Skip if last run was less than 20 hours ago
                if (lastRunAt && now - lastRunAt.getTime() < MIN_GAP_MS) continue;

                runAgentRadar(supabase, user_id, instance_id, 'batch')
                    .catch(err => console.error(`[sprint-cron] agent-radar failed ${user_id}/${instance_id}:`, err.message));
            }
        } catch (err) {
            console.error('[sprint-cron] agent-radar error:', err.message);
        }
    }, { timezone: 'UTC' });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function startCrons() {
    scheduleSignalCompression();
    scheduleSprintEndJobs();
    scheduleAgentRadar();
    scheduleChangeDetection();
    console.log('[sprint-cron] scheduled: signal-compression (04:00 UTC) + sprint-end (22:00 UTC) + agent-radar (06:00 UTC) + change-detection (08:00 UTC)');
}

module.exports = { startCrons };
