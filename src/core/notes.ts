import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from '@iwsdk/core';

/** Priority colors: high, medium, low. */
export const NOTE_COLORS = ['#e8705f', '#efc35a', '#8cc47e'] as const;
export const NOTE_NAMES = ['high', 'medium', 'low'] as const;
export const NOTE_SIZE = 0.045;
export const NOTE_THICKNESS = 0.004;

const noteGeometry = new BoxGeometry(NOTE_SIZE, NOTE_THICKNESS, NOTE_SIZE);
const noteMaterials = NOTE_COLORS.map(
  (c) =>
    new MeshStandardMaterial({
      color: new Color(c),
      roughness: 0.9,
      emissive: new Color('#ffe2b0'),
      emissiveIntensity: 0,
    }),
);

export function noteMaterial(priority: number): MeshStandardMaterial {
  return noteMaterials[Math.max(0, Math.min(2, priority))];
}

export function createNoteMesh(priority: number): Mesh {
  // Own material instance so hover glow stays per note.
  const m = new Mesh(noteGeometry, noteMaterial(priority).clone());
  m.name = `note-${NOTE_NAMES[priority] ?? 'medium'}`;
  return m;
}

/** Pad: a cream block with the next note color on top. */
export function createPadObject(): Group {
  const g = new Group();
  g.name = 'note-pad';
  const base = new Mesh(
    new BoxGeometry(0.052, 0.014, 0.052),
    new MeshStandardMaterial({ color: '#f3ead8', roughness: 0.95 }),
  );
  base.position.y = 0.007;
  g.add(base);
  const top = new Mesh(noteGeometry, noteMaterial(0).clone());
  top.name = 'pad-top';
  top.position.y = 0.014 + NOTE_THICKNESS / 2;
  g.add(top);
  return g;
}

export function setPadColor(pad: Group, priority: number): void {
  const top = pad.getObjectByName('pad-top') as Mesh | undefined;
  if (top) (top.material as MeshStandardMaterial).color.set(NOTE_COLORS[priority]);
}
