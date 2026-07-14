/**
 * themes.js — Interior design theme definitions.
 *
 * Each theme specifies wall colors, floor materials, furniture defaults,
 * and visual properties that modify the 3D model's appearance.
 */

export const THEMES = [
  {
    id: 'modern',
    name: 'Modern',
    desc: 'Clean lines, neutral palette, open feel',
    preview: { wall: '#f5f5f0', floor: '#b98d5f', accent: '#2c3e50', fabric: '#7c8895' },
    wallColor: '#f5f5f0',
    wallExtColor: '#e7ded0',
    floorOverrides: {
      bedroom: 'wood',
      living: 'wood',
      kitchen: 'tile',
      bathroom: 'tile',
      dining: 'wood',
    },
    furnitureColors: {
      fabric: '#7c8895',
      wood: '#8a5a37',
      woodLight: '#b08a5e',
      accent: '#2c3e50',
    },
    lightingWarmth: 0.5,
    ceilingStyle: 'flat',
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    desc: 'Less is more, white walls, natural wood',
    preview: { wall: '#fafafa', floor: '#c4a882', accent: '#333333', fabric: '#d9d2c4' },
    wallColor: '#fafafa',
    wallExtColor: '#f0ede8',
    floorOverrides: {
      bedroom: 'wood',
      living: 'wood',
      kitchen: 'tile',
      bathroom: 'tile',
      dining: 'wood',
    },
    furnitureColors: {
      fabric: '#d9d2c4',
      wood: '#c4a882',
      woodLight: '#dbc8a8',
      accent: '#333333',
    },
    lightingWarmth: 0.3,
    ceilingStyle: 'flat',
  },
  {
    id: 'luxury',
    name: 'Luxury',
    desc: 'Premium finishes, rich materials, grand scale',
    preview: { wall: '#f0ebe3', floor: '#8b6914', accent: '#c9a24a', fabric: '#5b4a3f' },
    wallColor: '#f0ebe3',
    wallExtColor: '#e0d5c5',
    floorOverrides: {
      bedroom: 'marble',
      living: 'marble',
      kitchen: 'marble',
      bathroom: 'marble',
      dining: 'wood',
    },
    furnitureColors: {
      fabric: '#5b4a3f',
      wood: '#6b3a1f',
      woodLight: '#8b6914',
      accent: '#c9a24a',
    },
    lightingWarmth: 0.7,
    ceilingStyle: 'flat',
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian',
    desc: 'Light woods, white walls, cozy minimalism',
    preview: { wall: '#f8f6f2', floor: '#d4b896', accent: '#5b6ee1', fabric: '#e8e0d0' },
    wallColor: '#f8f6f2',
    wallExtColor: '#ede8e0',
    floorOverrides: {
      bedroom: 'wood',
      living: 'wood',
      kitchen: 'wood',
      bathroom: 'tile',
      dining: 'wood',
    },
    furnitureColors: {
      fabric: '#e8e0d0',
      wood: '#d4b896',
      woodLight: '#e8d5b7',
      accent: '#5b6ee1',
    },
    lightingWarmth: 0.2,
    ceilingStyle: 'flat',
  },
  {
    id: 'industrial',
    name: 'Industrial',
    desc: 'Raw materials, exposed textures, urban edge',
    preview: { wall: '#d0ccc5', floor: '#808080', accent: '#c87533', fabric: '#4a4a4a' },
    wallColor: '#d0ccc5',
    wallExtColor: '#b8b0a5',
    floorOverrides: {
      bedroom: 'concrete',
      living: 'concrete',
      kitchen: 'tile',
      bathroom: 'tile',
      dining: 'concrete',
    },
    furnitureColors: {
      fabric: '#4a4a4a',
      wood: '#6b4226',
      woodLight: '#8a6040',
      accent: '#c87533',
    },
    lightingWarmth: 0.6,
    ceilingStyle: 'flat',
  },
  {
    id: 'traditional',
    name: 'Traditional',
    desc: 'Classic proportions, warm tones, ornate details',
    preview: { wall: '#f5ede0', floor: '#9c6b30', accent: '#8b0000', fabric: '#6b3a2a' },
    wallColor: '#f5ede0',
    wallExtColor: '#e5d5c0',
    floorOverrides: {
      bedroom: 'wood',
      living: 'wood',
      kitchen: 'tile',
      bathroom: 'tile',
      dining: 'wood',
    },
    furnitureColors: {
      fabric: '#6b3a2a',
      wood: '#6b3a1f',
      woodLight: '#9c6b30',
      accent: '#8b0000',
    },
    lightingWarmth: 0.8,
    ceilingStyle: 'flat',
  },
];

/**
 * Get a theme by ID, defaulting to 'modern' if not found.
 */
export function getTheme(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

/**
 * Apply a theme to a THREE.js material set, returning modified materials.
 * This mutates the materials object in place for efficiency.
 */
export function applyThemeToMaterials(mats, theme) {
  if (!theme || !mats) return mats;

  // Wall colors
  if (mats.wall && theme.wallColor) {
    mats.wall.color.set(theme.wallColor);
  }
  if (mats.wallExt && theme.wallExtColor) {
    mats.wallExt.color.set(theme.wallExtColor);
  }

  // Furniture accent colors
  if (theme.furnitureColors) {
    if (mats.fabric && theme.furnitureColors.fabric) {
      mats.fabric.color.set(theme.furnitureColors.fabric);
    }
    if (mats.wood && theme.furnitureColors.wood) {
      mats.wood.color.set(theme.furnitureColors.wood);
    }
    if (mats.woodLight && theme.furnitureColors.woodLight) {
      mats.woodLight.color.set(theme.furnitureColors.woodLight);
    }
  }

  return mats;
}
