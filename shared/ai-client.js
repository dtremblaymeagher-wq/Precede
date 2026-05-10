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

const ANTHROPIC_URL       = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_BATCH_URL = 'https://api.anthropic.com/v1/messages/batches';
const ANTHROPIC_VERSION   = '2023-06-01';
const BATCH_BETA_HEADER   = 'message-batches-2024-09-24';

// Anthropic pricing constants — update here if prices change
const PRICE_INPUT_PER_TOKEN  = 3  / 1_000_000; // $3 / MTok  (Sonnet input)
const PRICE_OUTPUT_PER_TOKEN = 15 / 1_000_000; // $15 / MTok (Sonnet output)

/**
 * Model registry.
 * All model ID strings live here — never hard-coded in route handlers.
 *
 * sonnet — primary model: radar analysis, brainstorm, epic prediction, story grooming, OKR coverage
 * haiku  — fast tasks: RICE estimation, smart audit, meeting prep, learning, jira comments
 */
const MODELS = {
    sonnet: 'claude-sonnet-4-6',
    haiku:  'claude-haiku-4-5-20251001',
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

async function callAI({ model, system, messages, maxTokens = 2048, callType, req, deliveryMode = 'instant', batchId = null, timeoutMs: timeoutOverride = null }) {
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
        const timeoutMs  = timeoutOverride ?? (parseInt(process.env.CALL_AI_TIMEOUT_MS, 10) || 90_000);
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
        (async () => {
            let userEmail = null;
            if (userId) {
                try {
                    const { clerkClient } = require('@clerk/express');
                    const user = await clerkClient.users.getUser(userId);
                    userEmail = user.emailAddresses?.[0]?.emailAddress ?? null;
                } catch { /* non-critical — older logs simply have no email */ }
            }
            const supabase = require('../database/db');
            const { error } = await supabase.from('api_usage_logs').insert({
                user_id:               userId,
                instance_id:           instanceId,
                user_email:            userEmail,
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
            });
            if (error) console.warn('[callAI] Usage log failed:', error.message);
        })().catch(err => console.error('[api_usage_logs] Failed to log:', err.message));
    }

    return data.content?.[0]?.text ?? '';
}

// ── Anthropic Message Batches API ─────────────────────────────────────────────

/**
 * Submit a batch of requests to the Anthropic Message Batches API (50% cheaper).
 * @param {Array<{ custom_id: string, model: string, system?: string, messages: Array, max_tokens?: number }>} requests
 * @returns {Promise<{ id: string, processing_status: string }>}
 */
async function submitBatch(requests) {
    const body = {
        requests: requests.map(r => ({
            custom_id: r.custom_id,
            params: {
                model:      r.model,
                max_tokens: r.max_tokens ?? 2048,
                messages:   r.messages,
                ...(r.system ? { system: r.system } : {}),
            },
        })),
    };
    const res = await fetch(ANTHROPIC_BATCH_URL, {
        method: 'POST',
        headers: {
            'x-api-key':         process.env.ANTHROPIC_API_KEY.trim(),
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta':    BATCH_BETA_HEADER,
            'content-type':      'application/json',
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Batch submit: ${data.error.message || JSON.stringify(data.error)}`);
    return data;
}

/**
 * Poll a batch's status.
 * @param {string} batchId
 * @returns {Promise<{ id: string, processing_status: string, request_counts: object }>}
 */
async function fetchBatch(batchId) {
    const res = await fetch(`${ANTHROPIC_BATCH_URL}/${batchId}`, {
        headers: {
            'x-api-key':         process.env.ANTHROPIC_API_KEY.trim(),
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta':    BATCH_BETA_HEADER,
        },
    });
    const data = await res.json();
    if (data.error) throw new Error(`Batch fetch: ${data.error.message || JSON.stringify(data.error)}`);
    return data;
}

/**
 * Fetch JSONL results from a completed batch.
 * @param {string} batchId
 * @returns {Promise<Array<{ custom_id: string, result: object }>>}
 */
async function fetchBatchResults(batchId) {
    const res = await fetch(`${ANTHROPIC_BATCH_URL}/${batchId}/results`, {
        headers: {
            'x-api-key':         process.env.ANTHROPIC_API_KEY.trim(),
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta':    BATCH_BETA_HEADER,
        },
    });
    const text = await res.text();
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

module.exports = { MODELS, callAI, submitBatch, fetchBatch, fetchBatchResults, PRICE_INPUT_PER_TOKEN, PRICE_OUTPUT_PER_TOKEN };
