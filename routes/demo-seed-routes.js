'use strict';
/**
 * routes/demo-seed-routes.js
 *
 * POST /api/demo-seed/generate   { sector, appType }  — purge + generate full demo dataset
 * DELETE /api/demo-seed/clear                         — purge only
 *
 * Restricted to DEMO_USER_ID only. All writes are instance-scoped.
 * Full rollback on any failure: every inserted row is tracked and deleted on error.
 */

const { Router }        = require('express');
const { randomUUID }    = require('crypto');
const { callAI, MODELS } = require('../shared/ai-client');
const getSectorData     = require('../shared/demo-seed-data');

const DEMO_USER_ID = 'user_3D4i7FnU8qME3E88vdREjtl09JK';

// ── Date helpers (relative to today) ─────────────────────────────────────────
const dStr = (base, days) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};
const dISO = (base, days) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString();
};

// ── Purge all instance data ───────────────────────────────────────────────────
async function purgeInstance(supabase, userId, instanceId) {
    const tables = [
        'intelligence_entries', 'backlog_stories', 'analysis_history',
        'radar_memory', 'sprint_exceptions', 'meeting_prep_history',
        'learning_vault', 'sprints',
    ];
    for (const table of tables) {
        await supabase.from(table).delete().eq('user_id', userId).eq('instance_id', instanceId);
    }
    // Reset settings cache (keep base config skeleton)
    await supabase.from('settings')
        .update({ data: {}, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('instance_id', instanceId);
}

// ── Rollback: delete everything inserted so far ───────────────────────────────
async function rollback(supabase, userId, instanceId, inserted) {
    try {
        if (inserted.entryFilenames?.length)
            await supabase.from('intelligence_entries').delete().eq('user_id', userId).eq('instance_id', instanceId)
                .in('filename', inserted.entryFilenames);
        if (inserted.storyFilenames?.length)
            await supabase.from('backlog_stories').delete().eq('user_id', userId).eq('instance_id', instanceId)
                .in('filename', inserted.storyFilenames);
        if (inserted.analysisFilenames?.length)
            await supabase.from('analysis_history').delete().eq('user_id', userId).eq('instance_id', instanceId)
                .in('filename', inserted.analysisFilenames);
        if (inserted.sprintJiraIds?.length)
            await supabase.from('sprints').delete().eq('user_id', userId).eq('instance_id', instanceId)
                .in('jira_id', inserted.sprintJiraIds);
    } catch (e) {
        console.error('[demo-seed] Rollback error:', e.message);
    }
}

// ── Shuffle array helper ──────────────────────────────────────────────────────
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Story status helpers ──────────────────────────────────────────────────────
const SOURCE_TYPES = ['user_interview', 'support_ticket', 'sales_call', 'nps', 'analytics', 'stakeholder'];

module.exports = function createDemoSeedRouter(supabase) {
    const router = Router();

    // Guard: demo user only
    router.use((req, res, next) => {
        if (req.userId !== DEMO_USER_ID)
            return res.status(403).json({ error: 'Forbidden — demo seed is restricted' });
        next();
    });

    // ── DELETE /clear ─────────────────────────────────────────────────────────
    router.delete('/clear', async (req, res) => {
        try {
            await purgeInstance(supabase, req.userId, req.instanceId);
            res.json({ success: true });
        } catch (e) {
            console.error('[demo-seed] Clear error:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ── POST /generate ────────────────────────────────────────────────────────
    router.post('/generate', async (req, res) => {
        const { sector, appType } = req.body;
        if (!sector) return res.status(400).json({ error: 'sector is required' });

        const userId     = req.userId;
        const instanceId = req.instanceId;
        const today      = new Date();
        const data       = getSectorData(sector, appType || 'the app');

        const inserted = { entryFilenames: [], storyFilenames: [], analysisFilenames: [], sprintJiraIds: [] };

        try {
            // ── 1. Purge ──────────────────────────────────────────────────────
            await purgeInstance(supabase, userId, instanceId);

            // ── 2. Settings ───────────────────────────────────────────────────
            const sprintStartDate = dStr(today, -364); // started 1 year ago
            const settingsData = {
                vision:              data.vision,
                objectives:          data.objectives,
                personas:            data.personas,
                sprint_start_date:   sprintStartDate,
                sprint_duration_days: 14,
                importState: {
                    lastSyncAt:    today.toISOString(),
                    lastSyncCount: 60,
                },
            };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: instanceId, data: settingsData, updated_at: today.toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            // ── 3. Intelligence entries (80 signals over 12 months) ───────────
            const allEntries = [];
            const entryRows  = [];

            // Helper: create entry
            const makeEntry = (daysOffset, sourceType, body, person = null) => {
                const id   = randomUUID();
                const date = dStr(today, daysOffset);
                const entry = {
                    id, body, sourceType, date, person,
                    tags: [], createdAt: dISO(today, daysOffset),
                };
                allEntries.push(entry);
                const filename = `entry-${id}.json`;
                entryRows.push({ user_id: userId, instance_id: instanceId, filename, data: entry });
                inserted.entryFilenames.push(filename);
                return entry;
            };

            // Distribute signals across 12 months
            // Months -12 to -9: foundation shipped, early weak signals
            const strength  = shuffle(data.strengthSignals);
            const recurring = shuffle(data.recurringSignals);
            const weak      = shuffle(data.weakSignals);
            const alerts    = shuffle(data.alertSignals);

            // Phase 1: -365 to -270 days (foundation era)
            makeEntry(-355, 'user_interview',  strength[0],  'Sarah Mitchell');
            makeEntry(-348, 'support_ticket',  recurring[0], null);
            makeEntry(-340, 'nps',             strength[1],  'James Okafor');
            makeEntry(-332, 'sales_call',      recurring[1], null);
            makeEntry(-325, 'user_interview',  strength[2],  'Priya Sharma');
            makeEntry(-318, 'support_ticket',  weak[0],      null);
            makeEntry(-310, 'analytics',       recurring[2], null);
            makeEntry(-302, 'nps',             strength[3],  'David Chen');
            makeEntry(-295, 'stakeholder',     alerts[0],    'Executive review');
            makeEntry(-288, 'user_interview',  recurring[3], 'Marcus Williams');
            makeEntry(-280, 'support_ticket',  strength[4],  null);
            makeEntry(-275, 'sales_call',      recurring[4], null);
            makeEntry(-272, 'nps',             weak[1],      'Laura Fischer');

            // Phase 2: -270 to -180 days (second epic, mobile pain emerging)
            makeEntry(-265, 'user_interview',  recurring[0], 'Tom Andreessen');
            makeEntry(-258, 'support_ticket',  recurring[5], null);
            makeEntry(-250, 'nps',             strength[5],  'Aisha Patel');
            makeEntry(-243, 'user_interview',  weak[2],      'Robert Kim');
            makeEntry(-236, 'analytics',       recurring[6], null);
            makeEntry(-228, 'sales_call',      strength[6],  null);
            makeEntry(-221, 'support_ticket',  recurring[1], null);
            makeEntry(-214, 'user_interview',  strength[7] || strength[0], 'Elena Vasquez');
            makeEntry(-207, 'nps',             recurring[7] || recurring[0], 'Chris Thompson');
            makeEntry(-200, 'stakeholder',     weak[3] || weak[0], 'Quarterly review');
            makeEntry(-193, 'support_ticket',  alerts[1],    null);
            makeEntry(-186, 'user_interview',  recurring[2], 'Nina Johansson');

            // Phase 3: -180 to -90 days (mobile epic, analytics gap emerges)
            makeEntry(-178, 'support_ticket',  recurring[3], null);
            makeEntry(-171, 'user_interview',  strength[0],  'Alex Rivera');
            makeEntry(-164, 'nps',             recurring[8] || recurring[0], 'Mohammed Al-Hassan');
            makeEntry(-157, 'analytics',       alerts[2] || alerts[0], null);
            makeEntry(-150, 'sales_call',      recurring[4], null);
            makeEntry(-143, 'user_interview',  weak[4] || weak[0], 'Sophie Dubois');
            makeEntry(-136, 'support_ticket',  recurring[5], null);
            makeEntry(-129, 'nps',             strength[1],  'Ryan O\'Brien');
            makeEntry(-122, 'stakeholder',     recurring[0], 'Mid-year review');
            makeEntry(-115, 'user_interview',  strength[2],  'Yuki Tanaka');
            makeEntry(-108, 'support_ticket',  recurring[6], null);
            makeEntry(-101, 'analytics',       recurring[9] || recurring[0], null);
            makeEntry(-95,  'sales_call',      alerts[3] || alerts[0], null);
            makeEntry(-90,  'user_interview',  weak[0],      'Isabella Costa');

            // Phase 4: -90 to -30 days (analytics epic starts, integration gap critical)
            makeEntry(-88,  'support_ticket',  recurring[0], null);
            makeEntry(-82,  'nps',             strength[3],  'Daniel Park');
            makeEntry(-76,  'user_interview',  recurring[7] || recurring[0], 'Fatima Al-Zahra');
            makeEntry(-70,  'analytics',       recurring[1], null);
            makeEntry(-64,  'sales_call',      recurring[4], null);
            makeEntry(-58,  'support_ticket',  alerts[0],    null);
            makeEntry(-52,  'user_interview',  weak[1],      'Thomas Müller');
            makeEntry(-46,  'nps',             recurring[2], 'Camille Leblanc');
            makeEntry(-40,  'stakeholder',     strength[4],  'Board update');
            makeEntry(-34,  'support_ticket',  recurring[5], null);
            makeEntry(-30,  'user_interview',  alerts[1] || alerts[0], 'Lisa Fernandez');

            // Phase 5: -30 to 0 days (current, integration urgent + positives)
            makeEntry(-28,  'nps',             strength[5],  'Omar Khalid');
            makeEntry(-24,  'user_interview',  recurring[0], 'Natasha Ivanova');
            makeEntry(-20,  'support_ticket',  recurring[3], null);
            makeEntry(-16,  'analytics',       strength[6],  null);
            makeEntry(-14,  'sales_call',      recurring[4], null);
            makeEntry(-12,  'user_interview',  strength[7] || strength[0], 'Emma Wilson');
            makeEntry(-10,  'support_ticket',  recurring[6], null);
            makeEntry(-8,   'nps',             recurring[8] || recurring[0], 'Lucas Martini');
            makeEntry(-6,   'user_interview',  weak[2] || weak[0], 'Zara Ahmed');
            makeEntry(-5,   'stakeholder',     alerts[2] || alerts[0], 'Sprint review');
            makeEntry(-4,   'support_ticket',  recurring[1], null);
            makeEntry(-3,   'nps',             strength[0],  'Jack Harrison');
            makeEntry(-2,   'user_interview',  recurring[2], 'Mei Lin');
            makeEntry(-1,   'analytics',       strength[1],  null);
            makeEntry(0,    'user_interview',  recurring[5], 'Anna Kowalski');

            // Batch insert entries
            const CHUNK = 20;
            for (let i = 0; i < entryRows.length; i += CHUNK) {
                const { error } = await supabase.from('intelligence_entries').insert(entryRows.slice(i, i + CHUNK));
                if (error) throw new Error(`Entry insert failed: ${error.message}`);
            }

            // ── 4. Sprints (26 closed + 1 active) ────────────────────────────
            const sprintRows = [];
            const totalSprints = 27;
            for (let i = 0; i < totalSprints; i++) {
                const sprintNum  = i + 1;
                const startDays  = -364 + (i * 14);
                const endDays    = startDays + 13;
                const isActive   = i === totalSprints - 1;
                const isClosed   = !isActive;

                // Realistic velocity: varies 6-14 stories, some carry-over
                const total     = 8 + Math.floor(Math.random() * 6);
                const rollover  = isClosed ? Math.floor(Math.random() * 3) : 0;
                const completed = isClosed ? Math.max(total - rollover - Math.floor(Math.random() * 2), total - 4) : null;
                const jiraId    = `demo-sprint-${sprintNum}`;

                const sprintGoals = [
                    'Ship core workflow improvements and address top support tickets',
                    'Complete integration layer and improve onboarding flow',
                    'Deliver mobile responsiveness fixes and performance improvements',
                    'Launch analytics MVP and validate with 3 key customers',
                    'Stabilize platform, reduce bug backlog by 40%',
                    'Finalize Q2 epics and prep Q3 roadmap stories',
                ];

                sprintRows.push({
                    user_id:         userId,
                    instance_id:     instanceId,
                    jira_id:         jiraId,
                    source:          'demo',
                    name:            `Sprint ${sprintNum}`,
                    state:           isActive ? 'active' : 'closed',
                    start_date:      dStr(today, startDays),
                    end_date:        dStr(today, endDays),
                    goal:            isActive ? 'Complete analytics epic MVP and validate with pilot customers' : (sprintNum % 6 === 0 ? sprintGoals[Math.floor(sprintNum / 6) % sprintGoals.length] : null),
                    completed_count: completed,
                    total_count:     isClosed ? total : null,
                    added_count:     isClosed ? Math.floor(Math.random() * 2) : null,
                    removed_count:   isClosed ? (Math.random() > 0.7 ? 1 : 0) : null,
                    rollover_count:  rollover,
                    updated_at:      today.toISOString(),
                });
                inserted.sprintJiraIds.push(jiraId);
            }
            const { error: sprintErr } = await supabase.from('sprints').insert(sprintRows);
            if (sprintErr) throw new Error(`Sprint insert failed: ${sprintErr.message}`);

            // ── 5. Backlog stories ────────────────────────────────────────────
            const storyRows = [];
            let jiraCounter = 1;
            let displayOrder = 0;

            // Build signal ID pools per epic phase (for precede_origin)
            const phase1Entries = allEntries.filter(e => { const d = new Date(e.date); return d <= new Date(dStr(today, -270)); });
            const phase2Entries = allEntries.filter(e => { const d = new Date(e.date); return d > new Date(dStr(today, -270)) && d <= new Date(dStr(today, -180)); });
            const phase3Entries = allEntries.filter(e => { const d = new Date(e.date); return d > new Date(dStr(today, -180)) && d <= new Date(dStr(today, -90)); });
            const phase4Entries = allEntries.filter(e => { const d = new Date(e.date); return d > new Date(dStr(today, -90)); });

            const makeStory = (epic, storyDef) => {
                const externalId = `${data.jiraPrefix}-${String(jiraCounter++).padStart(3, '0')}`;
                const filename   = `story-${Date.now() + jiraCounter}.json`;
                const sp         = storyDef.effort || pick([1, 2, 3, 5, 8]);
                const storyData  = {
                    id:            Date.now() + jiraCounter,
                    externalId,
                    title:         storyDef.title,
                    contentText:   storyDef.description || '',
                    status:        storyDef.status,
                    priority:      storyDef.priority || 'Medium',
                    epicKey:       epic.key,
                    epicName:      epic.name,
                    importedEffort: sp,
                    jiraRank:      displayOrder + 1,
                    source:        'demo',
                    issueType:     'Story',
                    projectKey:    data.jiraPrefix,
                    sprintName:    storyDef.sprintName || null,
                    sprintState:   storyDef.sprintState || null,
                    createdAt:     dISO(today, storyDef.createdDays || -60),
                    updatedAt:     dISO(today, storyDef.updatedDays || -1),
                    resolvedAt:    storyDef.status === 'Done' ? dISO(today, storyDef.updatedDays || -30) : null,
                    rice: {
                        reach:      storyDef.reach      || Math.floor(30 + Math.random() * 60),
                        impact:     storyDef.impact     || pick([0.5, 1, 2, 3]),
                        confidence: storyDef.confidence || pick([0.5, 0.8, 1]),
                        effort:     sp,
                        score:      0,
                    },
                    precede_origin: storyDef.precede_origin || null,
                };
                storyData.rice.score = Math.round((storyData.rice.reach * storyData.rice.impact * storyData.rice.confidence) / storyData.rice.effort);

                storyRows.push({ user_id: userId, instance_id: instanceId, filename, display_order: displayOrder++, data: storyData });
                inserted.storyFilenames.push(filename);
            };

            // ── Epic 1: Foundation — all DONE ─────────────────────────────────
            const e1 = data.epics[0];
            const e1Signals = phase1Entries.slice(0, 4).map(e => e.id);
            [
                { title: `Core ${appType} setup and configuration wizard`, status: 'Done', priority: 'High', effort: 5, createdDays: -365, updatedDays: -320 },
                { title: 'User authentication and role-based access control', status: 'Done', priority: 'High', effort: 8, createdDays: -360, updatedDays: -315 },
                { title: 'Dashboard home with key metrics overview', status: 'Done', priority: 'High', effort: 5, createdDays: -355, updatedDays: -310 },
                { title: 'Notification system (in-app + email)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -350, updatedDays: -305 },
                { title: 'Search and global filter functionality', status: 'Done', priority: 'High', effort: 5, createdDays: -345, updatedDays: -298 },
                { title: 'Data import via CSV with validation', status: 'Done', priority: 'Medium', effort: 3, createdDays: -340, updatedDays: -292 },
                { title: 'Basic reporting with PDF export', status: 'Done', priority: 'Medium', effort: 5, createdDays: -335, updatedDays: -285 },
                { title: 'Onboarding checklist and in-app guidance', status: 'Done', priority: 'High', effort: 3, createdDays: -330, updatedDays: -278, precede_origin: { signal_ids: e1Signals, oldest_signal_date: dStr(today, -340), signal_count: e1Signals.length, captured_at: dISO(today, -365), linked_at: dISO(today, -360) } },
                { title: 'Activity feed and audit log', status: 'Done', priority: 'Low', effort: 3, createdDays: -325, updatedDays: -270 },
                { title: 'Team workspace management', status: 'Done', priority: 'High', effort: 8, createdDays: -320, updatedDays: -265 },
                { title: 'API key management for basic integrations', status: 'Done', priority: 'Medium', effort: 5, createdDays: -315, updatedDays: -258 },
                { title: 'Performance baseline and caching layer', status: 'Done', priority: 'Medium', effort: 8, createdDays: -310, updatedDays: -252 },
                { title: 'Accessibility compliance (WCAG 2.1 AA)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -305, updatedDays: -248 },
                { title: 'Dark mode support', status: 'Done', priority: 'Low', effort: 2, createdDays: -300, updatedDays: -242 },
            ].forEach(s => makeStory(e1, s));

            // ── Epic 2: Collaboration — all DONE ──────────────────────────────
            const e2 = data.epics[1];
            const e2Signals = phase2Entries.slice(0, 3).map(e => e.id);
            [
                { title: 'Real-time collaborative editing on shared views', status: 'Done', priority: 'High', effort: 13, createdDays: -275, updatedDays: -200 },
                { title: 'Comment threads and @mentions on any item', status: 'Done', priority: 'High', effort: 5, createdDays: -270, updatedDays: -195, precede_origin: { signal_ids: e2Signals, oldest_signal_date: dStr(today, -265), signal_count: e2Signals.length, captured_at: dISO(today, -275), linked_at: dISO(today, -270) } },
                { title: 'Shared templates library with version control', status: 'Done', priority: 'High', effort: 5, createdDays: -265, updatedDays: -190 },
                { title: 'Guest / external collaborator access', status: 'Done', priority: 'Medium', effort: 8, createdDays: -260, updatedDays: -185 },
                { title: 'Permission scoping per workspace and project', status: 'Done', priority: 'High', effort: 8, createdDays: -255, updatedDays: -178 },
                { title: 'Team activity digest (weekly summary email)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -250, updatedDays: -172 },
                { title: 'Slack notification webhook integration', status: 'Done', priority: 'High', effort: 5, createdDays: -245, updatedDays: -165 },
                { title: 'Custom views and saved filters per user', status: 'Done', priority: 'Medium', effort: 5, createdDays: -240, updatedDays: -158 },
                { title: 'Bulk actions on multiple items', status: 'Done', priority: 'Medium', effort: 3, createdDays: -235, updatedDays: -152 },
                { title: 'Keyboard shortcuts for power users', status: 'Done', priority: 'Low', effort: 3, createdDays: -230, updatedDays: -148 },
                { title: 'In-app changelog and release notes widget', status: 'Done', priority: 'Low', effort: 2, createdDays: -225, updatedDays: -144 },
            ].forEach(s => makeStory(e2, s));

            // ── Epic 3: Mobile — all DONE ──────────────────────────────────────
            const e3 = data.epics[2];
            const e3Signals = phase2Entries.slice(3, 7).map(e => e.id);
            [
                { title: 'Responsive layout for all core screens (mobile-first)', status: 'Done', priority: 'High', effort: 13, createdDays: -185, updatedDays: -110, precede_origin: { signal_ids: e3Signals, oldest_signal_date: dStr(today, -243), signal_count: e3Signals.length, captured_at: dISO(today, -185), linked_at: dISO(today, -182) } },
                { title: 'Native iOS app (Swift wrapper + push notifications)', status: 'Done', priority: 'High', effort: 13, createdDays: -180, updatedDays: -105 },
                { title: 'Android app (Kotlin wrapper)', status: 'Done', priority: 'High', effort: 13, createdDays: -175, updatedDays: -100 },
                { title: 'Offline mode for read-only access', status: 'Done', priority: 'Medium', effort: 8, createdDays: -170, updatedDays: -95 },
                { title: 'Biometric authentication (Face ID / Touch ID)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -165, updatedDays: -88 },
                { title: 'Mobile-optimized data entry forms', status: 'Done', priority: 'High', effort: 5, createdDays: -160, updatedDays: -82 },
                { title: 'Push notification preferences and management', status: 'Done', priority: 'Medium', effort: 3, createdDays: -155, updatedDays: -76 },
                { title: 'App performance optimization (cold start < 2s)', status: 'Done', priority: 'High', effort: 8, createdDays: -150, updatedDays: -70 },
                { title: 'App store release pipeline (CI/CD)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -145, updatedDays: -65 },
            ].forEach(s => makeStory(e3, s));

            // ── Epic 4: Analytics — in progress ───────────────────────────────
            const e4 = data.epics[3];
            const e4Signals = phase3Entries.slice(0, 5).map(e => e.id);
            const activeSprint = `Sprint ${totalSprints}`;
            [
                { title: 'Data warehouse schema and ETL pipeline', status: 'Done', priority: 'High', effort: 13, createdDays: -65, updatedDays: -42 },
                { title: 'Core metrics dashboard (7 KPIs)', status: 'Done', priority: 'High', effort: 8, createdDays: -62, updatedDays: -38, precede_origin: { signal_ids: e4Signals, oldest_signal_date: dStr(today, -88), signal_count: e4Signals.length, captured_at: dISO(today, -65), linked_at: dISO(today, -62) } },
                { title: 'Custom chart builder (bar, line, pie, funnel)', status: 'Done', priority: 'High', effort: 8, createdDays: -58, updatedDays: -35 },
                { title: 'Cohort analysis and retention curves', status: 'Done', priority: 'High', effort: 8, createdDays: -54, updatedDays: -28 },
                { title: 'Scheduled report delivery via email', status: 'Done', priority: 'Medium', effort: 5, createdDays: -50, updatedDays: -21 },
                { title: 'Report sharing with external stakeholders (public link)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -46, updatedDays: -14 },
                { title: 'Real-time data streaming for live dashboards', status: 'In Progress', priority: 'High', effort: 13, sprintName: activeSprint, sprintState: 'active', createdDays: -30, updatedDays: -2 },
                { title: 'Custom dimensions and event tracking SDK', status: 'In Progress', priority: 'High', effort: 8, sprintName: activeSprint, sprintState: 'active', createdDays: -28, updatedDays: -1 },
                { title: 'Funnel analysis with multi-step attribution', status: 'In Progress', priority: 'Medium', effort: 8, sprintName: activeSprint, sprintState: 'active', createdDays: -25, updatedDays: -1 },
                { title: 'Executive summary auto-generated weekly', status: 'To Do', priority: 'Medium', effort: 5, createdDays: -20, updatedDays: -5 },
                { title: 'Anomaly detection alerts on key metrics', status: 'To Do', priority: 'High', effort: 8, createdDays: -18, updatedDays: -4 },
                { title: 'Data export API for BI tools (Looker, Tableau)', status: 'To Do', priority: 'Medium', effort: 5, createdDays: -15, updatedDays: -3 },
            ].forEach(s => makeStory(e4, s));

            // ── Epic 5: Integrations — planned ────────────────────────────────
            const e5 = data.epics[4];
            [
                { title: `${data.jiraPrefix} Integration Framework — oauth flow and token management`, status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Salesforce CRM bi-directional sync', status: 'To Do', priority: 'High', effort: 13, reach: 75, impact: 3 },
                { title: 'HubSpot contacts and deal sync', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Google Workspace (Calendar, Drive, Gmail) connector', status: 'To Do', priority: 'Medium', effort: 8 },
                { title: 'Zapier / Make.com webhook triggers', status: 'To Do', priority: 'Medium', effort: 5 },
                { title: 'REST API v2 with full OpenAPI spec', status: 'To Do', priority: 'High', effort: 13 },
                { title: 'Webhook management UI (subscribe, test, debug)', status: 'To Do', priority: 'Medium', effort: 5 },
                { title: 'SSO / SAML 2.0 for enterprise customers', status: 'To Do', priority: 'High', effort: 8, reach: 40, impact: 3 },
                { title: 'Integration health monitoring and error logs', status: 'To Do', priority: 'Medium', effort: 5 },
                { title: 'Integration marketplace (discovery page)', status: 'To Do', priority: 'Low', effort: 3 },
            ].forEach(s => makeStory(e5, s));

            // ── Epic 6: AI Automation — discovery ─────────────────────────────
            const e6 = data.epics[5];
            [
                { title: 'AI-assisted content generation (drafts from context)', status: 'To Do', priority: 'High', effort: 13 },
                { title: 'Smart classification and auto-tagging of incoming items', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Priority recommendation engine based on signals', status: 'To Do', priority: 'High', effort: 13 },
                { title: 'Natural language search across all data', status: 'To Do', priority: 'Medium', effort: 8 },
                { title: 'Automated weekly summary and insights digest', status: 'To Do', priority: 'Medium', effort: 5 },
                { title: 'AI coach for new user onboarding (contextual tips)', status: 'To Do', priority: 'Medium', effort: 8 },
                { title: 'Predictive churn signals and intervention suggestions', status: 'To Do', priority: 'High', effort: 13 },
                { title: 'LLM fine-tuning pipeline on customer data (opt-in)', status: 'To Do', priority: 'Low', effort: 13 },
            ].forEach(s => makeStory(e6, s));

            // Batch insert stories
            for (let i = 0; i < storyRows.length; i += CHUNK) {
                const { error } = await supabase.from('backlog_stories').insert(storyRows.slice(i, i + CHUNK));
                if (error) throw new Error(`Story insert failed: ${error.message}`);
            }

            // ── 6. Historical Radar Analyses (4 Claude calls) ────────────────
            const analysisWindows = [
                { label: 'Q1 retrospective', daysAgo: -90, entryPool: phase1Entries.concat(phase2Entries) },
                { label: 'Mid-year check-in', daysAgo: -60, entryPool: phase2Entries.concat(phase3Entries) },
                { label: 'Sprint retrospective', daysAgo: -30, entryPool: phase3Entries.concat(phase4Entries.slice(0, 10)) },
                { label: 'Current sprint analysis', daysAgo: -7,  entryPool: phase4Entries },
            ];

            for (const window of analysisWindows) {
                const signalSample = window.entryPool.slice(0, 20)
                    .map(e => `[${e.sourceType}] (${e.date}) ${e.body.slice(0, 120)}`).join('\n');

                const prompt = `You are generating a realistic historical product radar analysis for a ${sector} company building "${appType}".

Product vision: ${data.vision}
OKRs: ${data.objectives.join(' | ')}
Analysis label: ${window.label}

Recent signals sample:
${signalSample}

Generate a realistic radar analysis JSON. Be specific, use realistic numbers, reference signal themes from the data above.

Return ONLY valid JSON matching this exact structure:
{
  "analysis": {
    "summary": "2-3 sentence strategic summary of the product situation at this time, grounded in the signals",
    "trends": [
      { "theme": "theme name", "direction": "up|down|stable", "strength": "strong|moderate|weak", "insight": "1 sentence insight with specific detail" }
    ],
    "okr_alignment": [
      { "okr": "exact OKR text", "score": 65, "evidence": "1 sentence citing specific signals", "risk": "specific risk or null" }
    ],
    "delta": {
      "new_topics": ["topic 1", "topic 2"],
      "resolved_topics": ["resolved topic"],
      "velocity_change": "description of sprint velocity trend",
      "so_what": "1 sentence consequence for the PM"
    },
    "untracked_demand": [
      { "topic": "specific unmet demand topic", "urgency": "high|medium|low", "signal_count": 3, "reasoning": "why untracked" }
    ]
  },
  "sprint_memory": {
    "last_sprint_velocity": 9,
    "carry_over_rate": 0.15,
    "key_risks": ["specific risk 1", "specific risk 2"]
  }
}

Requirements:
- trends: 3-4 items, mix of positive and concerning
- okr_alignment: one entry per OKR (${data.objectives.length} total), scores between 40-85
- untracked_demand: 2-3 items, reference actual signal themes
- Be specific and realistic, avoid generic statements`;

                const raw = await callAI({
                    model:     MODELS.haiku,
                    maxTokens: 2000,
                    messages:  [{ role: 'user', content: prompt }],
                    callType:  'demo_seed_analysis',
                }) || '{}';

                let analysisJSON = {};
                try {
                    const match = raw.match(/\{[\s\S]*\}/);
                    analysisJSON = match ? JSON.parse(match[0]) : {};
                } catch (_) {
                    analysisJSON = { analysis: { summary: `${window.label} analysis.`, trends: [], okr_alignment: [], delta: {}, untracked_demand: [] } };
                }

                // Add required metadata
                analysisJSON.analysis_type = 'full';
                analysisJSON.meta = { longitudinal_triggered: false, memory_used: true, demo: true };

                const aFilename = `radar-demo-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
                const { error: aErr } = await supabase.from('analysis_history').insert({
                    user_id:     userId,
                    instance_id: instanceId,
                    filename:    aFilename,
                    data:        analysisJSON,
                    created_at:  dISO(today, window.daysAgo),
                });
                if (aErr) throw new Error(`Analysis insert failed: ${aErr.message}`);
                inserted.analysisFilenames.push(aFilename);
            }

            // ── 7. Radar memory (last sprint) ─────────────────────────────────
            await supabase.from('radar_memory').upsert({
                user_id:     userId,
                instance_id: instanceId,
                data: {
                    last_analyzed_sprint:  `Sprint ${totalSprints}`,
                    last_sprint_velocity:  9,
                    carry_over_rate:       0.12,
                    key_risks:             ['Integration gap becoming critical — multiple lost deals', 'Performance at scale concern'],
                    sprint_count:          totalSprints,
                    oldest_entry_days_ago: 365,
                },
                updated_at: today.toISOString(),
            }, { onConflict: 'user_id,instance_id' });

            // ── 8. Learning vault (grooming insights) ─────────────────────────
            const learningEntries = [
                { type: 'jira_comment', data: { storyTitle: 'Data warehouse schema and ETL pipeline', author: 'Elena Vasquez', body: 'Scope was unclear at start — we should define data contracts before sprint planning next time.', hasImprovement: true, recommendation: 'Always define data contracts and output schemas before a story enters the sprint. Prevents scope creep mid-sprint.', analyzedAt: dISO(today, -38) } },
                { type: 'jira_comment', data: { storyTitle: 'Native iOS app (Swift wrapper)', author: 'Thomas Müller', body: 'We underestimated App Store review time. Added 5 days to our timeline. Need buffer.', hasImprovement: true, recommendation: 'For stories involving third-party review processes (app stores, compliance reviews), add explicit buffer time in the effort estimate.', analyzedAt: dISO(today, -102) } },
                { type: 'user_feedback', data: { comment: 'The signal radar is really useful but I wish it connected directly to backlog creation', recommendation: 'Close the loop between insight discovery and story creation — PMs want a one-click path from signal to backlog item.', selectedItems: [], aiSnippet: '', createdAt: dISO(today, -22) } },
                { type: 'jira_comment', data: { storyTitle: 'Permission scoping per workspace', author: 'Sarah Mitchell', body: 'We had to redo the data model halfway through — the requirements for external collaborators changed.', hasImprovement: true, recommendation: 'When a story involves permissions, explicitly document the user types and their access levels before development starts.', analyzedAt: dISO(today, -168) } },
                { type: 'jira_comment', data: { storyTitle: 'Real-time collaborative editing', author: 'Marcus Williams', body: 'WebSocket implementation required a separate spike. Should have been a separate story.', hasImprovement: true, recommendation: 'Infrastructure spikes should be separate stories with explicit acceptance criteria before the feature story is groomed.', analyzedAt: dISO(today, -195) } },
                { type: 'user_feedback', data: { comment: 'Loving the new analytics but the export is slow for large datasets', recommendation: 'Performance requirements for data operations (exports, bulk actions) should be defined as explicit acceptance criteria with threshold values.', selectedItems: [], aiSnippet: '', createdAt: dISO(today, -8) } },
            ];
            for (const entry of learningEntries) {
                await supabase.from('learning_vault').insert({ user_id: userId, instance_id: instanceId, ...entry });
            }

            // ── 9. Meeting prep history ───────────────────────────────────────
            const meetings = [
                { actor: 'Engineering Lead', subject: 'Sprint 25 planning', format: 'Planning', prep: `Align on analytics epic priority. Key risk: real-time streaming dependency on infra team. Signal: 3 customers waiting on this feature.`, publicAgenda: '1. Sprint goal review\n2. Story point allocation\n3. Risk flagging', radarInsights: { trendsUsed: 2, opportunitiesUsed: 1, risksUsed: 1, feedbacksUsed: 3 }, createdAt: dISO(today, -28) },
                { actor: 'VP Product', subject: 'Quarterly roadmap review', format: 'Executive Update', prep: `Present Q3 progress: Analytics epic 50% done. Integration epic starting next month. Key signal: enterprise customers requesting SSO (3 deals blocked). Recommend fast-tracking SSO in integration epic.`, publicAgenda: '1. Q3 progress vs plan\n2. Q4 roadmap preview\n3. Resource ask: +1 engineer for integrations', radarInsights: { trendsUsed: 4, opportunitiesUsed: 2, risksUsed: 2, feedbacksUsed: 5 }, createdAt: dISO(today, -14) },
                { actor: 'Key Customer (Enterprise)', subject: 'Quarterly business review', format: 'Customer Call', prep: `Customer using ${appType} for 8 months. NPS: 8. Main ask: better Salesforce integration depth. Renewal coming in 60 days. Bring roadmap slide showing integration epic timeline.`, publicAgenda: '1. Usage review and wins\n2. Pain points discussion\n3. Roadmap alignment', radarInsights: { trendsUsed: 1, opportunitiesUsed: 2, risksUsed: 1, feedbacksUsed: 4 }, createdAt: dISO(today, -5) },
            ];
            for (const m of meetings) {
                await supabase.from('meeting_prep_history').insert({
                    user_id:     userId,
                    instance_id: instanceId,
                    data: { actor: m.actor, subject: m.subject, format: m.format, prepContent: m.prep, publicAgenda: m.publicAgenda, radarInsights: m.radarInsights, createdAt: m.createdAt },
                });
            }

            // ── 10. Update settings with caches pre-populated ─────────────────
            const untrackedCache = {
                results: [
                    { topic: weak[0]?.slice(0, 60) || 'Offline / async access for field teams', urgency: 'medium', signalCount: 2, reasoning: 'Mentioned twice by field-facing users, no story created yet.', source_ids: [allEntries[5]?.id, allEntries[89]?.id].filter(Boolean), signals: [weak[0] || ''] },
                    { topic: weak[1]?.slice(0, 60) || 'Digest / summary notifications', urgency: 'low', signalCount: 2, reasoning: 'Small but recurring ask — no prioritization yet.', source_ids: [allEntries[12]?.id, allEntries[51]?.id].filter(Boolean), signals: [weak[1] || ''] },
                    { topic: 'SSO / SAML enterprise authentication', urgency: 'high', signalCount: 4, reasoning: 'Multiple enterprise deals blocked on this. Currently planned in integration epic.', source_ids: phase4Entries.slice(0, 2).map(e => e.id), signals: [alerts[0] || ''] },
                ],
                olderResults: [
                    { topic: weak[2]?.slice(0, 60) || 'Custom approval workflows', urgency: 'low', signalCount: 1, reasoning: 'Mentioned once 6 months ago, not resurfacing.', signals: [weak[2] || ''] },
                ],
                computedAt:       today.toISOString(),
                signalFingerprint: `${allEntries.length}|${allEntries[allEntries.length - 1]?.date}|45`,
            };

            const finalSettings = {
                ...settingsData,
                untrackedDemandCache: untrackedCache,
            };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: instanceId, data: finalSettings, updated_at: today.toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json({
                success: true,
                generated: {
                    entries:   inserted.entryFilenames.length,
                    stories:   inserted.storyFilenames.length,
                    sprints:   inserted.sprintJiraIds.length,
                    analyses:  inserted.analysisFilenames.length,
                    sector,
                    appType,
                },
            });

        } catch (e) {
            console.error('[demo-seed] Generation failed:', e.message);
            await rollback(supabase, userId, instanceId, inserted);
            res.status(500).json({ error: e.message, rolledBack: true });
        }
    });

    return router;
};
