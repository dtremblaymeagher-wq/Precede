'use strict';
/**
 * utils/signal-compressor.js
 *
 * Progressive signal compression.
 *
 * Signals older than 6 months are summarised into monthly AI paragraphs using
 * claude-haiku and stored in signal_summaries.  Originals are kept in
 * intelligence_entries but tagged with archived_at so they are excluded from
 * future analyses.
 *
 * Idempotent: if a monthly summary already exists, the entries are simply
 * archived without calling the AI again.
 *
 * Usage (cron / manual trigger):
 *   const { compressOldSignals } = require('./signal-compressor');
 *   await compressOldSignals(supabase, userId, instanceId);
 */

const { MODELS, callAI } = require('../shared/ai-client');

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
    'January', 'February', 'March',    'April',   'May',      'June',
    'July',    'August',   'September', 'October', 'November', 'December',
];

/** '2024-09-14' → '2024-09' */
function toMonthKey(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** '2024-09' → 'September 2024' */
function monthLabel(key) {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

/** '2024-09' → { start: '2024-09-01', end: '2024-09-30' } */
function periodBounds(key) {
    const [y, m] = key.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
        start: `${y}-${String(m).padStart(2, '0')}-01`,
        end:   `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
}

/**
 * Compress intelligence_entries older than 6 months into monthly summaries.
 *
 * @param {object} supabase   Supabase client instance
 * @param {string} userId
 * @param {string} instanceId
 * @returns {Promise<{ created: number, archived: number }>}
 */
async function compressOldSignals(supabase, userId, instanceId) {
    const cutoff = new Date(Date.now() - SIX_MONTHS_MS).toISOString();

    const { data: rows, error } = await supabase
        .from('intelligence_entries')
        .select('id, data, created_at')
        .eq('user_id', userId)
        .eq('instance_id', instanceId)
        .lt('created_at', cutoff)
        .is('archived_at', null)
        .order('created_at', { ascending: true });

    if (error) throw new Error('[compressOldSignals] query failed: ' + error.message);
    if (!rows?.length) return { created: 0, archived: 0 };

    // Group entries by calendar month using data.date (signal date) or created_at
    const byMonth = new Map();
    for (const row of rows) {
        const key = toMonthKey(row.data?.date || row.created_at);
        if (!key) continue;
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(row);
    }

    let created  = 0;
    let archived = 0;

    for (const [key, monthRows] of byMonth) {
        const summaryId = `sum-${key}`;
        try {
            // Check if a summary already exists for this month
            const { data: existing } = await supabase
                .from('signal_summaries')
                .select('id')
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .eq('summary_id', summaryId)
                .maybeSingle();

            const alreadyExists = !!existing;

            if (!alreadyExists) {
                // Build text for Haiku summarisation
                const label       = monthLabel(key);
                const signalsText = monthRows.map((r, i) => {
                    const d   = r.data ?? {};
                    const who = d.person     ? ` [${d.person}]`      : '';
                    const src = d.sourceType ? ` (${d.sourceType})`  : '';
                    return `${i + 1}.${who}${src}: ${d.body || ''}`;
                }).join('\n');

                const summary = await callAI({
                    model:     MODELS.haiku,
                    maxTokens: 400,
                    messages:  [{
                        role:    'user',
                        content: `Summarize these ${monthRows.length} product intelligence signals from ${label} in 1-2 paragraphs. Cover key user needs, themes, risks, and opportunities. Reference specific clients or personas where patterns exist. Be factual and specific.\n\n${signalsText}`,
                    }],
                    callType: 'signal_compression',
                });

                const { start, end } = periodBounds(key);
                const { error: insErr } = await supabase.from('signal_summaries').insert({
                    user_id:          userId,
                    instance_id:      instanceId,
                    period_type:      'monthly',
                    period_start:     start,
                    period_end:       end,
                    summary_id:       summaryId,
                    summary,
                    signal_count:     monthRows.length,
                    source_entry_ids: monthRows.map(r => r.id),
                });

                if (insErr) {
                    console.error(`[compressOldSignals] insert failed for ${key}:`, insErr.message);
                    continue;
                }
                created++;
            }

            // Archive the entries (whether summary was just created or already existed)
            const entryIds = monthRows.map(r => r.id);
            const { error: archErr } = await supabase
                .from('intelligence_entries')
                .update({ archived_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .in('id', entryIds);

            if (archErr) {
                console.error(`[compressOldSignals] archive failed for ${key}:`, archErr.message);
            } else {
                archived += entryIds.length;
                console.log(`[compressOldSignals] ${key}: ${alreadyExists ? 're-archived' : 'compressed'} ${entryIds.length} entries`);
            }
        } catch (err) {
            console.error(`[compressOldSignals] failed for month ${key}:`, err.message);
        }
    }

    return { created, archived };
}

module.exports = { compressOldSignals };
