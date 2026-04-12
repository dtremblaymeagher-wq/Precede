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

    // signal_coverage: % of OKRs with score > 50 (i.e. backed by real signals, not neutral default)
    function extractCoverageScore(record) {
        try {
            const a   = record.data?.analysis ?? record.data;
            const arr = Array.isArray(a?.okr_alignment) ? a.okr_alignment : null;
            if (!arr?.length) return null;
            const covered = arr.filter(o => typeof o.score === 'number' && o.score > 50).length;
            return Math.round(covered / arr.length * 100);
        } catch { return null; }
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

            const [analysesRes, settingsRes, storiesRes, sprintsRes] = await Promise.all([
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
                    .select('name, start_date, end_date')
                    .eq('user_id', userId)
                    .order('start_date', { ascending: false }),
            ]);

            const analyses = analysesRes.data ?? [];
            const settings = settingsRes.data ?? [];
            const stories  = storiesRes.data ?? [];
            const jiraSprints = sprintsRes.data ?? [];


            // Match an analysis created_at to the Jira sprint it was run during.
            // Compare as date strings (YYYY-MM-DD) to avoid UTC midnight edge cases
            // where a timestamp on end_date day falls after new Date(end_date) midnight.
            // Falls back to a short date string if no sprint covers that date.
            function sprintLabelForDate(createdAt) {
                const day = createdAt.slice(0, 10); // "YYYY-MM-DD"
                for (const s of jiraSprints) {
                    if (day >= s.start_date && day <= s.end_date) return s.name;
                }
                return new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            // Widget 1A — OKR Horizontal Alignment Trend
            // Take the 6 most recent analyses per instance (analyses already sorted newest-first).
            // Sprint label comes from Jira sprint date-range match, or falls back to a short date.
            const _okrCountByInst = {};
            const okr_trend = analyses
                .map(r => {
                    const score = extractOkrScore(r);
                    if (score === null) return null;
                    return {
                        instance_id:   r.instance_id,
                        instance_name: instanceMap[r.instance_id]?.name ?? 'Unknown',
                        sprint:        sprintLabelForDate(r.created_at),
                        score,
                        date:          r.created_at,
                    };
                })
                .filter(Boolean)
                .filter(r => {
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

            // Widget 2 — Signal Coverage Rate
            const _covCountByInst = {};
            const signal_coverage = analyses
                .map(r => {
                    const score = extractCoverageScore(r);
                    if (score === null) return null;
                    return {
                        instance_id:   r.instance_id,
                        instance_name: instanceMap[r.instance_id]?.name ?? 'Unknown',
                        sprint:        sprintLabelForDate(r.created_at),
                        score,
                        date:          r.created_at,
                    };
                })
                .filter(Boolean)
                .filter(r => {
                    _covCountByInst[r.instance_id] = (_covCountByInst[r.instance_id] ?? 0) + 1;
                    return _covCountByInst[r.instance_id] <= 6;
                });

            // Widget 3 — Vision Drift (trend of OKR scores over time)
            const okrScores = okr_trend.map(r => r.score);
            let drift_trend = 'stable';
            if (okrScores.length >= 4) {
                const recent = okrScores.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
                const older  = okrScores.slice(-2).reduce((a, b) => a + b, 0) / 2;
                if (recent > older + 5)  drift_trend = 'improving';
                if (recent < older - 5)  drift_trend = 'declining';
            }
            const vision_drift = {
                score:   okrScores[0] ?? null,
                trend:   drift_trend,
                history: okr_trend.slice(0, 6),
            };

            // Widget 4 — Focus Guard Trend (new value vs maintenance vs tech debt)
            const focusBuckets = {};
            for (const s of stories) {
                const month = (s.created_at ?? '').slice(0, 7) || 'unknown';
                if (!focusBuckets[month]) focusBuckets[month] = { new_value: 0, maintenance: 0, tech_debt: 0, total: 0 };
                const cat = s.data?.category ?? inferStoryCategory(s.data);
                focusBuckets[month][cat === 'tech_debt' ? 'tech_debt' : cat === 'maintenance' ? 'maintenance' : 'new_value']++;
                focusBuckets[month].total++;
            }
            const focus_guard = Object.entries(focusBuckets)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 6)
                .map(([period, b]) => ({
                    period,
                    new_value_pct:   b.total ? Math.round(b.new_value   / b.total * 100) : 0,
                    maintenance_pct: b.total ? Math.round(b.maintenance / b.total * 100) : 0,
                    tech_debt_pct:   b.total ? Math.round(b.tech_debt   / b.total * 100) : 0,
                    total: b.total,
                }))
                .reverse();

            res.json({ pm_instances: pmInstances, okr_trend, okr_objectives, signal_coverage, vision_drift, focus_guard });
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
                return res.json({ pm_instances: [], scope_drift: [], signal_velocity: null, epic_health: [] });
            }

            const [storiesRes, signalsRes] = await Promise.all([
                supabase.from('backlog_stories')
                    .select('instance_id, data, created_at, display_order')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(500),
                supabase.from('intelligence_entries')
                    .select('instance_id, data, created_at')
                    .eq('user_id', userId).in('instance_id', pmIds)
                    .order('created_at', { ascending: false }).limit(200),
            ]);

            const stories = storiesRes.data ?? [];
            const signals = signalsRes.data ?? [];

            // Widget 5 — Sprint Scope Drift
            // Bucket by sprintName when available (not creation month) to avoid import-date spikes.
            // Only count stories with a known sprint — exclude stories never assigned to a sprint.
            const driftBuckets = {};
            for (const s of stories) {
                const sprintName = s.data?.sprintName;
                if (!sprintName) continue; // skip unassigned stories — no sprint context
                if (!driftBuckets[sprintName]) driftBuckets[sprintName] = { planned: 0, added: 0, delivered: 0 };
                const status = (s.data?.status ?? '').toLowerCase();
                if (status === 'done' || status === 'closed') driftBuckets[sprintName].delivered++;
                else if (s.data?.added_mid_sprint)            driftBuckets[sprintName].added++;
                else                                           driftBuckets[sprintName].planned++;
            }
            // Sort sprints: extract trailing number from name ("Sprint 14" → 14), fall back to string sort
            const sprintSortKey = name => sprintNumFromName(name) ?? name;
            const scope_drift = Object.entries(driftBuckets)
                .sort(([a], [b]) => {
                    const ka = sprintSortKey(a), kb = sprintSortKey(b);
                    return typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(a).localeCompare(String(b));
                })
                .slice(-6)
                .map(([period, b]) => ({ period, ...b }));

            // Widget 6 — Signal to Delivery Velocity
            const now = Date.now();
            const signalAges    = signals.map(s => (now - new Date(s.created_at).getTime()) / 86400000).filter(d => d < 180);
            const deliveredAges = stories.filter(s => ['done', 'closed'].includes((s.data?.status ?? '').toLowerCase()))
                .map(s => (now - new Date(s.created_at).getTime()) / 86400000).filter(d => d < 180);

            const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
            const avgSignal    = avg(signalAges);
            const avgDelivered = avg(deliveredAges);
            const signal_velocity = {
                avg_signal_age_days:   avgSignal,
                avg_delivery_age_days: avgDelivered,
                velocity_gap_days:     avgSignal != null && avgDelivered != null ? avgSignal - avgDelivered : null,
                signal_count:          signals.length,
                delivered_count:       deliveredAges.length,
            };

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
            const [analysesRes, storiesRes, activeSprintRes, settingsRes] = await Promise.all([
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
                const covScore  = okrArr.length ? Math.round(okrArr.filter(o => typeof o.score === 'number' && o.score > 50).length / okrArr.length * 100) : null;

                if (okrScore !== null && okrScore < 50) {
                    decisions_required.push({
                        instance_name:    instanceName,
                        type:             'okr_misalignment',
                        severity:         okrScore < 30 ? 'critical' : 'warning',
                        description:      `OKR alignment at ${okrScore}% — below threshold`,
                        suggested_action: 'Review sprint priorities against OKRs in next planning session',
                    });
                }
                if (covScore !== null && covScore < 35) {
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

    return router;
};
