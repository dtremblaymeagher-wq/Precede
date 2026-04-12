'use strict';
/**
 * routes/usage-routes.js
 *
 * GET /api/usage/summary — token usage summary for the authenticated user
 *
 * Returns total tokens, estimated cost, and breakdown by call_type and by instance.
 * Scoped to the authenticated user (no instance filter — shows all instances).
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { PRICE_INPUT_PER_TOKEN, PRICE_OUTPUT_PER_TOKEN } = require('../shared/ai-client');

module.exports = function createUsageRouter(supabase) {
    const router = Router();

    // ── GET /api/usage/summary ────────────────────────────────────────────────

    router.get('/summary', async (req, res) => {
        try {
            const { data: rows, error } = await supabase
                .from('api_usage_logs')
                .select('call_type, instance_id, model, input_tokens, output_tokens, total_tokens, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const logs = rows ?? [];

            // Totals
            const totalInput  = logs.reduce((s, r) => s + (r.input_tokens  || 0), 0);
            const totalOutput = logs.reduce((s, r) => s + (r.output_tokens || 0), 0);
            const totalTokens = totalInput + totalOutput;
            const estimatedCost = parseFloat(
                (totalInput * PRICE_INPUT_PER_TOKEN + totalOutput * PRICE_OUTPUT_PER_TOKEN).toFixed(4)
            );

            // Breakdown by call_type
            const byCallType = {};
            for (const r of logs) {
                const key = r.call_type || 'unknown';
                if (!byCallType[key]) byCallType[key] = { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0 };
                byCallType[key].input_tokens  += r.input_tokens  || 0;
                byCallType[key].output_tokens += r.output_tokens || 0;
                byCallType[key].total_tokens  += r.total_tokens  || 0;
                byCallType[key].calls         += 1;
            }

            // Breakdown by instance
            const byInstance = {};
            for (const r of logs) {
                const key = r.instance_id || 'unknown';
                if (!byInstance[key]) byInstance[key] = { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0 };
                byInstance[key].input_tokens  += r.input_tokens  || 0;
                byInstance[key].output_tokens += r.output_tokens || 0;
                byInstance[key].total_tokens  += r.total_tokens  || 0;
                byInstance[key].calls         += 1;
            }

            res.json({
                totalCalls:    logs.length,
                totalInput,
                totalOutput,
                totalTokens,
                estimatedCostUsd: estimatedCost,
                byCallType,
                byInstance,
            });
        } catch (e) {
            apiError(res, e, 'usage/summary');
        }
    });

    return router;
};
