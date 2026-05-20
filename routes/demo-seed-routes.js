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
        'learning_vault', 'sprints', 'roadmap_milestones',
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
        if (inserted.milestonesInserted)
            await supabase.from('roadmap_milestones').delete().eq('user_id', userId).eq('instance_id', instanceId);
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
        const { sector, appType, focus = 'growth' } = req.body;
        if (!sector) return res.status(400).json({ error: 'sector is required' });

        const userId     = req.userId;
        const instanceId = req.instanceId;
        const today      = new Date();
        const data       = getSectorData(sector, appType || 'the app');
        const isPlatform = focus === 'platform';

        if (isPlatform) {
            data.vision = 'Build the most reliable, scalable, and secure platform that enterprise teams can bet their business on. Own the infrastructure layer so product teams ship faster with zero compliance risk.';
            data.objectives = [
                'Achieve and maintain 99.9% uptime SLA across all production environments',
                'Complete SOC 2 Type II certification and pass GDPR compliance audit by Q3',
                'Reduce p95 API latency to under 200ms across all customer-facing endpoints',
                'Enable zero-touch enterprise onboarding via SSO and SCIM provisioning',
            ];
            data.personas        = 'Platform Engineer (integrates via API), Security Lead (owns compliance), Enterprise Admin (manages tenant), DevOps Lead (monitors infrastructure)';
            data.epics           = [
                { key: `${data.jiraPrefix}-PE1`, name: 'REST API v2 & Developer Platform' },
                { key: `${data.jiraPrefix}-PE2`, name: 'Infrastructure Reliability & Observability' },
                { key: `${data.jiraPrefix}-PE3`, name: 'SOC 2 & Compliance Certification' },
                { key: `${data.jiraPrefix}-PE4`, name: 'Performance & Scalability' },
                { key: `${data.jiraPrefix}-PE5`, name: 'Enterprise SSO, SCIM & Multi-Tenancy' },
                { key: `${data.jiraPrefix}-PE6`, name: 'Developer Experience & Documentation' },
            ];
            data.strengthSignals = [
                'API response times consistently under 100ms — outperforming competitor benchmarks by 3×',
                'SOC 2 audit preparation ahead of schedule — no critical findings in pre-assessment',
                'Zero unplanned downtime in Q3 — SLA target of 99.9% exceeded every month',
                'Developer NPS for API v2 beta is 72 — highest score for any platform release to date',
                'Observability stack catching issues before customers report them — MTTD improved 4×',
                'Enterprise onboarding time reduced from 14 days to 2 days after SCIM automation',
                'Database query optimization reduced p95 latency from 850ms to 210ms on core endpoints',
                'Zero critical vulnerabilities in last two penetration tests — security posture strong',
            ];
            data.recurringSignals = [
                'Rate limiting too aggressive — developers hitting quota limits during normal usage patterns',
                'API documentation outdated — 40% of developer support tickets reference missing or wrong docs',
                'Webhook delivery reliability complaints — developers report occasional message loss under load',
                'Staging environment frequently out of sync with production — blocks QA validation cycles',
                'No granular API scopes — enterprise customers want read-only tokens per resource type',
                'Alert fatigue from monitoring — too many low-priority pages drowning critical signals',
                'Database connection pool exhaustion during peak traffic — requires manual restart intervention',
                'SAML attribute mapping fails with non-standard identity providers during enterprise onboarding',
                'Slow cold start times in serverless functions affecting user-facing API latency',
                'Deployment pipeline takes 45 minutes — slowing down engineering iteration speed',
            ];
            data.weakSignals = [
                'Some engineering teams asking about gRPC support in addition to REST endpoints',
                'Three enterprise teams have independently asked for a GraphQL API layer',
                'EU customers asking about data residency options — GDPR-driven compliance requirement',
                'Ruby and Go developers underserved — SDK only covers JavaScript and Python today',
                'Real-time event streaming via SSE requested as an alternative to short-interval polling',
            ];
            data.alertSignals = [
                'Critical compliance gap: audit log retention is 30 days — SOC 2 Type II requires 12 months minimum',
                'EU customers data transiting through us-east-1 — potential GDPR violation flagged by legal team',
                'Webhook system delivered duplicate events during traffic spike — 2 enterprise accounts impacted',
                'Security researcher disclosed IDOR vulnerability in API v1 — must patch before SOC 2 audit',
            ];
        }

        const inserted = { entriesInserted: false, storyFilenames: [], analysisFilenames: [], sprintJiraIds: [], milestonesInserted: false };

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
                objectives:          data.objectives.map((text, i) => ({ id: `okr_demo_${i + 1}`, text })),
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
            // Random base per run → avoids (user_id, jira_id) unique constraint conflicts
            // across multiple instances for the same user (constraint has no instance_id).
            const sprintJiraBase = 1_000_000 + Math.floor(Math.random() * 9_000_000);
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
                const jiraId    = sprintJiraBase + sprintNum;

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

            const activeSprint = `Sprint ${totalSprints}`;
            if (!isPlatform) {
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
            [
                { title: 'Data warehouse schema and ETL pipeline', status: 'Done', priority: 'High', effort: 13, createdDays: -65, updatedDays: -42, sprintName: 'Sprint 24', sprintState: 'closed' },
                { title: 'Core metrics dashboard (7 KPIs)', status: 'Done', priority: 'High', effort: 8, createdDays: -62, updatedDays: -38, sprintName: 'Sprint 24', sprintState: 'closed', precede_origin: { signal_ids: e4Signals, oldest_signal_date: dStr(today, -88), signal_count: e4Signals.length, captured_at: dISO(today, -65), linked_at: dISO(today, -62), resolved_at: dISO(today, -38), lead_time_days: 50 } },
                { title: 'Custom chart builder (bar, line, pie, funnel)', status: 'Done', priority: 'High', effort: 8, createdDays: -58, updatedDays: -35, sprintName: 'Sprint 24', sprintState: 'closed' },
                { title: 'Cohort analysis and retention curves', status: 'Done', priority: 'High', effort: 8, createdDays: -54, updatedDays: -28, sprintName: 'Sprint 25', sprintState: 'closed', precede_origin: { signal_ids: phase3Entries.slice(5, 8).map(e => e.id), oldest_signal_date: dStr(today, -70), signal_count: 3, captured_at: dISO(today, -55), linked_at: dISO(today, -54), resolved_at: dISO(today, -28), lead_time_days: 42 } },
                { title: 'Scheduled report delivery via email', status: 'Done', priority: 'Medium', effort: 5, createdDays: -50, updatedDays: -21, sprintName: 'Sprint 25', sprintState: 'closed' },
                { title: 'Report sharing with external stakeholders (public link)', status: 'Done', priority: 'Medium', effort: 3, createdDays: -46, updatedDays: -14, sprintName: 'Sprint 26', sprintState: 'closed', precede_origin: { signal_ids: phase4Entries.slice(2, 4).map(e => e.id), oldest_signal_date: dStr(today, -52), signal_count: 2, captured_at: dISO(today, -47), linked_at: dISO(today, -46), resolved_at: dISO(today, -4), lead_time_days: 48 } },
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
                { title: 'Salesforce CRM bi-directional sync', status: 'To Do', priority: 'High', effort: 8, reach: 75, impact: 3 },
                { title: 'HubSpot contacts and deal sync', status: 'To Do', priority: 'High', effort: 5 },
                { title: 'REST API v2 with full OpenAPI spec', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'SSO / SAML 2.0 for enterprise customers', status: 'To Do', priority: 'High', effort: 5, reach: 40, impact: 3 },
            ].forEach(s => makeStory(e5, s));

            // ── Epic 6: AI Automation — discovery ─────────────────────────────
            const e6 = data.epics[5];
            [
                { title: 'AI-assisted content generation (drafts from context)', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Smart classification and auto-tagging of incoming items', status: 'To Do', priority: 'High', effort: 5 },
                { title: 'Priority recommendation engine based on signals', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Predictive churn signals and intervention suggestions', status: 'To Do', priority: 'High', effort: 8 },
            ].forEach(s => makeStory(e6, s));
            } else {
            // ── Platform Epic 1: REST API v2 & Developer Platform — all DONE ──
            // Sprint distribution: 4 in Sprint 1, 3 in Sprint 2, 5 in Sprints 5-8 → ~40% scope creep
            const pe1 = data.epics[0];
            const pe1Signals = phase1Entries.slice(0, 4).map(e => e.id);
            [
                { title: 'API v2 schema design and OpenAPI 3.0 specification', status: 'Done', priority: 'High', effort: 5, createdDays: -365, updatedDays: -330, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'Versioned endpoint routing and API deprecation policy', status: 'Done', priority: 'High', effort: 3, createdDays: -360, updatedDays: -325, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'OAuth 2.0 authorization code flow implementation', status: 'Done', priority: 'High', effort: 8, createdDays: -355, updatedDays: -318, sprintName: 'Sprint 1', sprintState: 'closed' },
                { title: 'API key management — generate, rotate, revoke', status: 'Done', priority: 'High', effort: 5, createdDays: -350, updatedDays: -310, sprintName: 'Sprint 1', sprintState: 'closed', precede_origin: { signal_ids: pe1Signals, oldest_signal_date: dStr(today, -355), signal_count: pe1Signals.length, captured_at: dISO(today, -365), linked_at: dISO(today, -355), resolved_at: dISO(today, -310), lead_time_days: 55 } },
                { title: 'Rate limiting with per-key quotas and burst allowance', status: 'Done', priority: 'High', effort: 5, createdDays: -345, updatedDays: -302, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Request and response logging for audit and debugging', status: 'Done', priority: 'Medium', effort: 3, createdDays: -340, updatedDays: -295, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Pagination, filtering and sorting — consistent pattern across all endpoints', status: 'Done', priority: 'High', effort: 5, createdDays: -335, updatedDays: -288, sprintName: 'Sprint 2', sprintState: 'closed' },
                { title: 'Granular API scopes for read-only and resource-scoped access tokens', status: 'Done', priority: 'High', effort: 5, createdDays: -320, updatedDays: -268, sprintName: 'Sprint 5', sprintState: 'closed' },
                { title: 'Webhook event catalog — 40 event types with retry and delivery logs', status: 'Done', priority: 'High', effort: 8, createdDays: -308, updatedDays: -255, sprintName: 'Sprint 6', sprintState: 'closed' },
                { title: 'Developer sandbox environment with test data fixtures', status: 'Done', priority: 'Medium', effort: 5, createdDays: -296, updatedDays: -242, sprintName: 'Sprint 7', sprintState: 'closed' },
                { title: 'API usage analytics dashboard (calls, errors, latency per key)', status: 'Done', priority: 'Medium', effort: 5, createdDays: -290, updatedDays: -236, sprintName: 'Sprint 7', sprintState: 'closed' },
                { title: 'JavaScript and Python SDK v2 aligned to new API contracts', status: 'Done', priority: 'High', effort: 8, createdDays: -283, updatedDays: -229, sprintName: 'Sprint 8', sprintState: 'closed' },
            ].forEach(s => makeStory(pe1, s));

            // ── Platform Epic 2: Infrastructure Reliability & Observability — all DONE ──
            // Sprint distribution: 4 in Sprint 9, 3 in Sprint 10, 3 in Sprints 13-16 → ~43% scope creep
            const pe2 = data.epics[1];
            const pe2Signals = phase2Entries.slice(0, 3).map(e => e.id);
            [
                { title: 'Prometheus metrics instrumentation across all production services', status: 'Done', priority: 'High', effort: 5, createdDays: -275, updatedDays: -200, sprintName: 'Sprint 9', sprintState: 'closed', precede_origin: { signal_ids: pe2Signals, oldest_signal_date: dStr(today, -265), signal_count: pe2Signals.length, captured_at: dISO(today, -275), linked_at: dISO(today, -270), resolved_at: dISO(today, -200), lead_time_days: 75 } },
                { title: 'Grafana dashboard suite — 8 operational dashboards for on-call team', status: 'Done', priority: 'High', effort: 5, createdDays: -270, updatedDays: -195, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'Centralized log aggregation with structured JSON logging', status: 'Done', priority: 'High', effort: 5, createdDays: -265, updatedDays: -190, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'SLA uptime monitoring and breach alerting (99.9% target)', status: 'Done', priority: 'High', effort: 3, createdDays: -260, updatedDays: -185, sprintName: 'Sprint 9', sprintState: 'closed' },
                { title: 'PagerDuty integration and on-call rotation configuration', status: 'Done', priority: 'Medium', effort: 3, createdDays: -255, updatedDays: -178, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Alert routing and severity tiers with P1-P4 runbooks', status: 'Done', priority: 'High', effort: 5, createdDays: -250, updatedDays: -172, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Distributed tracing with OpenTelemetry across service mesh', status: 'Done', priority: 'High', effort: 8, createdDays: -245, updatedDays: -165, sprintName: 'Sprint 10', sprintState: 'closed' },
                { title: 'Database slow-query detection and performance alerting', status: 'Done', priority: 'Medium', effort: 5, createdDays: -235, updatedDays: -152, sprintName: 'Sprint 13', sprintState: 'closed' },
                { title: 'Capacity planning dashboards and auto-scaling policy triggers', status: 'Done', priority: 'Medium', effort: 5, createdDays: -225, updatedDays: -144, sprintName: 'Sprint 14', sprintState: 'closed' },
                { title: 'Disaster recovery drill tooling and automated failover testing', status: 'Done', priority: 'High', effort: 8, createdDays: -215, updatedDays: -136, sprintName: 'Sprint 16', sprintState: 'closed' },
            ].forEach(s => makeStory(pe2, s));

            // ── Platform Epic 3: SOC 2 & Compliance — in progress ─────────────
            // 8 done, 3 in-progress, 3 todo → ~2 sprints left → ON TRACK for 90d milestone
            const pe3 = data.epics[2];
            const pe3Signals = phase3Entries.slice(0, 5).map(e => e.id);
            [
                { title: 'Security policy framework documentation (access control, incident response)', status: 'Done', priority: 'High', effort: 5, createdDays: -185, updatedDays: -110, precede_origin: { signal_ids: pe3Signals, oldest_signal_date: dStr(today, -182), signal_count: pe3Signals.length, captured_at: dISO(today, -185), linked_at: dISO(today, -183), resolved_at: dISO(today, -110), lead_time_days: 75 } },
                { title: 'Audit log retention extended to 12 months with tamper-proof storage', status: 'Done', priority: 'High', effort: 8, createdDays: -180, updatedDays: -105 },
                { title: 'Encryption at rest on all production databases and object storage', status: 'Done', priority: 'High', effort: 5, createdDays: -175, updatedDays: -98 },
                { title: 'TLS 1.3 enforced across all API endpoints and internal services', status: 'Done', priority: 'High', effort: 3, createdDays: -170, updatedDays: -92 },
                { title: 'Vulnerability management process — monthly scans, 30-day remediation SLA', status: 'Done', priority: 'High', effort: 5, createdDays: -165, updatedDays: -85 },
                { title: 'Employee security training and phishing simulation programme', status: 'Done', priority: 'Medium', effort: 3, createdDays: -160, updatedDays: -78 },
                { title: 'Vendor risk assessment for all third-party integrations', status: 'Done', priority: 'Medium', effort: 5, createdDays: -155, updatedDays: -70 },
                { title: 'SOC 2 pre-assessment with external auditor — no critical findings', status: 'Done', priority: 'High', effort: 8, createdDays: -65, updatedDays: -42, sprintName: 'Sprint 24', sprintState: 'closed', precede_origin: { signal_ids: phase3Entries.slice(5, 8).map(e => e.id), oldest_signal_date: dStr(today, -70), signal_count: 3, captured_at: dISO(today, -65), linked_at: dISO(today, -64), resolved_at: dISO(today, -42), lead_time_days: 28 } },
                { title: 'Evidence collection portal for SOC 2 audit artifacts', status: 'In Progress', priority: 'High', effort: 8, sprintName: activeSprint, sprintState: 'active', createdDays: -30, updatedDays: -2 },
                { title: 'Data classification policy and automated sensitive-data tagging', status: 'In Progress', priority: 'High', effort: 5, sprintName: activeSprint, sprintState: 'active', createdDays: -28, updatedDays: -1 },
                { title: 'Penetration test remediation — 2 medium-severity findings to close', status: 'In Progress', priority: 'High', effort: 5, sprintName: activeSprint, sprintState: 'active', createdDays: -25, updatedDays: -1 },
                { title: 'Business continuity plan and annual tabletop exercise', status: 'To Do', priority: 'Medium', effort: 5, createdDays: -20, updatedDays: -5 },
                { title: 'Customer-facing security portal with SOC 2 report and DPA templates', status: 'To Do', priority: 'Medium', effort: 5, createdDays: -18, updatedDays: -4 },
                { title: 'Formal audit submission and remediation tracking system', status: 'To Do', priority: 'High', effort: 3, createdDays: -15, updatedDays: -3 },
            ].forEach(s => makeStory(pe3, s));

            // ── Platform Epic 4: Performance & Scalability — in progress ───────
            // 6 done, 3 in-progress, 2 todo
            const pe4 = data.epics[3];
            const pe4Signals = phase3Entries.slice(0, 5).map(e => e.id);
            [
                { title: 'Database indexing audit — 23 missing indexes identified and added', status: 'Done', priority: 'High', effort: 5, createdDays: -65, updatedDays: -42, sprintName: 'Sprint 24', sprintState: 'closed' },
                { title: 'Connection pooling tuning (PgBouncer) — eliminated pool exhaustion incidents', status: 'Done', priority: 'High', effort: 8, createdDays: -62, updatedDays: -38, sprintName: 'Sprint 24', sprintState: 'closed', precede_origin: { signal_ids: pe4Signals, oldest_signal_date: dStr(today, -88), signal_count: pe4Signals.length, captured_at: dISO(today, -65), linked_at: dISO(today, -62), resolved_at: dISO(today, -38), lead_time_days: 50 } },
                { title: 'Response caching layer (Redis) for high-frequency read endpoints', status: 'Done', priority: 'High', effort: 5, createdDays: -58, updatedDays: -35, sprintName: 'Sprint 24', sprintState: 'closed' },
                { title: 'CDN setup for static assets — TTFB improved by 60%', status: 'Done', priority: 'Medium', effort: 3, createdDays: -54, updatedDays: -28, sprintName: 'Sprint 25', sprintState: 'closed' },
                { title: 'N+1 query elimination in top 10 high-volume API endpoints', status: 'Done', priority: 'High', effort: 8, createdDays: -50, updatedDays: -21, sprintName: 'Sprint 25', sprintState: 'closed' },
                { title: 'Load testing suite — 10× traffic baseline validated and documented', status: 'Done', priority: 'Medium', effort: 5, createdDays: -46, updatedDays: -14, sprintName: 'Sprint 26', sprintState: 'closed' },
                { title: 'p95 latency reduction on search and filter API (target: <200ms)', status: 'In Progress', priority: 'High', effort: 8, sprintName: activeSprint, sprintState: 'active', createdDays: -30, updatedDays: -2 },
                { title: 'Background job queue optimization — reduce lag under peak load', status: 'In Progress', priority: 'High', effort: 5, sprintName: activeSprint, sprintState: 'active', createdDays: -28, updatedDays: -1 },
                { title: 'Lambda cold start mitigation with provisioned concurrency evaluation', status: 'In Progress', priority: 'Medium', effort: 5, sprintName: activeSprint, sprintState: 'active', createdDays: -25, updatedDays: -1 },
                { title: 'Global edge caching strategy for geographically distributed enterprise tenants', status: 'To Do', priority: 'Medium', effort: 8, createdDays: -20, updatedDays: -5 },
                { title: 'Database read-replica routing for analytics and reporting queries', status: 'To Do', priority: 'Medium', effort: 5, createdDays: -18, updatedDays: -4 },
            ].forEach(s => makeStory(pe4, s));

            // ── Platform Epic 5: Enterprise SSO, SCIM & Multi-Tenancy — planned ─
            // 0/5 done, ~3-4 sprints needed → AT RISK for 35d milestone
            const pe5 = data.epics[4];
            [
                { title: 'SAML 2.0 SSO — Okta, Azure AD and Google Workspace connectors', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'SCIM 2.0 provisioning — automated user and group sync from IdP', status: 'To Do', priority: 'High', effort: 5 },
                { title: 'Multi-tenancy strict data isolation — row-level security per enterprise tenant', status: 'To Do', priority: 'High', effort: 8 },
                { title: 'Enterprise admin panel — tenant management and usage quota controls', status: 'To Do', priority: 'High', effort: 5 },
                { title: 'IdP group to product role mapping with conflict resolution', status: 'To Do', priority: 'High', effort: 5 },
            ].forEach(s => makeStory(pe5, s));

            // ── Platform Epic 6: Developer Experience & Documentation — discovery ─
            const pe6 = data.epics[5];
            [
                { title: 'Developer portal redesign with interactive API explorer (Swagger UI)', status: 'To Do', priority: 'High', effort: 5 },
                { title: 'Quickstart guides for top 5 enterprise integration patterns', status: 'To Do', priority: 'High', effort: 3 },
                { title: 'Ruby and Go SDK — expanding language coverage beyond JS and Python', status: 'To Do', priority: 'Medium', effort: 5 },
            ].forEach(s => makeStory(pe6, s));
            } // end if/else isPlatform

            // ── Historic epics (one per T-shirt size, distinct scope-creep patterns) ──
            // Sprint numbers 101+ avoid collisions with active sprints 1-27.
            // The engine reads sprintName from story data only (no sprints table join).
            // initThreshold = minS + max(1, (maxS-minS)*0.10) — only sprint-minS stories are "initial".
            const makeHistStory = (epicKey, epicName, sp, sprint, title, createdDaysAgo = -400, resolvedDaysAgo = -300) => {
                const hId       = jiraCounter++;
                const filename  = `story-hist-${hId}-${randomUUID()}.json`;
                const storyData = {
                    id:             Date.now() + hId,
                    externalId:     `${data.jiraPrefix}-H${hId}`,
                    title,
                    contentText:    '',
                    status:         'Done',
                    priority:       'Medium',
                    epicKey,
                    epicName,
                    importedEffort: sp,
                    jiraRank:       displayOrder + 1,
                    source:         'demo',
                    issueType:      'Story',
                    projectKey:     data.jiraPrefix,
                    sprintName:     `Sprint ${sprint}`,
                    sprintState:    'closed',
                    createdAt:      dISO(today, createdDaysAgo),
                    updatedAt:      dISO(today, resolvedDaysAgo),
                    resolvedAt:     dISO(today, resolvedDaysAgo),
                    rice:           { reach: 50, impact: 1, confidence: 0.8, effort: sp, score: Math.round(50 / sp) },
                    precede_origin: null,
                };
                storyRows.push({ user_id: userId, instance_id: instanceId, filename, display_order: displayOrder++, data: storyData });
                inserted.storyFilenames.push(filename);
            };

            // XS — 1 sprint, 0% scope creep. Textbook delivery: all stories in Sprint 101.
            const hxsKey  = `${data.jiraPrefix}-EHX`, hxsName  = 'Quick Win: Accessibility & UX Polish';
            [[3,101,'Screen reader compatibility across core views'],
             [2,101,'Keyboard navigation in dialogs and menus'],
             [2,101,'Colour contrast ratio fixes (WCAG AA)'],
             [3,101,'Focus indicator styling for all interactive elements']]
            .forEach(([sp,s,t]) => makeHistStory(hxsKey, hxsName, sp, s, t, -420, -415));

            // S — 3 sprints, ~20% scope creep. Light late addition discovered during compliance review.
            // initThreshold = 103+1=104 → Sprint 103 is init, Sprint 105 is new scope.
            const hsKey   = `${data.jiraPrefix}-EHS`, hsName   = 'Onboarding Email Sequence & Activation Flow';
            [[3,103,'Welcome email with personalised onboarding checklist'],
             [2,103,'Day-3 activation nudge — key action reminder'],
             [2,103,'Day-7 feature discovery email (top 3 power features)'],
             [3,103,'Day-14 success milestone email with usage summary'],
             [2,103,'Re-engagement drip for dormant users (30-day trigger)'],
             [2,105,'Unsubscribe preference centre (compliance req added in final review)']]
            .forEach(([sp,s,t]) => makeHistStory(hsKey, hsName, sp, s, t, -390, -370));

            // M (additional) — 7 sprints, ~43% scope creep. Back-loaded: role & audit req gaps found post-beta.
            // initThreshold = 108+1=109 → Sprints 108 are init; 112, 114 are new scope.
            const hmKey   = `${data.jiraPrefix}-EHM`, hmName   = 'Customer Portal & Self-Service Admin';
            [[5,108,'Customer portal landing page and navigation'],
             [5,108,'Account overview and subscription management'],
             [3,108,'Invoice history and PDF export'],
             [3,108,'User seat management (add / remove team members)'],
             [5,108,'API key self-service management'],
             [3,108,'Support ticket submission and status tracking'],
             [3,108,'Portal SSO login (reuse existing identity provider)'],
             [5,112,'Role-based access control for portal sections (requirement gap)'],
             [5,112,'Admin delegation — assign portal admins per account'],
             [3,114,'Audit log of all admin actions (compliance added late)']]
            .forEach(([sp,s,t]) => makeHistStory(hmKey, hmName, sp, s, t, -360, -310));

            // L (additional) — 11 sprints, ~60% scope creep. Enterprise requirements kept expanding post-kickoff.
            // initThreshold = 120+1=121 → Sprint 120 is init; 124, 127, 130 are new scope.
            const hlKey   = `${data.jiraPrefix}-EHL`, hlName   = 'Enterprise SSO & Permissions Overhaul';
            [[8,120,'SAML 2.0 identity provider integration'],
             [5,120,'Okta connector — attribute mapping and group sync'],
             [5,120,'Azure AD / Entra connector'],
             [3,120,'SSO session management and token refresh'],
             [5,120,'Permission groups and role hierarchy model'],
             [5,120,'Admin UI for SSO configuration'],
             [3,120,'Automated SSO provisioning via SCIM'],
             [5,120,'Fallback login and SSO error handling'],
             [3,120,'SSO testing harness and sandbox environment'],
             [5,120,'Migration guide and documentation for existing customers'],
             [5,124,'Google Workspace OIDC connector (added after enterprise kickoff)'],
             [3,124,'PingIdentity integration (added sprint 4 — enterprise requirement)'],
             [5,127,'Full audit trail of all permission changes'],
             [5,127,'GDPR-compliant data access log export'],
             [5,130,'Admin delegation across sub-accounts (late customer requirement)'],
             [3,130,'Permission inheritance model for nested team structures']]
            .forEach(([sp,s,t]) => makeHistStory(hlKey, hlName, sp, s, t, -330, -260));

            // XL — 17 sprints, ~90% scope creep. Massive hidden complexity: each spike uncovered more unknowns.
            // initThreshold = 140 + max(1, 16*0.10) = 141.6 → Sprints 140-141 are init; 143+ are new scope.
            const hxlKey  = `${data.jiraPrefix}-EHZ`, hxlName  = 'Legacy Infrastructure Migration to Cloud-Native';
            [[13,140,'Cloud infrastructure setup (Kubernetes, networking, IAM)'],
             [8, 140,'Database migration strategy and tooling'],
             [8, 140,'CI/CD pipeline rebuild for new infrastructure'],
             [5, 140,'Environment parity (dev / staging / prod)'],
             [5, 140,'Service mesh setup for inter-service communication'],
             [8, 140,'Secrets management migration to Vault'],
             [5, 140,'Monitoring and alerting stack (Prometheus + Grafana)'],
             [5, 140,'Log aggregation pipeline setup'],
             [5, 140,'Load balancer configuration and SSL offloading'],
             [3, 141,'Disaster recovery runbooks and failover testing'],
             [13,143,'Data model compatibility layer — 8 incompatible schemas found'],
             [8, 143,'Legacy API shim for backward-compatibility during cutover'],
             [5, 143,'Blue/green deployment for zero-downtime cutover'],
             [8, 147,'Automated rollback mechanism (required after staging incident)'],
             [5, 147,'Data integrity validation suite (100k+ records)'],
             [5, 150,'Performance regression fixes — latency 3× worse than baseline'],
             [3, 150,'Memory leak investigation and patch in migrated services'],
             [5, 154,'Post-migration data reconciliation and diff tooling'],
             [3, 154,'Operational runbook and incident playbook updates']]
            .forEach(([sp,s,t]) => makeHistStory(hxlKey, hxlName, sp, s, t, -290, -200));

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
                // ── Sprint 21 Retrospective (-80d) ───────────────────────────
                {
                    daysAgo: -80,
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
                // ── Sprint 22 Check-in (-65d) ────────────────────────────────
                {
                    daysAgo: -65,
                    analysisJSON: {
                        analysis: {
                            summary: `Mobile epic shipped — strong execution. ${str[1]?.slice(0, 80) || 'Core platform performing well.'}. Analytics epic now in planning; integration gap is starting to surface in sales feedback.`,
                            trends: [
                                buildTrend(str[1] || 'Mobile delivery',   'rising',    70, 3),
                                buildTrend(rec[1] || 'Integration gap',   'declining', 40, 3),
                                buildTrend(str[3] || 'Core retention',    'stable',    68, 2),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [66, 72, 50, 70][i] || 62,
                                (str[i + 1] || rec[i] || str[0]),
                                i === 2 ? (alt[0]?.slice(0, 60) || 'Integration gap emerging in sales') : null,
                            )),
                            delta: { new_signals: [rec[2]?.slice(0, 40) || 'Integration friction'], strengthened: [str[1]?.slice(0, 40) || 'Mobile UX'], resolved: [rec[3]?.slice(0, 30) || 'Mobile friction'], contradictions: [], so_what: 'Mobile shipped cleanly — focus must shift to analytics and integration gap before it becomes a deal-blocker.' },
                            sentiment: sentActors.map((a, i) => ({ ...a, sentiment: i === 0 ? 'positive' : i === 1 ? 'neutral' : 'negative' })),
                            untracked_demand: [
                                { topic: wk[0]?.slice(0, 60) || 'Offline access', urgency: 'low', signal_count: 2, reasoning: 'Still recurring, no story created.' },
                                { topic: alt[0]?.slice(0, 60) || 'SSO / enterprise auth', urgency: 'medium', signal_count: 2, reasoning: 'Two enterprise prospects asking about SSO — no backlog story yet.' },
                            ],
                            longitudinal: { status: 'insufficient_data', sprints_completed: 2, sprints_required: 4 },
                            risks: [{ title: rec[2]?.slice(0, 40) || 'Integration gap', severity: 'medium', description: 'Starting to appear in sales calls — not yet critical but escalating.' }],
                            opportunities: [{ title: str[1]?.slice(0, 40) || 'Mobile adoption', potential: 'medium', description: 'Mobile launch well-received — opportunity to drive engagement with push notifications.' }],
                        },
                        sprint_memory: { last_sprint_velocity: 9, carry_over_rate: 0.16, key_risks: [rec[2]?.slice(0, 60) || 'Integration gap', alt[0]?.slice(0, 60) || 'Enterprise churn risk'], established_trends: [str[1]?.slice(0, 40) || 'Mobile UX', str[0]?.slice(0, 40) || 'Adoption'], active_risks: [rec[2]?.slice(0, 40) || 'Integration gap'], tracked_opportunities: [str[1]?.slice(0, 40) || 'Mobile expansion'], decisions_made: ['Mobile epic shipped', 'Analytics epic started'] },
                    },
                },
                // ── Sprint 23 Check-in (-50d) ────────────────────────────────
                {
                    daysAgo: -50,
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
                // ── Sprint 24 Retrospective (-35d) ───────────────────────────
                {
                    daysAgo: -35,
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
                // ── Sprint 25 Check-in (-20d) ────────────────────────────────
                {
                    daysAgo: -20,
                    analysisJSON: {
                        analysis: {
                            summary: `Analytics epic is nearly complete — strong delivery momentum. ${str[5]?.slice(0, 80) || 'Renewal signals positive.'}. Integration epic has started but ${rec[4]?.slice(0, 60) || 'early progress is slow'} — timeline risk is materializing.`,
                            trends: [
                                buildTrend(str[4] || 'Analytics momentum',       'rising',    81, 4),
                                buildTrend(alt[0] || 'Enterprise churn pressure', 'declining', 31, 4),
                                buildTrend(rec[4] || 'Integration friction',      'declining', 36, 4),
                                buildTrend(str[5] || 'Renewal momentum',          'rising',    75, 3),
                            ],
                            okr_alignment: data.objectives.map((okr, i) => buildOKR(
                                okr, [73, 79, 43, 76][i] || 66,
                                (str[i + 2] || rec[i + 1] || str[0]),
                                i === 2 ? 'Integration gap still blocking enterprise segment' : null,
                            )),
                            delta: { new_signals: [rec[4]?.slice(0, 40) || 'Integration delay risk'], strengthened: [str[4]?.slice(0, 40) || 'Analytics adoption'], resolved: [], contradictions: [], so_what: 'Analytics will ship on time but integration timeline is slipping — fast-tracking SSO story is now essential to protect enterprise renewals.' },
                            sentiment: sentActors.map((a, i) => ({ ...a, sentiment: i === 0 ? 'positive' : 'negative', risk_level: i === 0 ? 'low' : 'high' })),
                            untracked_demand: [
                                { topic: wk[0]?.slice(0, 60) || 'Offline access', urgency: 'medium', signal_count: 3, reasoning: 'Resurfacing after mobile launch — field teams still asking.' },
                                { topic: alt[0]?.slice(0, 60) || 'SSO / SAML', urgency: 'high', signal_count: 4, reasoning: 'Now blocking 2 enterprise deals — needs immediate backlog entry.' },
                            ],
                            longitudinal: { status: 'insufficient_data', sprints_completed: 3, sprints_required: 4 },
                            risks: [
                                { title: alt[0]?.slice(0, 40) || 'Enterprise churn', severity: 'high', description: alt[0]?.slice(0, 100) || 'Large account flagging competitive evaluation.' },
                                { title: rec[4]?.slice(0, 40) || 'Integration delay', severity: 'high', description: 'Integration epic started but velocity below plan — SSO at risk of missing renewal window.' },
                            ],
                            opportunities: [{ title: str[4]?.slice(0, 40) || 'Analytics expansion', potential: 'high', description: 'Analytics dashboard near GA — strong upsell signal for premium reporting tier.' }],
                        },
                        sprint_memory: { last_sprint_velocity: 10, carry_over_rate: 0.11, key_risks: [alt[0]?.slice(0, 60) || 'Enterprise churn', rec[4]?.slice(0, 60) || 'Integration timeline'], established_trends: [str[4]?.slice(0, 40) || 'Analytics momentum', str[0]?.slice(0, 40) || 'Core adoption'], active_risks: [alt[0]?.slice(0, 40) || 'Churn signal', 'Integration delay'], tracked_opportunities: [str[4]?.slice(0, 40) || 'Analytics upsell'], decisions_made: ['Analytics epic on final sprint', 'Integration framework story started'] },
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

            // ── 11. Roadmap Milestones ────────────────────────────────────────
            const milestoneRows = isPlatform
                ? [
                    {
                        // ✅ ON TRACK — SOC 2 epic (~2 sprints left) completes well before 90d.
                        user_id:         userId,
                        instance_id:     instanceId,
                        name:            'SOC 2 Type II Audit Submission',
                        date:            dStr(today, 90),
                        type:            'external',
                        linked_epic_ids: [data.epics[2].key],
                        note:            'Submission deadline to auditor. Evidence collection and final pen-test remediation must be complete at least 3 weeks prior.',
                        created_by:      'pm',
                    },
                    {
                        // ⚠️ AT RISK — SSO/SCIM epic (0/10 done, ~5 sprints needed) won't complete in time.
                        user_id:         userId,
                        instance_id:     instanceId,
                        name:            'EU Region Launch & Data Residency GA',
                        date:            dStr(today, 35),
                        type:            'external',
                        linked_epic_ids: [data.epics[4].key],
                        note:            'Hard commitment to EU enterprise accounts requiring data residency. Multi-tenancy and region deployment depend on SSO/SCIM epic completion.',
                        created_by:      'pm',
                    },
                ]
                : [
                    {
                        // ✅ ON TRACK — Analytics epic (~2 sprints left) completes well before this date.
                        user_id:         userId,
                        instance_id:     instanceId,
                        name:            'Analytics GA Release',
                        date:            dStr(today, 90),
                        type:            'external',
                        linked_epic_ids: [data.epics[3].key],
                        note:            'Public announcement of Analytics & Reporting tier to existing customers. Analytics epic must ship at least 3 weeks before marketing goes out.',
                        created_by:      'pm',
                    },
                    {
                        // ⚠️ AT RISK — Integration epic (0/10 done, ~5 sprints needed) won't complete in time.
                        user_id:         userId,
                        instance_id:     instanceId,
                        name:            'Enterprise Tier Public Launch',
                        date:            dStr(today, 30),
                        type:            'external',
                        linked_epic_ids: [data.epics[4].key],
                        note:            'Hard commitment to 3 enterprise accounts pending SSO and Salesforce integration. Sales has already set expectations on this date.',
                        created_by:      'pm',
                    },
                ];
            const { error: msError } = await supabase.from('roadmap_milestones').insert(milestoneRows);
            if (msError && !msError.message?.includes('relation')) throw new Error(`Milestone insert failed: ${msError.message}`);
            inserted.milestonesInserted = true;

            res.json({
                success: true,
                generated: {
                    entries:   entryRows.length,
                    stories:   inserted.storyFilenames.length,
                    sprints:   inserted.sprintJiraIds.length,
                    analyses:  inserted.analysisFilenames.length,
                    sector,
                    appType,
                    focus,
                },
            });

        } catch (e) {
            console.error('[demo-seed] Generation failed:', e.message);
            await rollback(supabase, userId, instanceId, inserted);
            res.status(500).json({ error: e.message, rolledBack: true });
        }
    });

    // ── POST /generate-exec ───────────────────────────────────────────────────
    // Seeds the executive instance with decisions and a cached exec synthesis.
    // Does NOT require X-Instance-Id — finds the exec instance internally.
    // Requires at least one PM instance with seeded data (for instance_id refs).
    router.post('/generate-exec', async (req, res) => {
        const userId = req.userId;
        const today  = new Date();

        try {
            // ── 1. Find exec instance ─────────────────────────────────────────
            const { data: execInstances } = await supabase
                .from('instances')
                .select('id, name')
                .eq('user_id', userId)
                .eq('instance_type', 'executive')
                .limit(1);

            if (!execInstances?.length) {
                return res.status(404).json({
                    error: 'No executive instance found. Create an executive workspace first, then run this seed.',
                });
            }
            const execInstance = execInstances[0];

            // ── 2. Find PM instances (for linking + synthesis instance_id) ────
            const { data: pmInstances } = await supabase
                .from('instances')
                .select('id, name')
                .eq('user_id', userId)
                .or('instance_type.eq.pm,instance_type.is.null')
                .order('created_at', { ascending: true });

            const pm0 = pmInstances?.[0] ?? null;
            const pm1 = pmInstances?.[1] ?? null;

            // ── 3. Purge exec-specific rows ───────────────────────────────────
            await supabase.from('settings')
                .update({ data: {}, updated_at: today.toISOString() })
                .eq('user_id', userId).eq('instance_id', execInstance.id);
            // Remove any previous exec synthesis rows (stored on pm0's instance_id)
            if (pm0) {
                await supabase.from('analysis_history')
                    .delete()
                    .eq('user_id', userId)
                    .eq('analysis_type', 'exec_synthesis');
            }

            // ── 4. Seed decisions in exec settings ────────────────────────────
            const decisions = [
                {
                    id:                  `demo-exec-d1`,
                    name:                'Go / No-Go: Analytics GA Release',
                    description:         'Analytics epic is on track for completion within 2 sprints. Marketing has set customer expectations for the GA announcement. PM requires exec sign-off before the external communication goes out. Key open question: do we announce the full Analytics & Reporting tier or just the core dashboard?',
                    date:                dStr(today, 14),
                    approver:            'Head of Product',
                    status:              'pending',
                    createdAt:           dISO(today, -3),
                    approvedAt:          null,
                    isEscalation:        true,
                    linkedPmDecisionId:  'demo-pm-d1',
                    linkedPmInstanceId:  pm0?.id ?? null,
                    source_ids:          [],
                    okr_ids:             [],
                },
                {
                    id:                  `demo-exec-d2`,
                    name:                'EU Region Launch: Accept 60-Day Delay',
                    description:         'SSO/SCIM epic (Enterprise SSO, SCIM & Multi-Tenancy) will not complete before the committed EU launch date. 3 enterprise accounts are expecting data residency by that date. Options: (A) negotiate delay with accounts, (B) ship partial EU region without SCIM, (C) reassign engineers from perf epic. PM recommends option A but needs exec alignment before customer communication.',
                    date:                dStr(today, 7),
                    approver:            'Head of Product',
                    status:              'pending',
                    createdAt:           dISO(today, -1),
                    approvedAt:          null,
                    isEscalation:        true,
                    linkedPmDecisionId:  'demo-pm-d2',
                    linkedPmInstanceId:  pm1?.id ?? null,
                    source_ids:          [],
                    okr_ids:             [],
                },
                {
                    id:                  `demo-exec-d3`,
                    name:                'Q4 Integration Headcount: +1 Senior Engineer',
                    description:         'Integration epic velocity is behind projection. Adding one senior engineer would reduce timeline risk by 3 sprints and protect the Enterprise Tier launch commitment. Budget impact: ~$45k for Q4. PM has already identified a contractor profile.',
                    date:                dStr(today, -7),
                    approver:            'Head of Product',
                    status:              'awaiting_acknowledgment',
                    createdAt:           dISO(today, -18),
                    approvedAt:          null,
                    execResponse:        { text: 'Approved. Coordinate with Finance to raise the PO this week. Onboarding must happen before Sprint 29 starts.', rationale: 'The enterprise commitment is more costly to miss than the headcount spend. Approved.', respondedAt: dISO(today, -7) },
                    isEscalation:        true,
                    linkedPmDecisionId:  'demo-pm-d3',
                    linkedPmInstanceId:  pm0?.id ?? null,
                    source_ids:          [],
                    okr_ids:             [],
                },
                {
                    id:                  `demo-exec-d4`,
                    name:                'Deprioritize AI Automation Epic to Q1',
                    description:         'With integration and analytics taking priority, the AI Automation epic has no realistic sprint capacity in Q4. PM recommends moving it entirely to Q1 and communicating proactively to the 2 customers who were shown the roadmap.',
                    date:                dStr(today, -21),
                    approver:            'Head of Product',
                    status:              'approved',
                    createdAt:           dISO(today, -35),
                    approvedAt:          dISO(today, -21),
                    execResponse:        { text: 'Agreed. Update the roadmap deck and loop in Customer Success to handle the account conversations.', rationale: 'Right call. AI features are differentiating but not blocking any renewals right now.', respondedAt: dISO(today, -28) },
                    isEscalation:        true,
                    linkedPmDecisionId:  'demo-pm-d4',
                    linkedPmInstanceId:  pm0?.id ?? null,
                    source_ids:          [],
                    okr_ids:             [],
                },
            ];

            const { error: settingsErr } = await supabase.from('settings').upsert(
                { user_id: userId, instance_id: execInstance.id, data: { decisions }, updated_at: today.toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
            if (settingsErr) throw new Error(`Exec settings seed failed: ${settingsErr.message}`);

            // ── 5. Seed exec synthesis cache ──────────────────────────────────
            // Stored on pm0's instance_id (matches how /api/exec/synthesis caches it).
            // sprint_name matches the demo seed's last closed sprint (Sprint 26).
            if (pm0) {
                const sq0 = pm0.name || 'Growth Squad';
                const sq1 = pm1?.name || 'Platform Squad';
                const synthesis = {
                    executive_pulse: `The organization is executing against two different risk profiles simultaneously: ${sq0} is in a delivery sprint with healthy momentum but an enterprise retention cliff approaching, while ${sq1} is absorbing compliance and infrastructure debt that will constrain capacity for the next two quarters. The integration timeline is the single constraint that determines whether both squads can honor their Q4 commitments.`,
                    squad_reads: [
                        {
                            instance_name: sq0,
                            status: 'watch',
                            read: `Analytics delivery is on track and NPS signals are positive, but the enterprise segment is showing churn pressure that analytics alone won't resolve. The integration epic is underway but its timeline intersects with two live renewal windows — a slip of one sprint becomes a retention event.`,
                            reasoning: `OKR score trending up (74% → 80%) and signal coverage is strong, but churn_high flags an active enterprise risk aligned to integration gap. Sprint predictability at 88% over last 3 sprints is reliable but the integration epic carries the most scope uncertainty.`,
                        },
                        {
                            instance_name: sq1,
                            status: 'at_risk',
                            read: `SOC 2 is progressing but the EU region commitment is now structurally at risk. SSO/SCIM is 0% started with a 35-day window — this is not a PM problem to solve alone. Resource reallocation or a customer conversation needs to happen this sprint, not next.`,
                            reasoning: `PE5 (SSO/SCIM) has 10 stories at 0% completion with 5 sprints of work ahead and a 35-day milestone. PE4 performance work is absorbing 3 engineers in active sprint. No capacity exists to start PE5 without a trade-off decision at exec level.`,
                        },
                    ],
                    where_to_intervene: [
                        {
                            title: 'EU Region Launch: Customer Communication Decision',
                            why_exec: 'The 35-day EU milestone cannot be met with current resource allocation. Communicating a delay to enterprise accounts is a Head of Product conversation, not a PM one — it affects revenue commitments and sales credibility.',
                            suggested_action: `Review the 3 enterprise accounts expecting EU data residency and decide whether to negotiate a delay or ship a partial solution. Decision needed before Sprint 29 planning.`,
                            urgency: 'this_sprint',
                            reasoning: `PE5 (SSO/SCIM) has 0/10 stories done with ~5 sprints of work ahead. The milestone is in 35 days. Even if all PE4 engineers pivoted today, delivery by the milestone date is not feasible without descoping multi-region from the SSO epic.`,
                        },
                        {
                            title: 'Integration Timeline: Cross-Squad Capacity',
                            why_exec: `Both squads have integration-related commitments (Salesforce sync on ${sq0}, SCIM on ${sq1}) that compete for the same senior engineering profile. If headcount isn't added, one epic will slip. This is a budget decision, not a prioritization one.`,
                            suggested_action: `Approve Q4 contractor headcount to unblock integration epic. PM has already identified the profile — PO can be raised this week.`,
                            urgency: 'this_sprint',
                            reasoning: `${sq0} integration epic (0/10 done) and ${sq1} SSO epic (0/10 done) both start Q4 simultaneously. Current velocity data shows neither squad has slack capacity. The +1 senior engineer reduces combined timeline risk by an estimated 3 sprints.`,
                        },
                    ],
                    quarter_outlook: {
                        assessment: 'at_risk',
                        rationale: `Analytics GA is on track — that commitment will be met. The enterprise tier launch and EU region launch are both at risk. The integration epic has not started and the SSO/SCIM epic has no capacity to begin. If resource constraints are not resolved in the next sprint, at least one external commitment will be missed.`,
                        key_dependency: 'Headcount decision for integration + exec alignment on EU launch timeline with affected customers.',
                        reasoning: `${sq0} shows 80% OKR alignment and 3 in-progress analytics stories on active sprint — on track for GA. But ${sq1} has 0% on its two largest planned epics (PE5, PE6) with hard external milestones in 35 days. Sprint predictability across both squads is 85%+ — the risk is not execution quality, it is scope vs capacity.`,
                    },
                };

                const { error: synthErr } = await supabase.from('analysis_history').insert({
                    user_id:       userId,
                    instance_id:   pm0.id,
                    filename:      'exec-synthesis',
                    analysis_type: 'exec_synthesis',
                    data:          { sprint_name: 'Sprint 26', synthesis, generated_at: today.toISOString() },
                    created_at:    today.toISOString(),
                });
                if (synthErr && !synthErr.message?.includes('duplicate'))
                    throw new Error(`Exec synthesis seed failed: ${synthErr.message}`);
            }

            res.json({
                success:    true,
                execInstance: { id: execInstance.id, name: execInstance.name },
                seeded:     { decisions: decisions.length, synthesis: !!pm0 },
            });
        } catch (e) {
            console.error('[demo-seed] Exec generation failed:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
