'use strict';
/**
 * utils/sprint-utils.js
 *
 * Sprint calculation helpers shared across route files and the analyze monolith.
 * makeSprintUtils(supabase) → { calculateSprint, getSprintConfig, getCurrentSprint }
 *
 * Note: getCurrentSprint() filters by both user_id and instance_id to prevent sprint bleed across instances.
 */

const { makeHelpers } = require('./db-helpers');

function makeSprintUtils(supabase) {
    const { instanceSelect } = makeHelpers(supabase);

    function calculateSprint(sprintStartDate, durationDays, targetDate = new Date()) {
        const start          = new Date(sprintStartDate);
        const target         = new Date(targetDate);
        const msPerDay       = 1000 * 60 * 60 * 24;
        const daysSinceStart = Math.floor((target - start) / msPerDay);
        const sprintNumber   = Math.floor(daysSinceStart / durationDays) + 1;
        const sprintStartOffset = (sprintNumber - 1) * durationDays;
        const sprintStart    = new Date(start.getTime() + sprintStartOffset * msPerDay);
        const sprintEnd      = new Date(sprintStart.getTime() + durationDays * msPerDay - 1);
        const daysElapsed    = Math.floor((target - sprintStart) / msPerDay) + 1;
        const daysRemaining  = durationDays - daysElapsed;
        return {
            sprint_number:  sprintNumber,
            start_date:     sprintStart.toISOString().split('T')[0],
            end_date:       sprintEnd.toISOString().split('T')[0],
            days_elapsed:   daysElapsed,
            days_remaining: daysRemaining,
            duration_days:  durationDays,
            is_exception:   false,
        };
    }

    async function getSprintConfig(userId, instanceId) {
        const { data } = await instanceSelect('settings', 'data', userId, instanceId).single();
        const s = data?.data ?? {};
        return {
            startDate:    s.sprint_start_date    || null,
            durationDays: parseInt(s.sprint_duration_days) || 14,
        };
    }

    // getCurrentSprint: Jira-imported sprints take precedence; falls back to the
    // calculated system for users who haven't connected Jira or have no sprints yet.
    async function getCurrentSprint(userId, instanceId) {
        const { data: jiraSprint } = await supabase
            .from('sprints')
            .select('*')
            .eq('user_id', userId)
            .eq('instance_id', instanceId)
            .eq('state', 'active')
            .single();

        if (jiraSprint) {
            const start       = new Date(jiraSprint.start_date);
            const end         = new Date(jiraSprint.end_date);
            const now         = new Date();
            const duration    = Math.round((end - start) / 86400000) + 1;
            const daysElapsed = Math.min(duration, Math.max(1, Math.floor((now - start) / 86400000) + 1));
            return {
                name:           jiraSprint.name,
                sprint_number:  null,
                jira_id:        jiraSprint.jira_id,
                identifier:     jiraSprint.jira_id,
                start_date:     jiraSprint.start_date,
                end_date:       jiraSprint.end_date,
                goal:           jiraSprint.goal,
                state:          'active',
                source:         'jira',
                days_elapsed:   daysElapsed,
                days_remaining: Math.max(0, duration - daysElapsed),
                duration_days:  duration,
                is_exception:   false,
            };
        }

        const { startDate, durationDays } = await getSprintConfig(userId, instanceId);
        if (!startDate) return null;
        const sprint = calculateSprint(startDate, durationDays);
        return {
            ...sprint,
            identifier: sprint.sprint_number,
            name:       `Sprint ${sprint.sprint_number}`,
            source:     'calculated',
            goal:       null,
        };
    }

    return { calculateSprint, getSprintConfig, getCurrentSprint };
}

module.exports = { makeSprintUtils };
