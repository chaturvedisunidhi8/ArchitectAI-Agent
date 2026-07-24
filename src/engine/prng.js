/**
 * prng.js — Seeded pseudo-random number generator.
 *
 * Mulberry32: a simple 32-bit PRNG that is fast, small, and
 * sufficient for layout randomisation.  Deterministic given a seed.
 *
 * @module prng
 */

/**
 * Create a seeded PRNG function.  Each call returns a float in [0, 1).
 *
 * @param {number} seed - Integer seed.
 * @returns {() => number} PRNG function.
 */
export function createPRNG(seed) {
  let s = seed | 0;
  return function random() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a random integer seed from the current time.
 * Used when no seed is provided.
 *
 * @returns {number}
 */
export function randomSeed() {
  return (Math.random() * 2147483647) | 0;
}
