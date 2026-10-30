import {
  BoxGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { sfx } from '../feedback/sfx.js';
import type { Primitive } from '../sculpt/deform.js';
import { createClayMesh } from './clay.js';
import { Clay, TraySlot } from './components.js';
import { hands } from './hands.js';

/**
 * Desk layout, in desk-local meters. The desk top is at y = 0, +z points at
 * the seated user, so everything sits within a ~0.6 m (two foot) reach.
 */
export const DESK = {
  width: 0.9,
  depth: 0.5,
  /** Desk top below the seated head. */
  belowHead: 0.4,
  /** Desk center in front of the head. */
  inFront: 0.36,
  tray: { x: 0, z: -0.17, width: 0.44, depth: 0.11 },
  traySlotSpacing: 0.13,
} as const;

/** Shared desk handle so systems can parent and convert into desk space. */
export const desk: {
  root: Entity | null;
  group: Group | null;
  anchored: boolean;
  /** 0..1 progress of the palms-up recenter gesture. */
  recenterProgress: number;
} = { root: null, group: null, anchored: false, recenterProgress: 0 };

export function isOverTray(local: Vector3): boolean {
  const t = DESK.tray;
  return (
    Math.abs(local.x - t.x) < t.width / 2 + 0.02 &&
    Math.abs(local.z - t.z) < t.depth / 2 + 0.03 &&
    local.y < 0.12
  );
}

/** Clamp a desk-local point onto the usable desk surface. */
export function clampToDesk(local: Vector3): Vector3 {
  const hx = DESK.width / 2 - 0.05;
  const hz = DESK.depth / 2 - 0.05;
  local.x = Math.max(-hx, Math.min(hx, local.x));
  local.z = Math.max(-hz, Math.min(hz, local.z));
  return local;
}

const RECENTER_HOLD = 1.0;

export class DeskSystem extends createSystem({
  slots: { required: [TraySlot] },
}) {
  private legs: Mesh[] = [];
  private edge!: MeshStandardMaterial;
  private anchorDelay = -1;
  private head = new Vector3();
  private fwd = new Vector3();
  private q = new Quaternion();
  private recenterHeld = 0;
  private recenterLatched = false;
  private trayPrimitives: Primitive[] = ['cube', 'cylinder', 'sphere'];

  init(): void {
    const group = new Group();
    group.name = 'DeskRoot';
    const root = this.world.createTransformEntity(group, { persistent: true });
    desk.root = root;
    desk.group = group;

    const wood = new MeshStandardMaterial({ color: '#e2bf93', roughness: 0.7 });
    const top = new Mesh(new BoxGeometry(DESK.width, 0.03, DESK.depth), wood);
    top.position.y = -0.015;
    group.add(top);

    // Soft front edge strip doubles as the recenter progress light.
    this.edge = new MeshStandardMaterial({
      color: '#e9d6bd',
      roughness: 0.6,
      emissive: new Color('#ffcf8a'),
      emissiveIntensity: 0,
    });
    const edge = new Mesh(new BoxGeometry(DESK.width, 0.012, 0.012), this.edge);
    edge.position.set(0, -0.006, DESK.depth / 2);
    group.add(edge);

    const legMat = new MeshStandardMaterial({ color: '#8a6a4c', roughness: 0.8 });
    const legGeo = new CylinderGeometry(0.018, 0.015, 1, 10);
    legGeo.translate(0, -0.5, 0);
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const leg = new Mesh(legGeo, legMat);
      leg.position.set(
        x * (DESK.width / 2 - 0.05),
        -0.03,
        z * (DESK.depth / 2 - 0.05),
      );
      group.add(leg);
      this.legs.push(leg);
    }

    const trayMat = new MeshStandardMaterial({ color: '#a77d57', roughness: 0.75 });
    const t = DESK.tray;
    const tray = new Mesh(new BoxGeometry(t.width, 0.01, t.depth), trayMat);
    tray.position.set(t.x, 0.005, t.z);
    group.add(tray);
    const rimGeo = new BoxGeometry(t.width, 0.018, 0.008);
    for (const dz of [-1, 1]) {
      const rim = new Mesh(rimGeo, trayMat);
      rim.position.set(t.x, 0.009, t.z + (dz * t.depth) / 2);
      group.add(rim);
    }

    this.trayPrimitives.forEach((p, i) => this.addTraySlot(p, i));

    // Desktop / emulator before entering XR: anchor to the configured camera.
    this.anchor();
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) this.anchorDelay = 0.6;
        if (state === VisibilityState.NonImmersive) this.anchorDelay = 0.1;
      }),
    );
  }

  /** Adds a tray slot (also used by the daily "desk grows" unlocks). */
  addTraySlot(primitive: Primitive, index: number): Entity {
    const mesh = createClayMesh(primitive);
    const n = Math.max(3, index + 1);
    const x = DESK.tray.x + (index - (n - 1) / 2) * DESK.traySlotSpacing;
    mesh.position.set(x, 0.01 + 0.04 * 0.75, DESK.tray.z);
    mesh.scale.setScalar(0.75);
    const e = this.world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
    e.addComponent(TraySlot, { primitive });
    e.addComponent(Clay, { primitive, uid: `tray-${primitive}` });
    return e;
  }

  /** Place the desk at seated height in front of the current head pose. */
  anchor(): void {
    const group = desk.group;
    if (!group) return;
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    const y = Math.max(0.45, this.head.y - DESK.belowHead);
    group.position.set(
      this.head.x + this.fwd.x * DESK.inFront,
      y,
      this.head.z + this.fwd.z * DESK.inFront,
    );
    this.q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    group.quaternion.copy(this.q);
    for (const leg of this.legs) leg.scale.y = Math.max(0.05, y - 0.03);
    desk.anchored = true;
  }

  update(delta: number): void {
    if (this.anchorDelay >= 0) {
      this.anchorDelay -= delta;
      if (this.anchorDelay < 0) this.anchor();
    }

    // Recenter: both palms up, open, not pinching, held for a second.
    const l = hands.left;
    const r = hands.right;
    const palmsUp =
      l.tracked &&
      r.tracked &&
      l.isHand &&
      r.isHand &&
      !l.pinching &&
      !r.pinching &&
      l.curl < 0.4 &&
      r.curl < 0.4 &&
      l.palmNormal.y > 0.75 &&
      r.palmNormal.y > 0.75;
    if (palmsUp && !this.recenterLatched) {
      this.recenterHeld += delta;
      if (this.recenterHeld >= RECENTER_HOLD) {
        this.anchor();
        sfx.whoosh();
        this.recenterLatched = true;
        this.recenterHeld = 0;
      }
    } else if (!palmsUp) {
      this.recenterHeld = Math.max(0, this.recenterHeld - delta * 2);
      this.recenterLatched = false;
    }
    desk.recenterProgress = this.recenterHeld / RECENTER_HOLD;
    this.edge.emissiveIntensity = desk.recenterProgress * 1.2;
  }
}
