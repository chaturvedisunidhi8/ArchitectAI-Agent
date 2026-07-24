/**
 * aiDesigner.js — End-to-end automated floor plan designer.
 *
 * Takes a free-form property description and produces a finished, furnished,
 * themed plan without any manual step in between.  The pipeline is:
 *
 *   1. parse     — description → structured design brief (nlp.js)
 *   2. program   — brief → validated room schedule with balanced areas
 *   3. search    — sweep strategy × envelope proportion × seed for candidates
 *   4. score     — rank every candidate with the multi-objective fitness fn
 *   5. refine    — hill-climb the top candidates and re-score
 *   6. finish    — pick a theme, assemble the result and explain the choice
 *
 * "AI" here means informed search: a scored candidate pool of ~40 plans
 * explored per run, optimised against weights derived from the description.
 * It is deterministic for a given seed and runs entirely client-side.
 *
 * @module aiDesigner
 */

import { extractRequirements } from './nlp.js';
import { extractRequirementsSmart } from './llm/designBrief.js';
import { applyDesignGraph, resetDesignGraph } from './llm/adjacencyGraph.js';
import { LLM_CONFIG } from './llm/client.js';
import { buildCandidate, layoutStats, VARIANT_INFO } from './layoutVariants.js';
import { scoreLayout, resolveWeights, explainScore, findWeaknesses } from './layoutScore.js';
import { ROOM_TYPES, getRoomType, SQM_TO_SQFT } from './constants.js';
import { THEMES } from './themes.js';

// ---------------------------------------------------------------------------
// Search space
// ---------------------------------------------------------------------------

/** Strategies the search explores, in the order they are tried. */
const STRATEGIES = VARIANT_INFO.map(v => v.id);

/** Envelope width/height ratios. Squarer plans are more compact; wider plans
 *  put more rooms on an exterior wall, which helps daylight. */
const ASPECTS = [1.0, 1.2, 1.4, 1.65];

/** Distinct seeds per (strategy, aspect) pair. */
const SEEDS_PER_COMBO = 3;

/** How many top candidates get the local refinement pass. */
const REFINE_TOP_K = 3;

/** Extra seeds explored around each finalist, keeping its strategy and
 *  envelope fixed so the refined plan is still the plan it claims to be. */
const REFINE_SEEDS = 20;

/** How many ranked alternatives the report offers. */
const ALTERNATIVES = 4;

// ---------------------------------------------------------------------------
// Style → theme mapping
// ---------------------------------------------------------------------------

const STYLE_TO_THEME = {
  modern: 'modern',
  contemporary: 'modern',
  urban: 'modern',
  compact: 'minimalist',
  minimalist: 'minimalist',
  japanese: 'minimalist',
  luxury: 'luxury',
  'art deco': 'luxury',
  colonial: 'luxury',
  scandinavian: 'scandinavian',
  'mid-century': 'scandinavian',
  industrial: 'industrial',
  traditional: 'traditional',
  indian: 'traditional',
  classic: 'traditional',
  rustic: 'traditional',
  farmhouse: 'traditional',
  mediterranean: 'traditional',
  tropical: 'scandinavian',
  vintage: 'traditional',
  bohemian: 'traditional',
};

/**
 * Map an extracted style keyword onto one of the six built-in 3D themes.
 *
 * @param {string} style
 * @returns {string} A valid theme id.
 */
export function pickTheme(style) {
  const mapped = STYLE_TO_THEME[(style || '').toLowerCase()];
  if (mapped && THEMES.some(t => t.id === mapped)) return mapped;
  return 'modern';
}

// ---------------------------------------------------------------------------
// Stage 2 — programming the room schedule
// ---------------------------------------------------------------------------

/**
 * Minimum viable dwelling: whatever the description omits, a home still needs.
 * Only applied when the description mentions living space at all.
 */
function ensureEssentials(specs, bhk) {
  const added = [];
  const bedrooms = specs.find(s => s.type === 'bedroom');
  const bedroomCount = bedrooms ? bedrooms.count : 0;

  const ensure = (type, count, reason) => {
    const spec = specs.find(s => s.type === type);
    if (!spec || spec.count > 0) return;
    spec.count = count;
    added.push({ type, count, reason });
  };

  if (bedroomCount === 0 && !bhk) {
    // Nothing resembling a dwelling was described — seed a studio.
    ensure('living', 1, 'every home needs a living space');
    ensure('kitchen', 1, 'no kitchen was mentioned');
    ensure('bathroom', 1, 'no bathroom was mentioned');
    return added;
  }

  ensure('living', 1, 'no living room was mentioned');
  ensure('kitchen', 1, 'no kitchen was mentioned');
  ensure('bathroom', Math.max(1, Math.ceil(bedroomCount * 0.7)), 'bathroom count derived from bedrooms');
  if (bedroomCount >= 2) ensure('dining', 1, 'added a dining area for a multi-bedroom home');

  return added;
}

/**
 * Rebalance requested areas so the schedule sums to the available floor area.
 *
 * Areas are treated as relative weights: each room keeps its share of the
 * request but the total is stretched or compressed to fit, never below the
 * type's `minArea`.
 *
 * @param {Object[]} specs - Full ROOM_TYPES-shaped spec list.
 * @param {number} totalAreaFt
 * @returns {{ scale: number, clampedRooms: string[] }}
 */
function balanceAreas(specs, totalAreaFt) {
  const active = specs.filter(s => s.count > 0);
  if (active.length === 0) return { scale: 1, clampedRooms: [] };

  const requested = active.reduce((sum, s) => sum + s.area * s.count, 0);
  if (requested <= 0) return { scale: 1, clampedRooms: [] };

  const scale = totalAreaFt / requested;
  const clampedRooms = [];

  active.forEach(spec => {
    const scaled = spec.area * scale;
    const floor = spec.minArea ?? getRoomType(spec.type)?.minArea ?? 20;
    if (scaled < floor) {
      spec.area = floor;
      clampedRooms.push(spec.label);
    } else {
      spec.area = Math.round(scaled);
    }
  });

  return { scale, clampedRooms };
}

/**
 * Turn a raw NLP result into a complete, validated design brief.
 *
 * @param {string} prompt
 * @param {Object} [opts]
 * @param {string} [opts.unit='sqft'] - Unit the caller's areas are expressed in.
 * @returns {{
 *   ok: boolean, error?: string, prompt: string, totalAreaFt: number,
 *   roomSpecs: Object[], style: string, direction: string|null,
 *   preferences: Object, weights: Object, extracted: Object,
 *   decisions: {title: string, detail: string}[], warnings: string[],
 * }}
 */
export function buildDesignBrief(prompt, opts = {}) {
  return briefFromNlp(prompt, extractRequirements(prompt), opts);
}

/**
 * Same brief, but reading the description with an open-weights model when one
 * is reachable.  The model handles arbitrary phrasing the regex extractor
 * cannot ("somewhere for the in-laws when they visit"); everything downstream
 * is unchanged, and a missing or failing model falls back silently.
 *
 * @param {string} prompt
 * @param {Object} [opts]
 * @param {boolean} [opts.useLlm=true]
 * @returns {Promise<Object>} Brief, with `briefSource` recording the path taken.
 */
export async function buildDesignBriefAsync(prompt, opts = {}) {
  const nlp = await extractRequirementsSmart(prompt, opts);
  const brief = briefFromNlp(prompt, nlp, opts);
  if (!brief.ok) return brief;

  brief.briefSource = nlp.source;
  if (nlp.source === 'llm') {
    brief.decisions.unshift({
      title: 'Read your description with a language model',
      detail: nlp.reasoning || 'Interpreted the brief into a room schedule before any geometry was generated',
    });
  }
  return brief;
}

function briefFromNlp(prompt, nlp, opts = {}) {
  if (!nlp.success) return { ok: false, error: nlp.error, prompt };

  const decisions = [];
  const specs = nlp.roomSpecs.map(s => ({ ...s }));
  const { bhk, style, direction, preferences = {} } = nlp.extracted;

  // --- Fill in what the description left out -------------------------------
  const added = ensureEssentials(specs, bhk);
  added.forEach(a => {
    const rt = getRoomType(a.type);
    decisions.push({
      title: `Added ${a.count}× ${rt ? rt.label : a.type}`,
      detail: a.reason,
    });
  });

  // --- Decide the floor area ----------------------------------------------
  // `totalArea` is always populated; only trust it as a request when the
  // description actually stated one.
  const requestedArea = nlp.extracted.areaSpecified ? nlp.extracted.totalArea : null;
  const scheduleArea = specs
    .filter(s => s.count > 0)
    .reduce((sum, s) => sum + s.area * s.count, 0);

  // Rooms occupy ~88% of the envelope; walls and circulation take the rest.
  const CIRCULATION_FRACTION = 0.88;
  let totalAreaFt = requestedArea || Math.round(scheduleArea / CIRCULATION_FRACTION);

  if (!requestedArea) {
    decisions.push({
      title: `Sized the home at ${totalAreaFt} ft²`,
      detail: 'No area was given, so the envelope was derived from the room schedule plus circulation',
    });
  }

  const usableArea = Math.round(totalAreaFt * CIRCULATION_FRACTION);
  const { scale, clampedRooms } = balanceAreas(specs, usableArea);

  if (Math.abs(scale - 1) > 0.12) {
    decisions.push({
      title: scale > 1 ? 'Enlarged rooms to fill the plan' : 'Trimmed rooms to fit the plan',
      detail: `Requested rooms were ${Math.round(Math.abs(1 - scale) * 100)}% ${scale > 1 ? 'under' : 'over'} the ${totalAreaFt} ft² envelope, so every room was scaled proportionally`,
    });
  }
  if (clampedRooms.length > 0) {
    decisions.push({
      title: 'Held rooms at their minimum size',
      detail: `${clampedRooms.join(', ')} would have been unusably small, so they were floored at the minimum`,
    });
  }

  // --- Priorities ----------------------------------------------------------
  const weights = resolveWeights(preferences);
  const priorityNames = Object.keys(preferences).filter(k => preferences[k]);
  if (priorityNames.length > 0) {
    decisions.push({
      title: 'Tuned the scoring for your priorities',
      detail: `Weighted the search toward ${priorityNames.join(', ')} based on your description`,
    });
  }

  return {
    ok: true,
    prompt,
    totalAreaFt,
    roomSpecs: specs,
    style: style || 'modern',
    direction: direction || null,
    preferences,
    weights,
    extracted: nlp.extracted,
    decisions,
    warnings: nlp.warnings || [],
  };
}

// ---------------------------------------------------------------------------
// Stage 3/4 — candidate search and ranking
// ---------------------------------------------------------------------------

/**
 * Compress the full ROOM_TYPES spec list into the expanded form the layout
 * engine consumes (active rooms only, areas already in ft²).
 */
function toEngineSpecs(roomSpecs, unit = 'sqft') {
  return roomSpecs
    .filter(r => r.count > 0)
    .map(r => ({
      type: r.type,
      label: r.label,
      color: r.color,
      area: unit === 'sqm' ? r.area * SQM_TO_SQFT : r.area,
      count: r.count,
      aspectTarget: ROOM_TYPES.find(t => t.id === r.type)?.aspectTarget || 1.2,
    }));
}

/**
 * Enumerate every (strategy, aspect, seed) combination the search will try.
 *
 * @param {number} baseSeed
 * @returns {{strategy: string, aspect: number, seed: number}[]}
 */
export function planSearchSpace(baseSeed) {
  const combos = [];
  let n = 0;
  STRATEGIES.forEach(strategy => {
    ASPECTS.forEach(aspect => {
      for (let s = 0; s < SEEDS_PER_COMBO; s++) {
        combos.push({ strategy, aspect, seed: (baseSeed + n * 7919) | 0 });
        n++;
      }
    });
  });
  return combos;
}

/**
 * Keep only the best candidate per strategy so the alternatives on offer are
 * visibly different plans rather than four near-identical seeds.
 */
function dedupeByStrategy(ranked, limit) {
  const seen = new Set();
  const picked = [];
  ranked.forEach(c => {
    if (picked.length >= limit || seen.has(c.strategy)) return;
    seen.add(c.strategy);
    picked.push(c);
  });
  // Backfill with the next-best regardless of strategy.
  ranked.forEach(c => {
    if (picked.length >= limit || picked.includes(c)) return;
    picked.push(c);
  });
  return picked;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Stage descriptors, used to drive the progress UI.
 */
export const PIPELINE_STAGES = [
  { id: 'parse', label: 'Reading your description', detail: 'Extracting rooms, area, style and priorities' },
  { id: 'program', label: 'Planning the room schedule', detail: 'Balancing areas and filling in what you left out' },
  { id: 'search', label: 'Exploring layouts', detail: 'Generating candidate plans across four strategies' },
  { id: 'score', label: 'Scoring every plan', detail: 'Flow, daylight, privacy, proportion and space use' },
  { id: 'refine', label: 'Refining the finalists', detail: 'Hill-climbing the highest-scoring arrangements' },
  { id: 'finish', label: 'Furnishing and styling', detail: 'Placing furniture and applying your interior theme' },
];

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run the full automated design pipeline.
 *
 * Yields to the event loop between stages so the progress UI can paint; the
 * heavy geometry itself is synchronous.
 *
 * @param {string} prompt - The property description.
 * @param {Object} [opts]
 * @param {number}   [opts.seed]       - Base seed; omit for a fresh design.
 * @param {string}   [opts.unit]       - Unit of the spec areas ('sqft'|'sqm').
 * @param {Function} [opts.onProgress] - `(stageId, index, total, info) => void`.
 * @param {Object}   [opts.brief]      - Pre-built brief; skips parsing.
 * @returns {Promise<Object>} The design result, or `{ ok: false, error }`.
 */
export async function runAutoDesign(prompt, opts = {}) {
  const baseSeed = opts.seed ?? (Date.now() | 0);
  const report = (stageId, info) => {
    if (!opts.onProgress) return;
    const index = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    opts.onProgress(stageId, index, PIPELINE_STAGES.length, info);
  };

  // --- 1. Parse ------------------------------------------------------------
  report('parse');
  await nextTick();

  const brief = opts.brief || await buildDesignBriefAsync(prompt, opts);
  if (!brief.ok) return { ok: false, error: brief.error };

  // --- 2. Program ----------------------------------------------------------
  report('program', { rooms: brief.roomSpecs.filter(s => s.count > 0).length });
  await nextTick();

  const engineSpecs = toEngineSpecs(brief.roomSpecs, opts.unit);
  if (engineSpecs.length === 0) {
    return { ok: false, error: 'No rooms could be derived from that description. Try naming the rooms you want.' };
  }

  // Ask the model for this home's bubble diagram.  It steers subdivision,
  // door placement and scoring alike; without a model the built-in
  // architectural weights are used and nothing else changes.
  const graph = await applyDesignGraph(brief.roomSpecs, { ...opts, brief: prompt });
  if (graph.source === 'llm') {
    brief.decisions.push({
      title: `Planned room relationships with a language model`,
      detail: graph.reasoning || `Derived ${graph.edges} adjacency preferences specific to this home, then searched layouts against them`,
    });
  }

  // --- 3. Search -----------------------------------------------------------
  const combos = planSearchSpace(baseSeed);
  report('search', { planned: combos.length });
  await nextTick();

  const candidates = [];
  combos.forEach(({ strategy, aspect, seed }) => {
    try {
      const built = buildCandidate(strategy, brief.totalAreaFt, engineSpecs, { seed, aspect });
      if (built) candidates.push({ ...built, strategy, aspect });
    } catch (e) {
      // A strategy can legitimately fail on an awkward schedule — skip it.
      console.warn(`AI candidate ${strategy}@${aspect} failed:`, e);
    }
  });

  if (candidates.length === 0) {
    resetDesignGraph();
    return { ok: false, error: 'Could not fit those rooms into a plan. Try a larger area or fewer rooms.' };
  }

  // --- 4. Score ------------------------------------------------------------
  report('score', { evaluated: candidates.length });
  await nextTick();

  const scoreOpts = { weights: brief.weights, direction: brief.direction };
  candidates.forEach(c => { c.score = scoreLayout(c.layout, scoreOpts); });
  candidates.sort((a, b) => b.score.total - a.score.total);

  // --- 5. Refine -----------------------------------------------------------
  // Local search in seed space: hold each finalist's strategy and envelope
  // fixed and explore neighbouring seeds, keeping anything that scores higher.
  // Re-subdividing generically would score better on paper but would no longer
  // be the layout it is labelled as.
  report('refine', { finalists: Math.min(REFINE_TOP_K, candidates.length) });
  await nextTick();

  const finalists = candidates.slice(0, REFINE_TOP_K);
  let refinedEvaluations = 0;

  for (const finalist of finalists) {
    for (let i = 1; i <= REFINE_SEEDS; i++) {
      try {
        const trial = buildCandidate(finalist.strategy, brief.totalAreaFt, engineSpecs, {
          seed: (finalist.seed + i * 104729) | 0,
          aspect: finalist.aspect,
        });
        if (!trial) continue;
        refinedEvaluations++;

        const trialScore = scoreLayout(trial.layout, scoreOpts);
        if (trialScore.total > finalist.score.total) {
          finalist.layout = trial.layout;
          finalist.score = trialScore;
          finalist.seed = trial.seed;
          finalist.refined = true;
        }
      } catch (e) {
        console.warn(`Refinement of ${finalist.strategy} failed:`, e);
      }
    }
    await nextTick();
  }

  candidates.sort((a, b) => b.score.total - a.score.total);

  // --- 6. Finish -----------------------------------------------------------
  report('finish');
  await nextTick();

  const shortlist = dedupeByStrategy(candidates, ALTERNATIVES);
  const winner = shortlist[0];
  const theme = pickTheme(brief.style);

  const totalEvaluated = candidates.length + refinedEvaluations;
  const decisions = [...brief.decisions, {
    title: `Chose the ${winner.name.toLowerCase()}`,
    detail: `Best of ${totalEvaluated} generated plans, scoring ${winner.score.total} out of 100`,
  }, {
    title: `Applied the ${THEMES.find(t => t.id === theme)?.name || theme} interior theme`,
    detail: `Matched to the "${brief.style}" style in your description`,
  }];

  const variants = shortlist.map((c, i) => ({
    id: `${c.strategy}_${i}`,
    name: c.name,
    desc: c.desc,
    layout: c.layout,
    score: c.score,
    aiRank: i + 1,
    stats: {
      ...layoutStats(c.layout),
      adjacency: c.score.breakdown.adjacency?.score ?? 0,
      reachable: c.score.reachable,
      aiScore: c.score.total,
    },
  }));

  // The graph is per-run state; leaving it installed would silently reshape
  // any later manual layout the user builds.
  resetDesignGraph();

  return {
    ok: true,
    brief,
    seed: baseSeed,
    theme,
    // Which parts of this design came from a model rather than the rule base.
    llm: {
      brief: brief.briefSource || 'rules',
      graph: graph.source,
      graphEdges: graph.edges,
      model: graph.source === 'llm' || brief.briefSource === 'llm' ? LLM_CONFIG.model : null,
    },
    layout: winner.layout,
    score: winner.score,
    strengths: explainScore(winner.score),
    weaknesses: findWeaknesses(winner.score),
    decisions,
    variants,
    stats: {
      candidatesGenerated: totalEvaluated,
      strategiesTried: new Set(candidates.map(c => c.strategy)).size,
      refined: finalists.filter(f => f.refined).length,
    },
  };
}
