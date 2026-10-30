import {
  createSystem,
  DoubleSide,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type World,
} from '@iwsdk/core';
import { BehaviorRuntime, type BlockHost, type TriggerEvent } from '../blocks/runtime.js';
import type { BehaviorGraph, SoundName } from '../blocks/schema.js';
import { behaviorFor, DEFAULT_BEHAVIORS } from '../blocks/templates.js';
import { toolLevel } from '../persist/model.js';
import { deskState } from '../persist/state.js';
import { validateBehavior } from '../blocks/validate.js';
import { clayMesh, createClayMesh, readDeform, writeDeform } from '../core/clay.js';
import { Clay, Held, Note, Tool, TraySlot } from '../core/components.js';
import { desk } from '../core/desk.js';
import { deskEvents } from '../core/events.js';
import { hands, SIDES, type Side } from '../core/hands.js';
import { glowMaterial, LEVER_MAX, manipulation, newUid } from '../core/manipulate.js';
import { createNoteMesh, NOTE_SIZE } from '../core/notes.js';
import { Label } from '../feedback/label.js';
import { dimRoom, updateRoom } from '../feedback/room.js';
import { sfx } from '../feedback/sfx.js';
import { halfExtents, type DeformParams } from '../sculpt/deform.js';
import {
  ARCHETYPE_LABELS,
  ARCHETYPE_SHAPES,
  recognize,
  type Archetype,
} from '../sculpt/recognizer.js';

/** Confidence needed for a sculpted shape to lock into a tool. */
export const LOCK_CONFIDENCE = 0.6;
const DIAL_RANGE = 270;
const POKE_COOLDOWN = 0.5;

interface Saved {
  vars: Record<string, string | number | boolean>;
  timers: Record<string, number>;
  savedAt: number;
}

interface LiveTool {
  rt: BehaviorRuntime;
  label: Label;
  ring: Mesh;
  ringProgress: number;
  flipped: boolean;
  yawPrev: number;
  angle: number;
  leverLatched: boolean;
  pokeInside: Record<Side, boolean>;
  lastPoke: number;
  lock: number;
  /** Jar contents in arrival or sorted order (note priorities). */
  items: number[];
  itemGroup: Group | null;
  lastSave: number;
}

const ringMaterial = new MeshBasicMaterial({
  color: '#f2b36b',
  transparent: true,
  opacity: 0.85,
  side: DoubleSide,
  depthWrite: false,
});

const SOUND: Record<SoundName, () => void> = {
  chime: sfx.chime,
  tap: sfx.tap,
  lock: sfx.lock,
  sparkle: sfx.sparkle,
  whoosh: sfx.whoosh,
  detent: sfx.detent,
  place: sfx.place,
};

/** Parse + validate a stored behavior; fall back to the archetype default. */
export function loadBehavior(json: string, archetype: Archetype): BehaviorGraph {
  try {
    const v = validateBehavior(JSON.parse(json));
    if (v.ok && v.graph) return v.graph;
  } catch {
    /* fall through */
  }
  return DEFAULT_BEHAVIORS[archetype] ?? DEFAULT_BEHAVIORS.block;
}

/** Spawn a finished tool on the desk (starter desk, agent, persistence). */
export function spawnTool(
  world: World,
  archetype: Archetype,
  behavior: BehaviorGraph,
  position: Vector3,
  opts: { uid?: string; deform?: DeformParams; yaw?: number; state?: string; items?: string } = {},
): Entity {
  const shape = ARCHETYPE_SHAPES[archetype];
  const mesh = createClayMesh(shape.primitive);
  const deform = opts.deform ?? shape.deform;
  mesh.position.copy(position);
  mesh.position.y = halfExtents(deform).y + 0.0005;
  if (opts.yaw) mesh.rotation.y = opts.yaw;
  const e = world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
  e.addComponent(Clay, { primitive: shape.primitive, uid: opts.uid ?? newUid(), archetype });
  writeDeform(e, deform);
  e.addComponent(Tool, {
    archetype,
    behavior: JSON.stringify(behavior),
    state: opts.state ?? '',
    items: opts.items ?? '',
  });
  return e;
}

/**
 * Turns locked-in shapes into tools and runs every tool: its behavior graph
 * (block runtime), its physical sensors (flip, turn, pull, poke, drop) and
 * its feedback (labels, timer ring, glow, room mood, jar contents).
 */
export class ToolSystem extends createSystem({
  tools: { required: [Tool, Clay] },
}) {
  private live = new Map<Entity, LiveTool>();
  private hint!: Label;
  private hintFor: Entity | null = null;
  private params: DeformParams = { sx: 1, sy: 1, sz: 1, waist: 0, twist: 0, taper: 0 };
  private v = new Vector3();
  private v2 = new Vector3();
  private q = new Quaternion();
  private time = 0;
  private pendingLock = new Set<Entity>();

  init(): void {
    this.hint = new Label(0.12);
    this.queries.tools.subscribe('qualify', (e) => this.setup(e));
    this.queries.tools.subscribe('disqualify', (e) => this.teardown(e));
    this.cleanupFuncs.push(
      deskEvents.on((ev) => {
        switch (ev.type) {
          case 'sculpted':
            this.recognizeSculpt(ev.entity);
            break;
          case 'settled': {
            const t = this.live.get(ev.entity);
            if (t && t.flipped !== ev.flipped) {
              t.flipped = ev.flipped;
              this.fire(ev.entity, { type: 'flip' });
            }
            break;
          }
          case 'grab': {
            const t = this.live.get(ev.entity);
            if (t && ev.entity.object3D) t.yawPrev = yawOf(ev.entity.object3D.quaternion, this.v);
            if (t) this.fire(ev.entity, { type: 'grab' });
            break;
          }
          case 'release':
          case 'poke':
            if (this.live.has(ev.entity)) this.fire(ev.entity, { type: ev.type });
            break;
        }
      }),
    );
    manipulation.dropHandler = (e) => this.noteIntoJar(e);
    this.cleanupFuncs.push(() => {
      manipulation.dropHandler = null;
    });
  }

  // ------------------------------------------------------------ lifecycle

  private setup(entity: Entity): void {
    const archetype = (entity.getValue(Tool, 'archetype') ?? 'block') as Archetype;
    const graph = loadBehavior(entity.getValue(Tool, 'behavior') ?? '', archetype);
    const label = new Label();
    desk.group!.add(label.sprite);
    const ring = new Mesh(new RingGeometry(0.03, 0.036, 48), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    desk.group!.add(ring);

    let restore: { vars: Saved['vars']; timers: Saved['timers'] } | undefined;
    try {
      const s = JSON.parse(entity.getValue(Tool, 'state') || 'null') as Saved | null;
      if (s) {
        const elapsed = Date.now() - s.savedAt;
        const timers: Record<string, number> = {};
        for (const [k, ms] of Object.entries(s.timers)) timers[k] = ms - elapsed;
        restore = { vars: s.vars, timers };
      }
    } catch {
      /* ignore corrupt state */
    }

    const tool: LiveTool = {
      rt: null as unknown as BehaviorRuntime,
      label,
      ring,
      ringProgress: -1,
      flipped: false,
      yawPrev: 0,
      angle: 0,
      leverLatched: false,
      pokeInside: { left: false, right: false },
      lastPoke: -10,
      lock: 0,
      items: (entity.getValue(Tool, 'items') ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
      itemGroup: null,
      lastSave: 0,
    };
    tool.rt = new BehaviorRuntime(graph, this.hostFor(entity, tool), restore, Date.now());
    const o = entity.object3D!;
    this.v.set(0, 1, 0).applyQuaternion(o.quaternion);
    tool.flipped = this.v.y < 0;
    tool.yawPrev = yawOf(o.quaternion, this.v2);
    tool.angle = Number(tool.rt.vars._angle ?? 0);
    this.live.set(entity, tool);
    if (tool.items.length) this.layoutItems(entity, tool, true);
    if (this.pendingLock.delete(entity)) {
      tool.lock = 1;
      tool.label.show(ARCHETYPE_LABELS[archetype], 3.5);
    }
  }

  private teardown(entity: Entity): void {
    const t = this.live.get(entity);
    if (!t) return;
    t.label.dispose();
    t.ring.geometry.dispose();
    t.ring.removeFromParent();
    this.live.delete(entity);
  }

  private hostFor(entity: Entity, tool: LiveTool): BlockHost {
    return {
      showText: (text, seconds) => tool.label.show(text, seconds),
      playSound: (s) => SOUND[s]?.(),
      setColor: (c) => {
        const mesh = clayMesh(entity);
        if (mesh) (mesh.material as MeshStandardMaterial).color.set(c);
      },
      dimRoom: (level) => dimRoom(level),
      sortItems: () => {
        tool.items.sort((a, b) => a - b);
        entity.setValue(Tool, 'items', tool.items.join(','));
        this.layoutItems(entity, tool, false);
      },
      timerStarted: () => {
        tool.ringProgress = -1;
      },
      timerStopped: () => {},
      timerEnded: () => {
        tool.lock = 1;
      },
    };
  }

  private fire(entity: Entity, ev: TriggerEvent): void {
    const t = this.live.get(entity);
    if (!t) return;
    t.rt.dispatch(ev, Date.now());
    this.save(entity, t);
  }

  private save(entity: Entity, t: LiveTool): void {
    t.rt.vars._angle = Math.round(t.angle * 10) / 10;
    const now = Date.now();
    const snap = t.rt.snapshot(now);
    entity.setValue(Tool, 'state', JSON.stringify({ ...snap, savedAt: now }));
    t.lastSave = this.time;
  }

  // ------------------------------------------------------------ recognizer

  private recognizeSculpt(entity: Entity): void {
    if (!entity.active || entity.hasComponent(Tool) || entity.hasComponent(TraySlot)) return;
    if (!entity.hasComponent(Clay)) return;
    const primitive = (entity.getValue(Clay, 'primitive') ?? 'cube') as 'cube';
    const r = recognize(primitive, readDeform(entity, this.params));
    if (r.archetype !== 'block' && r.confidence >= LOCK_CONFIDENCE) {
      this.lockIn(entity, r.archetype);
    } else if (r.archetype !== 'block' && r.confidence > 0.25) {
      this.hintFor = entity;
      this.hint.show(`almost a ${r.archetype}…`, 2);
      if (!this.hint.sprite.parent) desk.group!.add(this.hint.sprite);
    }
  }

  /** A sculpted shape becomes a working tool: glow, label, chime. */
  lockIn(entity: Entity, archetype: Archetype): void {
    entity.setValue(Clay, 'archetype', archetype);
    this.pendingLock.add(entity);
    const level = toolLevel(deskState.snapshot, archetype);
    entity.addComponent(Tool, {
      archetype,
      level,
      behavior: JSON.stringify(behaviorFor(archetype, level)),
    });
    const t = this.live.get(entity);
    if (t && this.pendingLock.delete(entity)) {
      t.lock = 1;
      t.label.show(ARCHETYPE_LABELS[archetype], 3.5);
    }
    sfx.lock();
    deskEvents.emit({ type: 'archetype', entity, archetype });
  }

  // ------------------------------------------------------------ jar

  private jarAt(note: Entity): Entity | null {
    const p = note.object3D!.position;
    for (const [e] of this.live) {
      if (e.getValue(Tool, 'archetype') !== 'jar') continue;
      const o = e.object3D!;
      const ext = halfExtents(readDeform(e, this.params));
      const horiz = Math.hypot(p.x - o.position.x, p.z - o.position.z);
      if (horiz < Math.max(ext.x, ext.z) + 0.03 && p.y < o.position.y + ext.y + 0.1) return e;
    }
    return null;
  }

  private noteIntoJar(note: Entity): boolean {
    if (!note.hasComponent(Note)) return false;
    const jar = this.jarAt(note);
    if (!jar) return false;
    const t = this.live.get(jar)!;
    const priority = note.getValue(Note, 'priority') ?? 1;
    deskEvents.emit({ type: 'removed', entity: note, uid: note.getValue(Note, 'uid') ?? '' });
    note.dispose();
    t.items.push(priority);
    jar.setValue(Tool, 'items', t.items.join(','));
    this.layoutItems(jar, t, false);
    this.fire(jar, { type: 'drop', item: 'note', count: t.items.length });
    return true;
  }

  /** Notes stand like cards in the jar, poking out of the top. */
  private layoutItems(jar: Entity, t: LiveTool, instant: boolean): void {
    const o = jar.object3D!;
    if (!t.itemGroup) {
      t.itemGroup = new Group();
      o.add(t.itemGroup);
    }
    const g = t.itemGroup;
    while (g.children.length < t.items.length) g.add(createNoteMesh(1));
    while (g.children.length > t.items.length) g.children[g.children.length - 1].removeFromParent();
    const ext = halfExtents(readDeform(jar, this.params));
    const spread = Math.min(ext.x * 1.2, 0.016 * t.items.length);
    t.items.forEach((p, i) => {
      const m = g.children[i] as Mesh;
      const prev = (m.material as MeshStandardMaterial).userData.priority;
      if (prev !== p) {
        (m.material as MeshStandardMaterial).dispose();
        m.material = createNoteMesh(p).material;
        (m.material as MeshStandardMaterial).userData.priority = p;
      }
      const n = t.items.length;
      const x = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0;
      m.userData.target = [x, ext.y - NOTE_SIZE / 2 + 0.034, (i % 2) * 0.004 - 0.002];
      m.rotation.set(Math.PI / 2 - 0.12, 0, (i - (n - 1) / 2) * 0.06);
      if (instant || !m.userData.placed) {
        m.position.fromArray(m.userData.target);
        m.userData.placed = true;
      }
    });
  }

  // ------------------------------------------------------------ frame

  update(delta: number): void {
    this.time += delta;
    const now = Date.now();
    updateRoom(this.scene, delta);
    if (this.hintFor?.active && this.hintFor.object3D) {
      const o = this.hintFor.object3D;
      const hy = halfExtents(readDeform(this.hintFor, this.params)).y;
      this.hint.sprite.position.set(o.position.x, o.position.y + hy + 0.035, o.position.z);
    }
    this.hint.update(delta);

    for (const [e, t] of this.live) {
      const o = e.object3D;
      if (!o) continue;
      t.rt.tick(now);
      const held = e.hasComponent(Held);
      const hy = halfExtents(readDeform(e, this.params)).y;

      if (held) this.senseTurn(e, t, o.quaternion);
      if (held && e.getValue(Tool, 'archetype') === 'lever') this.senseLever(e, t, o.quaternion);
      if (!held) this.sensePoke(e, t, o.position, hy);

      // Label above, timer ring around the base.
      t.label.sprite.position.set(o.position.x, o.position.y + hy + 0.035, o.position.z);
      const timer = t.rt.runningTimers[0];
      if (timer) {
        const p = t.rt.timerProgress(timer, now) ?? 0;
        const remaining = Math.max(0, t.rt.snapshot(now).timers[timer] ?? 0);
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        t.label.setPersistent(`${m}:${s.toString().padStart(2, '0')}`);
        if (Math.abs(p - t.ringProgress) > 0.004) {
          t.ringProgress = p;
          const r = Math.max(0.035, halfExtents(readDeform(e, this.params)).x + 0.012);
          t.ring.geometry.dispose();
          t.ring.geometry = new RingGeometry(r, r + 0.006, 48, 1, Math.PI / 2, Math.PI * 2 * (1 - p));
        }
        t.ring.visible = !held;
        t.ring.position.set(o.position.x, 0.0015, o.position.z);
      } else {
        t.label.setPersistent('');
        t.ring.visible = false;
      }
      t.label.update(delta);

      // Glow: lock-in flash decays; a breathing glow while a timer runs.
      t.lock = Math.max(0, t.lock - delta * 0.8);
      const breathe = timer ? 0.06 + 0.05 * Math.sin(this.time * 2.2) : 0;
      const mat = glowMaterial(e);
      if (mat) mat.userData.lockGlow = Math.max(t.lock, breathe);

      // Ease jar notes toward their sorted slots.
      if (t.itemGroup) {
        for (const c of t.itemGroup.children) {
          const target = c.userData.target as number[] | undefined;
          if (target) {
            c.position.x += (target[0] - c.position.x) * Math.min(1, delta * 8);
            c.position.y += (target[1] - c.position.y) * Math.min(1, delta * 8);
            c.position.z += (target[2] - c.position.z) * Math.min(1, delta * 8);
          }
        }
      }

      if (timer && this.time - t.lastSave > 1) this.save(e, t);
    }
  }

  /** Rotation about vertical while held accumulates a 0..270° turn. */
  private senseTurn(e: Entity, t: LiveTool, q: Quaternion): void {
    const yaw = yawOf(q, this.v);
    let d = yaw - t.yawPrev;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    t.yawPrev = yaw;
    // Clockwise (seen from above) raises the value, like a volume knob.
    const deg = (-d * 180) / Math.PI;
    if (Math.abs(deg) < 0.05) return;
    const next = Math.max(0, Math.min(DIAL_RANGE, t.angle + deg));
    if (next === t.angle) return;
    t.angle = next;
    this.fire(e, { type: 'turn', angle: t.angle, value: t.angle / DIAL_RANGE });
  }

  private senseLever(e: Entity, t: LiveTool, q: Quaternion): void {
    this.v.set(0, 1, 0).applyQuaternion(q);
    const tilt = Math.acos(Math.max(-1, Math.min(1, this.v.y)));
    if (!t.leverLatched && tilt > LEVER_MAX * 0.65) {
      t.leverLatched = true;
      sfx.detent();
      this.fire(e, { type: 'pull' });
    } else if (t.leverLatched && tilt < 0.15) {
      t.leverLatched = false;
    }
  }

  /** An open fingertip entering the tool from outside counts as a poke. */
  private sensePoke(e: Entity, t: LiveTool, pos: Vector3, hy: number): void {
    const r = Math.max(0.03, halfExtents(readDeform(e, this.params)).x) + 0.008;
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked || !h.isHand || h.pinching || h.pinchStrength > 0.6) {
        t.pokeInside[side] = false;
        continue;
      }
      this.v.copy(h.indexTip);
      desk.group!.worldToLocal(this.v);
      const inside =
        Math.hypot(this.v.x - pos.x, this.v.z - pos.z) < r &&
        this.v.y > pos.y - hy - 0.005 &&
        this.v.y < pos.y + hy + 0.01;
      if (inside && !t.pokeInside[side] && this.time - t.lastPoke > POKE_COOLDOWN) {
        t.lastPoke = this.time;
        sfx.tap();
        this.fire(e, { type: 'poke' });
      }
      t.pokeInside[side] = inside;
    }
  }
}

function yawOf(q: Quaternion, tmp: Vector3): number {
  tmp.set(0, 0, 1).applyQuaternion(q);
  if (Math.abs(tmp.y) > 0.95) tmp.set(1, 0, 0).applyQuaternion(q);
  return Math.atan2(tmp.x, tmp.z);
}
