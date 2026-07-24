/**
 * nlp.js — Natural Language Processing engine for home design prompts.
 *
 * Parses free-form text describing a desired home and extracts structured
 * requirements: BHK count, total area, style, room specifications, and
 * optional preferences (direction, budget, floors, amenities).
 *
 * Fully client-side — no external API calls. Uses regex patterns and
 * heuristic keyword matching against the ROOM_TYPES catalog.
 */

import { ROOM_TYPES, SQM_TO_SQFT } from './constants.js';

// ---------------------------------------------------------------------------
// Room keyword mapping — maps common words/phrases to room type IDs
// ---------------------------------------------------------------------------
const ROOM_KEYWORDS = {
  bedroom: ['bedroom', 'bed room', 'bedrooms', 'bhk', 'master bedroom', 'guest bedroom', 'kids room', "kid's room", 'master bedroom'],
  bathroom: ['bathroom', 'bath room', 'bathrooms', 'bath', 'washroom', 'toilet', 'restroom', 'ensuite', 'en-suite'],
  kitchen: ['kitchen', 'kitchenette', 'cooking area'],
  living: ['living room', 'living', 'hall', 'lounge', 'family room', 'great room', 'drawing room', 'sitting room'],
  dining: ['dining room', 'dining', 'dining area', 'breakfast nook'],
  balcony: ['balcony', 'balconies', 'patio', 'terrace', 'deck'],
  store: ['store room', 'storeroom', 'storage', 'storage room', 'utility room'],
  study: ['study', 'study room', 'office', 'home office', 'work from home', 'wfH', 'den', 'library'],
  pooja: ['pooja', 'pooja room', 'prayer room', 'mandir', 'puja', 'worship'],
  laundry: ['laundry', 'laundry room', 'wash area', 'washing area'],
  garage: ['garage', 'car parking', 'carport', 'parking'],
  garden: ['garden', 'backyard', 'front yard', 'yard', 'lawn', 'landscaped area', 'outdoor space'],
};

// Size modifiers that adjust default area
const SIZE_MODIFIERS = {
  tiny: 0.5,
  small: 0.7,
  medium: 1.0,
  standard: 1.0,
  normal: 1.0,
  large: 1.3,
  big: 1.3,
  spacious: 1.4,
  huge: 1.6,
  massive: 1.8,
  grand: 1.5,
  luxurious: 1.5,
  master: 1.3,
  extra: 1.2,
  vast: 1.5,
};

// Style keywords
const STYLES = [
  'modern', 'minimalist', 'minimal', 'luxury', 'luxurious', 'traditional',
  'contemporary', 'scandinavian', 'nordic', 'industrial', 'classic',
  'japanese', 'japanese minimalist', 'indian', 'vastu', 'colonial',
  'mediterranean', 'tropical', 'rustic', 'bohemian', 'art deco',
  'mid-century', 'vintage', 'farmhouse', 'smart home', 'eco-friendly',
  'sustainable', 'green', 'urban', 'compact', 'open plan', 'open-concept',
];

// Direction keywords (for Vastu)
const DIRECTIONS = [
  'north', 'south', 'east', 'west',
  'north-east', 'northeast', 'south-east', 'southeast',
  'north-west', 'northwest', 'south-west', 'southwest',
  'facing north', 'facing south', 'facing east', 'facing west',
];

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractBhk(text) {
  // Match patterns like "3BHK", "3 BHK", "3 bhk", "3 bedroom"
  const bhkMatch = text.match(/(\d+)\s*(?:bhk|bed(?:\s*room)?s?)/i);
  if (bhkMatch) return parseInt(bhkMatch[1], 10);

  // Count explicit bedroom mentions
  const bedroomKeywords = ['bedroom', 'bed room', 'master bedroom', 'guest bedroom', 'kids room'];
  let count = 0;
  bedroomKeywords.forEach(kw => {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'gi');
    const matches = text.match(re);
    if (matches) count += matches.length;
  });
  return count > 0 ? Math.min(count, 10) : null;
}

function extractArea(text) {
  // Match "1800 sqft", "1800 sq ft", "1800 sq. ft.", "1800 square feet"
  const sqftMatch = text.match(/(\d[\d,]*)\s*(?:sq[\s.]*(?:ft|feet|foot)|square\s*(?:feet|foot|ft))/i);
  if (sqftMatch) return parseInt(sqftMatch[1].replace(/,/g, ''), 10);

  // Match "1800 sqm", "1800 sq m", "167 sqm"
  const sqmMatch = text.match(/(\d[\d,]*)\s*(?:sq[\s.]*(?:m|meter|meters|metre|metres))/i);
  if (sqmMatch) return Math.round(parseInt(sqmMatch[1].replace(/,/g, ''), 10) * SQM_TO_SQFT);

  // Match plain numbers followed by area context: "1800 area", "1800 total"
  const plainMatch = text.match(/(\d[\d,]*)\s*(?:total\s*)?(?:area|sq|sqr)/i);
  if (plainMatch) return parseInt(plainMatch[1].replace(/,/g, ''), 10);

  return null;
}

function extractStyle(text) {
  const lower = text.toLowerCase();
  for (const style of STYLES) {
    if (lower.includes(style)) {
      // Normalize some synonyms
      if (style === 'minimal' || style === 'minimalist') return 'minimalist';
      if (style === 'luxurious') return 'luxury';
      if (style === 'nordic') return 'scandinavian';
      if (style === 'japanese minimalist') return 'japanese';
      if (style === 'open plan' || style === 'open-concept') return 'modern';
      if (style === 'smart home') return 'modern';
      if (style === 'eco-friendly' || style === 'sustainable' || style === 'green') return 'modern';
      return style;
    }
  }
  return null;
}

function extractDirection(text) {
  const lower = text.toLowerCase();
  for (const dir of DIRECTIONS) {
    if (lower.includes(dir)) {
      return dir.replace('facing ', '');
    }
  }
  return null;
}

function extractFloors(text) {
  const match = text.match(/(\d+)\s*(?:floor|story|storey|stories|level)/i);
  if (match) return Math.min(parseInt(match[1], 10), 5);
  return null;
}

function extractBudget(text) {
  // Match "$150,000", "₹50 lakh", "₹1 crore", "budget of 200000"
  const dollarMatch = text.match(/\$\s*([\d,]+)/);
  if (dollarMatch) return { amount: parseInt(dollarMatch[1].replace(/,/g, ''), 10), currency: 'USD' };

  const inrLakh = text.match(/([\d,.]+)\s*lakh/i);
  if (inrLakh) return { amount: parseFloat(inrLakh[1].replace(/,/g, '')) * 100000, currency: 'INR' };

  const inrCrore = text.match(/([\d,.]+)\s*crore/i);
  if (inrCrore) return { amount: parseFloat(inrCrore[1].replace(/,/g, '')) * 10000000, currency: 'INR' };

  const budgetMatch = text.match(/budget\s*(?:of|is|:)?\s*\$?\s*([\d,]+)/i);
  if (budgetMatch) return { amount: parseInt(budgetMatch[1].replace(/,/g, ''), 10), currency: 'USD' };

  return null;
}

// ---------------------------------------------------------------------------
// Design priorities — phrases that tell the auto-designer what to optimise for
// ---------------------------------------------------------------------------

const PREFERENCE_KEYWORDS = {
  vastu: ['vastu', 'vaastu', 'vastu compliant', 'vastu-compliant', 'shastra', 'auspicious', 'facing'],
  daylight: ['natural light', 'sunlight', 'sunlit', 'bright', 'airy', 'ventilation', 'ventilated',
    'cross ventilation', 'breezy', 'daylight', 'well lit', 'well-lit', 'windows'],
  privacy: ['privacy', 'private', 'quiet', 'separate wing', 'secluded', 'guest wing'],
  openPlan: ['open plan', 'open-plan', 'open concept', 'open-concept', 'open kitchen',
    'open living', 'spacious feel', 'great room', 'loft'],
  compact: ['compact', 'small', 'studio', 'tiny', 'efficient', 'space saving', 'space-saving',
    'budget', 'affordable'],
  luxury: ['luxury', 'luxurious', 'premium', 'grand', 'lavish', 'high-end', 'high end', 'villa'],
};

/**
 * Detect which design priorities the description implies.  These become the
 * scoring weights the auto-designer optimises against.
 *
 * @param {string} text
 * @returns {Object<string, boolean>}
 */
function extractPreferences(text) {
  const lower = text.toLowerCase();
  const prefs = {};
  for (const [key, keywords] of Object.entries(PREFERENCE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) prefs[key] = true;
  }
  return prefs;
}

function extractAmenities(text) {
  const amenityKeywords = [
    'swimming pool', 'pool', 'gym', 'garden', 'parking', 'garage',
    'elevator', 'lift', 'security', 'clubhouse', 'playground',
    'rooftop', 'basement', 'attic', 'fireplace', 'fire pit',
    'jacuzzi', 'sauna', 'theater', 'theatre', 'home theater',
    'wine cellar', 'library', 'study', 'walk-in closet', 'pantry',
    'mudroom', 'laundry', 'servant room', 'driver room', 'store room',
  ];

  const found = [];
  const lower = text.toLowerCase();
  amenityKeywords.forEach(kw => {
    if (lower.includes(kw)) found.push(kw);
  });
  return found.length > 0 ? found : null;
}

// ---------------------------------------------------------------------------
// Room extraction — find individual room mentions with size modifiers
// ---------------------------------------------------------------------------

function extractRooms(text) {
  const lower = text.toLowerCase();
  const rooms = [];
  const processed = new Set();

  // For each room type, check if it's mentioned in the text
  for (const [type, keywords] of Object.entries(ROOM_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`(?:a\\s+|an\\s+|the\\s+|${kw}\\s+)?${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?:\\s*(?:room|area))?`, 'gi');
      const matches = [...lower.matchAll(regex)];

      if (matches.length > 0 && !processed.has(type)) {
        // Check for size modifiers near the keyword
        let sizeMultiplier = 1.0;
        for (const [mod, mult] of Object.entries(SIZE_MODIFIERS)) {
          const modRegex = new RegExp(`${mod}\\s+${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
          if (modRegex.test(lower)) {
            sizeMultiplier = mult;
            break;
          }
        }

        // Check for explicit count (e.g., "2 bathrooms", "3 bedrooms")
        let count = 1;
        const countMatch = lower.match(new RegExp(`(\\d+)\\s+${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?`, 'i'));
        if (countMatch) {
          count = Math.min(parseInt(countMatch[1], 10), 10);
        }

        // Skip 'bedroom' here — BHK handles it
        if (type === 'bedroom') {
          processed.add(type);
          continue;
        }

        rooms.push({ type, count, sizeMultiplier });
        processed.add(type);
        break; // only match once per room type
      }
    }
  }

  return rooms;
}

// ---------------------------------------------------------------------------
// Apply extracted data to generate room specifications
// ---------------------------------------------------------------------------

function buildRoomSpecs(bhk, extractedRooms, totalArea) {
  const specs = ROOM_TYPES.map(t => ({
    type: t.id,
    label: t.label,
    color: t.color,
    area: t.defaultArea,
    count: 0,
    minArea: t.minArea,
    aspectTarget: t.aspectTarget,
  }));

  // Set bedroom count from BHK
  if (bhk && bhk > 0) {
    const bedroomSpec = specs.find(s => s.type === 'bedroom');
    if (bedroomSpec) {
      bedroomSpec.count = Math.min(bhk, 5);
      // Scale bedroom area based on total area
      if (totalArea) {
        const targetBedArea = Math.round((totalArea * 0.25) / bhk);
        bedroomSpec.area = Math.max(bedroomSpec.minArea, Math.min(400, targetBedArea));
      }
    }
  }

  // Apply extracted room specifications
  extractedRooms.forEach(({ type, count, sizeMultiplier }) => {
    const spec = specs.find(s => s.type === type);
    if (spec) {
      spec.count = Math.max(spec.count, count);
      if (sizeMultiplier !== 1.0) {
        spec.area = Math.round(spec.area * sizeMultiplier);
      }
    }
  });

  // Auto-add common rooms based on BHK if not already specified
  if (bhk >= 1) {
    const ensureRoom = (type, count) => {
      const spec = specs.find(s => s.type === type);
      if (spec && spec.count === 0) spec.count = count;
    };

    ensureRoom('bathroom', Math.max(1, Math.ceil(bhk * 0.7)));
    ensureRoom('kitchen', 1);
    ensureRoom('living', 1);

    if (bhk >= 2) ensureRoom('dining', 1);
    if (bhk >= 3) {
      ensureRoom('balcony', 1);
      ensureRoom('store', 1);
    }
  }

  // Scale areas proportionally if total area is known
  if (totalArea) {
    const activeSpecs = specs.filter(s => s.count > 0);
    const totalRequested = activeSpecs.reduce((sum, s) => sum + s.area * s.count, 0);
    if (totalRequested > 0) {
      const scale = Math.min(1.5, Math.max(0.5, totalArea / totalRequested));
      activeSpecs.forEach(s => {
        s.area = Math.max(s.minArea, Math.round(s.area * scale));
      });
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export function extractRequirements(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: 'Please provide a description of your dream home.' };
  }

  const trimmed = prompt.trim();
  if (trimmed.length < 5) {
    return { success: false, error: 'Please describe your home in more detail (at least a few words).' };
  }

  const bhk = extractBhk(trimmed);
  const totalArea = extractArea(trimmed);
  const style = extractStyle(trimmed);
  const direction = extractDirection(trimmed);
  const floors = extractFloors(trimmed);
  const budget = extractBudget(trimmed);
  const amenities = extractAmenities(trimmed);
  const rooms = extractRooms(trimmed);
  const preferences = extractPreferences(trimmed);

  // An explicit facing direction implies the user cares about orientation.
  if (direction) preferences.vastu = true;

  // Validate minimum requirements
  const warnings = [];
  if (!bhk && rooms.length === 0) {
    warnings.push('Could not detect room count. Consider mentioning BHK (e.g., "3BHK") or listing rooms.');
  }
  if (!totalArea) {
    warnings.push('Could not detect total area. Consider adding square footage (e.g., "1800 sqft").');
  }

  // Build room specs
  const roomSpecs = buildRoomSpecs(bhk, rooms, totalArea);

  // Calculate defaults if area not provided
  const effectiveArea = totalArea || roomSpecs
    .filter(s => s.count > 0)
    .reduce((sum, s) => sum + s.area * s.count, 0);

  return {
    success: true,
    extracted: {
      bhk,
      totalArea: effectiveArea,
      // Whether the area came from the description or was inferred from the
      // room list — the auto-designer sizes the envelope differently for each.
      areaSpecified: Boolean(totalArea),
      style: style || 'modern',
      direction,
      floors,
      budget,
      amenities,
      preferences,
      rooms: rooms.map(r => `${r.count}× ${r.type}`),
    },
    roomSpecs,
    warnings,
  };
}

/**
 * Human-readable labels for the design priorities, for the UI chips.
 */
export const PREFERENCE_INFO = {
  vastu: { label: 'Vastu', desc: 'Directional placement rules' },
  daylight: { label: 'Daylight', desc: 'Windows and cross-ventilation' },
  privacy: { label: 'Privacy', desc: 'Bedrooms shielded from public rooms' },
  openPlan: { label: 'Open Plan', desc: 'Connected living, dining and kitchen' },
  compact: { label: 'Compact', desc: 'Every square foot works' },
  luxury: { label: 'Luxury', desc: 'Generous, well-proportioned rooms' },
};

// ---------------------------------------------------------------------------
// Example prompts for the UI
// ---------------------------------------------------------------------------

export const EXAMPLE_PROMPTS = [
  '3BHK modern home, 1800 sqft, large living room, 2 bathrooms, kitchen with dining, balcony',
  'Small 2BHK apartment, 900 sqft, minimalist style, study room, 1 bathroom',
  'Luxury 4BHK house, 3000 sqft, spacious master bedroom, 3 bathrooms, pooja room, garden, garage',
  'Compact 1BHK studio, 500 sqft, open kitchen, balcony, modern industrial style',
  'Traditional Indian 3BHK, 2000 sqft, vastu compliant, pooja room, 2 bathrooms, store room, laundry',
  'Scandinavian style 2BHK, 1200 sqft, large kitchen, home office, balcony, minimalist design',
];

// ---------------------------------------------------------------------------
// Style display names and descriptions for the UI
// ---------------------------------------------------------------------------

export const STYLE_INFO = {
  modern: { label: 'Modern', desc: 'Clean lines, open spaces, neutral tones' },
  minimalist: { label: 'Minimalist', desc: 'Less is more, functional simplicity' },
  luxury: { label: 'Luxury', desc: 'Premium finishes, grand proportions' },
  traditional: { label: 'Traditional', desc: 'Classic proportions, ornate details' },
  contemporary: { label: 'Contemporary', desc: 'Current trends, mixed textures' },
  scandinavian: { label: 'Scandinavian', desc: 'Light woods, white walls, hygge' },
  industrial: { label: 'Industrial', desc: 'Exposed materials, raw finishes' },
  classic: { label: 'Classic', desc: 'Timeless elegance, symmetrical' },
  japanese: { label: 'Japanese', desc: 'Zen simplicity, natural materials' },
  indian: { label: 'Indian', desc: 'Rich colors, traditional patterns' },
  colonial: { label: 'Colonial', desc: 'European influence, tall ceilings' },
  mediterranean: { label: 'Mediterranean', desc: 'Warm tones, arched openings' },
  tropical: { label: 'Tropical', desc: 'Open air, natural ventilation' },
  rustic: { label: 'Rustic', desc: 'Natural wood, stone, earthy tones' },
  'art deco': { label: 'Art Deco', desc: 'Geometric patterns, bold colors' },
  'mid-century': { label: 'Mid-Century', desc: 'Retro modern, organic shapes' },
  vintage: { label: 'Vintage', desc: 'Classic charm, curated antiques' },
  farmhouse: { label: 'Farmhouse', desc: 'Rustic warmth, shiplap, open shelving' },
  urban: { label: 'Urban', desc: 'City living, space-efficient' },
  compact: { label: 'Compact', desc: 'Maximized small space' },
};
