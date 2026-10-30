import {
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { sfx, unlockAudio } from '../feedback/sfx.js';
import {
  clampDeform,
  copyDeform,
  halfExtents,
  type DeformParams,
  type Primitive,
} from '../sculpt/deform.js';
import { createClayMesh, readDeform, writeDeform } from './clay.js';
import { Clay, Held, Note, NotePad, Settling, Tool, TraySlot } from './components.js';
import { clampToDesk, desk, isOverTray } from './desk.js';
import { deskEvents } from './events.js';
import { hands, otherSide, SIDES, type HandState, type Side } from './hands.js';
import { createNoteMesh, NOTE_THICKNESS, setPadColor } from './notes.js';

/** Extra reach around an object that still counts as pinching it. */
export const PINCH_SLOP = 0.035;
const SETTLE_TIME = 0.22;
const SQUEEZE_RATE = 0.6;
/** A pinch released this fast without moving counts as a tap (poke). */
const TAP_TIME = 0.3;
const TAP_MOVE = 0.015;
/** Lever tilt (radians) per meter the hand pulls toward the user. */
const LEVER_GAIN = 9;
export const LEVER_MAX = 0.9;

/** How a held object follows the hand. */
type GrabMode = 'move' | 'turn' | 'pull';

interface Grip {
  entity: Entity;
  mode: GrabMode;
  /** Object position in the hand frame (desk space). */
  offset: Vector3;
  /** inv(hand) * object rotation (desk space). */
  rot: Quaternion;
  time: number;
  hand0: Vector3;
  handQ0: Quaternion;
  /** Object pose at grab (turn/pull keep the object anchored). */
  pos0: Vector3;
  q0: Quaternion;
  moved: number;
}

interface Sculpt {
  entity: Entity;
  start: DeformParams;
  /** Hand separation in object space at sculpt start. */
  v0: Vector3;
  axis: 0 | 1 | 2;
  objQ: Quaternion;
  handQ0: Record<Side, Quaternion>;
  lastSound: number;
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `c${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export const manipulation: {
  /** Accessibility mode: one-hand pinch on clay sculpts against the desk. */
  oneHanded: boolean;
  /** Tool layer hook: return true to consume a released object (e.g. note into jar). */
  dropHandler: ((entity: Entity) => boolean) | null;
} = { oneHanded: false, dropHandler: null };

/** Glow material of any grabbable (clay mesh, note mesh, pad top sheet). */
export function glowMaterial(e: Entity): MeshStandardMaterial | null {
  const o = e.object3D;
  if (o instanceof Mesh) return o.material as MeshStandardMaterial;
  if (o instanceof Group) {
    const top = o.getObjectByName('pad-top');
    if (top instanceof Mesh) return top.material as MeshStandardMaterial;
  }
  return null;
}

/**
 * Hands-only manipulation of everything on the desk:
 * - one-hand pinch: pick up / move / flip; tray slots and the note pad hand out new items
 * - tools grab by archetype: dials turn in place, levers tilt on their pivot
 * - quick pinch-tap without moving: poke
 * - two-hand pinch on the same clay: stretch along the hands' axis, wring to twist
 * - open hand closed around clay: squeeze its waist
 */
export class ManipulateSystem extends createSystem({
  clay: { required: [Clay] },
  notes: { required: [Note] },
  pads: { required: [NotePad] },
  settling: { required: [Settling] },
}) {
  private grips: Record<Side, Grip | null> = { left: null, right: null };
  private sculpt: Sculpt | null = null;
  private deskQ = new Quaternion();
  private deskQInv = new Quaternion();
  private handLocal = { left: new Vector3(), right: new Vector3() };
  private handQLocal = { left: new Quaternion(), right: new Quaternion() };
  private v = new Vector3();
  private v2 = new Vector3();
  private q = new Quaternion();
  private q2 = new Quaternion();
  private up = new Vector3();
  private axisY = new Vector3(0, 1, 0);
  private axisX = new Vector3(1, 0, 0);
  private params: DeformParams = { sx: 1, sy: 1, sz: 1, waist: 0, twist: 0, taper: 0 };
  private hover = new Map<Entity, number>();
  private time = 0;
  private squeezeLast = 0;
  private squeezeEntity: Entity | null = null;

  update(delta: number): void {
    const group = desk.group;
    if (!group) return;
    this.time += delta;
    group.updateWorldMatrix(true, false);
    group.getWorldQuaternion(this.deskQ);
    this.deskQInv.copy(this.deskQ).invert();

    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked) continue;
      this.handLocal[side].copy(h.pinchPoint);
      group.worldToLocal(this.handLocal[side]);
      this.handQLocal[side].copy(this.deskQInv).multiply(h.rotation);
    }

    for (const side of SIDES) {
      const h = hands[side];
      if (h.pinchStart) {
        unlockAudio();
        this.onPinchStart(side);
      } else if ((h.pinchEnd || !h.tracked) && this.grips[side]) {
        this.onPinchEnd(side);
      }
    }

    if (this.sculpt) this.updateSculpt();
    else {
      for (const side of SIDES) {
        const g = this.grips[side];
        if (g) this.follow(side, g);
      }
    }

    this.updateSqueeze(delta);
    this.updateGlow();
    this.updateSettling(delta);
  }

  // ---------------------------------------------------------------- grabbing

  private grabRadius(e: Entity): number {
    if (e.hasComponent(Note)) return 0.028;
    if (e.hasComponent(NotePad)) return 0.035;
    const ext = halfExtents(readDeform(e, this.params));
    return Math.max(ext.x, ext.y, ext.z) * (e.object3D?.scale.x ?? 1);
  }

  private nearest(side: Side): Entity | null {
    const p = this.handLocal[side];
    let best: Entity | null = null;
    let bestD = PINCH_SLOP;
    const consider = (e: Entity) => {
      const o = e.object3D;
      if (!o || !o.visible) return;
      const d = p.distanceTo(o.position) - this.grabRadius(e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    };
    for (const e of this.queries.clay.entities) consider(e);
    for (const e of this.queries.notes.entities) consider(e);
    for (const e of this.queries.pads.entities) consider(e);
    return best;
  }

  private onPinchStart(side: Side): void {
    let target = this.nearest(side);
    if (!target) return;
    if (target.hasComponent(TraySlot)) target = this.spawnFromTray(target);
    else if (target.hasComponent(NotePad)) target = this.spawnNote(target);
    if (target.hasComponent(Settling)) target.removeComponent(Settling);
    this.grab(side, target);
    sfx.pick();

    if (target.hasComponent(Tool) || target.hasComponent(Note)) return;
    const other = this.grips[otherSide(side)];
    if (other && other.entity === target) this.beginSculpt(target);
    else if (manipulation.oneHanded) this.beginSculpt(target);
  }

  private spawnFromTray(slot: Entity): Entity {
    const primitive = (slot.getValue(TraySlot, 'primitive') ?? 'cube') as Primitive;
    const mesh = createClayMesh(primitive);
    mesh.position.copy(slot.object3D!.position);
    const e = this.world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
    e.addComponent(Clay, { primitive, uid: newUid() });
    deskEvents.emit({ type: 'spawned', entity: e });
    return e;
  }

  private spawnNote(pad: Entity): Entity {
    const priority = pad.getValue(NotePad, 'next') ?? 0;
    const next = (priority + 1) % 3;
    pad.setValue(NotePad, 'next', next);
    setPadColor(pad.object3D as Group, next);
    const mesh = createNoteMesh(priority);
    mesh.position.copy(pad.object3D!.position);
    mesh.position.y += 0.02;
    const e = this.world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
    e.addComponent(Note, { priority, uid: newUid() });
    deskEvents.emit({ type: 'spawned', entity: e });
    return e;
  }

  private modeFor(entity: Entity): GrabMode {
    if (!entity.hasComponent(Tool)) return 'move';
    const a = entity.getValue(Tool, 'archetype');
    return a === 'dial' ? 'turn' : a === 'lever' ? 'pull' : 'move';
  }

  private grab(side: Side, entity: Entity): void {
    const o = entity.object3D!;
    const hq = this.handQLocal[side];
    const inv = this.q.copy(hq).invert();
    const offset = new Vector3().copy(o.position).sub(this.handLocal[side]).applyQuaternion(inv);
    const rot = new Quaternion().copy(inv).multiply(o.quaternion);
    this.grips[side] = {
      entity,
      mode: this.modeFor(entity),
      offset,
      rot,
      time: this.time,
      hand0: this.handLocal[side].clone(),
      handQ0: hq.clone(),
      pos0: o.position.clone(),
      q0: o.quaternion.clone(),
      moved: 0,
    };
    this.markHeld(entity);
    deskEvents.emit({ type: 'grab', entity, side });
  }

  private markHeld(entity: Entity): void {
    const l = this.grips.left?.entity === entity;
    const r = this.grips.right?.entity === entity;
    if (!l && !r) {
      if (entity.hasComponent(Held)) entity.removeComponent(Held);
      return;
    }
    const by = l && r ? 'both' : l ? 'left' : 'right';
    if (entity.hasComponent(Held)) entity.setValue(Held, 'by', by);
    else entity.addComponent(Held, { by });
  }

  private follow(side: Side, g: Grip): void {
    const o = g.entity.object3D;
    if (!o) return;
    const hand = this.handLocal[side];
    g.moved = Math.max(g.moved, hand.distanceTo(g.hand0));
    const hq = this.handQLocal[side];
    if (g.mode === 'turn') {
      // Knob: the wrist's rotation about vertical turns the dial in place.
      this.q.copy(g.handQ0).invert().premultiply(hq);
      const angle = twistAngle(this.q, this.axisY);
      o.position.copy(g.pos0);
      o.quaternion.setFromAxisAngle(this.axisY, angle).multiply(g.q0);
      return;
    }
    if (g.mode === 'pull') {
      // Lever: pulling toward you (or down) tilts it about its base pivot.
      const dz = hand.z - g.hand0.z;
      const dy = g.hand0.y - hand.y;
      const tilt = Math.max(0, Math.min(LEVER_MAX, (dz + dy * 0.5) * LEVER_GAIN));
      const hy = halfExtents(readDeform(g.entity, this.params)).y;
      this.q.setFromAxisAngle(this.axisX, tilt);
      o.quaternion.copy(this.q).multiply(g.q0);
      this.v.set(0, hy, 0).applyQuaternion(this.q);
      o.position.set(g.pos0.x, g.pos0.y - hy, g.pos0.z).add(this.v);
      return;
    }
    o.quaternion.copy(hq).multiply(g.rot);
    o.position.copy(g.offset).applyQuaternion(hq).add(hand);
  }

  private onPinchEnd(side: Side): void {
    const g = this.grips[side];
    this.grips[side] = null;
    if (!g) return;
    const entity = g.entity;
    const other = otherSide(side);
    if (this.sculpt?.entity === entity) {
      this.endSculpt();
      // The remaining hand keeps holding from where it is now.
      if (this.grips[other]?.entity === entity) this.grab(other, entity);
    }
    this.markHeld(entity);
    deskEvents.emit({ type: 'release', entity, side });
    if (this.time - g.time < TAP_TIME && g.moved < TAP_MOVE) {
      deskEvents.emit({ type: 'poke', entity, side });
    }
    if (this.grips[other]?.entity === entity) return;
    this.drop(entity, g);
  }

  private drop(entity: Entity, g: Grip): void {
    const o = entity.object3D;
    if (!o) return;
    if (manipulation.dropHandler?.(entity)) return;
    if (isOverTray(o.position) && !entity.hasComponent(TraySlot)) {
      sfx.dissolve();
      const uid = entity.getValue(Clay, 'uid') ?? entity.getValue(Note, 'uid') ?? '';
      deskEvents.emit({ type: 'removed', entity, uid });
      entity.dispose();
      return;
    }
    const isNote = entity.hasComponent(Note);
    // Snap to upright or upside-down, keeping the yaw the hand left it at.
    this.up.set(0, 1, 0).applyQuaternion(o.quaternion);
    const flipped = !isNote && this.up.y < 0;
    this.v.set(0, 0, 1).applyQuaternion(o.quaternion);
    if (Math.abs(this.v.y) > 0.9) this.v.set(1, 0, 0).applyQuaternion(o.quaternion);
    const yaw = Math.atan2(this.v.x, this.v.z) + (flipped ? Math.PI : 0);
    this.q.setFromAxisAngle(this.axisY, yaw);
    if (flipped) this.q.multiply(this.q2.setFromAxisAngle(this.axisX, Math.PI));

    this.v.copy(g.mode === 'pull' ? g.pos0 : o.position);
    if (g.mode === 'pull') this.q.copy(g.q0);
    clampToDesk(this.v);
    this.v.y = isNote
      ? NOTE_THICKNESS / 2 + 0.0005
      : halfExtents(readDeform(entity, this.params)).y * o.scale.y + 0.0005;

    if (!entity.hasComponent(Settling)) entity.addComponent(Settling, {});
    entity.setValue(Settling, 't', 0);
    entity.getVectorView(Settling, 'fromPosition').set([o.position.x, o.position.y, o.position.z]);
    entity
      .getVectorView(Settling, 'fromQuaternion')
      .set([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
    entity.getVectorView(Settling, 'toPosition').set([this.v.x, this.v.y, this.v.z]);
    entity.getVectorView(Settling, 'toQuaternion').set([this.q.x, this.q.y, this.q.z, this.q.w]);
  }

  private updateSettling(delta: number): void {
    for (const e of Array.from(this.queries.settling.entities)) {
      if (e.hasComponent(Held)) {
        e.removeComponent(Settling);
        continue;
      }
      const o = e.object3D;
      if (!o) continue;
      const t = Math.min(1, (e.getValue(Settling, 't') ?? 0) + delta / SETTLE_TIME);
      e.setValue(Settling, 't', t);
      const k = 1 - Math.pow(1 - t, 3);
      const fp = e.getVectorView(Settling, 'fromPosition');
      const tp = e.getVectorView(Settling, 'toPosition');
      const fq = e.getVectorView(Settling, 'fromQuaternion');
      const tq = e.getVectorView(Settling, 'toQuaternion');
      o.position.set(
        fp[0] + (tp[0] - fp[0]) * k,
        fp[1] + (tp[1] - fp[1]) * k,
        fp[2] + (tp[2] - fp[2]) * k,
      );
      this.q.set(fq[0], fq[1], fq[2], fq[3]);
      this.q2.set(tq[0], tq[1], tq[2], tq[3]);
      o.quaternion.copy(this.q).slerp(this.q2, k);
      if (t >= 1) {
        e.removeComponent(Settling);
        sfx.place();
        this.up.set(0, 1, 0).applyQuaternion(o.quaternion);
        deskEvents.emit({ type: 'settled', entity: e, flipped: this.up.y < 0 });
      }
    }
  }

  // ---------------------------------------------------------------- sculpting

  private beginSculpt(entity: Entity): void {
    const o = entity.object3D!;
    const start = copyDeform(readDeform(entity, this.params), {} as DeformParams);
    const objQ = o.quaternion.clone();
    this.sculpt = {
      entity,
      start,
      v0: new Vector3(),
      axis: 1,
      objQ,
      handQ0: {
        left: this.handQLocal.left.clone(),
        right: this.handQLocal.right.clone(),
      },
      lastSound: 0,
    };
    const v0 = this.separation(objQ, this.sculpt.v0);
    const a = [Math.abs(v0.x), Math.abs(v0.y), Math.abs(v0.z)];
    this.sculpt.axis = (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as 0 | 1 | 2;
  }

  /** Hand separation (or hand-to-center in one-handed mode) in object space. */
  private separation(objQ: Quaternion, out: Vector3): Vector3 {
    const single = !(this.grips.left && this.grips.right);
    if (single) {
      const side: Side = this.grips.right ? 'right' : 'left';
      const center = this.sculpt!.entity.object3D!.position;
      out.copy(this.handLocal[side]).sub(center);
    } else {
      out.copy(this.handLocal.right).sub(this.handLocal.left);
    }
    return out.applyQuaternion(this.q2.copy(objQ).invert());
  }

  private updateSculpt(): void {
    const s = this.sculpt!;
    // In one-handed mode the object stays put on the desk while sculpting.
    if (!(this.grips.left && this.grips.right)) {
      const o = s.entity.object3D!;
      o.quaternion.copy(s.objQ);
    }
    const v = this.separation(s.objQ, this.v);
    const p = copyDeform(s.start, this.params);
    const comp = (vec: Vector3, i: number) => Math.abs(i === 0 ? vec.x : i === 1 ? vec.y : vec.z);
    const v0 = Math.max(0.02, comp(s.v0, s.axis));
    const ratio = Math.max(0.02, comp(v, s.axis)) / v0;
    if (s.axis === 0) p.sx = s.start.sx * ratio;
    else if (s.axis === 1) p.sy = s.start.sy * ratio;
    else p.sz = s.start.sz * ratio;

    // Wring: opposite wrist roll around the object's up axis adds twist.
    this.up.set(0, 1, 0).applyQuaternion(s.objQ);
    const twistOf = (side: Side) => {
      this.q.copy(s.handQ0[side]).invert().premultiply(this.handQLocal[side]);
      return twistAngle(this.q, this.up);
    };
    const wring =
      this.grips.left && this.grips.right
        ? twistOf('right') - twistOf('left')
        : twistOf(this.grips.right ? 'right' : 'left');
    p.twist = s.start.twist + wring * 0.8;
    clampDeform(p);

    const e = s.entity;
    const changed =
      Math.abs(p.sx - (e.getValue(Clay, 'sx') ?? 1)) +
      Math.abs(p.sy - (e.getValue(Clay, 'sy') ?? 1)) +
      Math.abs(p.sz - (e.getValue(Clay, 'sz') ?? 1)) +
      Math.abs(p.twist - (e.getValue(Clay, 'twist') ?? 0));
    if (changed > 0.002) {
      writeDeform(e, p);
      if (this.time - s.lastSound > 0.09) {
        sfx.squish(Math.min(1, changed * 20));
        s.lastSound = this.time;
      }
    }
  }

  private endSculpt(): void {
    const s = this.sculpt;
    this.sculpt = null;
    if (s) deskEvents.emit({ type: 'sculpted', entity: s.entity });
  }

  /** Open hand closed around clay pinches its waist. */
  private updateSqueeze(delta: number): void {
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked || !h.isHand || h.pinching || h.curl < 0.45) continue;
      const target = this.wrapped(h);
      if (!target) continue;
      const p = readDeform(target, this.params);
      const before = p.waist;
      p.waist += SQUEEZE_RATE * (h.curl - 0.4) * delta;
      clampDeform(p);
      if (p.waist - before > 1e-4) {
        writeDeform(target, p);
        if (this.time - this.squeezeLast > 0.12) sfx.squish(p.waist);
        if (this.time - this.squeezeLast > 0.12 || this.squeezeEntity !== target) {
          this.squeezeLast = this.time;
        }
        this.squeezeEntity = target;
      }
    }
    if (this.squeezeEntity && this.time - this.squeezeLast > 0.5) {
      deskEvents.emit({ type: 'sculpted', entity: this.squeezeEntity });
      this.squeezeEntity = null;
    }
  }

  private wrapped(h: HandState): Entity | null {
    this.v.copy(h.graspPoint);
    desk.group!.worldToLocal(this.v);
    for (const e of this.queries.clay.entities) {
      if (e.hasComponent(TraySlot) || e.hasComponent(Tool)) continue;
      const o = e.object3D;
      if (!o) continue;
      const ext = halfExtents(readDeform(e, this.params));
      this.v2.copy(this.v).sub(o.position);
      const horiz = Math.hypot(this.v2.x, this.v2.z);
      if (horiz < Math.max(ext.x, ext.z) + 0.05 && Math.abs(this.v2.y) < ext.y * 0.6 + 0.02) {
        return e;
      }
    }
    return null;
  }

  /**
   * Single writer of emissive glow: hover affordance (brightens as a hand
   * closes its pinch nearby), held tint, and the tool layer's lockGlow.
   */
  private updateGlow(): void {
    this.hover.clear();
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked || this.grips[side]) continue;
      const e = this.nearest(side);
      if (e) this.hover.set(e, Math.max(this.hover.get(e) ?? 0, 0.15 + h.pinchStrength * 0.25));
    }
    const apply = (e: Entity) => {
      const mat = glowMaterial(e);
      if (!mat) return;
      const lock = (mat.userData.lockGlow as number | undefined) ?? 0;
      const held = e.hasComponent(Held) ? 0.08 : 0;
      mat.emissiveIntensity = Math.max(lock, this.hover.get(e) ?? 0, held);
    };
    for (const e of this.queries.clay.entities) apply(e);
    for (const e of this.queries.notes.entities) apply(e);
    for (const e of this.queries.pads.entities) apply(e);
  }
}

/** Swing-twist: rotation angle of q around a unit axis. */
export function twistAngle(q: Quaternion, axis: Vector3): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  let a = 2 * Math.atan2(d, q.w);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
