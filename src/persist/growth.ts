import {
  BoxGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { behaviorFor, DEFAULT_BEHAVIORS } from '../blocks/templates.js';
import { Tool } from '../core/components.js';
import { desk } from '../core/desk.js';
import { hands, SIDES } from '../core/hands.js';
import { Label } from '../feedback/label.js';
import { sfx, unlockAudio } from '../feedback/sfx.js';
import type { Archetype } from '../sculpt/recognizer.js';
import { openGift, toolLevel, unlockedPrimitives, type GrowthItem } from './model.js';
import { deskState, markDirty } from './state.js';

/** Candidate gift spots; the one farthest from existing objects wins. */
const GIFT_SPOTS = [new Vector3(0.12, 0, 0.1), new Vector3(-0.12, 0, 0.13), new Vector3(0.02, 0, 0.16), new Vector3(0.16, 0, -0.04)];
const GIFT_POS = new Vector3();
const PLANT_POS = new Vector3(0.37, 0, -0.17);
const MAX_LEAVES = 14;

/**
 * "Desk grows": a streak plant that gains a leaf every consecutive day, and
 * a small gift box on each new day that you pinch open to unlock a new clay
 * primitive or a tool upgrade. Physical, no panels.
 */
export class GrowthSystem extends createSystem({
  tools: { required: [Tool] },
}) {
  private plant!: Group;
  private leaves: Mesh[] = [];
  private plantLabel!: Label;
  private gift: Group | null = null;
  private giftLabel!: Label;
  private opening = -1;
  private time = 0;
  private shownLeaves = 0;
  private started = false;
  private v = new Vector3();

  init(): void {
    this.plant = this.buildPlant();
    this.plant.position.copy(PLANT_POS);
    desk.group!.add(this.plant);
    this.plantLabel = new Label(0.12);
    this.plantLabel.sprite.position.set(PLANT_POS.x, 0.17, PLANT_POS.z);
    desk.group!.add(this.plantLabel.sprite);
    this.giftLabel = new Label(0.13);
    desk.group!.add(this.giftLabel.sprite);
  }

  private buildPlant(): Group {
    const g = new Group();
    const pot = new Mesh(
      new CylinderGeometry(0.03, 0.024, 0.05, 20),
      new MeshStandardMaterial({ color: '#c97e5a', roughness: 0.85 }),
    );
    pot.position.y = 0.025;
    g.add(pot);
    const soil = new Mesh(
      new CylinderGeometry(0.027, 0.027, 0.004, 20),
      new MeshStandardMaterial({ color: '#6b4a35', roughness: 1 }),
    );
    soil.position.y = 0.049;
    g.add(soil);
    const stem = new Mesh(
      new CylinderGeometry(0.003, 0.004, 0.11, 6),
      new MeshStandardMaterial({ color: '#6f9a5c', roughness: 0.9 }),
    );
    stem.position.y = 0.05 + 0.055;
    stem.name = 'stem';
    g.add(stem);
    const leafGeo = new SphereGeometry(0.014, 10, 6);
    leafGeo.scale(1.6, 0.35, 0.9);
    leafGeo.translate(0.018, 0, 0);
    const leafMat = new MeshStandardMaterial({ color: '#86b86f', roughness: 0.8 });
    for (let i = 0; i < MAX_LEAVES; i++) {
      const leaf = new Mesh(leafGeo, leafMat);
      leaf.position.y = 0.058 + i * 0.0075;
      leaf.rotation.y = i * 2.4;
      leaf.rotation.z = 0.35;
      leaf.scale.setScalar(0);
      g.add(leaf);
      this.leaves.push(leaf);
    }
    return g;
  }

  private buildGift(): Group {
    const g = new Group();
    const box = new Mesh(
      new BoxGeometry(0.06, 0.05, 0.06),
      new MeshStandardMaterial({
        color: '#f0d9b5',
        roughness: 0.8,
        emissive: new Color('#ffcc88'),
        emissiveIntensity: 0.15,
      }),
    );
    box.position.y = 0.025;
    g.add(box);
    const ribbonMat = new MeshStandardMaterial({ color: '#d9725f', roughness: 0.6 });
    const r1 = new Mesh(new BoxGeometry(0.062, 0.052, 0.012), ribbonMat);
    r1.position.y = 0.025;
    const r2 = new Mesh(new BoxGeometry(0.012, 0.052, 0.062), ribbonMat);
    r2.position.y = 0.025;
    const bow = new Mesh(new SphereGeometry(0.012, 10, 8), ribbonMat);
    bow.position.y = 0.054;
    bow.scale.set(1.4, 0.7, 1.4);
    g.add(r1, r2, bow);
    return g;
  }

  update(delta: number): void {
    this.time += delta;
    if (!deskState.loaded) return;
    const s = deskState.snapshot;

    if (!this.started) {
      this.started = true;
      // Old leaves appear at once; today's new leaf grows in.
      this.shownLeaves = Math.max(0, Math.min(MAX_LEAVES, s.streak - (deskState.newDay ? 1 : 0)));
      this.leaves.forEach((l, i) => l.scale.setScalar(i < this.shownLeaves ? 1 : 0));
      if (deskState.newDay && s.daysVisited > 1) {
        this.plantLabel.show(s.streak > 1 ? `${s.streak}-day streak` : 'Welcome back', 5);
        sfx.sparkle();
      }
    }

    // Grow leaves toward the streak.
    const target = Math.min(MAX_LEAVES, s.streak);
    this.leaves.forEach((l, i) => {
      const goal = i < target ? 1 : 0;
      if (l.scale.x !== goal) {
        const next = l.scale.x + (goal - l.scale.x) * Math.min(1, delta * 1.5);
        l.scale.setScalar(Math.abs(goal - next) < 0.01 ? goal : next);
      }
    });
    const stem = this.plant.getObjectByName('stem');
    if (stem) stem.scale.y = 0.4 + 0.6 * Math.min(1, target / MAX_LEAVES + 0.2);
    this.plantLabel.update(delta);

    // Gift box for today's growth.
    if (s.pendingGift && !this.gift && this.opening < 0) {
      this.gift = this.buildGift();
      GIFT_POS.copy(this.clearestSpot());
      this.gift.position.copy(GIFT_POS);
      desk.group!.add(this.gift);
      this.giftLabel.setPersistent('Your desk grew');
    }
    if (this.gift) {
      if (this.opening < 0) {
        this.gift.position.y = 0.004 + Math.abs(Math.sin(this.time * 2.2)) * 0.008;
        this.gift.rotation.y = Math.sin(this.time * 0.8) * 0.15;
        if (this.handTouchesGift()) this.open();
      } else {
        this.opening += delta;
        const k = Math.min(1, this.opening / 0.5);
        this.gift.scale.setScalar(1 + k * 0.4);
        this.gift.position.y = 0.02 + k * 0.05;
        this.gift.traverse((o) => {
          const m = (o as Mesh).material as MeshStandardMaterial | undefined;
          if (m) {
            m.transparent = true;
            m.opacity = 1 - k;
          }
        });
        if (k >= 1) {
          this.gift.removeFromParent();
          this.gift = null;
          this.giftLabel.setPersistent('');
          this.opening = -1;
        }
      }
      this.giftLabel.sprite.position.set(GIFT_POS.x, 0.1, GIFT_POS.z);
    }
    this.giftLabel.update(delta);
  }

  private clearestSpot(): Vector3 {
    let best = GIFT_SPOTS[0];
    let bestD = -1;
    for (const spot of GIFT_SPOTS) {
      let d = Infinity;
      for (const c of desk.group!.children) {
        if (!/^(clay|note)/.test(c.name) || c.position.z < -0.12) continue;
        d = Math.min(d, Math.hypot(c.position.x - spot.x, c.position.z - spot.z));
      }
      if (d > bestD) {
        bestD = d;
        best = spot;
      }
    }
    return best;
  }

  private handTouchesGift(): boolean {
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked) continue;
      const near = (p: Vector3) => {
        this.v.copy(p);
        desk.group!.worldToLocal(this.v);
        return Math.hypot(this.v.x - GIFT_POS.x, this.v.z - GIFT_POS.z) < 0.055 && this.v.y < 0.1;
      };
      if ((h.pinchStart && near(h.pinchPoint)) || (!h.pinching && near(h.indexTip))) return true;
    }
    return false;
  }

  private open(): void {
    unlockAudio();
    const item = openGift(deskState.snapshot);
    this.opening = 0;
    sfx.sparkle();
    if (!item) return;
    this.giftLabel.show(item.label, 5);
    this.apply(item);
    markDirty();
  }

  /** Apply an unlock: grow the tray, or upgrade matching tools in place. */
  private apply(item: GrowthItem): void {
    if (item.kind === 'primitive') {
      desk.setTray(unlockedPrimitives(deskState.snapshot));
      return;
    }
    const archetype = item.archetype as Archetype;
    const level = toolLevel(deskState.snapshot, archetype);
    const next = behaviorFor(archetype, level);
    const defaults = new Set([
      DEFAULT_BEHAVIORS[archetype].name,
      behaviorFor(archetype, level - 1).name,
    ]);
    for (const e of Array.from(this.queries.tools.entities)) {
      if (e.getValue(Tool, 'archetype') !== archetype) continue;
      let name = '';
      try {
        name = JSON.parse(e.getValue(Tool, 'behavior') ?? '{}').name ?? '';
      } catch {
        /* keep empty */
      }
      // Only upgrade tools still running a stock behavior, never custom ones.
      if (!defaults.has(name)) continue;
      const state = e.getValue(Tool, 'state') ?? '';
      const items = e.getValue(Tool, 'items') ?? '';
      e.removeComponent(Tool);
      e.addComponent(Tool, { archetype, behavior: JSON.stringify(next), level, state, items });
    }
  }
}
