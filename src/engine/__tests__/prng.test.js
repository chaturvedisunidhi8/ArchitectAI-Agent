import { describe, it, expect } from 'vitest';
import { createPRNG, randomSeed } from '../prng.js';

describe('createPRNG', () => {
  it('returns the same sequence for the same seed', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('returns different sequences for different seeds', () => {
    const a = createPRNG(1);
    const b = createPRNG(2);
    const results = Array.from({ length: 10 }, () => a() === b());
    expect(results.every(v => v)).toBe(false);
  });

  it('returns values in [0, 1)', () => {
    const rng = createPRNG(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces deterministic output for seed 0', () => {
    const rng = createPRNG(0);
    // Spot-check first few values.
    const v1 = rng();
    const v2 = rng();
    const v3 = rng();
    // Re-create and verify they match.
    const rng2 = createPRNG(0);
    expect(rng2()).toBe(v1);
    expect(rng2()).toBe(v2);
    expect(rng2()).toBe(v3);
  });
});

describe('randomSeed', () => {
  it('returns an integer', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
  });

  it('returns a positive value', () => {
    const s = randomSeed();
    expect(s).toBeGreaterThan(0);
  });
});
