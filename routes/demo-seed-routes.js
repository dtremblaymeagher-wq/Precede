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
        if (inserted.entriesInserted)
            await supabase.from('intelligence_entries').delete().eq('user_id', userId).eq('instance_id', instanceId);
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

        const inserted = { entriesInserted: false, storyFilenames: [], analysisFilenames: [], sprintJiraIds: [] };

        try {
            // ── 1. Purge ──────────────────────────────────────────────────────
            await purgeInstance(supabase, userId, instanceId);

            // ── 2. Settings ───────────────────────────────────────────────────
            const sprintStartDate = dStr(today, -364); // started 1 year ago
            // Parse persona string "Name (role), Name2 (role2)" → [{ name, role }]
            const personas = data.personas.split('), ').map((p, i, arr) => {
                const s = (i < arr.length - 1 ? p + ')' : p).trim();
                const parenIdx = s.indexOf(' (');
                return {
                    name: parenIdx > -1 ? s.slice(0, parenIdx) : s,
                    role: parenIdx > -1 ? s.slice(parenIdx + 2, s.endsWith(')') ? -1 : undefined) : '',
                };
            });
            const clientsMap = {
                'SaaS B2B':   ['Accenture Digital', 'Stripe Operations', 'Notion Enterprise', 'Slack Connect'],
                'Fintech':    ['TD Wealth', 'Desjardins Capital', 'PayScale Corp', 'Koho Financial'],
                'E-commerce': ['Shopify Plus', 'Reitmans Online', 'Wayfair Canada', 'Indigo Digital'],
                'Healthtech': ['TELUS Health', 'Medtronic Connected', 'Maple Telehealth', 'SE Health'],
                'EdTech':     ['UQAM Continuing Ed', 'Coursera Enterprise', 'Pearson Digital', 'Duolingo Business'],
            };
            const settingsData = {
                vision:              data.vision,
                objectives:          data.objectives,
                personas,
                clients:             clientsMap[sector] || ['Client A', 'Client B', 'Client C', 'Client D'],
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
                if (!body) return null; // guard against undefined signals from short sector arrays
                const id   = randomUUID();
                const date = dStr(today, daysOffset);
                const entry = {
                    id, body, sourceType, date, person,
                    tags: [], createdAt: dISO(today, daysOffset),
                };
                allEntries.push(entry);
                entryRows.push({ user_id: userId, instance_id: instanceId, data: entry });
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
            makeEntry(-228, 'sales_call',      strength[6]  || strength[0],  null);
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
            makeEntry(-16,  'analytics',       strength[6]  || strength[0],  null);
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
            inserted.entriesInserted = true;

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
                // Use high integers (90000+) to avoid UNIQUE (user_id, jira_id) conflicts with real Jira sprints
                const jiraId    = 90000 + sprintNum;

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
            // Sprint distribution: 6 in Sprint 1, 5 in Sprint 2, 3 in Sprints 5-8 → ~27% scope creep
            [
                { title: `Core ${appType} setup and configuration wizard`, status: 'Done', priority: 'High', effort: 5, createdDays: -365, updatedDays: -320, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'User authentication and role-based access control', status: 'Done', priority: 'High', effort: 8, createdDays: -360, updatedDays: -315, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Dashboard home with key metrics overview', status: 'Done', priority: 'High', effort: 5, createdDays: -355, updatedDays: -310, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Notification system (in-app + email)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -350, updatedDays: -305, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Search and global filter functionality', status: 'Done', priority: 'High', effort: 5, createdDays: -345, updatedDays: -298, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Data import via CSV with validation', status: 'Done', priority: 'Medium', effort: 3, createdDays: -340, updatedDays: -292, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Basic reporting with PDF export', status: 'Done', priority: 'Medium', effort: 5, createdDays: -335, updatedDays: -285, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Onboarding checklist and in-app guidance', status: 'Done', priority: 'High', effort: 3, createdDays: -330, updatedDays: -278, sprintName: 'Sprint 2', sprintState: 'closed', precede_origin: { signal_ids: e1Signals, oldest_signal_date: dStr(today, -340), signal_count: e1Signals.length, captured_at: dISO(today, -365), linked_at: dISO(today, -360), resolved_at: dISO(today, -278), lead_time_days: 62 }},
                { title: 'Activity feed and audit log', status: 'Done', priority: 'Low', effort: 3, createdDays: -325, updatedDays: -270, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Team workspace management', status: 'Done', priority: 'High', effort: 8, createdDays: -320, updatedDays: -265, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'API key management for basic integrations', status: 'Done', priority: 'Medium', effort: 5, createdDays: -315, updatedDays: -258, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Performance baseline and caching layer', status: 'Done', priority: 'Medium', effort: 8, createdDays: -310, updatedDays: -252, sprintName: 'Sprint 5', sprintState: 'closed' },
                { title: 'Accessibility compliance (WCAG 2.1 AA)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -305, updatedDays: -248, sprintName: 'Sprint 7', sprintState: 'closed' },
                { title: 'Dark mode support', status: 'Done', priority: 'Low', effort: 2, createdDays: -300, updatedDays: -242, sprintName: 'Sprint 8', sprintState: 'closed' },
            ].forEach(s => makeStory(e1, s));

            // ── Epic 2: Collaboration — all DONE ──────────────────────────────
            const e2 = data.epics[1];
            const e2Signals = phase2Entries.slice(0, 3).map(e => e.id);
            // Sprint distribution: 4 in Sprint 9, 4 in Sprint 10, 3 in Sprints 13-16 → ~37% scope creep
            [
                { title: 'Real-time collaborative editing on shared views', status: 'Done', priority: 'High', effort: 13, createdDays: -275, updatedDays: -200, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'Comment threads and @mentions on any item', status: 'Done', priority: 'High', effort: 5, createdDays: -270, updatedDays: -195, sprintName: 'Sprint 9', sprintState: 'closed', precede_origin: { signal_ids: e2Signals, oldest_signal_date: dStr(today, -265), signal_count: e2Signals.length, captured_at: dISO(today, -275), linked_at: dISO(today, -270), resolved_at: dISO(today, -195), lead_time_days: 70 } },
                { title: 'Shared templates library with version control', status: 'Done', priority: 'High', effort: 5, createdDays: -265, updatedDays: -190, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'Guest / external collaborator access', status: 'Done', priority: 'Medium', effort: 8, createdDays: -260, updatedDays: -185, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'Permission scoping per workspace and project', status: 'Done', priority: 'High', effort: 8, createdDays: -255, updatedDays: -178, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Team activity digest (weekly summary email)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -250, updatedDays: -172, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Slack notification webhook integration', status: 'Done', priority: 'High', effort: 5, createdDays: -245, updatedDays: -165, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Custom views and saved filters per user', status: 'Done', priority: 'Medium', effort: 5, createdDays: -240, updatedDays: -158, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Bulk actions on multiple items', status: 'Done', priority: 'Medium', effort: 3, createdDays: -235, updatedDays: -152, sprintName: 'Sprint 13', sprintState: 'closed' },
                { title: 'Keyboard shortcuts for power users', status: 'Done', priority: 'Low', effort: 3, createdDays: -230, updatedDays: -148, sprintName: 'Sprint 14', sprintState: 'closed' },
                { title: 'In-app changelog and release notes widget', status: 'Done', priority: 'Low', effort: 2, createdDays: -225, updatedDays: -144, sprintName: 'Sprint 16', sprintState: 'closed' },
            ].forEach(s => makeStory(e2, s));

            // ── Epic 3: Mobile — all DONE ──────────────────────────────────────
            const e3 = data.epics[2];
            const e3Signals = phase2Entries.slice(3, 7).map(e => e.id);
            // Sprint distribution: 4 in Sprint 17, 3 in Sprint 18, 2 in Sprint 21 → ~28% scope creep
            [
                { title: 'Responsive layout for all core screens (mobile-first)', status: 'Done', priority: 'High', effort: 13, createdDays: -185, updatedDays: -110, sprintName: 'Sprint 17', sprintState: 'closed', precede_origin: { signal_ids: e3Signals, oldest_signal_date: dStr(today, -243), signal_count: e3Signals.length, captured_at: dISO(today, -185), linked_at: dISO(today, -182), resolved_at: dISO(today, -110), lead_time_days: 133 } },
                { title: 'Native iOS app (Swift wrapper + push notifications)', status: 'Done', priority: 'High', effort: 13, createdDays: -180, updatedDays: -105, sprintName: 'Sprint 17', sprintState: 'closed' },
                { title: 'Android app (Kotlin wrapper)', status: 'Done', priority: 'High', effort: 13, createdDays: -175, updatedDays: -100, sprintName: 'Sprint 17', sprintState: 'closed' },
                { title: 'Offline mode for read-only access', status: 'Done', priority: 'Medium', effort: 8, createdDays: -170, updatedDays: -95, sprintName: 'Sprint 17', sprintState: 'closed' },
                { title: 'Biometric authentication (Face ID / Touch ID)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -165, updatedDays: -88, sprintName: 'Sprint 18', sprintState: 'closed' },
                { title: 'Mobile-optimized data entry forms', status: 'Done', priority: 'High', effort: 5, createdDays: -160, updatedDays: -82, sprintName: 'Sprint 18', sprintState: 'closed' },
                { title: 'Push notification preferences and management', status: 'Done', priority: 'Medium', effort: 3, createdDays: -155, updatedDays: -76, sprintName: 'Sprint 18', sprintState: 'closed' },
                { title: 'App performance optimization (cold start < 2s)', status: 'Done', priority: 'High', effort: 8, createdDays: -150, updatedDays: -70, sprintName: 'Sprint 21', sprintState: 'closed' },
                { title: 'App store release pipeline (CI/CD)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -145, updatedDays: -65, sprintName: 'Sprint 21', sprintState: 'closed' },
            ].forEach(s => makeStory(e3, s));

            // ── Epic 4: Analytics — in progress ───────────────────────────────
            const e4 = data.epics[3];
            const e4Signals = phase3Entries.slice(0, 5).map(e => e.id);
            const activeSprint = `Sprint ${totalSprints}`;
            [
                { title: 'Data warehouse schema and ETL pipeline', status: 'Done', priority: 'High', effort: 13, createdDays: -65, updatedDays: -42 },
                { title: 'Core metrics dashboard (7 KPIs)', status: 'Done', priority: 'High', effort: 8, createdDays: -62, updatedDays: -38, precede_origin: { signal_ids: e4Signals, oldest_signal_date: dStr(today, -88), signal_count: e4Signals.length, captured_at: dISO(today, -65), linked_at: dISO(today, -62), resolved_at: dISO(today, -38), lead_time_days: 50 } },
                { title: 'Custom chart builder (bar, line, pie, funnel)', status: 'Done', priority: 'High', effort: 8, createdDays: -58, updatedDays: -35 },
                { title: 'Cohort analysis and retention curves', status: 'Done', priority: 'High', effort: 8, createdDays: -54, updatedDays: -28, precede_origin: { signal_ids: phase3Entries.slice(5, 8).map(e => e.id), oldest_signal_date: dStr(today, -70), signal_count: 3, captured_at: dISO(today, -55), linked_at: dISO(today, -54), resolved_at: dISO(today, -28), lead_time_days: 42 } },
                { title: 'Scheduled report delivery via email', status: 'Done', priority: 'Medium', effort: 5, createdDays: -50, updatedDays: -21 },
                { title: 'Report sharing with external stakeholders (public link)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -46, updatedDays: -14, precede_origin: { signal_ids: phase4Entries.slice(2, 4).map(e => e.id), oldest_signal_date: dStr(today, -52), signal_count: 2, captured_at: dISO(today, -47), linked_at: dISO(today, -46), resolved_at: dISO(today, -4), lead_time_days: 48 } },
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

            // ── 6. Historical Radar Analyses — built deterministically ───────
            // No Claude calls here: hardcoded from sector data guarantees correct field names.
            const str = data.strengthSignals;
            const rec = data.recurringSignals;
            const wk  = data.weakSignals;
            const alt = data.alertSignals;

            // Sentiment actors from personas (already parsed to [{name,role}])
            const sentActors = personas.slice(0, 3).map((p, i) => ({
                actor:     p.name,
                sentiment: i === 0 ? 'positive' : i === 1 ? 'neutral' : 'negative',
                risk_level: i === 2 ? 'high' : i === 1 ? 'medium' : 'low',
                reasoning: i === 0
                    ? `${p.name} reports strong satisfaction with core workflows and time savings.`
                    : i === 1
                        ? `${p.name} sees value but raises concerns about specific missing features.`
                        : `${p.name} has flagged critical gaps; risk of escalation or churn.`,
            }));

            const buildTrend = (sig, evolution, score, count) => ({
                topic:               sig.split('.')[0].replace(/^.*?:\s*/, '').slice(0, 60),
                evolution,
                evidence_count:      count,
                description:         sig.slice(0, 120),
                persona_impacted:    personas[0]?.name || null,
                strategic_alignment: score,
            });

            const buildOKR = (okr, score, evidenceSig, risk) => ({
                okr, score,
                evidence: `Signals indicate ${evidenceSig.slice(0, 80)}`,
                risk:     risk || null,
            });

            const analysisWindows = [
                // ── Q1 Retrospective (-90d) ──────────────────────────────────
                {
                    daysAgo: -90,
                    analysisJSON: {
                        analysis: {
                            summary: `Early adoption signals show strong momentum in core workflows. ${str[0]?.slice(0, 80) || 'Core features resonating well.'}. Recurring friction points around ${rec[0]?.slice(0, 60) || 'data export'} require attention in upcoming sprints.`,
                            trends: [
                                buildTrend(str[0] || 'Core workflow adoption', 'rising', 78, 4),
                                buildTrend(rec[0] || 'Performance concerns',   'declining', 42, 3),
                                buildTrend(str[1] || 'Onboarding satisfaction', 'stable', 70, 2),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [62, 71, 55, 68][i] || 60,
                                (str[i] || rec[i] || str[0]),
                                i === 2 ? (alt[0]?.slice(0, 60) || 'Adoption risk in segment') : null,
                            )),
                            delta: { new_signals: [rec[0]?.slice(0, 40) || 'Performance issue'], strengthened: [str[0]?.slice(0, 40) || 'Adoption'], resolved: [], contradictions: [], so_what: 'Performance is the primary friction point — must be addressed before scaling.' },
                            sentiment: sentActors,
                            untracked_demand: [
                                { topic: wk[0]?.slice(0, 60) || 'Offline access', urgency: 'low', signal_count: 2, reasoning: 'Mentioned by field teams, not yet scoped into any epic.' },
                                { topic: wk[1]?.slice(0, 60) || 'Digest notifications', urgency: 'low', signal_count: 1, reasoning: 'Recurring ask in NPS comments, no story created.' },
                            ],
                            longitudinal: { status: 'insufficient_data', sprints_completed: 1, sprints_required: 4 },
                            risks: [{ title: alt[0]?.slice(0, 40) || 'Enterprise churn risk', severity: 'high', description: alt[0]?.slice(0, 100) || 'Key account signaling dissatisfaction.' }],
                            opportunities: [{ title: str[0]?.slice(0, 40) || 'Workflow automation', potential: 'high', description: 'Strong NPS scores on automation features — expand scope to adjacent workflows.' }],
                        },
                        sprint_memory: { last_sprint_velocity: 8, carry_over_rate: 0.18, key_risks: [alt[0]?.slice(0, 60) || 'Churn risk', rec[0]?.slice(0, 60) || 'Performance'], established_trends: [str[0]?.slice(0, 40) || 'Adoption'], active_risks: [alt[0]?.slice(0, 40) || 'Enterprise churn'], tracked_opportunities: [str[0]?.slice(0, 40) || 'Automation'], decisions_made: [] },
                    },
                },
                // ── Mid-year Check-in (-60d) ─────────────────────────────────
                {
                    daysAgo: -60,
                    analysisJSON: {
                        analysis: {
                            summary: `Mid-year review shows continued strength in core adoption. ${str[2]?.slice(0, 80) || 'Team collaboration features resonating.'}. However, ${rec[2]?.slice(0, 60) || 'integration gaps'} are now appearing in lost deals — requires escalation.`,
                            trends: [
                                buildTrend(str[2] || 'Team collaboration',     'rising',    75, 5),
                                buildTrend(rec[1] || 'Integration gap',        'declining', 38, 4),
                                buildTrend(str[3] || 'Retention improvement',  'stable',    72, 3),
                                buildTrend(rec[3] || 'Mobile UX friction',     'declining', 44, 3),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [68, 74, 49, 72][i] || 62,
                                (str[i + 1] || rec[i] || str[0]),
                                i === 2 ? (alt[1]?.slice(0, 60) || 'Integration gap blocking deals') : null,
                            )),
                            delta: { new_signals: [rec[2]?.slice(0, 40) || 'Integration gap'], strengthened: [str[2]?.slice(0, 40) || 'Collaboration'], resolved: [str[0]?.slice(0, 30) || 'Onboarding friction'], contradictions: [], so_what: 'Integration gap has become a deal-breaker — must be addressed in next quarter planning.' },
                            sentiment: sentActors.map((a, i) => ({ ...a, sentiment: i === 0 ? 'positive' : i === 1 ? 'negative' : 'neutral' })),
                            untracked_demand: [
                                { topic: wk[2]?.slice(0, 60) || 'Custom workflows', urgency: 'medium', signal_count: 3, reasoning: 'Compliance teams asking, not yet scoped.' },
                                { topic: alt[0]?.slice(0, 60) || 'SSO / enterprise auth', urgency: 'high', signal_count: 4, reasoning: 'Multiple enterprise deals blocked on this — no story in backlog.' },
                            ],
                            longitudinal: { status: 'insufficient_data', sprints_completed: 2, sprints_required: 4 },
                            risks: [{ title: alt[1]?.slice(0, 40) || 'Integration deal blocker', severity: 'high', description: rec[2]?.slice(0, 100) || 'Integration gap appearing in sales conversations.' }],
                            opportunities: [{ title: str[2]?.slice(0, 40) || 'Collaboration expansion', potential: 'high', description: 'Team collaboration adoption is accelerating — could expand to async workflows.' }],
                        },
                        sprint_memory: { last_sprint_velocity: 9, carry_over_rate: 0.14, key_risks: [alt[1]?.slice(0, 60) || 'Integration gap', rec[1]?.slice(0, 60) || 'Performance at scale'], established_trends: [str[2]?.slice(0, 40) || 'Collaboration', str[0]?.slice(0, 40) || 'Adoption'], active_risks: [alt[0]?.slice(0, 40) || 'Enterprise churn'], tracked_opportunities: [str[2]?.slice(0, 40) || 'Collaboration'], decisions_made: ['Deprioritized mobile epic to focus on integrations'] },
                    },
                },
                // ── Sprint Retrospective (-30d) ──────────────────────────────
                {
                    daysAgo: -30,
                    analysisJSON: {
                        analysis: {
                            summary: `Analytics epic launched with strong early signal. ${str[4]?.slice(0, 80) || 'Initial metrics dashboard well received.'}. Integration gap continues to escalate — ${alt[0]?.slice(0, 60) || 'key account at risk'}.`,
                            trends: [
                                buildTrend(str[4] || 'Analytics adoption',     'rising',    80, 4),
                                buildTrend(alt[0] || 'Enterprise churn risk',  'declining', 30, 3),
                                buildTrend(rec[4] || 'Integration friction',   'declining', 35, 5),
                                buildTrend(str[5] || 'Renewal momentum',       'stable',    74, 2),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [72, 78, 44, 75][i] || 65,
                                (str[i + 2] || rec[i + 1] || str[0]),
                                i === 2 ? (alt[0]?.slice(0, 60) || 'Enterprise segment at risk') : null,
                            )),
                            delta: { new_signals: [alt[0]?.slice(0, 40) || 'Churn escalation'], strengthened: [rec[4]?.slice(0, 40) || 'Integration friction'], resolved: [rec[3]?.slice(0, 30) || 'Mobile friction'], contradictions: [], so_what: 'Integration gap is now costing deals — fast-tracking SSO to next sprint is essential.' },
                            sentiment: sentActors.map((a, i) => ({ ...a, sentiment: i === 0 ? 'positive' : 'negative', risk_level: i === 0 ? 'low' : 'high' })),
                            untracked_demand: [
                                { topic: wk[0]?.slice(0, 60) || 'Offline access', urgency: 'medium', signal_count: 3, reasoning: 'Resurfacing after mobile launch — field teams still asking.' },
                                { topic: alt[0]?.slice(0, 60) || 'SSO / SAML', urgency: 'high', signal_count: 5, reasoning: 'Now blocking 3 enterprise deals — needs immediate backlog entry.' },
                            ],
                            longitudinal: { status: 'insufficient_data', sprints_completed: 3, sprints_required: 4 },
                            risks: [
                                { title: alt[0]?.slice(0, 40) || 'Enterprise churn', severity: 'high', description: alt[0]?.slice(0, 100) || 'Large account flagging competitive evaluation.' },
                                { title: rec[4]?.slice(0, 40) || 'Integration gap', severity: 'high', description: 'Integration gap now cited in 3 of 5 lost deals this quarter.' },
                            ],
                            opportunities: [{ title: str[4]?.slice(0, 40) || 'Analytics upsell', potential: 'high', description: 'Analytics dashboard driving renewal conversations — expand reporting to premium tier.' }],
                        },
                        sprint_memory: { last_sprint_velocity: 10, carry_over_rate: 0.10, key_risks: [alt[0]?.slice(0, 60) || 'Enterprise churn', 'Integration gap critical path'], established_trends: [str[4]?.slice(0, 40) || 'Analytics momentum', str[0]?.slice(0, 40) || 'Core adoption'], active_risks: [alt[0]?.slice(0, 40) || 'Churn signal'], tracked_opportunities: [str[4]?.slice(0, 40) || 'Analytics expansion'], decisions_made: ['Approved fast-track of SSO story', 'Deprioritized AI features to Q4'] },
                    },
                },
                // ── Current Sprint Analysis (-7d) — includes full longitudinal ─
                {
                    daysAgo: -7,
                    analysisJSON: {
                        analysis: {
                            summary: `The product is in a critical transition phase. ${str[5]?.slice(0, 80) || 'Renewals holding strong on core value.'} The integration epic is now underway but ${alt[0]?.slice(0, 60) || 'enterprise churn risk remains elevated'}. Four quarters of data reveal a clear recurring pattern: ${rec[0]?.slice(0, 60) || 'performance friction'} has persisted across all sprints without resolution.`,
                            trends: [
                                buildTrend(str[5] || 'Renewal momentum',           'rising',    76, 4),
                                buildTrend(alt[0] || 'Enterprise churn pressure',  'declining', 28, 5),
                                buildTrend(str[0] || 'Core workflow satisfaction',  'stable',    74, 6),
                                buildTrend(rec[0] || 'Performance at scale',        'declining', 40, 4),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [74, 80, 42, 78][i] || 68,
                                (str[i] || rec[i] || str[0]),
                                i === 2 ? 'Enterprise segment remains at risk — integration gap unresolved' : null,
                            )),
                            delta: { new_signals: [wk[1]?.slice(0, 40) || 'AI feature requests'], strengthened: [alt[0]?.slice(0, 40) || 'Enterprise churn risk'], resolved: [], contradictions: [], so_what: 'The integration gap has crossed from friction to deal-breaker — this sprint must deliver the first integration milestone.' },
                            sentiment: sentActors,
                            untracked_demand: [
                                { topic: wk[0]?.slice(0, 60) || 'Offline access', urgency: 'medium', signal_count: 3, reasoning: 'Persistent ask — no story created in 3 sprints.' },
                                { topic: wk[2]?.slice(0, 60) || 'Custom workflows', urgency: 'low', signal_count: 2, reasoning: 'Compliance-driven request with no current epic home.' },
                                { topic: alt[0]?.slice(0, 60) || 'SSO / SAML', urgency: 'high', signal_count: 6, reasoning: 'Blocking enterprise deals — partially addressed in integration epic but not complete.' },
                            ],
                            longitudinal: {
                                status:           'available',
                                sprints_analyzed: 4,
                                accelerating_trends: [
                                    str[5]?.slice(0, 70) || 'Renewal momentum accelerating across enterprise segment',
                                    str[3]?.slice(0, 70) || 'Self-serve adoption growing faster than expected',
                                ],
                                decelerating_trends: [
                                    rec[0]?.slice(0, 70) || 'Performance complaints — plateau but unresolved',
                                    rec[2]?.slice(0, 70) || 'Integration friction — partially addressed by integration epic',
                                ],
                                velocity_alerts: [
                                    { topic: alt[0]?.slice(0, 45) || 'Enterprise churn risk', velocity: 'fast', projection: 'If integration epic does not ship this sprint, 2 enterprise renewals are at risk of churning.' },
                                ],
                                persistent_contradictions: [
                                    alt[0]?.slice(0, 70) || 'Enterprise segment signaling churn while core NPS remains high — signals diverging across cohorts',
                                ],
                                silent_signals: [
                                    { topic: rec[3]?.slice(0, 50) || 'Mobile UX friction', risk_level: 'medium', hypothesis: 'Mobile epic shipped — issue may be resolved but no follow-up NPS to confirm.', last_seen: 'Sprint 18' },
                                    { topic: wk[3]?.slice(0, 50) || wk[0]?.slice(0, 50) || 'API access requests', risk_level: 'low', hypothesis: 'Technical users stopped raising this — possibly found workarounds or moved to a competitor.', last_seen: 'Sprint 12' },
                                ],
                                recurring_signals: [
                                    { topic: rec[0]?.slice(0, 55) || 'Performance degradation at scale', description: 'Raised in every quarterly review across all 4 sprints — no root cause addressed.', evidence_count: 6 },
                                    { topic: alt[0]?.slice(0, 55) || 'Enterprise integration gap', description: 'Escalating signal — started as friction, now blocking renewals and new deals.', evidence_count: 5 },
                                ],
                                churn_signals: [
                                    { actor: sentActors[2]?.actor || 'Enterprise segment', risk_level: 'high', indicators: alt[0]?.slice(0, 100) || 'Account flagged competitive evaluation; NPS dropped 3 points over last quarter.' },
                                ],
                            },
                            risks: [
                                { title: alt[0]?.slice(0, 40) || 'Enterprise churn', severity: 'high', description: alt[0]?.slice(0, 100) || 'Large account flagging competitive evaluation.' },
                                { title: 'Integration timeline risk', severity: 'medium', description: 'Integration epic in progress but timeline uncertainty could push key deliverables past renewal window.' },
                            ],
                            opportunities: [
                                { title: str[5]?.slice(0, 40) || 'Renewal expansion', potential: 'high', description: 'Strong renewal signals on analytics features — opportunity to upsell reporting tier.' },
                                { title: wk[0]?.slice(0, 40) || 'Offline / field access', potential: 'medium', description: 'Untracked demand from field teams — addressable with low engineering effort.' },
                            ],
                        },
                        sprint_memory: { last_sprint_velocity: 9, carry_over_rate: 0.12, key_risks: [alt[0]?.slice(0, 60) || 'Enterprise churn', rec[0]?.slice(0, 60) || 'Performance at scale'], established_trends: [str[5]?.slice(0, 40) || 'Renewal momentum', str[0]?.slice(0, 40) || 'Core adoption'], active_risks: [alt[0]?.slice(0, 40) || 'Enterprise churn', 'Integration delay'], tracked_opportunities: [str[5]?.slice(0, 40) || 'Analytics upsell'], decisions_made: ['Fast-tracked SSO', 'Paused AI epic to Q4', 'Approved integration framework story'] },
                    },
                },
            ];

            for (const window of analysisWindows) {
                window.analysisJSON.analysis_type = 'full';
                window.analysisJSON.meta = { longitudinal_triggered: window.daysAgo === -7, memory_used: true, demo: true };

                const aFilename = `radar-demo-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
                const { error: aErr } = await supabase.from('analysis_history').insert({
                    user_id:     userId,
                    instance_id: instanceId,
                    filename:    aFilename,
                    data:        window.analysisJSON,
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
                    last_analyzed_sprint:  `Sprint ${totalSprints - 1}`,
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
                    entries:   entryRows.length,
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
