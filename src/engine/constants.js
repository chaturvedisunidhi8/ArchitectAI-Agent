export const SQFT_TO_SQM = 0.092903;
export const SQM_TO_SQFT = 10.7639;
export const FT_PER_M = 3.28084;

// --- Wall thickness (Indian residential construction) ---
// Full brick 230 mm exterior, half brick 115 mm interior.
export const EXTERIOR_WALL_FT = 0.75;   // 9 in — full brick
export const INTERIOR_WALL_FT = 0.375;  // 4.5 in — half brick

// Legacy alias kept for backward compat; prefer EXTERIOR_WALL_FT / INTERIOR_WALL_FT.
export const WALL_THICKNESS_FT = INTERIOR_WALL_FT;

// --- Planning grid ---
// Every wall line, room dimension and opening offset is snapped to this
// module.  Drafting on a 6-inch grid is what makes a plan read as orthogonal
// and dimensioned rather than as arbitrary floating-point splits.
export const GRID_FT = 0.5;

/** Snap a value to the planning grid. */
export const snapToGrid = (v, grid = GRID_FT) => Math.round(v / grid) * grid;

// --- Opening dimensions ---
export const DOOR_WIDTH_FT = 3;
/** Narrowest door we will fit before giving up on an opening. */
export const DOOR_MIN_WIDTH_FT = 2.5;
/** Wide cased opening between public rooms (living/dining/kitchen). */
export const CASED_OPENING_FT = 5;
/** Clear distance a door must keep from the end of its wall, so the leaf
 *  never collides with the perpendicular wall it hinges against. */
export const DOOR_JAMB_CLEARANCE_FT = 0.5;
/** Clear distance a window must keep from a corner. */
export const WINDOW_CORNER_CLEARANCE_FT = 1.5;
/** Minimum masonry pier left between two openings on the same wall. */
export const MIN_PIER_FT = 1;

// --- 3D model dimensions (feet) ---
export const CEILING_HEIGHT_FT = 9;
export const FLOOR_SLAB_FT = 0.5;
export const CEILING_SLAB_FT = 0.4;
export const ROOF_SLAB_FT = 0.6;
export const PARAPET_HEIGHT_FT = 1.5;
export const DOOR_HEIGHT_FT = 6.8;
export const WINDOW_SILL_FT = 3;
export const WINDOW_HEIGHT_FT = 4;
export const WINDOW_MIN_WALL_FT = 5;

// --- Circulation ---
export const MIN_CORRIDOR_WIDTH_FT = 3.5;

// Room types that get windows on their exterior walls
export const WINDOWED_ROOMS = new Set([
  'bedroom', 'living', 'kitchen', 'dining', 'study', 'balcony',
  'bathroom', 'laundry', 'hall',
]);

/**
 * Per-type window sizing.  `unit` is the nominal width of one window; a long
 * exterior wall gets several of them evenly spaced rather than one wide slot,
 * which is how a drafted plan reads.  `max` caps how many go on one wall.
 */
export const WINDOW_SPEC = {
  living:   { unit: 5,   max: 3, minWall: 6 },
  bedroom:  { unit: 4.5, max: 2, minWall: 6 },
  dining:   { unit: 4.5, max: 2, minWall: 6 },
  kitchen:  { unit: 3.5, max: 2, minWall: 5 },
  study:    { unit: 4,   max: 2, minWall: 5 },
  balcony:  { unit: 6,   max: 2, minWall: 6 },
  bathroom: { unit: 2.5, max: 1, minWall: 4 },
  laundry:  { unit: 2.5, max: 1, minWall: 4 },
  hall:     { unit: 3,   max: 1, minWall: 5 },
};

export const DEFAULT_WINDOW_SPEC = { unit: 4, max: 2, minWall: 6 };

// --- Minimum room dimensions (feet) ---
// Used by the subdivision engine to reject aspect ratios that would
// produce unusable slivers.
export const MIN_DIMENSIONS = {
  bedroom:   { w: 8,   h: 8   },
  bathroom:  { w: 5,   h: 5   },
  kitchen:   { w: 6,   h: 6   },
  living:    { w: 10,  h: 10  },
  dining:    { w: 6,   h: 6   },
  balcony:   { w: 3,   h: 5   },
  store:     { w: 3,   h: 3   },
  study:     { w: 6,   h: 6   },
  pooja:     { w: 4,   h: 4   },
  laundry:   { w: 4,   h: 4   },
  garage:    { w: 10,  h: 18  },
  garden:    { w: 5,   h: 5   },
  hall:      { w: 3.5, h: 3.5 },
};

// Maximum acceptable bounding-box aspect ratio for any room cell.
// A cell with w/h > MAX_ASPECT_RATIO or h/w > MAX_ASPECT_RATIO is rejected.
export const MAX_ASPECT_RATIO = 2.2;

// Types of rooms that should never be passed through for circulation.
export const PRIVATE_ROOM_TYPES = new Set(['bedroom', 'bathroom', 'store']);

export const ROOM_TYPES = [
  { id: 'bedroom', label: 'Bedroom', color: '#E8D5B7', defaultArea: 150, minArea: 80, icon: '\u25A4', aspectTarget: 1.3 },
  { id: 'bathroom', label: 'Bathroom', color: '#B7D5E8', defaultArea: 50, minArea: 25, icon: '\u25A8', aspectTarget: 1.0 },
  { id: 'kitchen', label: 'Kitchen', color: '#D5E8B7', defaultArea: 100, minArea: 50, icon: '\u2699', aspectTarget: 1.4 },
  { id: 'living', label: 'Living Room', color: '#E8E0D0', defaultArea: 250, minArea: 120, icon: '\u25A3', aspectTarget: 1.5 },
  { id: 'dining', label: 'Dining Room', color: '#E0D5E8', defaultArea: 120, minArea: 60, icon: '\u25CB', aspectTarget: 1.2 },
  { id: 'balcony', label: 'Balcony', color: '#D0E8D5', defaultArea: 40, minArea: 20, icon: '\u25B3', aspectTarget: 2.0 },
  { id: 'store', label: 'Store Room', color: '#D5D5D5', defaultArea: 40, minArea: 20, icon: '\u25A1', aspectTarget: 1.0 },
  { id: 'study', label: 'Study', color: '#E8D5D5', defaultArea: 80, minArea: 40, icon: '\u270E', aspectTarget: 1.2 },
  { id: 'pooja', label: 'Pooja Room', color: '#E8E0B7', defaultArea: 40, minArea: 20, icon: '\u2600', aspectTarget: 1.0 },
  { id: 'laundry', label: 'Laundry', color: '#B7E0E8', defaultArea: 35, minArea: 20, icon: '\u2699', aspectTarget: 1.0 },
  { id: 'garage', label: 'Garage', color: '#C8C8C8', defaultArea: 200, minArea: 120, icon: '\u2699', aspectTarget: 1.8 },
  { id: 'garden', label: 'Garden', color: '#B7E8C0', defaultArea: 80, minArea: 30, icon: '\u2618', aspectTarget: 1.3 },
];

/**
 * Room types the planner creates on its own.  These are deliberately kept out
 * of `ROOM_TYPES` so they never appear as checkboxes in the manual room
 * picker — you don't ask for a hallway, the circulation solver gives you one.
 */
export const GENERATED_ROOM_TYPES = [
  { id: 'hall', label: 'Hallway', color: '#EDE8E0', defaultArea: 60, minArea: 20, icon: '║', aspectTarget: 3.0 },
];

/**
 * Planning zones.  Used to group rooms during subdivision so the public,
 * private and service parts of the home land in coherent blocks instead of
 * being interleaved by area balance alone.
 */
export const ROOM_ZONES = {
  living: 'public', dining: 'public', kitchen: 'service', hall: 'circulation',
  bedroom: 'private', bathroom: 'private', store: 'service', study: 'private',
  balcony: 'public', pooja: 'public', laundry: 'service', garage: 'service',
  garden: 'public',
};

export const getZone = (type) => ROOM_ZONES[type] || 'public';

export function getRoomType(id) {
  return ROOM_TYPES.find(r => r.id === id)
    || GENERATED_ROOM_TYPES.find(r => r.id === id);
}

export function hexToThree(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function darkenHex(hex, amount = 0.15) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return `#${[r, g, b].map(c => Math.round(c * f).toString(16).padStart(2, '0')).join('')}`;
}
