/**
 * furniture.js — the furnishing DATA model (no THREE dependency).
 *
 * A "furnishing" is a placeable object stored in the layout:
 *   { id, kind, roomId, x, y, rot, scale, color }
 * where x,y are the object's centre in plan feet, rot is radians about the
 * vertical axis, scale is a uniform multiplier and color is an optional hex
 * override. The 3D mesh for each `kind` is built in model3d.js.
 */

const r1 = (v) => Math.round(v * 10) / 10;

// Catalog: metadata only. `w`/`d` are the nominal footprint in feet, used for
// placement + selection. `mount:'ceiling'` items hang from the ceiling.
export const CATALOG = {
  // Bedroom
  bed: { label: 'Bed', category: 'Bedroom', w: 5, d: 6.7 },
  bunk_bed: { label: 'Bunk Bed', category: 'Bedroom', w: 4, d: 6.7 },
  crib: { label: 'Crib', category: 'Bedroom', w: 2.6, d: 4.2 },
  nightstand: { label: 'Nightstand', category: 'Bedroom', w: 1.6, d: 1.6 },
  wardrobe: { label: 'Wardrobe', category: 'Bedroom', w: 4, d: 2 },
  dresser: { label: 'Dresser', category: 'Bedroom', w: 3, d: 1.6 },
  ottoman: { label: 'Ottoman', category: 'Bedroom', w: 2, d: 2 },
  vanity_table: { label: 'Vanity Table', category: 'Bedroom', w: 3.5, d: 1.8 },

  // Living
  sofa: { label: 'Sofa', category: 'Living', w: 7, d: 3 },
  armchair: { label: 'Armchair', category: 'Living', w: 3, d: 3 },
  coffee_table: { label: 'Coffee Table', category: 'Living', w: 3.5, d: 1.8 },
  side_table: { label: 'Side Table', category: 'Living', w: 1.6, d: 1.6 },
  tv_console: { label: 'TV Console', category: 'Living', w: 5, d: 1.2 },
  tv: { label: 'TV', category: 'Living', w: 4, d: 0.3 },
  bookshelf: { label: 'Bookshelf', category: 'Living', w: 3, d: 1 },
  rug: { label: 'Rug', category: 'Living', w: 8, d: 6 },
  floor_lamp: { label: 'Floor Lamp', category: 'Living', w: 1.2, d: 1.2 },
  piano: { label: 'Piano', category: 'Living', w: 4.5, d: 3 },
  entertainment_center: { label: 'Ent. Center', category: 'Living', w: 6, d: 1.8 },
  floor_cushion: { label: 'Floor Cushion', category: 'Living', w: 2, d: 2 },
  loveseat: { label: 'Loveseat', category: 'Living', w: 5, d: 2.8 },
  recliner: { label: 'Recliner', category: 'Living', w: 3.2, d: 3.5 },

  // Dining
  dining_table: { label: 'Dining Table', category: 'Dining', w: 5, d: 3 },
  dining_chair: { label: 'Dining Chair', category: 'Dining', w: 1.5, d: 1.5 },
  bar_stool: { label: 'Bar Stool', category: 'Dining', w: 1.2, d: 1.2 },
  buffet: { label: 'Buffet', category: 'Dining', w: 5, d: 1.8 },
  wine_rack: { label: 'Wine Rack', category: 'Dining', w: 2, d: 1.2 },

  // Kitchen
  kitchen_counter: { label: 'Counter', category: 'Kitchen', w: 4, d: 2 },
  kitchen_island: { label: 'Island', category: 'Kitchen', w: 5, d: 3 },
  fridge: { label: 'Fridge', category: 'Kitchen', w: 2.5, d: 2.5 },
  oven: { label: 'Oven', category: 'Kitchen', w: 2.5, d: 2.5 },
  stove: { label: 'Stove', category: 'Kitchen', w: 2.5, d: 2 },
  microwave: { label: 'Microwave', category: 'Kitchen', w: 1.5, d: 1.2 },
  dishwasher: { label: 'Dishwasher', category: 'Kitchen', w: 2, d: 2 },
  sink: { label: 'Sink', category: 'Kitchen', w: 2, d: 1.6 },
  kitchen_cabinet: { label: 'Cabinet', category: 'Kitchen', w: 3, d: 1.5 },
  water_purifier: { label: 'Water Purifier', category: 'Kitchen', w: 1.2, d: 1.2 },

  // Bath
  toilet: { label: 'Toilet', category: 'Bath', w: 1.6, d: 2.4 },
  bathtub: { label: 'Bathtub', category: 'Bath', w: 5, d: 2.5 },
  shower: { label: 'Shower', category: 'Bath', w: 3, d: 3 },
  vanity: { label: 'Vanity', category: 'Bath', w: 3, d: 1.6 },
  mirror: { label: 'Mirror', category: 'Bath', w: 2, d: 0.2 },
  washer: { label: 'Washer', category: 'Bath', w: 2.2, d: 2.2 },
  towel_rack: { label: 'Towel Rack', category: 'Bath', w: 2, d: 0.5 },
  bath_mat: { label: 'Bath Mat', category: 'Bath', w: 2.5, d: 1.8 },
  toilet_bidet: { label: 'Bidet', category: 'Bath', w: 1.4, d: 2 },

  // Office
  desk: { label: 'Desk', category: 'Office', w: 4, d: 2 },
  office_chair: { label: 'Office Chair', category: 'Office', w: 1.8, d: 1.8 },
  treadmill: { label: 'Treadmill', category: 'Office', w: 2.5, d: 5 },
  filing_cabinet: { label: 'Filing Cabinet', category: 'Office', w: 1.8, d: 2 },
  whiteboard: { label: 'Whiteboard', category: 'Office', w: 4, d: 0.3 },
  standing_desk: { label: 'Standing Desk', category: 'Office', w: 4.5, d: 2.5 },

  // Outdoor
  bench: { label: 'Bench', category: 'Outdoor', w: 5, d: 2 },
  swing: { label: 'Swing', category: 'Outdoor', w: 5, d: 4 },
  fence: { label: 'Fence', category: 'Outdoor', w: 6, d: 0.3 },
  garden_shed: { label: 'Garden Shed', category: 'Outdoor', w: 6, d: 4 },
  fire_pit: { label: 'Fire Pit', category: 'Outdoor', w: 3, d: 3 },
  outdoor_table: { label: 'Outdoor Table', category: 'Outdoor', w: 4, d: 4 },
  umbrella: { label: 'Umbrella', category: 'Outdoor', w: 3, d: 3 },
  hammock: { label: 'Hammock', category: 'Outdoor', w: 6, d: 3 },

  // Decor
  plant: { label: 'Plant', category: 'Decor', w: 1.5, d: 1.5 },
  ceiling_fan: { label: 'Ceiling Fan', category: 'Decor', w: 3.5, d: 3.5, mount: 'ceiling' },
  chandelier: { label: 'Chandelier', category: 'Decor', w: 2, d: 2, mount: 'ceiling' },
  wall_art: { label: 'Wall Art', category: 'Decor', w: 2.5, d: 0.2 },
  bush: { label: 'Bush', category: 'Decor', w: 2, d: 2 },
  wall_shelf: { label: 'Wall Shelf', category: 'Decor', w: 3, d: 0.4 },
  hanging_planter: { label: 'H. Planter', category: 'Decor', w: 1.2, d: 1.2, mount: 'ceiling' },
  clock: { label: 'Clock', category: 'Decor', w: 1.5, d: 0.2 },
  aquarium: { label: 'Aquarium', category: 'Decor', w: 3, d: 1.5 },
  coat_rack: { label: 'Coat Rack', category: 'Decor', w: 1.2, d: 1.2 },
  shoe_rack: { label: 'Shoe Rack', category: 'Decor', w: 2.5, d: 1 },

  // Misc
  staircase: { label: 'Staircase', category: 'Misc', w: 3.5, d: 9 },
  car: { label: 'Car', category: 'Misc', w: 6, d: 12 },
  railing: { label: 'Railing', category: 'Misc', w: 6, d: 0.3 },
  washing_line: { label: 'Washing Line', category: 'Misc', w: 4, d: 2 },
  water_tank: { label: 'Water Tank', category: 'Misc', w: 3, d: 3 },
  solar_panel: { label: 'Solar Panel', category: 'Misc', w: 3.5, d: 2 },
  air_conditioner: { label: 'A/C Unit', category: 'Misc', w: 3, d: 1.5 },
  ladder: { label: 'Ladder', category: 'Misc', w: 1.5, d: 4 },
};

export const CATEGORIES = ['Bedroom', 'Living', 'Dining', 'Kitchen', 'Bath', 'Office', 'Outdoor', 'Decor', 'Misc'];

export function catalogByCategory() {
  const map = {};
  CATEGORIES.forEach(c => { map[c] = []; });
  Object.entries(CATALOG).forEach(([kind, meta]) => {
    if (!map[meta.category]) map[meta.category] = [];
    map[meta.category].push({ kind, ...meta });
  });
  return map;
}

let _seq = 0;
export function newFurnishingId(kind) {
  _seq += 1;
  return `f_${Date.now().toString(36)}_${_seq}_${kind}`;
}

function item(kind, roomId, x, y, rot = 0, extra = {}) {
  return { id: newFurnishingId(kind), kind, roomId, x: r1(x), y: r1(y), rot, scale: 1, color: null, ...extra };
}

// Sensible default furnishing set per room, in absolute plan coordinates.
export function defaultFurnishings(rooms) {
  const out = [];
  const push = (...items) => items.forEach(i => out.push(i));

  rooms.forEach((room) => {
    const cx = room.x + room.w / 2;
    const cz = room.y + room.h / 2;
    const m = 1.2;
    if (room.w < 3.5 || room.h < 3.5) {
      if (room.type === 'balcony') push(item('railing', room.id, cx, room.y + 0.2));
      return;
    }

    switch (room.type) {
      case 'bedroom':
        push(
          item('bed', room.id, cx, room.y + 3.8),
          item('nightstand', room.id, cx - 3, room.y + 1.2),
        );
        if (room.w > 8) push(item('wardrobe', room.id, room.x + room.w - m, cz, Math.PI / 2));
        break;
      case 'living':
        push(
          item('sofa', room.id, cx, room.y + 2),
          item('coffee_table', room.id, cx, cz + 0.5),
          item('tv_console', room.id, cx, room.y + room.h - m),
          item('tv', room.id, cx, room.y + room.h - m + 0.4),
          item('rug', room.id, cx, cz + 0.5),
        );
        break;
      case 'dining': {
        push(item('dining_table', room.id, cx, cz));
        const offs = [[-3.2, 0], [3.2, 0], [0, -2.4], [0, 2.4]];
        offs.forEach(([dx, dz]) => push(item('dining_chair', room.id, cx + dx, cz + dz, dx !== 0 ? Math.PI / 2 : 0)));
        break;
      }
      case 'kitchen':
        push(
          item('kitchen_counter', room.id, cx, room.y + 1.2),
          item('sink', room.id, cx, room.y + 1.2),
        );
        if (room.h > 6) push(item('fridge', room.id, room.x + room.w - m, room.y + room.h - m));
        if (room.w > 8) push(item('stove', room.id, cx + 3, room.y + 1.2));
        break;
      case 'bathroom':
        push(
          item('toilet', room.id, room.x + m, room.y + room.h - m),
          item('vanity', room.id, cx, room.y + m),
        );
        if (room.w > 5 && room.h > 5) push(item('shower', room.id, room.x + room.w - m - 0.5, room.y + room.h - m - 0.5));
        break;
      case 'study':
        push(
          item('desk', room.id, cx, room.y + m + 0.5),
          item('office_chair', room.id, cx, room.y + m + 2.2, Math.PI),
        );
        if (room.w > 6) push(item('bookshelf', room.id, room.x + room.w - m, cz, Math.PI / 2));
        break;
      case 'garage':
        push(item('car', room.id, cx, cz));
        break;
      case 'balcony':
        push(item('railing', room.id, cx, room.y + 0.2));
        break;
      case 'garden':
        push(
          item('bush', room.id, room.x + m, room.y + m),
          item('bush', room.id, room.x + room.w - m, room.y + m),
          item('bush', room.id, cx, room.y + room.h - m),
        );
        break;
      case 'store':
        push(item('bookshelf', room.id, cx, room.y + m));
        break;
      case 'laundry':
        push(item('washer', room.id, cx, room.y + m + 0.5));
        break;
      case 'pooja':
        push(item('side_table', room.id, cx, room.y + m));
        break;
      default:
        break;
    }
  });

  return out;
}
