export const SQFT_TO_SQM = 0.092903;
export const SQM_TO_SQFT = 10.7639;
export const FT_PER_M = 3.28084;
export const WALL_THICKNESS_FT = 0.5;
export const DOOR_WIDTH_FT = 3;

// --- 3D model dimensions (feet) ---
// The 3D model treats one layout unit as one foot, so heights use the same
// scale as the plan footprint. These give architecturally correct proportions
// for the exported model (GLTF/GLB/OBJ/STL are emitted in feet).
export const CEILING_HEIGHT_FT = 9;      // interior clear height
export const FLOOR_SLAB_FT = 0.5;        // floor slab thickness (below y = 0)
export const CEILING_SLAB_FT = 0.4;      // ceiling slab thickness
export const ROOF_SLAB_FT = 0.6;         // flat roof slab thickness
export const PARAPET_HEIGHT_FT = 1.5;    // roof parapet wall height
export const EXTERIOR_WALL_FT = 0.66;    // outer wall thickness
export const DOOR_HEIGHT_FT = 6.8;       // door opening height
export const WINDOW_SILL_FT = 3;         // height of window sill off the floor
export const WINDOW_HEIGHT_FT = 4;       // window opening height
export const WINDOW_MIN_WALL_FT = 5;     // don't window walls shorter than this

// Room types that get windows on their exterior walls
export const WINDOWED_ROOMS = new Set([
  'bedroom', 'living', 'kitchen', 'dining', 'study', 'balcony',
]);

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

export function getRoomType(id) {
  return ROOM_TYPES.find(r => r.id === id);
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
