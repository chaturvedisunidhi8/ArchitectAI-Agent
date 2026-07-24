/**
 * costEstimator.js — Rule-based construction and interior cost estimation.
 *
 * Provides cost breakdowns by room type, finish level, and total area.
 * Rates are approximate and based on mid-range US construction costs.
 */

const BASE_RATES = {
  bedroom: { low: 100, mid: 150, high: 220 },
  bathroom: { low: 200, mid: 300, high: 450 },
  kitchen: { low: 180, mid: 280, high: 400 },
  living: { low: 80, mid: 130, high: 200 },
  dining: { low: 80, mid: 120, high: 180 },
  balcony: { low: 50, mid: 80, high: 130 },
  store: { low: 40, mid: 60, high: 90 },
  study: { low: 90, mid: 140, high: 200 },
  pooja: { low: 70, mid: 110, high: 170 },
  laundry: { low: 80, mid: 120, high: 180 },
  garage: { low: 50, mid: 80, high: 120 },
  garden: { low: 30, mid: 60, high: 100 },
};

const STYLE_MULTIPLIER = {
  modern: 1.0,
  minimalist: 0.85,
  luxury: 1.5,
  traditional: 1.1,
  scandinavian: 0.95,
  industrial: 1.05,
  classic: 1.2,
  japanese: 0.9,
  colonial: 1.15,
  mediterranean: 1.1,
  tropical: 0.95,
  rustic: 0.9,
  'art deco': 1.3,
  'mid-century': 1.05,
  vintage: 1.1,
  farmhouse: 0.95,
  urban: 1.0,
  compact: 0.8,
};

const FINISH_MULTIPLIER = {
  economy: 0.7,
  standard: 1.0,
  premium: 1.4,
  luxury: 1.8,
};

export function estimateCost(layout, style = 'modern', finishLevel = 'standard') {
  if (!layout || !layout.rooms) return null;

  const styleMult = STYLE_MULTIPLIER[style] || 1.0;
  const finishMult = FINISH_MULTIPLIER[finishLevel] || 1.0;

  const roomCosts = layout.rooms.map(room => {
    const rt = room.roomType || room.type;
    const rates = BASE_RATES[rt] || BASE_RATES.living;
    const area = room.actualArea || (room.w * room.h);
    const rate = rates.mid * styleMult * finishMult;
    const cost = Math.round(area * rate);
    return {
      id: room.id,
      label: room.label,
      type: rt,
      area: Math.round(area),
      ratePerSqft: Math.round(rate),
      cost,
    };
  });

  const totalInterior = roomCosts.reduce((s, r) => s + r.cost, 0);
  const structuralCost = Math.round(layout.boundary.width * layout.boundary.height * 60 * finishMult);
  const total = totalInterior + structuralCost;

  return {
    rooms: roomCosts,
    structural: structuralCost,
    interior: totalInterior,
    total,
    currency: 'USD',
    perSqft: Math.round(total / (layout.boundary.width * layout.boundary.height)),
    style,
    finishLevel,
  };
}

export function formatCost(amount, currency = 'USD') {
  if (currency === 'INR') {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
    return `₹${amount.toLocaleString()}`;
  }
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}k`;
  return `$${amount}`;
}
