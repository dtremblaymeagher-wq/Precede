// routes/exec-routes.js
// Executive Dashboard server routes — fully isolated from PM logic.
//
// All routes are under /api/exec/ (mounted by server.js).
// Reads from PM instances but never modifies them.
//
// V1: aggregates across all 'pm' instances belonging to the same user account.
// V2: will aggregate across multiple PM user accounts connected to an exec account.
//     Migration path: replace getPmInstances() with a cross-account version.

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { sprintNumFromName, inferStoryCategory } = require('../utils/story-constants');
const { callAI, MODELS } = require('../shared/ai-client');
const { buildExecSynthesisSystem } = require('../shared/prompts');

module.exports = function createExecRouter(supabase) {
    const router = Router();

    // ─── Helpers ──────────────────────────────────────────────────────────────

    // Returns all PM instances for a user (V1: same account only).
    async function getPmInstances(userId) {
        const { data, error } = await supabase
            .from('instances')
            .select('id, name, color')
            .eq('user_id', userId)
            .or('instance_type.eq.pm,instance_type.is.null')
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data ?? [];
    }

    // okr_alignment is an array [{okr, score, trend, rationale}] — average all scores
    function extractOkrScore(record) {
        try {
            const a   = record.data?.analysis ?? record.data;
            const arr = Array.isArray(a?.okr_alignment) ? a.okr_alignment : null;
            if (!arr?.length) return null;
            const scores = arr.map(o => o.score).filter(s => typeof s === 'number');
            return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        } catch { return null; }
    }

    // signal_coverage score: based on intelligence entry count per instance.
    // 10 entries in the last 90 days = 100%. Trend compares last 45d vs 45–90d.
    function computeCoverageByEntries(entries, instanceId, instanceName) {
        const now = Date.now();
        const d45 = now - 45 * 86400000;
        const d90 = now - 90 * 86400000;
        const inst = entries.filter(e => e.instance_id === instanceId);
        const recent = inst.filter(e => new Date(e.created_at).getTime() >= d45).length;
        const older  = inst.filter(e => {
            const t = new Date(e.created_at).getTime();
            return t >= d90 && t < d45;
        }).length;
        const score = Math.min(100, Math.round(recent / 10 * 100));
        const prevScore = Math.min(100, Math.round(older / 10 * 100));
        const trend = inst.some(e => new Date(e.created_at).getTime() >= d90) ? score - prevScore : null;
        return { instance_id: instanceId, instance_name: instanceName, score, trend };
    }


    // ─── GET /api/exec/instances ──────────────────────────────────────────────
    // List all PM instances for this user.
    // Free path — no X-Instance-Id required (added to INSTANCE_FREE_PATHS in server.js).

    router.get('/instances', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            res.json(pmInstances);
        } catch (e) { apiError(res, e); }
    });

    // ─── GET /api/exec/strategic ──────────────────────────────────────────────
    // Section 1: OKR alignment trend, OKR objectives, signal coverage,
    //            vision drift, focus guard.

    router.get('/strategic', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            const pmIds       = pmInstances.map(i => i.id);
            const instanceMap = Object.fromEntries(pmInstances.map(i => [i.id, i]));

            if (pmIds.length === 0) {
                return res.json({ pm_instances: [], okr_trend: [], okr_objectives: [], signal_coverage: [], vision_drift: null, focus_guard: [] });
            }

            const [analysesRes, settingsRes, storiesRes, sprintsRes, entriesRes] = await Promise.all([
                supabase.from('analysis_history')
                    .select('instance_id, data, created_at, filename')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(24),
                supabase.from('settings')
                    .select('instance_id, data')
                    .eq('user_id', userId).in('instance_id', pmIds),
                supabase.from('backlog_stories')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(300),
                supabase.from('sprints')
                    .select('instance_id, name, state, start_date, end_date')
                    .eq('user_id', userId)
                    .order('start_date', { ascending: false }),
                supabase.from('intelligence_entries')
                    .select('instance_id, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
            ]);

            const analyses = analysesRes.data ?? [];
            const settings = settingsRes.data ?? [];
            const stories  = storiesRes.data ?? [];
            const jiraSprints = sprintsRes.data ?? [];
            const entries  = entriesRes.data ?? [];


            // Match an analysis created_at to the Jira sprint it was run during.
            // Compare as date strings (YYYY-MM-DD) to avoid UTC midnight edge cases
            // where a timestamp on end_date day falls after new Date(end_date) midnight.
            // Falls back to a short date string if no sprint covers that date.
            function sprintLabelForDate(createdAt, instanceId) {
                const day = createdAt.slice(0, 10); // "YYYY-MM-DD"
                // Match only sprints belonging to the same instance
                const instanceSprints = instanceId
                    ? jiraSprints.filter(s => s.instance_id === instanceId)
                    : jiraSprints;
                for (const s of instanceSprints) {
                    if (day >= s.start_date && day <= s.end_date) return s.name;
                }
                return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            // Widget 1A — OKR Horizontal Alignment Trend
            // One entry per sprint per instance (most recent analysis wins).
            // Analyses are already sorted newest-first, so first occurrence of each sprint label wins.
            const _okrSeenSprint = {};
            const _okrCountByInst = {};
            const okr_trend = analyses
                .map(r => {
                    const score = extractOkrScore(r);
                    if (score === null) return null;
                    const sprintLabel = sprintLabelForDate(r.created_at, r.instance_id);
                    const a = r.data?.analysis ?? r.data ?? {};
                    const okr_details = Array.isArray(a?.okr_alignment) ? a.okr_alignment : [];
                    return {
                        instance_id:   r.instance_id,
                        instance_name: instanceMap[r.instance_id]?.name ?? 'Unknown',
                        sprint:        sprintLabel,
                        score,
                        date:          r.created_at,
                        okr_details,
                    };
                })
                .filter(Boolean)
                .filter(r => {
                    // Deduplicate: one data point per sprint per instance
                    const key = `${r.instance_id}:${r.sprint}`;
                    if (_okrSeenSprint[key]) return false;
                    _okrSeenSprint[key] = true;
                    // Cap at 6 sprints per instance
                    _okrCountByInst[r.instance_id] = (_okrCountByInst[r.instance_id] ?? 0) + 1;
                    return _okrCountByInst[r.instance_id] <= 6;
                });

            // Widget 1B — OKR Vertical Alignment (PM OKRs per instance)
            const okr_objectives = settings.map(s => ({
                instance_id:   s.instance_id,
                instance_name: instanceMap[s.instance_id]?.name ?? 'Unknown',
                objectives:    s.data?.objectives ?? null,
                vision:        s.data?.vision ?? null,
            }));

            // Widget 2 — Signal Capture (based on actual intelligence entry count, 90-day window)
            const signal_coverage = pmInstances.map(inst =>
                computeCoverageByEntries(entries, inst.id, inst.name)
            );

            // Widget 3 — Product Vision Alignment (per instance, latest OKR score + trend)
            const vision_alignment = pmInstances.map(inst => {
                const instOkrs = okr_trend.filter(r => r.instance_id === inst.id);
                const latest   = instOkrs[0] ?? null;
                const prev     = instOkrs[1] ?? null;
                if (!latest) return { instance_id: inst.id, instance_name: inst.name, score: null, trend: null };
                const trend = prev !== null ? latest.score - prev.score : null;
                return { instance_id: inst.id, instance_name: inst.name, score: latest.score, trend };
            });

            // Current sprint detection for W4.
            // Primary: sprintState stored on each story by the Jira importer ('active' | 'future' | 'closed').
            // Fallback: name-match against sprints table (state=active or date range covers today).
            const today = new Date().toISOString().slice(0, 10);
            const activeSprintNames = new Set(
                jiraSprints
                    .filter(sp => sp.state === 'active' || (sp.start_date <= today && sp.end_date >= today))
                    .map(sp => sp.name)
            );
            if (activeSprintNames.size === 0 && jiraSprints.length > 0) {
                activeSprintNames.add(jiraSprints[0].name);
            }
            function isCurrentSprintStory(s) {
                if (s.data?.sprintState === 'active') return true;
                if (activeSprintNames.size > 0 && s.data?.sprintName) return activeSprintNames.has(s.data.sprintName);
                return false;
            }

            // Widget 4 — Resource Allocation: last 3 sprints per instance
            // Build a helper that categorises a list of stories into {new_value, maintenance, tech_debt}
            function categoriseStories(list) {
                const cats = { new_value: [], maintenance: [], tech_debt: [] };
                for (const s of list) {
                    const cat = s.data?.category ?? inferStoryCategory(s.data);
                    const key = cat === 'tech_debt' ? 'tech_debt' : cat === 'maintenance' ? 'maintenance' : 'new_value';
                    cats[key].push({ title: s.data?.title ?? '(no title)', jiraKey: s.data?.jiraKey ?? null, status: (s.data?.status ?? '').toLowerCase() });
                }
                return cats;
            }

            // W4 shows completed sprints only — active sprint data is partial and misleading.
            // Per-instance: use each instance's own 3 most recent non-active sprints.

            const focus_guard = pmInstances.map(inst => {
                const instStories = stories.filter(s => s.instance_id === inst.id);
                const instRecentSprints = jiraSprints
                    .filter(sp => sp.instance_id === inst.id && sp.state !== 'active')
                    .slice(0, 3);

                const buildBreakdown = (spStories, name) => {
                    const cats  = categoriseStories(spStories);
                    const total = cats.new_value.length + cats.maintenance.length + cats.tech_debt.length;
                    if (total === 0) return null;
                    return {
                        name, is_current: false,
                        new_value_pct:   Math.round(cats.new_value.length   / total * 100),
                        maintenance_pct: Math.round(cats.maintenance.length / total * 100),
                        tech_debt_pct:   Math.round(cats.tech_debt.length   / total * 100),
                        total,
                        stories_by_category: cats,
                    };
                };

                let sprintBreakdowns = instRecentSprints
                    .map(sp => buildBreakdown(
                        instStories.filter(s => s.data?.sprintName === sp.name),
                        sp.name
                    ))
                    .filter(Boolean);

                // Fallback: sprint table exists but nothing matched — show non-active stories ungrouped
                if (sprintBreakdowns.length === 0 && instStories.length > 0) {
                    const nonActive = instStories.filter(s => s.data?.sprintState !== 'active');
                    const fallback = buildBreakdown(nonActive.length ? nonActive : instStories, null);
                    if (fallback) sprintBreakdowns = [fallback];
                }

                return { instance_id: inst.id, instance_name: inst.name, sprints: sprintBreakdowns };
            });

            res.json({ pm_instances: pmInstances, okr_trend, okr_objectives, signal_coverage, vision_alignment, focus_guard });
        } catch (e) { apiError(res, e); }
    });

    // ─── GET /api/exec/pulse ──────────────────────────────────────────────────
    // Section 2: Sprint scope drift, signal to delivery velocity, epic health.

    router.get('/pulse', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            const pmIds       = pmInstances.map(i => i.id);
            const instanceMap = Object.fromEntries(pmInstances.map(i => [i.id, i]));

            if (pmIds.length === 0) {
                return res.json({ pm_instances: [], scope_drift: [], signal_velocity: [], epic_health: [] });
            }

            const [storiesRes, signalsRes, sprintCompletionRes] = await Promise.all([
                supabase.from('backlog_stories')
                    .select('instance_id, data, created_at, display_order')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(500),
                supabase.from('intelligence_entries')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(200),
                supabase.from('sprints')
                    .select('instance_id, jira_id, name, state, start_date, end_date, completed_count, total_count, added_count, removed_count, rollover_count')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .eq('state', 'closed')
                    .not('completed_count', 'is', null)
                    .order('start_date', { ascending: false })
                    .limit(50),
            ]);

            const stories = storiesRes.data ?? [];
            const signals = signalsRes.data ?? [];

            // Widget 5 — Sprint Predictability using Jira Agile sprint completion data
            // Deduplicate by (instance_id, jira_id) only — same name is allowed (Jira permits it).
            const _seenSprints = new Set();
            const closedSprintsWithStats = (sprintCompletionRes.data ?? []).filter(s => {
                const key = `${s.instance_id}:${s.jira_id}`;
                if (_seenSprints.has(key)) return false;
                _seenSprints.add(key);
                return true;
            });
            const scope_drift = pmInstances.map(inst => {
                const instSprints = closedSprintsWithStats
                    .filter(s => s.instance_id === inst.id && s.total_count > 0)
                    .slice(0, 4)
                    .sort((a, b) => {
                        // Primary: start_date ascending
                        if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
                        // Fallback: sprint number extracted from name
                        const na = sprintNumFromName(a.name), nb = sprintNumFromName(b.name);
                        if (na !== null && nb !== null) return na - nb;
                        return String(a.name).localeCompare(String(b.name));
                    });
                const predictability = instSprints.length
                    ? Math.min(100, Math.round(instSprints.reduce((sum, s) => sum + s.completed_count / s.total_count, 0) / instSprints.length * 100))
                    : null;
                const sprints = instSprints.map(s => ({
                    jira_id:    String(s.jira_id),
                    period:     s.name,
                    start_date: s.start_date   ?? null,
                    planned:    s.total_count,
                    delivered:  s.completed_count,
                    added:      s.added_count   ?? 0,
                    removed:    s.removed_count  ?? 0,
                    rollover:   s.rollover_count ?? 0,
                }));
                return { instance_id: inst.id, instance_name: instanceMap[inst.id]?.name ?? inst.name, color: instanceMap[inst.id]?.color ?? '#6366f1', predictability, sprints };
            });

            // Widget 6 — Response Lead Time (per instance)
            const now = Date.now();
            const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
            const signal_velocity = pmInstances.map(inst => {
                const instSignals  = signals.filter(s => s.instance_id === inst.id);
                const instStories  = stories.filter(s => s.instance_id === inst.id);

                // Traced lead time: Done stories with precede_origin.lead_time_days only
                const tracedLeadTimes = instStories
                    .filter(s => ['done', 'closed'].includes((s.data?.status ?? '').toLowerCase()))
                    .map(s => s.data?.precede_origin?.lead_time_days)
                    .filter(v => v != null);
                const avgTracedLeadTime = avg(tracedLeadTimes);

                // Monthly breakdown — last 3 months, keyed by Jira completion date
                const nowDate = new Date(now);
                const monthly_lead_time = Array.from({ length: 3 }, (_, i) => {
                    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - (2 - i), 1);
                    const year = d.getFullYear();
                    const month = d.getMonth();
                    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                    const times = instStories
                        .filter(s => {
                            const resolvedAt = s.data?.precede_origin?.resolved_at ?? s.data?.resolvedAt ?? null;
                            if (!resolvedAt || s.data?.precede_origin?.lead_time_days == null) return false;
                            const rd = new Date(resolvedAt);
                            return rd.getFullYear() === year && rd.getMonth() === month;
                        })
                        .map(s => s.data.precede_origin.lead_time_days);
                    return { label, avg_lead_time: avg(times), count: times.length };
                });

                const signalIndex = Object.fromEntries(
                    instSignals.filter(s => s.data?.id != null).map(s => [s.data.id, s])
                );
                const signalPairs = instStories
                    .filter(s => s.data?.precede_origin)
                    .slice(0, 20)
                    .map(s => {
                        const origin  = s.data.precede_origin;
                        const signals = (origin.signal_ids ?? [])
                            .map(id => signalIndex[id])
                            .filter(Boolean)
                            .map(sig => ({
                                body:       sig.data?.body ?? '',
                                date:       sig.data?.date ?? null,
                                sourceType: sig.data?.sourceType ?? 'Signal',
                            }));
                        return {
                            title:          s.data.title ?? '',
                            externalId:     s.data.externalId ?? null,
                            lead_time_days: origin.lead_time_days ?? null,
                            resolved_at:    origin.resolved_at ?? s.data.resolvedAt ?? null,
                            signals,
                        };
                    });
                return {
                    instance_id:          inst.id,
                    instance_name:        instanceMap[inst.id]?.name ?? inst.name,
                    avg_traced_lead_time: avgTracedLeadTime,
                    traced_count:         tracedLeadTimes.length,
                    monthly_lead_time,
                    signal_count:         instSignals.length,
                    signal_pairs:         signalPairs,
                };
            });

            // Widget 7 — Epic Health
            const epicMap = {};
            for (const s of stories) {
                const epic = s.data?.epic ?? s.data?.labels?.[0];
                if (!epic) continue;
                const key = `${s.instance_id}::${epic}`;
                if (!epicMap[key]) epicMap[key] = { epic, instance_name: instanceMap[s.instance_id]?.name ?? '', total: 0, done: 0 };
                epicMap[key].total++;
                if (['done', 'closed'].includes((s.data?.status ?? '').toLowerCase())) epicMap[key].done++;
            }
            const epic_health = Object.values(epicMap)
                .filter(e => e.total >= 2)
                .map(e => ({
                    ...e,
                    pct_done: Math.round(e.done / e.total * 100),
                    health:   e.done / e.total > 0.8 ? 'good' : e.done / e.total > 0.4 ? 'watch' : 'at_risk',
                }))
                .sort((a, b) => a.pct_done - b.pct_done)
                .slice(0, 10);

            res.json({ pm_instances: pmInstances, scope_drift, signal_velocity, epic_health });
        } catch (e) { apiError(res, e); }
    });

    // ─── GET /api/exec/forward ────────────────────────────────────────────────
    // Section 3: Predictive timeline, risk trajectory, decisions required.

    router.get('/forward', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            const pmIds       = pmInstances.map(i => i.id);
            const instanceMap = Object.fromEntries(pmInstances.map(i => [i.id, i]));

            if (pmIds.length === 0) {
                return res.json({ pm_instances: [], predictive_timeline: [], risks: [], decisions_required: [] });
            }

            // Fetch the latest radar analysis per PM instance + active sprint + stories in parallel
            const [analysesRes, storiesRes, activeSprintRes, settingsRes, fwdEntriesRes] = await Promise.all([
                supabase.from('analysis_history')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId)
                    .in('instance_id', pmIds)
                    .order('created_at', { ascending: false })
                    .limit(pmIds.length * 10),
                supabase.from('backlog_stories')
                    .select('instance_id, data, display_order')
                    .eq('user_id', userId)
                    .in('instance_id', pmIds)
                    .order('display_order', { ascending: true })
                    .limit(300),
                supabase.from('sprints')
                    .select('name, state, start_date, end_date')
                    .eq('user_id', userId)
                    .eq('state', 'active')
                    .limit(1)
                    .maybeSingle(),
                supabase.from('settings')
                    .select('instance_id, data')
                    .eq('user_id', userId)
                    .in('instance_id', pmIds)
                    .limit(pmIds.length),
                supabase.from('intelligence_entries')
                    .select('instance_id, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
            ]);

            // Keep only the latest row per instance (results already ordered desc)
            const _seen = new Set();
            const latestAnalyses = (analysesRes.data ?? []).filter(row => {
                if (_seen.has(row.instance_id)) return false;
                _seen.add(row.instance_id);
                return true;
            });
            const allStories     = storiesRes.data ?? [];
            const activeSprint   = activeSprintRes.data ?? null;
            const settingsRows   = settingsRes.data ?? [];
            const fwdEntries     = fwdEntriesRes.data ?? [];

            // Determine current sprint number + duration for projection
            // Priority: Jira active sprint → settings sprint config
            let currentSprintNum  = null;
            let sprintDurationDays = 14;
            let currentSprintEnd  = null;

            if (activeSprint?.end_date) {
                currentSprintEnd   = new Date(activeSprint.end_date);
                currentSprintNum   = sprintNumFromName(activeSprint.name);
                if (activeSprint.start_date) {
                    sprintDurationDays = Math.round((new Date(activeSprint.end_date) - new Date(activeSprint.start_date)) / 86400000) || 14;
                }
            } else {
                // Fall back to first PM instance's settings sprint config
                const firstSettings = settingsRows[0]?.data ?? {};
                const startDate     = firstSettings.sprint_start_date;
                const duration      = parseInt(firstSettings.sprint_duration_days) || 14;
                if (startDate) {
                    sprintDurationDays = duration;
                    const msPerDay     = 86400000;
                    const daysSince    = Math.floor((Date.now() - new Date(startDate).getTime()) / msPerDay);
                    currentSprintNum   = Math.floor(daysSince / duration) + 1;
                    const offset       = (currentSprintNum - 1) * duration;
                    currentSprintEnd   = new Date(new Date(startDate).getTime() + (offset + duration - 1) * msPerDay);
                }
            }

            // Helper: project target sprint name + date from a number of sprints ahead
            function projectSprint(sprintsAhead) {
                if (currentSprintNum === null && currentSprintEnd === null) return null;
                const targetNum  = currentSprintNum !== null ? currentSprintNum + sprintsAhead : null;
                const targetDate = currentSprintEnd
                    ? new Date(currentSprintEnd.getTime() + sprintsAhead * sprintDurationDays * 86400000)
                    : null;
                const datePart   = targetDate
                    ? targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : null;
                if (targetNum && datePart) return `Sprint ${targetNum} · ${datePart}`;
                if (targetNum)             return `Sprint ${targetNum}`;
                if (datePart)              return datePart;
                return null;
            }

            // Widget 8 — Predictive Timeline (top epics with remaining work)
            const epicMap = {};
            for (const s of allStories) {
                const epic = s.data?.epic ?? s.data?.labels?.[0];
                if (!epic) continue;
                const key = `${s.instance_id}::${epic}`;
                if (!epicMap[key]) epicMap[key] = { epic, instance_name: instanceMap[s.instance_id]?.name ?? '', total: 0, remaining: 0, points: 0 };
                epicMap[key].total++;
                if (!['done', 'closed'].includes((s.data?.status ?? '').toLowerCase())) {
                    epicMap[key].remaining++;
                    epicMap[key].points += Number(s.data?.importedEffort ?? s.data?.storyPoints ?? s.data?.story_points ?? 1);
                }
            }
            const predictive_timeline = Object.values(epicMap)
                .filter(e => e.total >= 2 && e.remaining > 0)
                .sort((a, b) => b.remaining - a.remaining)
                .slice(0, 6)
                .map(e => {
                    const sprintsAhead = Math.ceil(e.points / 8);
                    return {
                        ...e,
                        sprints_remaining:  sprintsAhead,
                        target_sprint_label: projectSprint(sprintsAhead),
                    };
                });

            // Widget 9 — Risk Trajectory
            // radar risks have {title, description} — no severity field; churn_signals have {actor, signal, risk_level}
            const risks = [];
            for (const a of latestAnalyses) {
                const analysis     = a.data?.analysis ?? a.data ?? {};
                const instanceName = instanceMap[a.instance_id]?.name ?? 'Unknown';
                for (const r of (analysis.risks ?? []).slice(0, 5)) {
                    const desc = r.description ?? r.title ?? String(r);
                    risks.push({ instance_name: instanceName, description: desc, severity: 'medium', type: 'general' });
                }
                const churnList = analysis.longitudinal?.churn_signals ?? analysis.churn_signals ?? [];
                for (const c of churnList.slice(0, 3)) {
                    const desc     = c.signal ?? c.description ?? String(c);
                    const severity = c.risk_level === 'high' ? 'high' : c.risk_level === 'low' ? 'low' : 'medium';
                    risks.push({ instance_name: instanceName, description: desc, severity, type: 'churn' });
                }
            }
            const severityOrder = { critical: 0, high: 1, medium: 2, watch: 3, low: 4 };
            risks.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

            // Widget 10 — Decisions Required (auto-detected from scores + risks + milestone proximity)
            //
            // Severity rules:
            //   critical — churn high · epic completion < 2 sprints from a milestone · OKR < 30%
            //   warning  — OKR 30-50% · signal coverage < 35% · epic within 3 sprints of milestone
            //   watch    — general risks · remaining radar risks

            // Milestone proximity helper
            // epics in predictive_timeline have target_sprint_label "Sprint 14 · Apr 7"
            // parse the date part to compare against known milestone dates
            const MILESTONES = settingsRows.flatMap(s =>
                (s.data?.milestones ?? []).map(m => ({ date: new Date(m.date), label: m.label }))
            ).filter(m => !isNaN(m.date));

            function epicMilestoneProximity(targetLabel) {
                if (!targetLabel || !MILESTONES.length) return null;
                const match = targetLabel.match(/·\s*(.+)$/);
                if (!match) return null;
                const targetDate = new Date(match[1] + ' ' + new Date().getFullYear());
                if (isNaN(targetDate)) return null;
                let closest = null;
                for (const m of MILESTONES) {
                    const daysFromMilestone = Math.round((targetDate - m.date) / 86400000);
                    // positive = epic ends AFTER milestone = at risk
                    if (daysFromMilestone > 0 && (closest === null || daysFromMilestone < closest.days)) {
                        closest = { days: daysFromMilestone, label: m.label };
                    }
                }
                return closest;
            }

            const decisions_required = [];

            // Check each epic in predictive timeline for milestone proximity
            for (const e of predictive_timeline) {
                const proximity = epicMilestoneProximity(e.target_sprint_label);
                if (!proximity) continue;
                const severity = proximity.days <= sprintDurationDays * 2 ? 'critical'
                               : proximity.days <= sprintDurationDays * 3 ? 'warning'
                               : 'watch';
                decisions_required.push({
                    instance_name:    e.instance_name,
                    type:             'milestone_risk',
                    severity,
                    description:      `${e.epic} at risk of missing "${proximity.label}" — projected to complete ${proximity.days} days after milestone`,
                    suggested_action: severity === 'critical'
                        ? 'Escalate immediately — re-scope or negotiate milestone date'
                        : 'Review epic scope and velocity before next sprint',
                });
            }

            for (const a of latestAnalyses) {
                const analysis     = a.data?.analysis ?? a.data ?? {};
                const instanceName = instanceMap[a.instance_id]?.name ?? 'Unknown';

                // Derive scores the same way as /strategic
                const okrArr    = Array.isArray(analysis.okr_alignment) ? analysis.okr_alignment : [];
                const okrScores = okrArr.map(o => o.score).filter(s => typeof s === 'number');
                const okrScore  = okrScores.length ? Math.round(okrScores.reduce((a, b) => a + b, 0) / okrScores.length) : null;
                const recent45  = fwdEntries.filter(e => e.instance_id === a.instance_id && (Date.now() - new Date(e.created_at).getTime()) < 45 * 86400000).length;
                const covScore  = Math.min(100, Math.round(recent45 / 10 * 100));

                if (okrScore !== null && okrScore < 50) {
                    decisions_required.push({
                        instance_name:    instanceName,
                        type:             'okr_misalignment',
                        severity:         okrScore < 30 ? 'critical' : 'warning',
                        description:      `OKR alignment at ${okrScore}% — below threshold`,
                        suggested_action: 'Review sprint priorities against OKRs in next planning session',
                    });
                }
                if (covScore < 35) {
                    decisions_required.push({
                        instance_name:    instanceName,
                        type:             'signal_coverage',
                        severity:         'warning',
                        description:      `Signal coverage at ${covScore}% — hub needs attention`,
                        suggested_action: 'Ask PM to capture recent client feedback in Intelligence Hub',
                    });
                }
                // Top radar risks → watch level (no severity in raw data)
                for (const r of (analysis.risks ?? []).slice(0, 2)) {
                    decisions_required.push({
                        instance_name:    instanceName,
                        type:             'risk',
                        severity:         'watch',
                        description:      r.title ? `${r.title} — ${r.description}` : (r.description ?? String(r)),
                        suggested_action: 'Monitor and flag if risk escalates before next sprint',
                    });
                }
                // High churn → critical
                const churnList = analysis.longitudinal?.churn_signals ?? analysis.churn_signals ?? [];
                for (const c of churnList.filter(c => c.risk_level === 'high').slice(0, 1)) {
                    decisions_required.push({
                        instance_name:    instanceName,
                        type:             'churn',
                        severity:         'critical',
                        description:      `Churn risk: ${c.actor ?? ''} — ${c.signal ?? c.description ?? ''}`.trim(),
                        suggested_action: 'Address churn signals before next sprint to prevent disengagement',
                    });
                }
            }
            decisions_required.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

            res.json({
                pm_instances: pmInstances,
                predictive_timeline,
                risks:               risks.slice(0, 10),
                decisions_required:  decisions_required.slice(0, 8),
            });
        } catch (e) { apiError(res, e); }
    });

    // ─── GET /api/exec/current-sprint ────────────────────────────────────────
    // Live facts for the currently active sprint — no scores, no judgments.
    // This is the only exec route whose data changes meaningfully on every refresh.

    router.get('/current-sprint', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            const pmIds       = pmInstances.map(i => i.id);

            if (pmIds.length === 0) {
                return res.json({ sprint: null, instances: [] });
            }

            const [sprintRes, storiesRes, signalsRes] = await Promise.all([
                supabase.from('sprints')
                    .select('name, state, start_date, end_date')
                    .eq('user_id', userId).eq('state', 'active')
                    .limit(1).maybeSingle(),
                supabase.from('backlog_stories')
                    .select('instance_id, data')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(400),
                supabase.from('intelligence_entries')
                    .select('instance_id, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds),
            ]);

            const sprint  = sprintRes.data ?? null;
            const stories = storiesRes.data ?? [];
            const signals = signalsRes.data ?? [];

            if (!sprint) {
                return res.json({ sprint: null, instances: [] });
            }

            const sprintStart = new Date(sprint.start_date);

            const instances = pmInstances.map(inst => {
                const instStories   = stories.filter(s => s.instance_id === inst.id);
                const activeStories = instStories.filter(s => s.data?.sprintState === 'active');
                const done          = activeStories.filter(s =>
                    ['done', 'closed'].includes((s.data?.status ?? '').toLowerCase())
                ).length;

                // Added mid-sprint: created in Jira after sprint start, OR moved into sprint after sprint start
                const added = activeStories.filter(s => {
                    if (s.data?.jiraCreatedAt && new Date(s.data.jiraCreatedAt) > sprintStart) return true;
                    const h = (s.data?.history ?? []).filter(e => e.field === 'sprintName' && e.to === sprint.name);
                    return h.length > 0 && new Date(h[h.length - 1].changedAt) > sprintStart;
                }).length;

                // Removed mid-sprint: history shows they were in this sprint but are no longer active in it
                const removed = instStories.filter(s => {
                    if (s.data?.sprintState === 'active') return false;
                    return (s.data?.history ?? []).some(e => e.field === 'sprintName' && e.to === sprint.name);
                }).length;

                const committed = activeStories.length - added;

                const signalsThisSprint = signals.filter(s =>
                    s.instance_id === inst.id && new Date(s.created_at) >= sprintStart
                ).length;

                const epicsDone = new Set(
                    activeStories
                        .filter(s => ['done', 'closed'].includes((s.data?.status ?? '').toLowerCase()) && s.data?.epicKey)
                        .map(s => s.data.epicKey)
                );

                return {
                    instance_id:          inst.id,
                    instance_name:        inst.name,
                    committed,
                    added,
                    removed,
                    done,
                    total:                committed + added,
                    signals_this_sprint:  signalsThisSprint,
                    epics_moving:         epicsDone.size,
                };
            });

            res.json({ sprint: { name: sprint.name, start_date: sprint.start_date, end_date: sprint.end_date }, instances });
        } catch (e) { apiError(res, e); }
    });

    // ─── GET /api/exec/synthesis ──────────────────────────────────────────────
    // Strategic briefing generated by Claude, cached once per sprint at close.
    // Refresh does NOT invalidate cache — cache clears only when a new sprint closes.

    router.get('/synthesis', async (req, res) => {
        try {
            const userId = req.userId;
            const pmInstances = await getPmInstances(userId);
            const pmIds       = pmInstances.map(i => i.id);

            if (pmIds.length === 0) {
                return res.json({ synthesis: null, sprint_name: null, insufficient_data: true });
            }

            // Find most recently closed sprint — used as cache key
            const { data: closedSprint } = await supabase.from('sprints')
                .select('name, start_date, end_date')
                .eq('user_id', userId).eq('state', 'closed')
                .order('end_date', { ascending: false })
                .limit(1).maybeSingle();

            if (!closedSprint) {
                return res.json({ synthesis: null, sprint_name: null, insufficient_data: true });
            }

            // Return cached synthesis if it matches the most recently closed sprint
            // ?force=1 bypasses cache (test only)
            const { data: cached } = await supabase.from('analysis_history')
                .select('data, created_at')
                .eq('user_id', userId)
                .eq('analysis_type', 'exec_synthesis')
                .order('created_at', { ascending: false })
                .limit(1).maybeSingle();

            if (req.query.force !== '1' && cached?.data?.sprint_name === closedSprint.name) {
                return res.json({
                    synthesis:     cached.data.synthesis,
                    sprint_name:   cached.data.sprint_name,
                    generated_at:  cached.data.generated_at,
                    cached:        true,
                });
            }

            // ── Generate synthesis — gather comprehensive per-squad data ──────────

            const [analysesRes, storiesRes, entriesRes, sprintsHistRes] = await Promise.all([
                supabase.from('analysis_history')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .eq('analysis_type', 'full')
                    .order('created_at', { ascending: false }).limit(pmIds.length * 4),
                supabase.from('backlog_stories')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(400),
                supabase.from('intelligence_entries')
                    .select('instance_id, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
                supabase.from('sprints')
                    .select('name, state')
                    .eq('user_id', userId)
                    .order('start_date', { ascending: false }).limit(8),
            ]);

            const analyses    = analysesRes.data ?? [];
            const allStories  = storiesRes.data ?? [];
            const entries     = entriesRes.data ?? [];
            const allSprints  = sprintsHistRes.data ?? [];
            const closedSprintNames3 = allSprints.filter(s => s.state === 'closed').slice(0, 3).map(s => s.name);

            function categoriseStoriesLocal(list) {
                const cats = { new_value: 0, maintenance: 0, tech_debt: 0 };
                for (const s of list) {
                    const cat = s.data?.category ?? inferStoryCategory(s.data);
                    if (cat === 'tech_debt') cats.tech_debt++;
                    else if (cat === 'maintenance') cats.maintenance++;
                    else cats.new_value++;
                }
                return cats;
            }

            const now = Date.now();
            const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

            const instSummaries = pmInstances.map(inst => {
                const instAnalyses = analyses.filter(a => a.instance_id === inst.id);
                const instStories  = allStories.filter(s => s.instance_id === inst.id);
                const instEntries  = entries.filter(e => e.instance_id === inst.id);

                // OKR score + trend direction (compare latest vs previous analysis)
                const okrScore1 = instAnalyses[0] ? extractOkrScore(instAnalyses[0]) : null;
                const okrScore2 = instAnalyses[1] ? extractOkrScore(instAnalyses[1]) : null;
                const okrTrend  = okrScore1 !== null && okrScore2 !== null
                    ? (okrScore1 > okrScore2 + 5 ? 'improving' : okrScore1 < okrScore2 - 5 ? 'declining' : 'stable')
                    : null;

                // Signal coverage (45-day window)
                const d45 = now - 45 * 86400000;
                const recentEntries = instEntries.filter(e => new Date(e.created_at).getTime() >= d45).length;
                const coverage = Math.min(100, Math.round(recentEntries / 10 * 100));

                // Sprint predictability over last 3 closed sprints
                const driftBuckets = {};
                for (const s of instStories) {
                    if (!closedSprintNames3.includes(s.data?.sprintName)) continue;
                    const sp = s.data.sprintName;
                    if (!driftBuckets[sp]) driftBuckets[sp] = { planned: 0, added: 0, delivered: 0 };
                    const status = (s.data?.status ?? '').toLowerCase();
                    if (['done','closed'].includes(status)) driftBuckets[sp].delivered++;
                    else if (s.data?.added_mid_sprint) driftBuckets[sp].added++;
                    else driftBuckets[sp].planned++;
                }
                const predBuckets = Object.values(driftBuckets).filter(b => b.planned + b.added > 0);
                const predictability = predBuckets.length > 0
                    ? Math.min(100, Math.round(predBuckets.reduce((sum, b) => sum + b.delivered / (b.planned + b.added), 0) / predBuckets.length * 100))
                    : null;

                // Resource allocation — most recently closed sprint
                const closedSpStories = instStories.filter(s => s.data?.sprintName === closedSprint.name);
                const cats    = categoriseStoriesLocal(closedSpStories);
                const catTotal = cats.new_value + cats.maintenance + cats.tech_debt;
                const allocation = catTotal > 0 ? {
                    new_value:   Math.round(cats.new_value   / catTotal * 100),
                    maintenance: Math.round(cats.maintenance / catTotal * 100),
                    tech_debt:   Math.round(cats.tech_debt   / catTotal * 100),
                } : null;

                // Response lead time — traced only: Done stories with precede_origin.lead_time_days
                const tracedLeadTimes2 = instStories
                    .filter(s => ['done','closed'].includes((s.data?.status ?? '').toLowerCase()))
                    .map(s => s.data?.precede_origin?.lead_time_days)
                    .filter(v => v != null);
                const responseGap         = avg(tracedLeadTimes2);
                const tracedLeadTimeCount = tracedLeadTimes2.length;

                // Epic health
                const epicMap = {};
                for (const s of instStories) {
                    const epic = s.data?.epic ?? s.data?.labels?.[0];
                    if (!epic) continue;
                    if (!epicMap[epic]) epicMap[epic] = { total: 0, done: 0 };
                    epicMap[epic].total++;
                    if (['done','closed'].includes((s.data?.status ?? '').toLowerCase())) epicMap[epic].done++;
                }
                const epicHealth = Object.values(epicMap).filter(e => e.total >= 2).reduce(
                    (acc, e) => { const pct = e.done / e.total; if (pct > 0.8) acc.good++; else if (pct > 0.4) acc.watch++; else acc.at_risk++; return acc; },
                    { at_risk: 0, watch: 0, good: 0 }
                );

                // Radar risks + churn signals
                const analysis    = instAnalyses[0]?.data?.analysis ?? instAnalyses[0]?.data ?? {};
                const topRisks    = (analysis.risks ?? []).slice(0, 2).map(r => r.title ?? r.description ?? String(r)).filter(Boolean);
                const churnHigh   = (analysis.longitudinal?.churn_signals ?? analysis.churn_signals ?? [])
                    .filter(c => c.risk_level === 'high').slice(0, 2)
                    .map(c => c.signal ?? c.description ?? String(c)).filter(Boolean);

                return { name: inst.name, okr_score: okrScore1, okr_trend: okrTrend, signal_coverage: coverage, signal_count_45d: recentEntries, predictability, predictability_sprints: predBuckets.length, allocation, response_gap_days: responseGap, traced_lead_time_count: tracedLeadTimeCount, epic_health: epicHealth, top_risks: topRisks, churn_high: churnHigh };
            });

            // ── Build structured data block for Claude ────────────────────────
            const dataBlock = instSummaries.map(s => {
                const lines = [`=== SQUAD: ${s.name} ===`];
                if (s.okr_score !== null) {
                    const arrow = s.okr_trend === 'improving' ? '↑' : s.okr_trend === 'declining' ? '↓' : '→';
                    lines.push(`OKR Alignment: ${s.okr_score}% ${arrow}${s.okr_trend ? ` (${s.okr_trend})` : ''}`);
                }
                lines.push(`Signal Coverage: ${s.signal_coverage}% — ${s.signal_count_45d} signals in last 45 days`);
                if (s.predictability !== null)
                    lines.push(`Sprint Predictability: ${s.predictability}% over ${s.predictability_sprints} closed sprint${s.predictability_sprints !== 1 ? 's' : ''}`);
                if (s.allocation)
                    lines.push(`Resource Allocation (${closedSprint.name}): ${s.allocation.new_value}% new value / ${s.allocation.maintenance}% maintenance / ${s.allocation.tech_debt}% tech debt`);
                if (s.response_gap_days !== null)
                    lines.push(`Response Lead Time (${s.traced_lead_time_count} traced stories): ${s.response_gap_days}d` + (s.response_gap_days > 30 ? ' (above threshold)' : ''));
                const eh = s.epic_health;
                if (eh.at_risk + eh.watch + eh.good > 0)
                    lines.push(`Epic Health: ${eh.at_risk} at risk / ${eh.watch} watch / ${eh.good} on track`);
                if (s.top_risks.length)    lines.push(`Top Risks: ${s.top_risks.join('; ')}`);
                if (s.churn_high.length)   lines.push(`High-Risk Churn: ${s.churn_high.join('; ')}`);
                return lines.join('\n');
            }).join('\n\n');

            const userMessage = `ORGANIZATION PERFORMANCE DATA — ${closedSprint.name}\nData source: completed sprints only. Active sprint excluded.\nSquad count: ${pmInstances.length}\n\n${dataBlock}\n\nGenerate the strategic briefing.`;

            // ── Claude call ───────────────────────────────────────────────────
            const generatedAt = new Date().toISOString();
            let synthesis;
            try {
                const rawText = await callAI({
                    model:     MODELS.sonnet,
                    system:    buildExecSynthesisSystem(),
                    messages:  [{ role: 'user', content: userMessage }],
                    maxTokens: 2000,
                    callType:  'exec_synthesis',
                    req,
                });
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                synthesis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                if (!synthesis) synthesis = { generation_error: true };
            } catch (_) {
                synthesis = { generation_error: true };
            }

            // Cache in analysis_history anchored to first PM instance
            const { error: insertErr } = await supabase.from('analysis_history').insert({
                user_id:       userId,
                instance_id:   pmIds[0],
                filename:      'exec-synthesis',
                analysis_type: 'exec_synthesis',
                data:          { sprint_name: closedSprint.name, synthesis, generated_at: generatedAt },
            });
            if (insertErr) console.error('[exec/synthesis] cache insert failed:', insertErr.message);

            res.json({ synthesis, sprint_name: closedSprint.name, generated_at: generatedAt, cached: false });
        } catch (e) { apiError(res, e); }
    });

    return router;
};
