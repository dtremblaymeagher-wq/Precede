'use strict';
/**
 * shared/ai-client.js
 *
 * Single integration point for all AI API calls.
 *
 * TO ADD A NEW PROVIDER (OpenAI, Gemini, custom LLM):
 *   1. Add a branch in callAI() for the new provider.
 *   2. Add the model IDs to MODELS or let the instance config supply them.
 *   3. In resolveInstance middleware (server.js), attach req.aiConfig:
 *      { provider: 'openai', modelOverride: 'gpt-4o' }
 *      The call sites in server.js and routes stay unchanged.
 *
 * TO CHANGE A MODEL NAME:
 *   Update one entry in MODELS below — nowhere else.
 *
 * TOKEN LOGGING:
 *   Pass callType (snake_case label) to every callAI() invocation.
 *   userId + instanceId are extracted automatically from req when available.
 *   Logging is non-blocking — a log failure never fails the API call.
 */

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Anthropic pricing constants — update here if prices change
const PRICE_INPUT_PER_TOKEN  = 3  / 1_000_000; // $3 / MTok  (Sonnet input)
const PRICE_OUTPUT_PER_TOKEN = 15 / 1_000_000; // $15 / MTok (Sonnet output)

/**
 * Model registry.
 * All model ID strings live here — never hard-coded in route handlers.
 *
 * sonnet   — primary model: radar analysis, brainstorm, epic prediction, story grooming
 * haiku    — fast tasks: RICE estimation, smart audit, meeting prep, learning, jira comments
 * sonnetV2 — untracked demand, OKR coverage (slightly older sonnet variant)
 */
const MODELS = {
    sonnet:   'claude-sonnet-4-20250514',
    haiku:    'claude-haiku-4-5-20251001',
    sonnetV2: 'claude-sonnet-4-6',
};

/**
 * Call the AI API and return the raw text from the first content block.
 * Automatically logs token usage to api_usage_logs (non-blocking).
 *
 * @param {object}  opts
 * @param {string}  opts.model        - Model ID — use a MODELS constant
 * @param {string}  [opts.system]     - System prompt (omit for user-only turns)
 * @param {Array}   opts.messages     - Anthropic messages array [{ role, content }]
 * @param {number}  [opts.maxTokens]  - Default 2048
 * @param {string}  [opts.callType]      - Snake_case label for this call (e.g. 'signal_analysis')
 * @param {object}  [opts.req]           - Express req — provides userId, instanceId, aiConfig
 * @param {string}  [opts.deliveryMode]  - 'instant' (user waits) | 'batch' (background job). Default: 'instant'
 * @param {string}  [opts.batchId]       - UUID linking related batch calls. Nullable.
 * @returns {Promise<string>} Raw text response
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callAI({ model, system, messages, maxTokens = 2048, callType, req, deliveryMode = 'instant', batchId = null }) {
    // ── Future per-instance override hook ─────────────────────────────────────
    // Attach req.aiConfig in resolveInstance to enable per-customer model selection:
    //
    //   if (req?.aiConfig?.provider === 'openai')  return callOpenAI({...});
    //   if (req?.aiConfig?.provider === 'custom')  return callCustomLLM({...});
    //   if (req?.aiConfig?.modelOverride) model = req.aiConfig.modelOverride;
    // ─────────────────────────────────────────────────────────────────────────

    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;

    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeoutMs  = parseInt(process.env.CALL_AI_TIMEOUT_MS, 10) || 90_000;
        const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetch(ANTHROPIC_URL, {
                method: 'POST',
                headers: {
                    'x-api-key':         process.env.ANTHROPIC_API_KEY.trim(),
                    'anthropic-version': ANTHROPIC_VERSION,
                    'anthropic-beta':    'prompt-caching-2024-07-31',
                    'content-type':      'application/json',
                },
                body:   JSON.stringify(body),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        data = await res.json();
        if (!data.error || data.error.type !== 'overloaded_error') break;
        if (attempt < 2) {
            console.warn(`[callAI] Overloaded — retry ${attempt + 1}/2 in ${2 ** attempt * 2}s`);
            await sleep(2 ** attempt * 2000);
        }
    }
    if (data.error) throw new Error(`AI API: ${data.error.message || JSON.stringify(data.error)}`);

    // ── Non-blocking token usage logging ──────────────────────────────────────
    if (data.usage && callType) {
        const userId     = req?.userId     ?? null;
        const instanceId = req?.instanceId ?? null;
        const { input_tokens, output_tokens, cache_read_input_tokens = 0, cache_creation_input_tokens = 0 } = data.usage;
        try {
            const supabase = require('../database/db');
            supabase.from('api_usage_logs').insert({
                user_id:               userId,
                instance_id:           instanceId,
                request_id:            req?.requestId ?? null,
                call_type:             callType,
                model,
                input_tokens,
                output_tokens,
                total_tokens:          input_tokens + output_tokens,
                cache_read_tokens:     cache_read_input_tokens,
                cache_creation_tokens: cache_creation_input_tokens,
                delivery_mode:         deliveryMode,
                batch_id:              batchId,
            }).then(({ error }) => {
                if (error) console.warn('[callAI] Usage log failed:', error.message);
            }).catch(err => console.error('[api_usage_logs] Failed to log:', err.message));
        } catch (e) {
            console.warn('[callAI] Usage log error:', e.message);
        }
    }

    return data.content?.[0]?.text ?? '';
}

module.exports = { MODELS, callAI, PRICE_INPUT_PER_TOKEN, PRICE_OUTPUT_PER_TOKEN };
