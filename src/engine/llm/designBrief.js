/**
 * llm/designBrief.js — Language understanding, delegated to an open-weights
 * model, with the rule-based extractor as the floor.
 *
 * ## Why the model does not draw the plan
 *
 * A language model cannot emit metric floor-plan geometry: it has no way to
 * guarantee gap-free tiling, aligned wall lines, or rooms that hit their
 * target area, and asking it for coordinates produces plans that overlap and
 * leave voids.  The published work in this area (Graph2Plan, House-GAN++,
 * RPLAN) all splits the problem the same way, and so does this module:
 *
 *   semantics  →  the model.  What rooms, how big, what matters, what should
 *                 sit next to what.  Open-ended language, no arithmetic.
 *   geometry   →  the solver.  Subdivision, circulation, doors and windows,
 *                 all deterministic and all verifiable.
 *
 * So the model's entire job is to produce a *brief* and a *bubble diagram*.
 * The existing engine turns those into the drawing.
 *
 * Every function here degrades to the regex extractor on any failure, so the
 * planner behaves identically with no model installed.
 *
 * @module llm/designBrief
 */

import { extractRequirements } from '../nlp.js';
import { ROOM_TYPES, getRoomType } from '../constants.js';
import { askForJson, isLlmAvailable } from './client.js';

const VALID_TYPES = ROOM_TYPES.map(t => t.id);

const BRIEF_SYSTEM = `You are an architectural programmer. You read a client's description of the home they want and turn it into a structured room schedule. You never draw or position anything — a geometry engine does that.

Reply with JSON only, matching exactly this shape:
{
  "totalAreaSqft": number | null,
  "style": one of ["modern","minimalist","luxury","traditional","contemporary","scandinavian","industrial","classic","japanese","indian","colonial","mediterranean","rustic","farmhouse","tropical","vintage","bohemian","art deco","mid-century","urban","compact"],
  "facing": one of ["north","south","east","west","north-east","north-west","south-east","south-west"] | null,
  "floors": number | null,
  "rooms": [ { "type": string, "count": number, "areaSqft": number, "note": string } ],
  "priorities": { "vastu": bool, "daylight": bool, "privacy": bool, "openPlan": bool, "compact": bool, "luxury": bool },
  "reasoning": "one sentence on the judgement calls you made"
}

Rules:
- "type" MUST be one of: ${VALID_TYPES.join(', ')}. Map anything else onto the nearest one (master bedroom -> bedroom, powder room -> bathroom, home office -> study, utility -> laundry, puja/prayer room -> pooja).
- areaSqft is the area of ONE room of that type, not the total for the count.
- Include the rooms a home needs even if unstated: living, kitchen, at least one bathroom.
- Use realistic Indian residential sizes: bedroom 110-200, master 180-260, bathroom 35-70, kitchen 80-150, living 180-400, dining 100-180, balcony 30-70, store 25-60, pooja 20-45.
- If the client gave a total area, the room areas should sum to roughly 85% of it, leaving the rest for walls and circulation.
- Set totalAreaSqft to null if the client did not state one. Do not invent it.`;

/**
 * Coerce a model's room list onto the app's room types, dropping anything
 * that cannot be mapped.  A model that hallucinates "sunroom" should not be
 * able to break the pipeline.
 */
function sanitizeRooms(rooms) {
  if (!Array.isArray(rooms)) return [];
  const merged = new Map();

  rooms.forEach(r => {
    const type = String(r?.type || '').toLowerCase().trim();
    if (!VALID_TYPES.includes(type)) return;

    const count = Math.max(0, Math.min(8, Math.round(Number(r.count) || 0)));
    if (count === 0) return;

    const rt = getRoomType(type);
    const raw = Number(r.areaSqft);
    // Clamp against the type's own floor so a bad number cannot produce a
    // room the geometry engine has to reject later.
    const area = Number.isFinite(raw) && raw > 0
      ? Math.max(rt.minArea, Math.min(raw, rt.defaultArea * 4))
      : rt.defaultArea;

    const existing = merged.get(type);
    if (existing) {
      existing.count = Math.min(8, existing.count + count);
    } else {
      merged.set(type, { type, count, area: Math.round(area) });
    }
  });

  return [...merged.values()];
}

/** Priorities in precedence order, most specific first. */
const PRIORITY_KEYS = ['vastu', 'privacy', 'daylight', 'openPlan', 'compact', 'luxury'];

/** Pairs that cannot both be true; the earlier key in PRIORITY_KEYS wins. */
const CONTRADICTORY = [['compact', 'luxury'], ['openPlan', 'privacy']];

/**
 * Small models tend to answer "true" to every flag in a list, which would
 * flatten the scoring weights back to uniform and undo the point of having
 * priorities.  Keep the strongest few and drop self-contradictions.
 */
function sanitizePriorities(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;

  PRIORITY_KEYS.forEach(k => { if (p[k] === true) out[k] = true; });

  CONTRADICTORY.forEach(([a, b]) => {
    if (out[a] && out[b]) {
      const loser = PRIORITY_KEYS.indexOf(a) < PRIORITY_KEYS.indexOf(b) ? b : a;
      delete out[loser];
    }
  });

  // Everything weighted is nothing weighted.
  const kept = PRIORITY_KEYS.filter(k => out[k]).slice(0, 3);
  return Object.fromEntries(kept.map(k => [k, true]));
}

/**
 * Read a description into the same structure `extractRequirements` returns,
 * using the model where it is available and the regex extractor otherwise.
 *
 * The rule-based result is always computed and is always the fallback: the
 * model can only *replace* fields it filled in credibly.
 *
 * @param {string} prompt
 * @param {Object} [opts]
 * @param {boolean} [opts.useLlm=true]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Object>} An `extractRequirements`-shaped result with an
 *   extra `source` field: 'llm' | 'rules' | 'llm-failed'.
 */
export async function extractRequirementsSmart(prompt, opts = {}) {
  const baseline = extractRequirements(prompt);
  if (!baseline.success) return { ...baseline, source: 'rules' };
  if (opts.useLlm === false) return { ...baseline, source: 'rules' };

  if (!(await isLlmAvailable())) return { ...baseline, source: 'rules' };

  let parsed;
  try {
    parsed = await askForJson({
      system: BRIEF_SYSTEM,
      user: prompt,
      temperature: 0.15,
      maxTokens: 900,
      signal: opts.signal,
    });
  } catch (e) {
    console.warn('LLM brief extraction failed, using rule-based extraction:', e.message);
    return { ...baseline, source: 'llm-failed', llmError: e.message };
  }

  const rooms = sanitizeRooms(parsed.rooms);
  if (rooms.length === 0) {
    // The model gave us nothing usable — the regex path is strictly better.
    return { ...baseline, source: 'llm-failed', llmError: 'no usable rooms in model output' };
  }

  // Build the full ROOM_TYPES-shaped spec list the engine expects.
  const roomSpecs = ROOM_TYPES.map(t => {
    const hit = rooms.find(r => r.type === t.id);
    return {
      type: t.id,
      label: t.label,
      color: t.color,
      minArea: t.minArea,
      count: hit ? hit.count : 0,
      area: hit ? hit.area : t.defaultArea,
    };
  });

  const areaGiven = Number(parsed.totalAreaSqft);
  const areaSpecified = Number.isFinite(areaGiven) && areaGiven > 100;
  const scheduleArea = roomSpecs.reduce((s, r) => s + r.area * r.count, 0);

  return {
    success: true,
    source: 'llm',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
    extracted: {
      bhk: rooms.find(r => r.type === 'bedroom')?.count || baseline.extracted.bhk,
      totalArea: areaSpecified ? Math.round(areaGiven) : scheduleArea,
      areaSpecified,
      style: typeof parsed.style === 'string' ? parsed.style.toLowerCase() : baseline.extracted.style,
      direction: typeof parsed.facing === 'string' ? parsed.facing.toLowerCase() : baseline.extracted.direction,
      floors: Number(parsed.floors) > 0 ? Math.round(Number(parsed.floors)) : baseline.extracted.floors,
      budget: baseline.extracted.budget,
      amenities: baseline.extracted.amenities,
      preferences: { ...baseline.extracted.preferences, ...sanitizePriorities(parsed.priorities) },
      rooms: rooms.map(r => `${r.count}× ${r.type}`),
    },
    roomSpecs,
    warnings: areaSpecified ? [] : baseline.warnings,
  };
}
