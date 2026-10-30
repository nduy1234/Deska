import { createSystem, Entity, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { createClayMesh, readDeform, writeDeform } from '../core/clay.js';
import { Clay, Note, Tool, TraySlot } from '../core/components.js';
import { desk } from '../core/desk.js';
import { deskEvents } from '../core/events.js';
import { createNoteMesh, NOTE_THICKNESS } from '../core/notes.js';
import { behaviorFor } from '../blocks/templates.js';
import { dimRoom, roomLevel } from '../feedback/room.js';
import { halfExtents, type DeformParams, type Primitive } from '../sculpt/deform.js';
import type { Archetype } from '../sculpt/recognizer.js';
import { loadBehavior, spawnTool } from '../tools/tools.js';
import { clearAll, loadRaw, saveRaw } from './db.js';
import {
  parseSnapshot,
  unlockedPrimitives,
  visit,
  type SavedObject,
} from './model.js';
import { deskState, markDirty, today } from './state.js';

const AUTOSAVE_DEBOUNCE = 1.5;
const AUTOSAVE_INTERVAL = 10;

/**
 * Saves the desk to IndexedDB and restores it on load. Saves are debounced
 * after any desk change, periodic (timers), and immediate when the page is
 * hidden or the XR session ends, so pause/resume never loses work.
 */
export class PersistSystem extends createSystem({
  clay: { required: [Clay], excluded: [TraySlot] },
  notes: { required: [Note] },
}) {
  private sinceChange = 0;
  private sinceSave = 0;
  private saving = false;
  private params: DeformParams = { sx: 1, sy: 1, sz: 1, waist: 0, twist: 0, taper: 0 };
  private v = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      deskEvents.on((e) => {
        if (e.type !== 'grab') {
          markDirty();
          this.sinceChange = 0;
        }
      }),
    );
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void this.saveNow();
    };
    const onPageHide = () => void this.saveNow();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    this.cleanupFuncs.push(
      () => document.removeEventListener('visibilitychange', onHidden),
      () => window.removeEventListener('pagehide', onPageHide),
    );
    let wasImmersive = false;
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        if (s === VisibilityState.NonImmersive && wasImmersive) void this.saveNow();
        if (s === VisibilityState.VisibleBlurred || s === VisibilityState.Hidden) void this.saveNow();
        wasImmersive = s !== VisibilityState.NonImmersive;
      }),
    );
    void this.load();
  }

  private async load(): Promise<void> {
    if (new URLSearchParams(location.search).has('reset')) await clearAll();
    const raw = await loadRaw();
    const prev = parseSnapshot(raw);
    const firstEver = prev.lastDay === '';
    const r = visit(prev, today());
    deskState.snapshot = r.snapshot;
    deskState.newDay = r.newDay;

    desk.setTray(unlockedPrimitives(r.snapshot));
    for (const o of r.snapshot.objects) {
      try {
        this.restore(o);
      } catch (err) {
        console.warn('[deska] skipped saved object', o.uid, err);
      }
    }
    if (firstEver) this.starterDesk();
    dimRoom(r.snapshot.roomLevel ?? 0);
    deskState.loaded = true;
    // Cold-start budget is 5 s to a usable desk; logged for the perf check.
    const ms = Math.round(performance.now());
    (window as unknown as { __deskaReadyMs?: number }).__deskaReadyMs = ms;
    console.info(`[deska] desk ready in ${ms} ms`);
    await this.saveNow();
  }

  /** First ever visit: two ready-made tools; the hourglass is yours to sculpt. */
  private starterDesk(): void {
    spawnTool(this.world, 'jar', behaviorFor('jar', 1), new Vector3(-0.28, 0, 0.1));
    spawnTool(this.world, 'lever', behaviorFor('lever', 1), new Vector3(0.24, 0, -0.04));
  }

  private restore(o: SavedObject): void {
    const pos = new Vector3().fromArray(o.position);
    const quat = new Quaternion().fromArray(o.quaternion);
    let e: Entity;
    if (o.kind === 'note') {
      const mesh = createNoteMesh(o.priority ?? 1);
      e = this.world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
      e.addComponent(Note, { uid: o.uid, priority: o.priority ?? 1 });
      pos.y = NOTE_THICKNESS / 2 + 0.0005;
    } else if (o.tool) {
      const archetype = o.tool.archetype as Archetype;
      e = spawnTool(this.world, archetype, loadBehavior(o.tool.behavior, archetype), pos, {
        uid: o.uid,
        deform: o.deform,
        state: o.tool.state,
        items: o.tool.items,
      });
      e.setValue(Tool, 'level', o.tool.level ?? 1);
    } else {
      const primitive = (o.primitive ?? 'cube') as Primitive;
      const mesh = createClayMesh(primitive);
      e = this.world.createTransformEntity(mesh, { parent: desk.root!, persistent: true });
      e.addComponent(Clay, { primitive, uid: o.uid });
      if (o.deform) writeDeform(e, o.deform);
    }
    // Anything saved mid-air (held when the page closed) comes back resting.
    const obj = e.object3D!;
    if (o.kind === 'clay') {
      const rest = halfExtents(readDeform(e, this.params)).y + 0.0005;
      if (Math.abs(pos.y - rest) > 0.01) {
        pos.y = rest;
        this.v.set(0, 0, 1).applyQuaternion(quat);
        quat.setFromAxisAngle(this.v.set(0, 1, 0), Math.atan2(this.v.x, this.v.z));
      }
    }
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
  }

  private collect(): SavedObject[] {
    const out: SavedObject[] = [];
    for (const e of this.queries.clay.entities) {
      const o = e.object3D;
      if (!o) continue;
      const saved: SavedObject = {
        uid: e.getValue(Clay, 'uid') ?? '',
        kind: 'clay',
        primitive: (e.getValue(Clay, 'primitive') ?? 'cube') as Primitive,
        deform: { ...readDeform(e, this.params) },
        position: [o.position.x, o.position.y, o.position.z],
        quaternion: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
      };
      if (e.hasComponent(Tool)) {
        saved.tool = {
          archetype: e.getValue(Tool, 'archetype') ?? 'block',
          behavior: e.getValue(Tool, 'behavior') ?? '',
          state: e.getValue(Tool, 'state') ?? '',
          items: e.getValue(Tool, 'items') ?? '',
          level: e.getValue(Tool, 'level') ?? 1,
        };
      }
      out.push(saved);
    }
    for (const e of this.queries.notes.entities) {
      const o = e.object3D;
      if (!o) continue;
      out.push({
        uid: e.getValue(Note, 'uid') ?? '',
        kind: 'note',
        priority: e.getValue(Note, 'priority') ?? 1,
        position: [o.position.x, o.position.y, o.position.z],
        quaternion: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
      });
    }
    return out;
  }

  async saveNow(): Promise<void> {
    if (!deskState.loaded || this.saving) return;
    this.saving = true;
    try {
      const s = deskState.snapshot;
      s.objects = this.collect();
      s.roomLevel = roomLevel();
      deskState.dirty = false;
      this.sinceSave = 0;
      await saveRaw(JSON.parse(JSON.stringify(s)));
    } finally {
      this.saving = false;
    }
  }

  update(delta: number): void {
    if (!deskState.loaded) return;
    this.sinceChange += delta;
    this.sinceSave += delta;
    if (
      (deskState.dirty && this.sinceChange > AUTOSAVE_DEBOUNCE) ||
      this.sinceSave > AUTOSAVE_INTERVAL
    ) {
      void this.saveNow();
    }
  }
}
