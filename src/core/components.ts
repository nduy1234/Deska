import { createComponent, Types } from '@iwsdk/core';

/**
 * Component declarations only: no systems, DOM or renderer imports here
 * (the editor imports this module to build its inspector).
 */

/** A sculptable clay object on the desk. Deform fields mirror DeformParams. */
export const Clay = createComponent('Clay', {
  uid: { type: Types.String, default: '' },
  primitive: { type: Types.String, default: 'cube' },
  sx: { type: Types.Float32, default: 1 },
  sy: { type: Types.Float32, default: 1 },
  sz: { type: Types.Float32, default: 1 },
  waist: { type: Types.Float32, default: 0 },
  twist: { type: Types.Float32, default: 0 },
  taper: { type: Types.Float32, default: 0 },
  /** Geometry must be rebuilt from the deform fields. */
  dirty: { type: Types.Boolean, default: true },
  /** Recognised archetype while sculpting ('' = none yet). */
  archetype: { type: Types.String, default: '' },
});

/** A tray slot that hands out fresh clay of one primitive when pinched. */
export const TraySlot = createComponent('TraySlot', {
  primitive: { type: Types.String, default: 'cube' },
});

/** Transient: currently held by one or two hands. */
export const Held = createComponent('Held', {
  /** 'left' | 'right' | 'both' */
  by: { type: Types.String, default: 'right' },
});

/** Transient: easing back to rest on the desk after release. */
export const Settling = createComponent('Settling', {
  t: { type: Types.Float32, default: 0 },
  toPosition: { type: Types.Vec3, default: [0, 0, 0] },
  toQuaternion: { type: Types.Vec4, default: [0, 0, 0, 1] },
  fromPosition: { type: Types.Vec3, default: [0, 0, 0] },
  fromQuaternion: { type: Types.Vec4, default: [0, 0, 0, 1] },
});

/** A finished tool: archetype plus its behavior graph (block JSON). */
export const Tool = createComponent('Tool', {
  archetype: { type: Types.String, default: 'block' },
  behavior: { type: Types.String, default: '' },
  level: { type: Types.Int16, default: 1 },
});
