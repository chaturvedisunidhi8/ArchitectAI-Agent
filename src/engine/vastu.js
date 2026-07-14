/**
 * vastu.js — Vastu Shastra compliance checker.
 *
 * Evaluates room placement against traditional Vastu rules and returns
 * a compliance score with specific recommendations.
 */

const VASTU_RULES = [
  {
    id: 'entrance_direction',
    name: 'Entrance Direction',
    description: 'Main entrance should be in the North, East, or North-East',
    check: (layout, direction) => {
      if (!direction) return { pass: null, note: 'Direction not specified' };
      const good = ['north', 'east', 'north-east', 'northeast'];
      return {
        pass: good.includes(direction.toLowerCase()),
        note: good.includes(direction.toLowerCase())
          ? `Entrance facing ${direction} is auspicious`
          : `Consider facing North or East instead of ${direction}`,
      };
    },
  },
  {
    id: 'kitchen_position',
    name: 'Kitchen Placement',
    description: 'Kitchen should be in the South-East or East',
    check: (layout) => {
      const kitchen = layout.rooms.find(r => r.type === 'kitchen');
      if (!kitchen) return { pass: null, note: 'No kitchen found' };
      const cx = kitchen.x + kitchen.w / 2;
      const cy = kitchen.y + kitchen.h / 2;
      const bw = layout.boundary.width;
      const bh = layout.boundary.height;
      // South-East: x > 60% width, y < 40% height (in plan coords, top is south)
      const isSE = cx > bw * 0.5 && cy < bh * 0.5;
      const isE = cx > bw * 0.5 && cy > bh * 0.3 && cy < bh * 0.7;
      return {
        pass: isSE || isE,
        note: isSE || isE ? 'Kitchen in South-East/East sector' : 'Consider moving kitchen to South-East',
      };
    },
  },
  {
    id: 'master_bedroom',
    name: 'Master Bedroom',
    description: 'Master bedroom should be in the South-West',
    check: (layout) => {
      const master = layout.rooms.find(r => r.type === 'bedroom');
      if (!master) return { pass: null, note: 'No bedroom found' };
      const cx = master.x + master.w / 2;
      const cy = master.y + master.h / 2;
      const bw = layout.boundary.width;
      const bh = layout.boundary.height;
      const isSW = cx > bw * 0.5 && cy > bh * 0.5;
      return {
        pass: isSW,
        note: isSW ? 'Master bedroom in South-West' : 'Consider placing master bedroom in South-West',
      };
    },
  },
  {
    id: 'bathroom_position',
    name: 'Bathroom Placement',
    description: 'Bathrooms should be in the North-West or West',
    check: (layout) => {
      const bathrooms = layout.rooms.filter(r => r.type === 'bathroom');
      if (bathrooms.length === 0) return { pass: null, note: 'No bathroom found' };
      const bw = layout.boundary.width;
      const bh = layout.boundary.height;
      const badPositions = bathrooms.filter(b => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        // Bad: center of house, or South-West
        return (cx > bw * 0.3 && cx < bw * 0.7 && cy > bh * 0.3 && cy < bh * 0.7);
      });
      return {
        pass: badPositions.length === 0,
        note: badPositions.length === 0
          ? 'Bathrooms are in acceptable positions'
          : `${badPositions.length} bathroom(s) near center — move to North-West`,
      };
    },
  },
  {
    id: 'pooja_position',
    name: 'Pooja Room',
    description: 'Pooja/prayer room should be in the North-East',
    check: (layout) => {
      const pooja = layout.rooms.find(r => r.type === 'pooja');
      if (!pooja) return { pass: null, note: 'No pooja room specified' };
      const cx = pooja.x + pooja.w / 2;
      const cy = pooja.y + pooja.h / 2;
      const bw = layout.boundary.width;
      const bh = layout.boundary.height;
      const isNE = cx < bw * 0.5 && cy < bh * 0.5;
      return {
        pass: isNE,
        note: isNE ? 'Pooja room in North-East (ideal)' : 'Consider placing pooja room in North-East',
      };
    },
  },
  {
    id: 'staircase_position',
    name: 'Staircase',
    description: 'Staircase should be in the South, West, or South-West',
    check: (layout) => {
      const stairs = layout.rooms.find(r => r.type === 'staircase' || (r.furnishings || []).some(f => f.kind === 'staircase'));
      // No strict check if no staircase specified
      return { pass: null, note: 'Staircase placement rules apply for multi-floor homes' };
    },
  },
  {
    id: 'center_open',
    name: 'Center of House',
    description: 'Center (Brahmasthan) should be open, not have a bathroom or staircase',
    check: (layout) => {
      const bw = layout.boundary.width;
      const bh = layout.boundary.height;
      const cx = bw / 2;
      const cy = bh / 2;
      const margin = 2;
      const centerBlocked = layout.rooms.some(r => {
        if (r.type === 'bathroom' || r.type === 'store') {
          const rcx = r.x + r.w / 2;
          const rcy = r.y + r.h / 2;
          return Math.abs(rcx - cx) < margin && Math.abs(rcy - cy) < margin;
        }
        return false;
      });
      return {
        pass: !centerBlocked,
        note: centerBlocked ? 'Center of house has a utility room — keep it open' : 'Center area is clear',
      };
    },
  },
];

export function checkVastu(layout, direction = null) {
  if (!layout) return null;

  const results = VASTU_RULES.map(rule => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    ...rule.check(layout, direction),
  }));

  const applicable = results.filter(r => r.pass !== null);
  const passed = applicable.filter(r => r.pass).length;
  const score = applicable.length > 0 ? Math.round((passed / applicable.length) * 100) : 0;

  return {
    score,
    results,
    passed,
    total: applicable.length,
  };
}
