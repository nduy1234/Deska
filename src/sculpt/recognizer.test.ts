import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFORM, type DeformParams } from './deform.js';
import { ARCHETYPE_SHAPES, ARCHETYPES, recognize } from './recognizer.js';

const shape = (o: Partial<DeformParams>): DeformParams => ({ ...DEFAULT_DEFORM, ...o });

describe('recognizer', () => {
  it('leaves untouched clay as a block', () => {
    expect(recognize('cube', shape({})).archetype).toBe('block');
    expect(recognize('sphere', shape({})).archetype).toBe('block');
  });

  it('reads a squeezed cylinder as an hourglass', () => {
    expect(recognize('cylinder', shape({ waist: 0.7, sy: 1.3 })).archetype).toBe('hourglass');
  });

  it('reads a squeezed cube as an hourglass too (the onboarding path)', () => {
    expect(recognize('cube', shape({ waist: 0.6 })).archetype).toBe('hourglass');
  });

  it('reads a tall thin stretch as a lever', () => {
    expect(recognize('cylinder', shape({ sy: 2.6 })).archetype).toBe('lever');
  });

  it('reads a flat cylinder as a dial and a flat sphere as a button', () => {
    expect(recognize('cylinder', shape({ sy: 0.45, sx: 1.2, sz: 1.2 })).archetype).toBe('dial');
    expect(recognize('sphere', shape({ sy: 0.45 })).archetype).toBe('button');
  });

  it('reads a wide cylinder as a jar', () => {
    expect(recognize('cylinder', shape({ sx: 1.8, sz: 1.8, sy: 1.5 })).archetype).toBe('jar');
  });

  it('round-trips every template shape to its archetype', () => {
    for (const a of ARCHETYPES) {
      const t = ARCHETYPE_SHAPES[a];
      expect(recognize(t.primitive, t.deform).archetype, a).toBe(a);
    }
  });
});
