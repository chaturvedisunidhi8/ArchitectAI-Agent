/**
 * llm/client.js — Minimal client for any OpenAI-compatible chat endpoint.
 *
 * Deliberately provider-agnostic: Ollama, llama.cpp's server, LM Studio,
 * vLLM, text-generation-webui and the free tiers of the hosted gateways all
 * expose the same `/chat/completions` shape, so one client covers every
 * open-weights model without a vendor SDK.
 *
 * Configure through Vite env vars (put them in `.env.local`):
 *
 *   VITE_LLM_BASE_URL=http://localhost:11434/v1     # Ollama's OpenAI shim
 *   VITE_LLM_MODEL=qwen2.5:7b-instruct
 *   VITE_LLM_API_KEY=                               # only for hosted gateways
 *
 * Nothing here is required for the app to work.  Every call site treats the
 * LLM as an optional accelerator and falls back to the deterministic engine,
 * so the planner still runs fully offline with no model installed.
 *
 * @module llm/client
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const LLM_CONFIG = {
  /**
   * Opt-in.  A local 7B takes over a minute per call, so a machine that
   * merely happens to be running Ollama must not silently turn a two-second
   * design into a three-minute one — and tests must never touch the network.
   * Set `VITE_LLM_ENABLED=true` in `.env.local` to turn the model path on.
   */
  enabled: String(env.VITE_LLM_ENABLED || '').toLowerCase() === 'true',
  baseUrl: env.VITE_LLM_BASE_URL || 'http://localhost:11434/v1',
  model: env.VITE_LLM_MODEL || 'qwen2.5:7b-instruct',
  apiKey: env.VITE_LLM_API_KEY || '',
  /**
   * Hard ceiling on a single call.  A local 7B answering a structured prompt
   * takes the better part of a minute on CPU, and the first call also pays
   * for loading the weights, so this has to be generous — the fallback only
   * fires when the model genuinely is not going to answer.
   */
  timeoutMs: Number(env.VITE_LLM_TIMEOUT_MS || 90000),
};

/** Cached availability probe, so we test the endpoint at most once per load. */
let _availability = null;

/**
 * Check whether the endpoint is reachable *and* serving the configured model.
 *
 * Checking the model matters: a running Ollama with nothing pulled answers
 * `/models` happily and then 404s every completion, so a reachability-only
 * probe would burn a timeout on each design run before falling back.
 *
 * @param {boolean} [recheck=false] - Ignore the cached result.
 * @returns {Promise<boolean>}
 */
export async function isLlmAvailable(recheck = false) {
  if (!LLM_CONFIG.enabled) {
    _unavailableReason = 'model path disabled (set VITE_LLM_ENABLED=true to enable)';
    return false;
  }
  if (_availability !== null && !recheck) return _availability;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${LLM_CONFIG.baseUrl}/models`, {
      method: 'GET',
      headers: authHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) { _availability = false; return false; }

    const body = await res.json();
    const ids = (body?.data || []).map(m => String(m.id));

    // Hosted gateways list hundreds of models; local runtimes list what is
    // pulled.  An empty list means nothing is loaded, so don't bother trying.
    if (ids.length === 0) {
      _availability = false;
      _unavailableReason = `no models available at ${LLM_CONFIG.baseUrl}`;
      return false;
    }

    // Resolve the configured name against what is actually served.  Asking
    // for "qwen2.5:7b-instruct" when the machine has "qwen2.5-coder:7b" is a
    // 404 on every completion, so bind to a real id rather than the wish.
    _resolvedModel = resolveModel(LLM_CONFIG.model, ids);

    _availability = Boolean(_resolvedModel);
    if (_resolvedModel) {
      _unavailableReason = `using ${_resolvedModel} at ${LLM_CONFIG.baseUrl}`;
    } else {
      _unavailableReason = `no usable model at ${LLM_CONFIG.baseUrl} (found: ${ids.slice(0, 5).join(', ')})`;
    }
  } catch (e) {
    _availability = false;
    _unavailableReason = `cannot reach ${LLM_CONFIG.baseUrl} (${e.message})`;
  }

  return _availability;
}

let _unavailableReason = 'not checked yet';
let _resolvedModel = null;

/** Why the LLM path is not being used, for the UI and for diagnostics. */
export function llmUnavailableReason() {
  return _unavailableReason;
}

/** The model id actually being called, once availability has been probed. */
export function resolvedModel() {
  return _resolvedModel;
}

/**
 * Pick the best served model id for the configured preference.
 *
 * Any instruction-tuned general model does this job well — the tasks are
 * short structured-output prompts, not code or long-form generation — so a
 * missing exact match falls back to the closest thing installed rather than
 * disabling the feature.
 *
 * @param {string} configured
 * @param {string[]} ids - Model ids the endpoint reports.
 * @returns {string|null}
 */
export function resolveModel(configured, ids) {
  if (!ids || ids.length === 0) return null;
  const wanted = String(configured || '').toLowerCase();
  const family = wanted.split(':')[0];

  const rank = (id) => {
    const low = id.toLowerCase();
    if (low === wanted) return 0;
    if (low.startsWith(`${family}:`) || low === family) return 1;
    if (low.includes(family)) return 2;
    // Prefer instruction-tuned chat models over specialised ones.
    if (/instruct|chat|-it\b/.test(low)) return 3;
    if (/coder|code|embed|vision/.test(low)) return 5;
    return 4;
  };

  const best = [...ids].sort((a, b) => rank(a) - rank(b) || a.length - b.length)[0];
  // Embedding models cannot answer chat completions at all.
  if (/embed/i.test(best) && ids.every(id => /embed/i.test(id))) return null;
  return best;
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (LLM_CONFIG.apiKey) h.Authorization = `Bearer ${LLM_CONFIG.apiKey}`;
  return h;
}

/**
 * Ask the model for a JSON object and parse it.
 *
 * Open-weights models honour `response_format: json_object` unevenly, so the
 * response is also salvaged by bracket-matching before giving up.
 *
 * @param {Object} opts
 * @param {string}   opts.system      - System prompt.
 * @param {string}   opts.user        - User message.
 * @param {number}   [opts.temperature=0.2]
 * @param {number}   [opts.maxTokens=900]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object>} Parsed JSON.
 * @throws {Error} On transport failure, timeout, or unparseable output.
 */
export async function askForJson({ system, user, temperature = 0.2, maxTokens = 900, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res;
  try {
    res = await fetch(`${LLM_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        model: _resolvedModel || LLM_CONFIG.model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`LLM endpoint returned ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM returned an empty completion');

  return parseJsonLoosely(text);
}

/**
 * Parse JSON from model output that may be wrapped in prose or a code fence.
 *
 * @param {string} text
 * @returns {Object}
 */
export function parseJsonLoosely(text) {
  const trimmed = String(text).trim();

  try {
    return JSON.parse(trimmed);
  } catch { /* fall through to salvage */ }

  // Strip a ```json fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* keep trying */ }
  }

  // Last resort: take the outermost balanced object.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* give up */ }
  }

  throw new Error('LLM output was not valid JSON');
}
