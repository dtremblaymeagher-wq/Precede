'use strict';
/**
 * routes/import-routes.js
 *
 * GET  /api/import/status           — read last import state
 * POST /api/import/initial          — one-time full import from Jira
 * POST /api/import/sync-ranks       — sync Agile board visual order
 * POST /api/import/sync             — incremental sync (last 24h)
 * POST /api/import/sprints/initial  — import last 5 closed + active sprints
 * POST /api/import/sprints/sync     — sync active/future sprints
 * POST /api/import/backfill-sp      — backfill story-point effort field
 * POST /api/import/backfill-epics   — backfill epicKey/epicName
 */

const { Router }             = require('express');
const { randomUUID }         = require('crypto');
const { makeHelpers }        = require('../utils/db-helpers');
const { makeIntegrationUtils } = require('../utils/integration-utils');
const { apiError }           = require('../utils/api-error');
const { MODELS, callAI, submitBatch } = require('../shared/ai-client');
const prompts                = require('../shared/prompts');
const JiraStoryImporter      = require('../integrations/jira-story-importer');
const { isDone }             = require('../utils/story-constants');

module.exports = function createImportRouter(supabase) {
    const router = Router();
    const { instanceSelect }           = makeHelpers(supabase);
    const { loadIntegrationConfig }    = makeIntegrationUtils(supabase);

    // ── Internal helpers ──────────────────────────────────────────────────────

    function getImporter(config) {
        if (!config?.type) throw new Error('Integration type is required');
        switch (config.type.toLowerCase()) {
            case 'jira': return new JiraStoryImporter(config);
            default:     throw new Error(`No importer available for integration type: ${config.type}`);
        }
    }

    async function saveImportState(userId, instanceId, patch) {
        const { data: existing } = await instanceSelect('settings', 'data', userId, instanceId).single();
        const current = existing?.data || {};
        const merged  = { ...current, importState: { ...(current.importState || {}), ...patch } };
        await supabase.from('settings').upsert(
            { user_id: userId, instance_id: instanceId, data: merged, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,instance_id' }
        );
    }

    async function batchCalculateRice(stories, req) {
        if (!stories.length) return [];
        const CHUNK_SIZE = 20;
        const batchId    = randomUUID();
        const allResults = new Array(stories.length);
        for (let offset = 0; offset < stories.length; offset += CHUNK_SIZE) {
            const chunk = stories.slice(offset, offset + CHUNK_SIZE);
            const list  = chunk.map((s, i) =>
                `[${offset + i}] TITLE: ${s.title}\nDESCRIPTION: ${(s.contentText || '').slice(0, 400)}`
            ).join('\n\n');
            const text  = await callAI({
                model: MODELS.haiku, maxTokens: 1024,
                messages: [{ role: 'user', content: prompts.buildRicePrompt({ list }) }],
                callType: 'rice_calculation',
                req,
                deliveryMode: 'batch',
                batchId,
            }) || '[]';
            const match = text.match(/\[[\s\S]*\]/);
            const items = match ? JSON.parse(match[0]) : [];
            chunk.forEach((_, i) => {
                const globalIndex = offset + i;
                const found = items.find(r => r.index === globalIndex) || {};
                allResults[globalIndex] = {
                    reach:      found.reach      ?? 0,
                    impact:     found.impact     ?? 1,
                    confidence: found.confidence ?? 50,
                    effort:     found.effort     ?? 3,
                };
            });
        }
        return allResults;
    }

    // Upsert one normalized story — creates or updates with history tracking.
    // existingMap: Map<externalId, { filename, data }> pre-loaded to avoid N+1 queries.
    async function upsertImportedStory(userId, instanceId, normalized, riceData, existingMap) {
        const existing = existingMap?.get(normalized.externalId);
        const now      = new Date().toISOString();

        if (existing) {
            const current    = existing.data;
            const newEntries = [];
            const TRACKED    = ['title', 'content', 'status', 'priority', 'issueType', 'sprintName', 'sprintState'];
            for (const field of TRACKED) {
                if (JSON.stringify(current[field]) !== JSON.stringify(normalized[field]))
                    newEntries.push({ field, from: current[field] ?? null, to: normalized[field], changedAt: now });
            }
            if (JSON.stringify(current.labels) !== JSON.stringify(normalized.labels))
                newEntries.push({ field: 'labels', from: current.labels ?? [], to: normalized.labels, changedAt: now });

            const effortChanged   = normalized.importedEffort !== null && normalized.importedEffort !== (current.importedEffort ?? null);
            const rankChanged     = normalized.jiraRank !== null && normalized.jiraRank !== current.jiraRank;
            const epicChanged     = normalized.epicKey !== (current.epicKey ?? null);
            const existingJiraKeys = new Set((current.comments || []).filter(c => c.source === 'jira').map(c => `${c.author}|${c.createdAt}`));
            const newJiraComments  = (normalized.comments || []).filter(c => !existingJiraKeys.has(`${c.author}|${c.createdAt}`));
            const mergedComments   = [...(current.comments || []), ...newJiraComments];
            const commentsChanged  = newJiraComments.length > 0;

            if (newEntries.length === 0 && !effortChanged && !rankChanged && !epicChanged && !commentsChanged)
                return { action: 'unchanged', fileName: existing.filename };

            const updatedData = {
                ...current,
                title:          normalized.title,
                content:        normalized.content,
                contentText:    normalized.contentText,
                status:            normalized.status,
                statusCategoryKey: normalized.statusCategoryKey ?? current.statusCategoryKey ?? null,
                priority:          normalized.priority,
                labels:            normalized.labels.length ? normalized.labels : current.labels,
                issueType:         normalized.issueType,
                sprintName:        normalized.sprintName,
                sprintId:          normalized.sprintId    ?? current.sprintId    ?? null,
                sprintState:       normalized.sprintState  ?? current.sprintState ?? null,
                jiraRank:       normalized.jiraRank     ?? current.jiraRank    ?? null,
                importedEffort: normalized.importedEffort ?? current.importedEffort ?? null,
                epicKey:        normalized.epicKey  !== undefined ? normalized.epicKey  : (current.epicKey  ?? null),
                epicName:       normalized.epicName !== undefined ? normalized.epicName : (current.epicName ?? null),
                comments:       mergedComments,
                updatedAt:      now,
                history:        [...(current.history || []), ...newEntries],
            };
            await supabase.from('backlog_stories')
                .update({ data: updatedData })
                .eq('user_id', userId).eq('instance_id', instanceId).eq('filename', existing.filename);
            return { action: 'updated', fileName: existing.filename, newJiraComments, storyTitle: current.title ?? normalized.title ?? '' };
        }

        // New story
        const timestamp = Date.now();
        const fileName  = `story-${randomUUID()}.json`;
        const effort    = normalized.importedEffort ?? riceData?.effort ?? 3;
        const reach     = riceData?.reach      ?? 0;
        const impact    = riceData?.impact     ?? 1;
        const conf      = riceData?.confidence ?? 50;
        const score     = Math.round((reach * impact * (conf / 100)) / (effort || 1));
        const newStory  = {
            id:             timestamp,
            externalId:     normalized.externalId,
            source:         normalized.source,
            projectKey:     normalized.projectKey,
            issueType:      normalized.issueType,
            priority:       normalized.priority,
            title:          normalized.title,
            content:        normalized.content,
            contentText:    normalized.contentText,
            status:         normalized.status,
            sprintName:     normalized.sprintName,
            sprintId:       normalized.sprintId    ?? null,
            sprintState:    normalized.sprintState  ?? null,
            jiraRank:       normalized.jiraRank     ?? null,
            importedEffort: normalized.importedEffort ?? null,
            epicKey:        normalized.epicKey       ?? null,
            epicName:       normalized.epicName      ?? null,
            jiraCreatedAt:  normalized.jiraCreatedAt ?? null,
            createdAt:      now, updatedAt: now, resolvedAt: null,
            rice:           { reach, impact, confidence: conf, effort, score },
            labels:         normalized.labels,
            history:        [{ field: 'status', from: null, to: normalized.status, changedAt: now }],
            comments:       [],
        };
        await supabase.from('backlog_stories')
            .insert({ user_id: userId, instance_id: instanceId, filename: fileName, data: newStory, display_order: 0 });
        return { action: 'created', fileName };
    }

    // Shared helper — upserts sprints from Jira Agile API into the sprints table.
    // initial=true  → last 5 closed + current active
    // initial=false → active + future + last 1 closed
    // Note: sprints table is user-scoped (no instance_id filter).
    async function syncSprintsFromJira(userId, instanceId, config, { initial = false } = {}) {
        const boardId = config.boardId;
        if (!boardId) throw new Error('boardId is not configured — set it in Settings → Integration');

        const JiraIntegration = require('../integrations/jira');
        const jira = new JiraIntegration(config);
        let rawSprints = [];

        if (initial) {
            const [closedData, activeData] = await Promise.all([
                jira._request('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=5`),
                jira._request('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=1`),
            ]);
            const closed = (closedData.values || []).slice(-5);
            rawSprints = [...closed, ...(activeData.values || [])];
        } else {
            const [activeData, closedData] = await Promise.all([
                jira._request('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=20`),
                // Fetch enough closed sprints so that the most recently closed one is always
                // included even when many sprints have closed (Jira returns ascending/oldest-first).
                jira._request('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=20`),
            ]);
            // Take the 3 most recent closed sprints to capture any that closed since last sync.
            rawSprints = [...(closedData.values || []).slice(-3), ...(activeData.values || [])];
        }

        if (!rawSprints.length) return { total: 0 };

        const now  = new Date().toISOString();
        const rows = rawSprints.map(s => ({
            user_id:     userId,
            instance_id: instanceId,
            jira_id:     s.id,
            source:      'jira',
            name:        s.name,
            state:       (s.state || 'closed').toLowerCase(),
            start_date:  s.startDate?.slice(0, 10) || null,
            end_date:    s.endDate?.slice(0, 10)   || null,
            goal:        s.goal || null,
            updated_at:  now,
        }));

        // Fetch completion stats for closed sprints from Jira Sprint Report API
        const closedRaw = rawSprints.filter(s => (s.state || '').toLowerCase() === 'closed');
        if (closedRaw.length > 0) {
            const statsResults = await Promise.allSettled(
                closedRaw.map(s => jira.getSprintIssueStats(s.id, boardId))
            );
            for (let i = 0; i < closedRaw.length; i++) {
                const r = statsResults[i];
                if (r.status === 'fulfilled') {
                    const row = rows.find(r => r.jira_id === closedRaw[i].id);
                    if (row) {
                        row.completed_count = r.value.completed;
                        row.total_count     = r.value.total;
                        row.added_count     = r.value.added;
                        row.removed_count   = r.value.removed;
                        row.rollover_count  = r.value.rollover;
                    }
                }
            }
        }

        const { error } = await supabase.from('sprints').upsert(rows, { onConflict: 'user_id,instance_id,jira_id' });
        if (error) throw new Error(`Sprint upsert failed: ${error.message}`);
        return { total: rows.length };
    }

    // ── GET /api/import/status ────────────────────────────────────────────────

    router.get('/status', async (req, res) => {
        try {
            const { data } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
            res.json(data?.data?.importState || { lastSyncAt: null, lastSyncCount: 0, initialDone: false });
        } catch (e) { apiError(res, e); }
    });

    // ── POST /api/import/initial ──────────────────────────────────────────────

    router.post('/initial', async (req, res) => {
        try {
            const userId = req.userId;
            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });

            const importer   = getImporter(config);
            const raw        = await importer.fetchInitial();
            const normalized = raw.map((r, idx) => importer.normalize(r, idx));

            const { data: existingRows } = await instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId);
            const existingMap = new Map((existingRows || []).filter(r => r.data?.externalId).map(r => [r.data.externalId, r]));

            const toCreate = normalized.filter(s => !existingMap.has(s.externalId));
            const toUpdate = normalized.filter(s =>  existingMap.has(s.externalId));

            const riceResults = await batchCalculateRice(toCreate, req);
            const [createResults, updateResults] = await Promise.all([
                Promise.all(toCreate.map((s, i) => upsertImportedStory(userId, req.instanceId, s, riceResults[i], existingMap))),
                Promise.all(toUpdate.map(s => upsertImportedStory(userId, req.instanceId, s, null, existingMap))),
            ]);
            const results = [...createResults, ...updateResults];

            await saveImportState(userId, req.instanceId, { initialDone: true, lastSyncAt: new Date().toISOString(), lastSyncCount: results.length });

            let sprintSync = null;
            if (config.boardId)
                sprintSync = await syncSprintsFromJira(userId, req.instanceId, config, { initial: true }).catch(e => ({ error: e.message }));

            const created   = results.filter(r => r.action === 'created').length;
            const updated   = results.filter(r => r.action === 'updated').length;
            const unchanged = results.filter(r => r.action === 'unchanged').length;
            res.json({ success: true, created, updated, unchanged, total: results.length, sprintSync });
        } catch (e) {
            console.error('❌ Import initial:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/import/sync-ranks ───────────────────────────────────────────

    router.post('/sync-ranks', async (req, res) => {
        try {
            const userId = req.userId;
            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });
            if (!config.boardId) return res.status(400).json({ error: 'Board ID is required — set it in Settings > Integrations' });

            const JiraIntegration = require('../integrations/jira');
            const jira = new JiraIntegration(config);

            async function fetchAllAgile(path) {
                const items = [];
                let startAt = 0;
                while (true) {
                    const sep  = path.includes('?') ? '&' : '?';
                    const data = await jira._request('GET', `${path}${sep}maxResults=100&startAt=${startAt}`);
                    const page = data.issues || data.values || [];
                    items.push(...page);
                    startAt += page.length;
                    if (items.length >= (data.total ?? data.values?.length ?? items.length)) break;
                    if (page.length === 0) break;
                }
                return items;
            }

            const rankMap = new Map();
            let rank = 0;
            const sprints = await fetchAllAgile(`/rest/agile/1.0/board/${config.boardId}/sprint?state=active,future`);
            const sorted  = [...sprints.filter(s => s.state === 'active'), ...sprints.filter(s => s.state === 'future')];

            for (const sprint of sorted) {
                const issues = await fetchAllAgile(`/rest/agile/1.0/sprint/${sprint.id}/issue`);
                for (const issue of issues) {
                    rankMap.set(issue.key, { jiraRank: rank++, sprintName: sprint.name, sprintState: sprint.state, sprintId: sprint.id });
                }
            }
            const backlogIssues = await fetchAllAgile(`/rest/agile/1.0/board/${config.boardId}/backlog`);
            for (const issue of backlogIssues) {
                rankMap.set(issue.key, { jiraRank: rank++, sprintName: null, sprintState: null, sprintId: null });
            }

            const { data: rows } = await instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId);
            let updated = 0;
            await Promise.all((rows || []).map(async row => {
                const info = rankMap.get(row.data?.externalId);
                if (!info) return;
                await supabase.from('backlog_stories')
                    .update({ data: { ...row.data, ...info } })
                    .eq('user_id', userId).eq('instance_id', req.instanceId).eq('filename', row.filename);
                updated++;
            }));
            res.json({ success: true, updated, total: rankMap.size });
        } catch (e) {
            console.error('❌ sync-ranks:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/import/sync ─────────────────────────────────────────────────

    router.post('/sync', async (req, res) => {
        try {
            const userId = req.userId;
            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });

            const importer = getImporter(config);
            // Full active-backlog fetch — same JQL as initial import.
            // Timestamp-based incremental filters (updated >= "-Xd") proved unreliable
            // across Jira configurations; a full fetch is safe for typical backlog sizes.
            const raw = await importer.fetchInitial();
            const normalized = raw.map(r => { const n = importer.normalize(r); n.jiraRank = null; return n; });

            const { data: existingRows } = await instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId);
            const existingMap = new Map((existingRows || []).filter(r => r.data?.externalId).map(r => [r.data.externalId, r]));

            const toCreate = normalized.filter(s => !existingMap.has(s.externalId));
            const toUpdate = normalized.filter(s =>  existingMap.has(s.externalId));

            const riceResults = await batchCalculateRice(toCreate, req);

            const [createResults, updateResults] = await Promise.all([
                Promise.all(toCreate.map((s, i) => upsertImportedStory(userId, req.instanceId, s, riceResults[i], existingMap))),
                Promise.all(toUpdate.map(s => upsertImportedStory(userId, req.instanceId, s, null, existingMap))),
            ]);
            const results = [...createResults, ...updateResults];

            // Reconciliation: remove wrong-project or deleted stories
            let removed = 0;
            try {
                const { data: allStored } = await instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId);
                const jiraStories  = (allStored || []).filter(r => r.data?.externalId);
                const wrongProject = config.projectKey
                    ? jiraStories.filter(r => r.data.externalId.split('-')[0] !== config.projectKey)
                    : [];

                const projectClause = config.projectKey ? `project = "${config.projectKey}" AND ` : '';
                let activeKeys = new Set();
                try {
                    const jql    = config.projectKey ? `project = "${config.projectKey}" ORDER BY created ASC` : 'ORDER BY created ASC';
                    const issues = await importer.jira.searchAll(jql, ['summary']);
                    issues.forEach(i => activeKeys.add(i.key));
                } catch (_) { /* Jira unavailable — skip deleted check */ }

                // Identify completed epic keys — their stories must never be deleted
                // (they represent historical epics used as baseline in Epic Lifecycle)
                const epicGroups = new Map();
                for (const row of allStored || []) {
                    const key = row.data?.epicKey ?? row.data?.epicName;
                    if (!key) continue;
                    if (!epicGroups.has(key)) epicGroups.set(key, []);
                    epicGroups.get(key).push(row);
                }
                const completedEpicKeys = new Set();
                for (const [key, epicRows] of epicGroups) {
                    const done = epicRows.filter(r => isDone({ data: r.data })).length;
                    if (done / epicRows.length >= 0.9) completedEpicKeys.add(key);
                }

                const wrongProjectSet = new Set(wrongProject.map(r => r.filename));
                const deletedFromJira = activeKeys.size > 0
                    ? jiraStories.filter(r => !wrongProjectSet.has(r.filename) && !activeKeys.has(r.data.externalId))
                    : [];

                const isHistorical = r => {
                    const key = r.data?.epicKey ?? r.data?.epicName;
                    return key && completedEpicKeys.has(key);
                };

                const toDelete = [...wrongProject, ...deletedFromJira].filter(row => !isHistorical(row));
                if (toDelete.length) {
                    await supabase.from('backlog_stories')
                        .delete()
                        .eq('user_id', userId).eq('instance_id', req.instanceId)
                        .in('filename', toDelete.map(r => r.filename));
                }
                removed = toDelete.length;
            } catch (reconErr) {
                console.warn('⚠️ Reconciliation step failed (non-fatal):', reconErr.message);
            }

            await saveImportState(userId, req.instanceId, { lastSyncAt: new Date().toISOString(), lastSyncCount: results.length });

            // ── Jira comment analysis for Learning Vault ─────────────────────────
            // Fire-and-forget: non-blocking, errors are non-fatal.
            const allNewComments = results
                .filter(r => r.newJiraComments?.length)
                .flatMap(r => r.newJiraComments.map(c => ({ ...c, storyTitle: r.storyTitle })));
            if (allNewComments.length) {
                analyzeJiraComments(allNewComments, userId, req.instanceId, req).catch(e =>
                    console.warn('⚠️ Jira comment analysis (non-fatal):', e.message)
                );
            }

            // ── Signal link suggestions (fire-and-forget) ─────────────────────────
            if (toCreate.length) {
                const toCreateWithFilenames = toCreate.map((s, i) => ({
                    ...s, fileName: results[i]?.fileName,
                }));
                suggestSignalLinksAsync(toCreateWithFilenames, userId, req.instanceId).catch(e =>
                    console.warn('⚠️ Signal link suggestions (non-fatal):', e.message)
                );
            }

            let sprintSync = null;
            if (config.boardId)
                sprintSync = await syncSprintsFromJira(userId, req.instanceId, config, { initial: false }).catch(e => ({ error: e.message }));

            // ── Epic-key backfill: fix any stories that still have no epicKey ─────
            // Handles stories imported before epicKey was tracked, or stories whose
            // epic was assigned after the initial import.
            let epicsUpdated = 0;
            try {
                const { data: allRows } = await instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId);
                const missing = (allRows || []).filter(r => r.data?.externalId && !r.data?.epicKey);
                if (missing.length) {
                    const jiraKeys = missing.map(r => r.data.externalId);
                    const epicData  = new Map();
                    for (let i = 0; i < jiraKeys.length; i += 100) {
                        const batch  = jiraKeys.slice(i, i + 100);
                        const issues = await importer.jira.search(
                            `issueKey in (${batch.join(',')})`,
                            ['customfield_10014', 'customfield_10008', 'parent', 'issuetype'], 100
                        );
                        for (const issue of issues) {
                            const f        = issue.fields;
                            const epicKey  = f.customfield_10014
                                ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.key : null)
                                ?? null;
                            const epicName = f.customfield_10008
                                ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.fields?.summary : null)
                                ?? null;
                            if (epicKey) epicData.set(issue.key, { epicKey, epicName: epicName ?? epicKey });
                        }
                    }
                    const epicPatches = missing
                        .map(row => ({ row, info: epicData.get(row.data.externalId) }))
                        .filter(({ info }) => !!info);
                    await Promise.all(epicPatches.map(({ row, info }) =>
                        supabase.from('backlog_stories')
                            .update({ data: { ...row.data, epicKey: info.epicKey, epicName: info.epicName } })
                            .eq('user_id', userId).eq('instance_id', req.instanceId).eq('filename', row.filename)
                    ));
                    epicsUpdated = epicPatches.length;
                }
            } catch (epicErr) {
                console.warn('⚠️ Epic backfill during sync (non-fatal):', epicErr.message);
            }

            // ── Status sync for completed stories ────────────────────────────────
            // fetchInitial() uses "status not in (Done)", so stories completed in Jira
            // disappear from sync results and their local status is never updated.
            // Fix: query Jira directly for ALL Done-category stories in the project,
            // then update any that exist locally with stale status or missing category key.
            let completedSynced = 0;
            try {
                const projectClause = config.projectKey ? `project = "${config.projectKey}" AND ` : '';
                const doneIssues = await importer.jira.searchAll(
                    `${projectClause}statusCategory = Done ORDER BY updated DESC`,
                    ['status', 'customfield_10020', 'customfield_10014', 'customfield_10008', 'parent', 'issuetype']
                );

                const statusPatches = [];
                for (const issue of doneIssues) {
                    const row = existingMap.get(issue.key);
                    if (!row) continue;   // not in local DB — skip

                    const newStatus      = issue.fields.status?.name || row.data.status;
                    const newCategoryKey = issue.fields.status?.statusCategory?.key ?? 'done';

                    // Parse updated sprint state (sprint may have closed)
                    let sprintState = row.data.sprintState ?? null;
                    const sf = issue.fields.customfield_10020;
                    if (Array.isArray(sf) && sf.length > 0) {
                        const last = sf[sf.length - 1];
                        sprintState = typeof last === 'object'
                            ? (last.state || sprintState)
                            : String(last).match(/state=([^,\]]+)/)?.[1]?.trim() || sprintState;
                    }

                    // Detect epic de-linking
                    const f = issue.fields;
                    const newEpicKey  = f.customfield_10014
                        ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.key : null)
                        ?? null;
                    const newEpicName = f.customfield_10008
                        ?? (f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.fields?.summary : null)
                        ?? null;

                    const statusChanged   = newStatus      !== row.data.status;
                    const categoryChanged = newCategoryKey !== (row.data.statusCategoryKey ?? null);
                    const sprintChanged   = sprintState    !== (row.data.sprintState ?? null);
                    const epicKeyChanged  = newEpicKey     !== (row.data.epicKey ?? null);
                    if (!statusChanged && !categoryChanged && !sprintChanged && !epicKeyChanged) continue;

                    // Compute real lead time for Precede-originated stories going Done
                    const isNowDone = ['done','closed'].includes((newStatus ?? '').toLowerCase());
                    const wasDone   = ['done','closed'].includes((row.data.status ?? '').toLowerCase());
                    let precedeOrigin = row.data.precede_origin ?? null;
                    if (isNowDone && !wasDone && precedeOrigin && !precedeOrigin.lead_time_days) {
                        const resolvedNow   = new Date().toISOString();
                        const anchorDate    = precedeOrigin.oldest_signal_date ?? precedeOrigin.median_signal_at ?? null;
                        if (anchorDate) {
                            const leadDays = Math.round((Date.now() - new Date(anchorDate).getTime()) / 86400000);
                            precedeOrigin  = { ...precedeOrigin, lead_time_days: leadDays, resolved_at: resolvedNow };
                        }
                    }

                    const resolvedAt = isNowDone && !wasDone ? new Date().toISOString() : (row.data.resolvedAt ?? null);
                    statusPatches.push({
                        filename: row.filename,
                        data: { ...row.data, status: newStatus, statusCategoryKey: newCategoryKey, sprintState,
                            epicKey: newEpicKey, epicName: newEpicName ?? row.data.epicName ?? null,
                            resolvedAt, precede_origin: precedeOrigin,
                            updatedAt: new Date().toISOString() },
                    });
                }
                await Promise.all(statusPatches.map(p =>
                    supabase.from('backlog_stories')
                        .update({ data: p.data })
                        .eq('user_id', userId).eq('instance_id', req.instanceId).eq('filename', p.filename)
                ));
                completedSynced = statusPatches.length;
            } catch (doneErr) {
                console.warn('⚠️ Completed-status sync (non-fatal):', doneErr.message);
            }

            const created   = results.filter(r => r.action === 'created').length;
            const updated   = results.filter(r => r.action === 'updated').length;
            const unchanged = results.filter(r => r.action === 'unchanged').length;
            res.json({ success: true, created, updated: updated + epicsUpdated + completedSynced, unchanged, total: results.length, removed, sprintSync });
        } catch (e) {
            console.error('❌ Import sync:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/import/sprints/initial ──────────────────────────────────────

    router.post('/sprints/initial', async (req, res) => {
        try {
            const config = await loadIntegrationConfig(req.userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });
            const result = await syncSprintsFromJira(req.userId, req.instanceId, config, { initial: true });
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('❌ Sprint initial import:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/import/sprints/sync ─────────────────────────────────────────

    router.post('/sprints/sync', async (req, res) => {
        try {
            const config = await loadIntegrationConfig(req.userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });
            const result = await syncSprintsFromJira(req.userId, req.instanceId, config, { initial: false });
            res.json({ success: true, ...result });
        } catch (e) {
            console.error('❌ Sprint sync:', e.message);
            apiError(res, e);
        }
    });

    // ── analyzeJiraComments ───────────────────────────────────────────────────
    // ── suggestSignalLinksAsync ───────────────────────────────────────────────
    // After sync, check if any new stories address untracked demand topics.
    // Uses the Anthropic Batch API (50% cheaper). Submits one batch request,
    // stores the batch ID in settings. Results are resolved lazily on next
    // dashboard load via GET /api/dashboard/signal-link-proposals.

    async function suggestSignalLinksAsync(newStories, userId, instanceId) {
        const { data: settingsRow } = await instanceSelect('settings', 'data', userId, instanceId).single();
        const settings = settingsRow?.data || {};

        const cache = settings.untrackedDemandCache || {};
        const untrackedItems = [...(cache.results || []), ...(cache.olderResults || [])];
        if (!untrackedItems.length) return;

        const stories = newStories
            .filter(s => s.title)
            .slice(0, 20)
            .map(s => ({ id: s.externalId || (s.fileName ? s.fileName.replace('.json', '') : s.id), title: s.title, contentText: s.contentText || '' }));
        if (!stories.length) return;

        const batchResult = await submitBatch([{
            custom_id: `signal-links-${Date.now()}`,
            model:     MODELS.haiku,
            max_tokens: 1024,
            messages:  [{ role: 'user', content: prompts.buildSuggestLinksPrompt({ stories, untrackedItems }) }],
        }]);

        const merged = { ...settings, pendingSignalLinksBatchId: batchResult.id };
        await supabase.from('settings').upsert(
            { user_id: userId, instance_id: instanceId, data: merged, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,instance_id' }
        );
    }

    // Sends new Jira comments to Claude in one batch. For each comment, Claude
    // decides whether it contains a grooming improvement. Results are saved to
    // learning_vault as type='jira_comment' regardless (yes or no).

    async function analyzeJiraComments(comments, userId, instanceId, req) {
        if (!comments.length) return;

        const list = comments.map((c, i) =>
            `[${i}] Story: "${c.storyTitle}" | Author: ${c.author}\nComment: "${c.body.slice(0, 400)}"`
        ).join('\n\n');

        const raw = await callAI({
            model:        MODELS.haiku,
            maxTokens:    800,
            system:       'You are a product management assistant. Always respond with valid JSON only, no markdown, no preamble.',
            messages:     [{
                role: 'user',
                content: `The following are Jira comments on backlog stories. For each, decide if it contains feedback that should improve how similar stories are groomed in the future (missing acceptance criteria, unclear scope, wrong priority, missing context, etc.).\n\nFor each comment return:\n- "index": the comment index\n- "hasImprovement": true or false\n- "recommendation": if true, a GENERAL grooming rule — written as a reusable principle for ANY story type. STRICT RULES: do NOT mention the story title, the feature, any specific field names, any domain terms (e.g. "deadline", "epic", "dashboard"), or any detail from the comment. The rule must read as if it came from a grooming handbook with no knowledge of this story. If false, a brief reason why this comment has nothing actionable for grooming (e.g. "Status update", "Technical implementation detail", "General discussion").\n\nReturn a JSON array.\n\nComments:\n${list}`,
            }],
            callType:     'jira_comment_analysis',
            req,
            deliveryMode: 'batch',
            batchId:      randomUUID(),
        });

        let parsed = [];
        try {
            const match = raw.match(/\[[\s\S]*\]/);
            parsed = match ? JSON.parse(match[0]) : [];
        } catch (_) {
            console.warn('⚠️ Could not parse jira comment analysis JSON');
            return;
        }

        for (const result of parsed) {
            const comment = comments[result.index];
            if (!comment) continue;
            await supabase.from('learning_vault').insert({
                user_id:     userId,
                instance_id: instanceId,
                type:        'jira_comment',
                data: {
                    storyTitle:      comment.storyTitle,
                    author:          comment.author,
                    body:            comment.body.slice(0, 600),
                    hasImprovement:  result.hasImprovement ?? false,
                    recommendation:  result.recommendation ?? '',
                    analyzedAt:      new Date().toISOString(),
                },
            });
        }
    }

    return router;
};
