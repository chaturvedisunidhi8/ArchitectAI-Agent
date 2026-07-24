import { describe, it, expect } from 'vitest';
import {
  buildDesignBrief, runAutoDesign, pickTheme, planSearchSpace, PIPELINE_STAGES,
} from '../aiDesigner.js';
import { THEMES } from '../themes.js';

const PROMPT = '3BHK modern home, 1800 sqft, large living room, 2 bathrooms, kitchen with dining, balcony';

describe('buildDesignBrief', () => {
  it('rejects an empty description', () => {
    expect(buildDesignBrief('').ok).toBe(false);
    expect(buildDesignBrief('hi').ok).toBe(false);
  });

  it('extracts area, style and a room schedule', () => {
    const brief = buildDesignBrief(PROMPT);
    expect(brief.ok).toBe(true);
    expect(brief.totalAreaFt).toBe(1800);
    expect(brief.style).toBe('modern');
    const bedrooms = brief.roomSpecs.find(s => s.type === 'bedroom');
    expect(bedrooms.count).toBe(3);
  });

  it('fills in the essentials a description omits', () => {
    const brief = buildDesignBrief('2 bedroom flat, 900 sqft');
    expect(brief.ok).toBe(true);
    ['living', 'kitchen', 'bathroom'].forEach(type => {
      expect(brief.roomSpecs.find(s => s.type === type).count).toBeGreaterThan(0);
    });
    expect(brief.decisions.length).toBeGreaterThan(0);
  });

  it('balances the schedule to the stated envelope', () => {
    const brief = buildDesignBrief(PROMPT);
    const scheduled = brief.roomSpecs
      .filter(s => s.count > 0)
      .reduce((sum, s) => sum + s.area * s.count, 0);
    // Rooms take ~88% of the envelope; the rest is walls and circulation.
    expect(scheduled).toBeGreaterThan(brief.totalAreaFt * 0.7);
    expect(scheduled).toBeLessThanOrEqual(brief.totalAreaFt);
  });

  it('derives an envelope when no area is given', () => {
    const brief = buildDesignBrief('3BHK house with a study and two bathrooms');
    expect(brief.ok).toBe(true);
    expect(brief.totalAreaFt).toBeGreaterThan(0);
    expect(brief.decisions.some(d => d.title.includes('Sized the home'))).toBe(true);
  });

  it('picks up design priorities and reweights the score', () => {
    const brief = buildDesignBrief('3BHK vastu compliant home, 1600 sqft, pooja room, facing east');
    expect(brief.preferences.vastu).toBe(true);
    expect(brief.direction).toBe('east');
    expect(brief.weights.vastu).toBeGreaterThan(10);
  });
});

describe('pickTheme', () => {
  it('maps every known style onto a real theme', () => {
    ['modern', 'minimalist', 'luxury', 'scandinavian', 'industrial', 'traditional',
      'japanese', 'indian', 'rustic', 'mid-century'].forEach(style => {
      expect(THEMES.some(t => t.id === pickTheme(style))).toBe(true);
    });
  });

  it('falls back to modern for anything unrecognised', () => {
    expect(pickTheme('brutalist-steampunk')).toBe('modern');
    expect(pickTheme(undefined)).toBe('modern');
  });
});

describe('planSearchSpace', () => {
  it('enumerates a deterministic set of combinations', () => {
    const a = planSearchSpace(42);
    const b = planSearchSpace(42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    expect(new Set(a.map(c => c.seed)).size).toBe(a.length);
  });

  it('covers multiple strategies and proportions', () => {
    const space = planSearchSpace(1);
    expect(new Set(space.map(c => c.strategy)).size).toBeGreaterThan(1);
    expect(new Set(space.map(c => c.aspect)).size).toBeGreaterThan(1);
  });
});

describe('runAutoDesign', () => {
  it('produces a complete, furnished, scored plan', async () => {
    const result = await runAutoDesign(PROMPT, { seed: 12345 });

    expect(result.ok).toBe(true);
    expect(result.layout.rooms.length).toBeGreaterThan(0);
    expect(result.layout.walls.length).toBeGreaterThan(0);
    expect(result.layout.furnishings.length).toBeGreaterThan(0);
    expect(result.score.total).toBeGreaterThan(0);
    expect(THEMES.some(t => t.id === result.theme)).toBe(true);
  }, 30000);

  it('is deterministic for a given seed', async () => {
    const a = await runAutoDesign(PROMPT, { seed: 777 });
    const b = await runAutoDesign(PROMPT, { seed: 777 });
    expect(a.score.total).toBe(b.score.total);
    expect(a.layout.rooms.map(r => r.id)).toEqual(b.layout.rooms.map(r => r.id));
  }, 40000);

  it('returns the winner ranked first among the alternatives', async () => {
    const result = await runAutoDesign(PROMPT, { seed: 999 });
    expect(result.variants.length).toBeGreaterThan(1);
    expect(result.variants[0].stats.aiScore).toBe(result.score.total);
    for (let i = 1; i < result.variants.length; i++) {
      expect(result.variants[i - 1].stats.aiScore).toBeGreaterThanOrEqual(result.variants[i].stats.aiScore);
    }
  }, 30000);

  it('keeps refined plans inside the strategy they are labelled with', async () => {
    // Refinement searches seeds within a finalist's own strategy. If it fell
    // back to a generic re-subdivision, a plan could be presented as an "Open
    // Plan" while structurally being something else.
    const result = await runAutoDesign(PROMPT, { seed: 4242 });
    const names = { shelf: 'Shelf Layout', grid: 'Grid Layout', corridor: 'Corridor Plan', open: 'Open Plan' };
    result.variants.forEach(v => {
      const strategy = v.id.replace(/_\d+$/, '');
      expect(v.name).toBe(names[strategy]);
    });
  }, 30000);

  it('counts refinement trials in the reported candidate total', async () => {
    const result = await runAutoDesign(PROMPT, { seed: 31337 });
    // 48 from the initial sweep plus the per-finalist seed exploration.
    expect(result.stats.candidatesGenerated).toBeGreaterThan(planSearchSpace(0).length);
  }, 30000);

  it('reports every pipeline stage in order', async () => {
    const seen = [];
    await runAutoDesign(PROMPT, { seed: 5, onProgress: (stageId) => seen.push(stageId) });
    expect(seen).toEqual(PIPELINE_STAGES.map(s => s.id));
  }, 30000);

  it('surfaces a friendly error for an unusable description', async () => {
    const result = await runAutoDesign('x', { seed: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('honours vastu priorities in the chosen plan', async () => {
    const result = await runAutoDesign(
      'vastu compliant 3BHK, 1600 sqft, pooja room, kitchen, 2 bathrooms, facing east',
      { seed: 2024 },
    );
    expect(result.ok).toBe(true);
    expect(result.score.weights.vastu).toBeGreaterThan(10);
    expect(result.brief.direction).toBe('east');
  }, 30000);
});
