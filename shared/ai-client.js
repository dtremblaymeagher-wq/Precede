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
 */

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Model registry.
 * All model ID strings live here — never hard-coded in route handlers.
 *
 * sonnet      — primary model: radar analysis, brainstorm, epic prediction, story grooming
 * haiku       — batch tasks requiring speed over depth: RICE estimation
 * haikuLegacy — retained for smart audit, generate proxy, meeting prep (tested with this model)
 * sonnetV2    — untracked demand, OKR coverage (slightly older sonnet variant)
 */
const MODELS = {
    sonnet:      'claude-sonnet-4-20250514',
    haiku:       'claude-haiku-4-5-20251001',
    haikuLegacy: 'claude-3-haiku-20240307',
    sonnetV2:    'claude-sonnet-4-6',
};

/**
 * Call the AI API and return the raw text from the first content block.
 *
 * @param {object}  opts
 * @param {string}  opts.model        - Model ID — use a MODELS constant
 * @param {string}  [opts.system]     - System prompt (omit for user-only turns)
 * @param {Array}   opts.messages     - Anthropic messages array [{ role, content }]
 * @param {number}  [opts.maxTokens]  - Default 2048
 * @param {object}  [opts.req]        - Express req object — reserved for future
 *                                      per-instance provider/model override via req.aiConfig
 * @returns {Promise<string>} Raw text response
 */
async function callAI({ model, system, messages, maxTokens = 2048, req }) {
    // ── Future per-instance override hook ─────────────────────────────────────
    // Attach req.aiConfig in resolveInstance to enable per-customer model selection:
    //
    //   if (req?.aiConfig?.provider === 'openai')  return callOpenAI({...});
    //   if (req?.aiConfig?.provider === 'custom')  return callCustomLLM({...});
    //   if (req?.aiConfig?.modelOverride) model = req.aiConfig.modelOverride;
    // ─────────────────────────────────────────────────────────────────────────

    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;

    const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
            'x-api-key':         process.env.ANTHROPIC_API_KEY.trim(),
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type':      'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.error) throw new Error(`AI API: ${data.error.message || JSON.stringify(data.error)}`);
    return data.content?.[0]?.text ?? '';
}

module.exports = { MODELS, callAI };
