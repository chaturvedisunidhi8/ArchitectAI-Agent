/**
 * llm/adjacencyGraph.js — Ask an open-weights model for the bubble diagram.
 *
 * Before an architect draws walls they sketch which spaces should touch which:
 * kitchen beside dining, bedrooms off a hall, bathroom away from the dining
 * table.  That diagram is a graph, it is pure judgement, and it is exactly the
 * kind of thing a language model is good at — unlike coordinates.
 *
 * The graph produced here overrides the static weights in `adjacency.js` for
 * one design run, which steers three separate stages at once: how subdivision
 * groups rooms, where the door solver puts openings, and how candidates are
 * scored.  With no model available the built-in table is used unchanged.
 *
 * @module llm/adjacencyGraph
 */

import { ROOM_TYPES } from '../constants.js';
import { setAdjacencyOverrides, clearAdjacencyOverrides } from '../adjacency.js';
import { askForJson, isLlmAvailable } from './client.js';

const VALID_TYPES = new Set([...ROOM_TYPES.map(t => t.id), 'hall']);

const GRAPH_SYSTEM = `You are an architect sketching a bubble diagram for a home, before any walls are drawn.

Given the room schedule, say which pairs of room types should share a wall (so a door can join them), and how strongly. You are describing relationships, not positions. Do not output any coordinates or dimensions.

Reply with JSON only:
{
  "edges": [ { "a": "<room type>", "b": "<room type>", "weight": 1-10 } ],
  "avoid": [ { "a": "<room type>", "b": "<room type>", "reason": "<short>" } ],
  "reasoning": "one sentence"
}

Room types you may use: ${[...VALID_TYPES].join(', ')}. "hall" means the circulation corridor.

Guidance:
- weight 9-10: must be adjacent (kitchen-dining, entry circulation).
- weight 6-8: strongly wanted (bedroom-hall, bathroom-bedroom, living-dining).
- weight 3-5: nice to have (study-bedroom, store-kitchen, balcony-living).
- "avoid" is for pairs that should NOT share a door: bathroom next to a kitchen or dining room, one bedroom opening into another.
- Every private room should reach the hall, so that reaching a bedroom never means crossing another bedroom.
- Return 8-16 edges. Only use the room types actually present in the schedule.`;

/**
 * Validate and normalise a model-produced graph.
 *
 * @param {Object} parsed
 * @param {Set<string>} present - Room types actually in the plan.
 * @returns {{weights: Map<string, number>, avoid: string[], count: number}}
 */
export function sanitizeGraph(parsed, present) {
  const weights = new Map();
  const avoid = [];

  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const usable = (t) => typeof t === 'string' && VALID_TYPES.has(t) && present.has(t);

  if (Array.isArray(parsed?.edges)) {
    parsed.edges.forEach(e => {
      const a = String(e?.a || '').toLowerCase().trim();
      const b = String(e?.b || '').toLowerCase().trim();
      if (a === b || !usable(a) || !usable(b)) return;
      const w = Number(e.weight);
      if (!Number.isFinite(w)) return;
      weights.set(key(a, b), Math.max(1, Math.min(10, Math.round(w))));
    });
  }

  if (Array.isArray(parsed?.avoid)) {
    parsed.avoid.forEach(e => {
      const a = String(e?.a || '').toLowerCase().trim();
      const b = String(e?.b || '').toLowerCase().trim();
      if (a === b || !usable(a) || !usable(b)) return;
      const k = key(a, b);
      // An "avoid" beats an "edge" if the model contradicts itself.
      weights.set(k, 0);
      avoid.push(k);
    });
  }

  return { weights, avoid, count: weights.size };
}

/**
 * Derive the adjacency graph for one design run and install it.
 *
 * @param {Object[]} roomSpecs - Full spec list; only active rooms are offered.
 * @param {Object} [opts]
 * @param {boolean} [opts.useLlm=true]
 * @param {string}  [opts.brief] - The original description, for context.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{source: 'llm'|'rules', edges: number, reasoning: string|null}>}
 */
export async function applyDesignGraph(roomSpecs, opts = {}) {
  clearAdjacencyOverrides();

  const active = roomSpecs.filter(r => r.count > 0);
  const present = new Set([...active.map(r => r.type), 'hall']);

  if (opts.useLlm === false || active.length < 3) {
    return { source: 'rules', edges: 0, reasoning: null };
  }
  if (!(await isLlmAvailable())) return { source: 'rules', edges: 0, reasoning: null };

  const schedule = active.map(r => `${r.count}× ${r.type} (~${r.area} sqft each)`).join(', ');
  const user = opts.brief
    ? `Client brief: ${opts.brief}\n\nRoom schedule: ${schedule}`
    : `Room schedule: ${schedule}`;

  let parsed;
  try {
    parsed = await askForJson({
      system: GRAPH_SYSTEM,
      user,
      temperature: 0.25,
      maxTokens: 700,
      signal: opts.signal,
    });
  } catch (e) {
    console.warn('LLM adjacency graph failed, using the built-in table:', e.message);
    return { source: 'rules', edges: 0, reasoning: null, error: e.message };
  }

  const { weights, count } = sanitizeGraph(parsed, present);

  // A graph too sparse to be meaningful is worse than the curated defaults.
  if (count < 4) return { source: 'rules', edges: count, reasoning: null };

  setAdjacencyOverrides(weights);

  return {
    source: 'llm',
    edges: count,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
  };
}

/** Drop any installed graph and return to the built-in weights. */
export function resetDesignGraph() {
  clearAdjacencyOverrides();
}
