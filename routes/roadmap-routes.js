'use strict';
// routes/roadmap-routes.js
// Predictive Roadmap — three routes:
//   GET /api/roadmap/epics       — active epics derived from backlog stories
//   GET /api/roadmap/velocity    — historical delivery metrics
//   GET /api/roadmap/projection  — confidence-interval completion projections

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { DONE_STATUSES, isDone, isActive, detectPhase, sprintNumFromName, inferStoryCategory } = require('../utils/story-constants');
const { VELOCITY } = require('../shared/constants');

const DEFAULT_CREEP   = VELOCITY.DEFAULT_CREEP;
const VELOCITY_SHARE  = VELOCITY.PRIORITY_SHARES;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

// Extract epic identifier and name from a story's data blob.
// Priority: Jira epicKey > explicit epic field > first non-status label.
function getEpicInfo(data) {
    if (data.epicKey) {
        return { key: data.epicKey, name: data.epicName ?? data.epicKey };
    }
    if (data.epic) {
        return { key: data.epic, name: data.epicLabel ?? data.epic };
    }
    return null;
}


// Find the sprint a completion date belongs to (sprints must be sorted by start_date asc).
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
        if (cat === 'tech_debt')   tech++;
        else if (cat === 'maintenance') maint++;
    }
    const techPct  = Math.round(tech  / total * 100) / 100;
    const maintPct = Math.round(maint / total * 100) / 100;
    const newPct   = Math.round((1 - techPct - maintPct) * 100) / 100;
    return { new: Math.max(0, newPct), maint: maintPct, tech: techPct };
}

// Build a future sprint schedule from current sprint outwards.
// Returns array of { name, sprint_number, start_date, end_date } for currentOffset + n sprints.
function buildFutureSchedule(currentName, currentEnd, durationDays, count = 20) {
    const baseNum = sprintNumFromName(currentName);
    const base    = new Date(currentEnd);
    const result  = [];
    for (let i = 0; i <= count; i++) {
        const start = new Date(base.getTime() + i * durationDays * 86400000);
        const end   = new Date(start.getTime() + durationDays * 86400000- 1);
        result.push({
            name:          baseNum != null ? `Sprint ${baseNum + i}` : null,
            sprint_number: baseNum != null ? baseNum + i : null,
            start_date:    start.toISOString().slice(0, 10),
            end_date:      end.toISOString().slice(0, 10),
        });
    }
    return result;
}

// Given sprints_needed (float) from now, return { sprintName, completionDate }.
function resolveCompletion(sprintsNeeded, futureSchedule, durationDays) {
    if (!futureSchedule.length) {
        return { completionSprint: null, completionDate: null };
    }
    const idx    = Math.max(0, Math.round(sprintsNeeded) - 1);
    const target = futureSchedule[Math.min(idx, futureSchedule.length - 1)];
    return {
        completionSprint: target.name ?? `+${Math.round(sprintsNeeded)} sprints`,
        completionDate:   target.end_date,
    };
}

// ─── Shared DB helpers ────────────────────────────────────────────────────────

// Load sprint context: active/recent sprints from DB, or calculated from settings.
async function loadSprintContext(supabase, userId, instanceId) {
    const [sprintsRes, settingsRes] = await Promise.all([
        supabase.from('sprints')
            .select('jira_id, name, state, start_date, end_date')
            .eq('user_id', userId)
            .order('start_date', { ascending: true }),
        supabase.from('settings')
            .select('data')
            .eq('user_id', userId)
            .eq('instance_id', instanceId)
            .maybeSingle(),
    ]);

    const allSprints      = (sprintsRes.data ?? []).filter(s => s.start_date && s.end_date);
    const settings        = settingsRes.data?.data ?? {};
    const sprintStartDate = settings.sprint_start_date ?? null;
    const durationDays    = parseInt(settings.sprint_duration_days) || 14;

    // Find active sprint
    let activeSprint = allSprints.find(s => s.state === 'active') ?? null;

    // If no Jira sprints, build from settings
    let calculatedSchedule = [];
    if (!activeSprint && sprintStartDate) {
        const msPerDay    = 86400000;
        const now         = Date.now();
        const daysSince   = Math.floor((now - new Date(sprintStartDate).getTime()) / msPerDay);
        const sprintNum   = Math.max(1, Math.floor(daysSince / durationDays) + 1);
        const offset      = (sprintNum - 1) * durationDays;
        const sprintStart = new Date(new Date(sprintStartDate).getTime() + offset * msPerDay);
        const sprintEnd   = new Date(sprintStart.getTime() + durationDays * msPerDay - 1);

        activeSprint = {
            name:       `Sprint ${sprintNum}`,
            state:      'active',
            start_date: sprintStart.toISOString().slice(0, 10),
            end_date:   sprintEnd.toISOString().slice(0, 10),
        };

        // Pre-build calculated historical sprints for velocity bucketing
        for (let i = Math.max(1, sprintNum - 10); i <= sprintNum; i++) {
            const s   = (i - 1) * durationDays;
            const ss  = new Date(new Date(sprintStartDate).getTime() + s * msPerDay);
            const se  = new Date(ss.getTime() + durationDays * msPerDay - 1);
            calculatedSchedule.push({
                name:       `Sprint ${i}`,
                state:      i === sprintNum ? 'active' : 'closed',
                start_date: ss.toISOString().slice(0, 10),
                end_date:   se.toISOString().slice(0, 10),
            });
        }
    }

    const historicalSprints = allSprints.length
        ? allSprints.filter(s => s.state === 'closed' || s.state === 'active')
        : calculatedSchedule;

    const futureSchedule = activeSprint
        ? buildFutureSchedule(activeSprint.name, activeSprint.end_date, durationDays)
        : [];

    return { activeSprint, historicalSprints, futureSchedule, durationDays };
}

// Load all stories for an instance.
async function loadStories(supabase, userId, instanceId) {
    const { data, error } = await supabase
        .from('backlog_stories')
        .select('filename, data, display_order, created_at')
        .eq('user_id', userId)
        .eq('instance_id', instanceId)
        .order('display_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

// Group stories into epics. Returns Map<epicKey, { key, name, stories, avgPosition }>.
function groupByEpic(stories) {
    const epicMap = new Map();
    for (const s of stories) {
        const info = getEpicInfo(s.data);
        if (!info) continue;
        if (!epicMap.has(info.key)) {
            epicMap.set(info.key, { key: info.key, name: info.name, stories: [], positions: [] });
        }
        const epic = epicMap.get(info.key);
        epic.stories.push(s);
        if (s.display_order != null) epic.positions.push(s.display_order);
    }
    // Attach avgPosition and sort by it (lower = closer to top of backlog = higher priority)
    const epics = [...epicMap.values()].map(e => ({
        ...e,
        avgPosition: e.positions.length
            ? e.positions.reduce((a, b) => a + b, 0) / e.positions.length
            : 9999,
    }));
    epics.sort((a, b) => a.avgPosition - b.avgPosition);
    return epics;
}

// ─── Velocity computation (single source of truth for both /velocity and /projection) ──
//
// Returns all velocity primitives needed by either route.
// Keeps the CLAUDE.md §6 effective-velocity formula in one place.
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

    // Min/max raw velocity (used by /projection for confidence bounds)
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

// ─── Router factory ───────────────────────────────────────────────────────────

module.exports = function createRoadmapRouter(supabase) {
    const router = Router();

    // ── GET /api/roadmap/epics ─────────────────────────────────────────────────

    router.get('/epics', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;

            const [stories, instRes] = await Promise.all([
                loadStories(supabase, userId, instanceId),
                supabase.from('instances').select('name').eq('id', instanceId).single(),
            ]);

            const instanceName = instRes.data?.name ?? instanceId;
            if (!stories.length) return res.json([]);

            const epics = groupByEpic(stories).filter(e => e.stories.length >= 1);

            const result = epics.map(e => {
                const strs       = e.stories;
                const done       = strs.filter(isDone);
                const active     = strs.filter(isActive);
                const remaining  = strs.length - done.length;

                const effPts     = r => Number(r.data?.importedEffort ?? r.data?.storyPoints ?? r.data?.story_points) || 0;
                const totalEff   = strs.reduce((s, r) => s + effPts(r), 0);
                const doneEff    = done.reduce((s, r) => s + effPts(r), 0);

                const dates      = strs.map(r => r.created_at).filter(Boolean).sort();
                const activities = strs.map(r => r.data?.updatedAt ?? r.created_at).filter(Boolean).sort().reverse();

                return {
                    id:            e.key,
                    name:          e.name,
                    instanceId,
                    instanceName,
                    avgPosition:   Math.round(e.avgPosition * 10) / 10,
                    stories: {
                        total:      strs.length,
                        completed:  done.length,
                        remaining,
                        inProgress: active.length,
                    },
                    importedEffort: {
                        total:     totalEff,
                        completed: doneEff,
                        remaining: totalEff - doneEff,
                    },
                    phase:          detectPhase(strs),
                    createdAt:      dates[0]      ?? null,
                    lastActivityAt: activities[0] ?? null,
                };
            });

            res.json(result);
        } catch (e) {
            apiError(res, e, 'roadmap/epics');
        }
    });

    // ── GET /api/roadmap/velocity ──────────────────────────────────────────────

    router.get('/velocity', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;

            const [stories, { historicalSprints, durationDays }] = await Promise.all([
                loadStories(supabase, userId, instanceId),
                loadSprintContext(supabase, userId, instanceId),
            ]);

            if (!stories.length) {
                return res.json({
                    avgStoriesPerSprint: 0, avgPointsPerSprint: 0,
                    carryOverRate: 0.15, newFeaturePct: 1, maintenancePct: 0, techDebtPct: 0,
                    sprintsAnalyzed: 0, lowConfidence: true,
                    velocityByEpic: {}, scopeCreepByPhase: { ...DEFAULT_CREEP },
                });
            }

            // ── Bucket completed stories by sprint ────────────────────────────
            const {
                sprintBuckets, recentKeys, lowConfidence,
                avgStoriesPerSprint, avgPointsPerSprint,
                carryOverRate, split,
            } = computeVelocityStats(stories, historicalSprints);

            // ── Velocity by epic ──────────────────────────────────────────────
            // For each epic, count deliveries across recent sprints
            const epicDeliveries = {};
            for (const key of recentKeys) {
                for (const s of sprintBuckets[key].stories) {
                    const info = getEpicInfo(s.data);
                    if (!info) continue;
                    if (!epicDeliveries[info.key]) epicDeliveries[info.key] = { count: 0, name: info.name };
                    epicDeliveries[info.key].count++;
                }
            }
            const totalDelivered = Object.values(epicDeliveries).reduce((s, e) => s + e.count, 0) || 1;
            const velocityByEpic = {};
            for (const [key, val] of Object.entries(epicDeliveries)) {
                velocityByEpic[key] = {
                    name:                val.name,
                    avgStoriesPerSprint: Math.round((val.count / Math.max(recentKeys.length, 1)) * 10) / 10,
                    shareOfVelocity:     Math.round(val.count / totalDelivered * 100) / 100,
                };
            }

            // ── Scope creep by phase ──────────────────────────────────────────
            // Measure actual growth: stories added to epic after its initial creation.
            // Proxy: compare current story count to earliest known story count per epic.
            // For V1 with limited history: use defaults until pattern emerges.
            const epicGroups = groupByEpic(stories);
            const creepByPhase = { ...DEFAULT_CREEP };
            const phaseObservations = { discovery: [], refinement: [], development: [], completion: [] };

            for (const eg of epicGroups) {
                const phase     = detectPhase(eg.stories);
                const history   = eg.stories.flatMap(s => s.data?.history ?? [])
                    .filter(h => h.field === 'status')
                    .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));

                if (history.length < 2) continue;
                // Stories added relative to oldest story date
                const oldest    = new Date(Math.min(...eg.stories.map(s => new Date(s.created_at || 0))));
                const newer     = eg.stories.filter(s => new Date(s.created_at) - oldest > 7 * 86400000);
                const creepRate = newer.length / Math.max(eg.stories.length, 1);
                phaseObservations[phase].push(creepRate);
            }

            for (const [phase, obs] of Object.entries(phaseObservations)) {
                if (obs.length >= 2) {
                    creepByPhase[phase] = Math.round(
                        obs.reduce((a, b) => a + b, 0) / obs.length * 100
                    ) / 100;
                }
                // else: keep default
            }

            res.json({
                avgStoriesPerSprint:  Math.round(avgStoriesPerSprint * 10) / 10,
                avgPointsPerSprint:   Math.round(avgPointsPerSprint  * 10) / 10,
                carryOverRate:        Math.round(carryOverRate * 100) / 100,
                newFeaturePct:        split.new,
                maintenancePct:       split.maint,
                techDebtPct:          split.tech,
                sprintsAnalyzed:      recentKeys.length,
                lowConfidence,
                velocityByEpic,
                scopeCreepByPhase:    creepByPhase,
            });
        } catch (e) {
            apiError(res, e, 'roadmap/velocity');
        }
    });

    // ── GET /api/roadmap/projection ────────────────────────────────────────────

    router.get('/projection', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;

            const [stories, sprintCtx] = await Promise.all([
                loadStories(supabase, userId, instanceId),
                loadSprintContext(supabase, userId, instanceId),
            ]);

            const { activeSprint, historicalSprints, futureSchedule, durationDays } = sprintCtx;

            if (!stories.length) {
                return res.json({ projections: [], lowConfidence: true, message: 'No stories found' });
            }

            // ── Velocity stats (shared formula via computeVelocityStats) ─────────
            const {
                recentKeys, lowConfidence,
                avgStoriesPerSprint, carryOverRate, split,
                minVelocity, maxVelocity,
            } = computeVelocityStats(stories, historicalSprints);

            // ── Epic grouping + priority ordering ─────────────────────────────
            const epics = groupByEpic(stories)
                .filter(e => {
                    const remaining = e.stories.filter(s => !isDone(s)).length;
                    return e.stories.length >= 1 && remaining > 0;
                });

            // Scope creep by phase (defaults — same as velocity route)
            const scopeCreep = { ...DEFAULT_CREEP };

            // ── Project each epic ─────────────────────────────────────────────
            const projections = epics.map((e, idx) => {
                const priorityRank   = idx + 1;  // 1-based, sorted by avgPosition already
                const velocityShare  = VELOCITY_SHARE[Math.min(idx, VELOCITY_SHARE.length - 1)];
                const phase          = detectPhase(e.stories);
                const creepRate      = scopeCreep[phase];
                const remaining      = e.stories.filter(s => !isDone(s)).length;

                // Effective velocity for this epic
                const effectiveVelocity = Math.max(0.5,
                    avgStoriesPerSprint
                    * (1 - carryOverRate)
                    * split.new
                    * velocityShare
                );

                // Projected scope with average creep
                const sprintsEst        = remaining / effectiveVelocity;
                const projectedScope    = remaining * Math.pow(1 + creepRate, sprintsEst);

                // Most likely
                const likelySprints     = projectedScope / effectiveVelocity;

                // Best case: minimal creep + max velocity
                const bestScope         = remaining * 1.05;
                const bestVelocity      = Math.max(effectiveVelocity,
                    maxVelocity * (1 - carryOverRate) * split.new * velocityShare);
                const bestSprints       = bestScope / Math.max(bestVelocity, 0.5);

                // Worst case: max creep + min velocity
                const worstCreep        = creepRate * 1.5; // 1.5× average = conservative upper bound
                const worstSprintsEst   = remaining / Math.max(
                    minVelocity * (1 - carryOverRate) * split.new * velocityShare, 0.3);
                const worstScope        = remaining * Math.pow(1 + worstCreep, worstSprintsEst);
                const worstVelocity     = Math.max(0.3,
                    minVelocity * (1 - carryOverRate) * split.new * velocityShare);
                const worstSprints      = worstScope / worstVelocity;

                // Map to sprint names + dates
                const best   = resolveCompletion(bestSprints,   futureSchedule, durationDays);
                const likely = resolveCompletion(likelySprints, futureSchedule, durationDays);
                const worst  = resolveCompletion(worstSprints,  futureSchedule, durationDays);

                // Confidence: wider spread = lower confidence
                const spread = worstSprints - bestSprints;
                const likelyConfidence = Math.max(20, Math.min(85, Math.round(85 - spread * 8)));
                const bestConfidence   = Math.min(95, likelyConfidence + 15);

                return {
                    epicId:           e.key,
                    epicName:         e.name,
                    priority:         priorityRank,
                    currentStories:   remaining,
                    projectedStories: Math.round(projectedScope * 10) / 10,
                    phase,
                    velocityShare,
                    effectiveVelocity: Math.round(effectiveVelocity * 10) / 10,
                    projection: {
                        bestCase: {
                            sprintsNeeded:    Math.round(bestSprints   * 10) / 10,
                            completionSprint: best.completionSprint,
                            completionDate:   best.completionDate,
                            confidence:       bestConfidence,
                        },
                        mostLikely: {
                            sprintsNeeded:    Math.round(likelySprints * 10) / 10,
                            completionSprint: likely.completionSprint,
                            completionDate:   likely.completionDate,
                            confidence:       likelyConfidence,
                        },
                        worstCase: {
                            sprintsNeeded:    Math.round(worstSprints  * 10) / 10,
                            completionSprint: worst.completionSprint,
                            completionDate:   worst.completionDate,
                            confidence:       90,
                        },
                    },
                };
            });

            res.json({
                projections,
                lowConfidence,
                activeSprint:    activeSprint?.name ?? null,
                sprintsAnalyzed: recentKeys.length,
                message: lowConfidence
                    ? `Limited sprint history (${recentKeys.length} sprint${recentKeys.length !== 1 ? 's' : ''} detected) — projections will improve over time`
                    : null,
            });
        } catch (e) {
            apiError(res, e, 'roadmap/projection');
        }
    });

    // ── GET /api/roadmap/scenarios ─────────────────────────────────────────────
    // Requires: roadmap_scenarios table (see CLAUDE.md for CREATE TABLE)

    router.get('/scenarios', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;

            const { data, error } = await supabase
                .from('roadmap_scenarios')
                .select('id, name, note, epic_order, visibility, created_at, updated_at')
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .order('updated_at', { ascending: false });

            if (error) throw error;
            res.json(data ?? []);
        } catch (e) {
            // Return empty array rather than 500 if table doesn't exist yet
            if (e.message?.includes('relation') || e.code === '42P01') return res.json([]);
            apiError(res, e, 'roadmap/scenarios GET');
        }
    });

    // ── POST /api/roadmap/scenarios ────────────────────────────────────────────

    router.post('/scenarios', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;
            const { id, name, note, epic_order, visibility } = req.body;

            if (!name?.trim())          return res.status(400).json({ error: 'Name is required' });
            if (!Array.isArray(epic_order)) return res.status(400).json({ error: 'epic_order must be an array' });

            const now = new Date().toISOString();

            if (id) {
                const { data, error } = await supabase
                    .from('roadmap_scenarios')
                    .update({ name: name.trim(), note: note ?? null, epic_order,
                              visibility: visibility ?? 'private', updated_at: now })
                    .eq('id', id)
                    .eq('user_id', userId)
                    .eq('instance_id', instanceId)
                    .select('id, name, note, epic_order, visibility, created_at, updated_at')
                    .single();
                if (error) throw error;
                return res.json(data);
            }

            const { data, error } = await supabase
                .from('roadmap_scenarios')
                .insert({ user_id: userId, instance_id: instanceId,
                          name: name.trim(), note: note ?? null,
                          epic_order, visibility: visibility ?? 'private' })
                .select('id, name, note, epic_order, visibility, created_at, updated_at')
                .single();
            if (error) throw error;
            res.json(data);
        } catch (e) {
            apiError(res, e, 'roadmap/scenarios POST');
        }
    });

    // ── DELETE /api/roadmap/scenarios/:id ──────────────────────────────────────

    router.delete('/scenarios/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;
            const { id }     = req.params;

            const { error } = await supabase
                .from('roadmap_scenarios')
                .delete()
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', instanceId);

            if (error) throw error;
            res.json({ ok: true });
        } catch (e) {
            apiError(res, e, 'roadmap/scenarios DELETE');
        }
    });

    // ── GET /api/roadmap/milestones ────────────────────────────────────────────

    router.get('/milestones', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;

            const { data, error } = await supabase
                .from('roadmap_milestones')
                .select('id, name, date, type, linked_epic_ids, note, created_by, created_at')
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .order('date', { ascending: true });

            if (error) throw error;
            res.json(data ?? []);
        } catch (e) {
            if (e.message?.includes('relation') || e.code === '42P01') return res.json([]);
            apiError(res, e, 'roadmap/milestones GET');
        }
    });

    // ── POST /api/roadmap/milestones ───────────────────────────────────────────

    router.post('/milestones', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;
            const { name, date, type, linkedEpicIds, note } = req.body;

            if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
            if (!date)         return res.status(400).json({ error: 'Date is required' });

            const { data, error } = await supabase
                .from('roadmap_milestones')
                .insert({
                    user_id:         userId,
                    instance_id:     instanceId,
                    name:            name.trim(),
                    date,
                    type:            type ?? 'internal',
                    linked_epic_ids: linkedEpicIds ?? [],
                    note:            note ?? null,
                    created_by:      'pm',
                })
                .select('id, name, date, type, linked_epic_ids, note, created_by, created_at')
                .single();

            if (error) throw error;
            res.json(data);
        } catch (e) {
            apiError(res, e, 'roadmap/milestones POST');
        }
    });

    // ── PUT /api/roadmap/milestones/:id ────────────────────────────────────────

    router.put('/milestones/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;
            const { id }     = req.params;
            const { name, date, type, linkedEpicIds, note } = req.body;

            if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
            if (!date)         return res.status(400).json({ error: 'Date is required' });

            const { data, error } = await supabase
                .from('roadmap_milestones')
                .update({
                    name:            name.trim(),
                    date,
                    type:            type ?? 'internal',
                    linked_epic_ids: linkedEpicIds ?? [],
                    note:            note ?? null,
                })
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .select('id, name, date, type, linked_epic_ids, note, created_by, created_at')
                .single();

            if (error) throw error;
            res.json(data);
        } catch (e) {
            apiError(res, e, 'roadmap/milestones PUT');
        }
    });

    // ── DELETE /api/roadmap/milestones/:id ─────────────────────────────────────

    router.delete('/milestones/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const instanceId = req.instanceId;
            const { id }     = req.params;

            const { error } = await supabase
                .from('roadmap_milestones')
                .delete()
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', instanceId);

            if (error) throw error;
            res.json({ ok: true });
        } catch (e) {
            apiError(res, e, 'roadmap/milestones DELETE');
        }
    });

    return router;
};
