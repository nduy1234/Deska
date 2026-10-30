import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  Entity,
  Mesh,
  MeshStandardMaterial,
  eq,
  SphereGeometry,
} from '@iwsdk/core';
import {
  deformPositions,
  type DeformParams,
  type Primitive,
} from '../sculpt/deform.js';
import { Clay } from './components.js';

/** Soft clay palette, one per primitive. */
export const CLAY_COLORS: Record<Primitive, string> = {
  cube: '#d9896a',
  cylinder: '#9db896',
  sphere: '#8db0d6',
};

const baseCache = new Map<Primitive, BufferGeometry>();

/** Unit-box base geometry with enough height rings to bend smoothly. */
function baseGeometry(primitive: Primitive): BufferGeometry {
  let g = baseCache.get(primitive);
  if (g) return g;
  if (primitive === 'cube') g = new BoxGeometry(1, 1, 1, 3, 14, 3);
  else if (primitive === 'cylinder') g = new CylinderGeometry(0.5, 0.5, 1, 28, 14);
  else g = new SphereGeometry(0.5, 28, 18);
  baseCache.set(primitive, g);
  return g;
}

export function createClayMesh(primitive: Primitive): Mesh {
  const base = baseGeometry(primitive);
  const geometry = base.clone();
  // Keep the undeformed positions alongside for rebuilds.
  geometry.setAttribute(
    'basePosition',
    new BufferAttribute(
      (base.getAttribute('position').array as Float32Array).slice(),
      3,
    ),
  );
  const material = new MeshStandardMaterial({
    color: new Color(CLAY_COLORS[primitive]),
    roughness: 0.82,
    metalness: 0,
    emissive: new Color('#ffd9a0'),
    emissiveIntensity: 0,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = `clay-${primitive}`;
  return mesh;
}

/** Read the deform vector off a Clay entity (into a reusable object). */
export function readDeform(entity: Entity, out: DeformParams): DeformParams {
  out.sx = entity.getValue(Clay, 'sx') ?? 1;
  out.sy = entity.getValue(Clay, 'sy') ?? 1;
  out.sz = entity.getValue(Clay, 'sz') ?? 1;
  out.waist = entity.getValue(Clay, 'waist') ?? 0;
  out.twist = entity.getValue(Clay, 'twist') ?? 0;
  out.taper = entity.getValue(Clay, 'taper') ?? 0;
  return out;
}

export function writeDeform(entity: Entity, p: DeformParams): void {
  entity.setValue(Clay, 'sx', p.sx);
  entity.setValue(Clay, 'sy', p.sy);
  entity.setValue(Clay, 'sz', p.sz);
  entity.setValue(Clay, 'waist', p.waist);
  entity.setValue(Clay, 'twist', p.twist);
  entity.setValue(Clay, 'taper', p.taper);
  entity.setValue(Clay, 'dirty', true);
}

export function clayMesh(entity: Entity): Mesh | null {
  const o = entity.object3D;
  return o instanceof Mesh ? o : null;
}

/** Rebuilds clay geometry from the deform vector, only when marked dirty. */
export class ClaySystem extends createSystem({
  clay: { required: [Clay], where: [eq(Clay, 'dirty', true)] },
}) {
  private params: DeformParams = { sx: 1, sy: 1, sz: 1, waist: 0, twist: 0, taper: 0 };

  update(): void {
    for (const entity of Array.from(this.queries.clay.entities)) {
      const mesh = clayMesh(entity);
      if (!mesh) continue;
      const g = mesh.geometry;
      const base = g.getAttribute('basePosition');
      const pos = g.getAttribute('position') as BufferAttribute;
      if (!base) continue;
      deformPositions(base.array, pos.array as Float32Array, readDeform(entity, this.params));
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      entity.setValue(Clay, 'dirty', false);
    }
  }
}
