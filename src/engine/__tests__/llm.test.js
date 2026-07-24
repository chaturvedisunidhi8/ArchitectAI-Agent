import { describe, it, expect } from 'vitest';
import { parseJsonLoosely, resolveModel } from '../llm/client.js';
import { sanitizeGraph } from '../llm/adjacencyGraph.js';

describe('llm/client — output parsing', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a fenced code block', () => {
    expect(parseJsonLoosely('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('salvages JSON wrapped in prose', () => {
    expect(parseJsonLoosely('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('throws rather than returning junk', () => {
    expect(() => parseJsonLoosely('no json at all')).toThrow();
  });
});

describe('llm/client — model resolution', () => {
  it('prefers an exact match', () => {
    expect(resolveModel('qwen2.5:7b-instruct', ['llama3.1:8b', 'qwen2.5:7b-instruct']))
      .toBe('qwen2.5:7b-instruct');
  });

  it('falls back to the same family on a different tag', () => {
    // Asking for a tag you do not have used to 404 every completion.
    expect(resolveModel('qwen2.5:7b-instruct', ['gemma2:2b', 'qwen2.5-coder:7b']))
      .toBe('qwen2.5-coder:7b');
  });

  it('prefers an instruct model over a specialised one when nothing matches', () => {
    expect(resolveModel('qwen2.5:7b-instruct', ['deepseek-coder:6b', 'llama3.1:8b-instruct']))
      .toBe('llama3.1:8b-instruct');
  });

  it('returns null when nothing is served', () => {
    expect(resolveModel('qwen2.5:7b-instruct', [])).toBeNull();
  });

  it('returns null when only embedding models are served', () => {
    expect(resolveModel('qwen2.5:7b-instruct', ['nomic-embed-text'])).toBeNull();
  });
});

describe('llm/adjacencyGraph — graph sanitising', () => {
  const present = new Set(['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hall']);

  it('keeps valid edges and clamps the weight', () => {
    const { weights } = sanitizeGraph({
      edges: [
        { a: 'kitchen', b: 'dining', weight: 9 },
        { a: 'bedroom', b: 'hall', weight: 99 },
      ],
    }, present);
    expect(weights.get('dining|kitchen')).toBe(9);
    expect(weights.get('bedroom|hall')).toBe(10);
  });

  it('drops room types the plan does not contain', () => {
    const { weights } = sanitizeGraph({
      edges: [{ a: 'garage', b: 'kitchen', weight: 8 }],
    }, present);
    expect(weights.size).toBe(0);
  });

  it('drops invented room types', () => {
    const { weights } = sanitizeGraph({
      edges: [{ a: 'sunroom', b: 'living', weight: 8 }],
    }, present);
    expect(weights.size).toBe(0);
  });

  it('drops self-pairs and non-numeric weights', () => {
    const { weights } = sanitizeGraph({
      edges: [
        { a: 'living', b: 'living', weight: 5 },
        { a: 'living', b: 'kitchen', weight: 'high' },
      ],
    }, present);
    expect(weights.size).toBe(0);
  });

  it('lets an avoid pair override a contradictory edge', () => {
    const { weights, avoid } = sanitizeGraph({
      edges: [{ a: 'bathroom', b: 'kitchen', weight: 7 }],
      avoid: [{ a: 'bathroom', b: 'kitchen', reason: 'hygiene' }],
    }, present);
    expect(weights.get('bathroom|kitchen')).toBe(0);
    expect(avoid).toContain('bathroom|kitchen');
  });

  it('survives a malformed response without throwing', () => {
    expect(() => sanitizeGraph(null, present)).not.toThrow();
    expect(sanitizeGraph({ edges: 'nope' }, present).count).toBe(0);
  });
});
