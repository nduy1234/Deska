import type { Light, Object3D } from '@iwsdk/core';
import { setAmbient } from './sfx.js';

/**
 * Room mood: `dimRoom` eases the scene lights down and warms/quiets the
 * ambient bed. The desk stays readable even at full dim.
 */
let lights: Light[] | null = null;
let current = 0;
let target = 0;

function collect(scene: Object3D): Light[] {
  const found: Light[] = [];
  scene.traverse((o) => {
    const l = o as Light;
    if (l.isLight) {
      l.userData.baseIntensity ??= l.intensity;
      found.push(l);
    }
  });
  return found;
}

export function dimRoom(level: number): void {
  target = Math.max(0, Math.min(1, level));
  setAmbient(target);
}

export function roomLevel(): number {
  return target;
}

/** Call once per frame. */
export function updateRoom(scene: Object3D, delta: number): void {
  if (!lights || lights.length === 0) lights = collect(scene);
  if (Math.abs(current - target) < 0.001) return;
  current += (target - current) * Math.min(1, delta * 3);
  for (const l of lights) {
    l.intensity = (l.userData.baseIntensity as number) * (1 - 0.6 * current);
  }
}
