/**
 * Parametric clay deformation. Pure math, no IWSDK imports, so it is unit
 * tested in Node and shared by the runtime, the recognizer and persistence.
 *
 * A clay object is a base primitive in a unit box ([-0.5, 0.5] on each
 * axis) plus a deform parameter vector. The vector is the whole truth: the
 * mesh is always rebuilt from it, never edited freeform.
 */

export type Primitive = 'cube' | 'cylinder' | 'sphere' | 'cone' | 'capsule';

export interface DeformParams {
  /** Per-axis stretch, 1 = base size. */
  sx: number;
  sy: number;
  sz: number;
  /** 0..1 pinch at mid height (squeeze). 1 = waist at 25% width. */
  waist: number;
  /** Radians of rotation between bottom and top (twist). */
  twist: number;
  /** -1..1 top vs bottom width. Positive = wider top. */
  taper: number;
}

export const DEFAULT_DEFORM: Readonly<DeformParams> = Object.freeze({
  sx: 1,
  sy: 1,
  sz: 1,
  waist: 0,
  twist: 0,
  taper: 0,
});

export const LIMITS = {
  scaleMin: 0.35,
  scaleMax: 4,
  waistMax: 0.92,
  twistMax: Math.PI * 1.5,
  taperMax: 0.8,
} as const;

/** Edge length in meters of a primitive at scale 1. */
export const BASE_SIZE = 0.08;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export function clampDeform(p: DeformParams): DeformParams {
  p.sx = clamp(p.sx, LIMITS.scaleMin, LIMITS.scaleMax);
  p.sy = clamp(p.sy, LIMITS.scaleMin, LIMITS.scaleMax);
  p.sz = clamp(p.sz, LIMITS.scaleMin, LIMITS.scaleMax);
  p.waist = clamp(p.waist, 0, LIMITS.waistMax);
  p.twist = clamp(p.twist, -LIMITS.twistMax, LIMITS.twistMax);
  p.taper = clamp(p.taper, -LIMITS.taperMax, LIMITS.taperMax);
  return p;
}

/** Radial multiplier at normalised height t in [-1, 1]. */
export function radialFactor(p: DeformParams, t: number): number {
  const waist = 1 - p.waist * 0.75 * Math.exp(-(t * t) / 0.18);
  const taper = 1 + p.taper * t * 0.5;
  return waist * taper;
}

/**
 * Deform base positions (unit box, xyz interleaved) into `out`, in meters.
 * Scale first, then twist around Y, so twisting a flat slab stays a slab.
 */
export function deformPositions(
  base: ArrayLike<number>,
  out: Float32Array,
  p: DeformParams,
): void {
  const s = BASE_SIZE;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i];
    const y = base[i + 1];
    const z = base[i + 2];
    const t = clamp(y * 2, -1, 1);
    const r = radialFactor(p, t);
    const xs = x * p.sx * r;
    const zs = z * p.sz * r;
    const a = p.twist * t * 0.5;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    out[i] = (xs * c - zs * sn) * s;
    out[i + 1] = y * p.sy * s;
    out[i + 2] = (xs * sn + zs * c) * s;
  }
}

/** Half extents in meters of the deformed shape's bounding box (approx). */
export function halfExtents(p: DeformParams): { x: number; y: number; z: number } {
  const rMax = Math.max(radialFactor(p, -1), radialFactor(p, 0), radialFactor(p, 1));
  const horiz = Math.max(p.sx, p.sz) * rMax * 0.5 * BASE_SIZE;
  // Twist rotates the footprint, so x and z share the larger reach.
  const twisted = Math.abs(p.twist) > 0.2;
  return {
    x: twisted ? horiz * 1.42 : p.sx * rMax * 0.5 * BASE_SIZE,
    y: p.sy * 0.5 * BASE_SIZE,
    z: twisted ? horiz * 1.42 : p.sz * rMax * 0.5 * BASE_SIZE,
  };
}

export function copyDeform(from: DeformParams, to: DeformParams): DeformParams {
  to.sx = from.sx;
  to.sy = from.sy;
  to.sz = from.sz;
  to.waist = from.waist;
  to.twist = from.twist;
  to.taper = from.taper;
  return to;
}
