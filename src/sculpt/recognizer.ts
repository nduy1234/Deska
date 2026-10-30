import type { DeformParams, Primitive } from './deform.js';

/**
 * Maps a deform vector to a tool archetype. Pure and deterministic: the
 * same shape always means the same tool, which is what makes sculpting feel
 * like a language rather than a guess.
 */

export const ARCHETYPES = ['hourglass', 'lever', 'jar', 'dial', 'button', 'block'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface Recognition {
  archetype: Archetype;
  /** 0..1: how clearly the shape reads as this archetype. */
  confidence: number;
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Score every archetype; highest wins. Block is the quiet default. */
export function scoreArchetypes(
  primitive: Primitive,
  p: DeformParams,
): Record<Archetype, number> {
  const width = Math.max(p.sx, p.sz);
  const narrow = Math.min(p.sx, p.sz);
  const tall = p.sy / width;
  const flat = narrow / p.sy;
  const roundish = primitive === 'sphere' ? 1 : 0;

  const hourglass = smooth(0.3, 0.55, p.waist) * smooth(0.7, 1.0, tall);
  const lever = smooth(1.8, 2.6, tall) * (1 - smooth(0.3, 0.5, p.waist));
  const flatness = smooth(1.5, 2.4, flat);
  const dial = flatness * (1 - roundish * 0.7) * (1 - smooth(0.3, 0.5, p.waist));
  const button = flatness * (roundish ? 1 : 0.25) * (1 - smooth(1.6, 2.4, width));
  const jar =
    smooth(1.3, 1.7, width) *
    smooth(0.55, 0.8, tall) *
    (1 - smooth(1.6, 2.2, tall)) *
    (1 - smooth(0.25, 0.45, p.waist)) *
    (primitive === 'sphere' ? 0.6 : 1);
  return { hourglass, lever, jar, dial, button, block: 0.35 };
}

export function recognize(primitive: Primitive, p: DeformParams): Recognition {
  const scores = scoreArchetypes(primitive, p);
  let best: Archetype = 'block';
  let bestScore = -1;
  for (const a of ARCHETYPES) {
    if (scores[a] > bestScore) {
      bestScore = scores[a];
      best = a;
    }
  }
  return { archetype: best, confidence: Math.min(1, bestScore) };
}

/** Shapes the agent / templates spawn for each archetype (inverse mapping). */
export const ARCHETYPE_SHAPES: Record<Archetype, { primitive: Primitive; deform: DeformParams }> = {
  hourglass: { primitive: 'cylinder', deform: { sx: 1, sy: 1.6, sz: 1, waist: 0.7, twist: 0, taper: 0 } },
  lever: { primitive: 'cylinder', deform: { sx: 0.5, sy: 2.4, sz: 0.5, waist: 0, twist: 0, taper: 0.2 } },
  jar: { primitive: 'cylinder', deform: { sx: 1.9, sy: 1.6, sz: 1.9, waist: 0.1, twist: 0, taper: -0.15 } },
  dial: { primitive: 'cylinder', deform: { sx: 1.5, sy: 0.45, sz: 1.5, waist: 0, twist: 0.9, taper: 0 } },
  button: { primitive: 'sphere', deform: { sx: 1.1, sy: 0.4, sz: 1.1, waist: 0, twist: 0, taper: 0 } },
  block: { primitive: 'cube', deform: { sx: 1, sy: 1, sz: 1, waist: 0, twist: 0, taper: 0 } },
};

/** Human label shown when an archetype locks in. */
export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  hourglass: 'Hourglass · focus timer',
  lever: 'Lever · routine',
  jar: 'Jar · notes',
  dial: 'Dial · focus level',
  button: 'Button',
  block: 'Block',
};
