import {
  Color,
  ConeGeometry,
  createSystem,
  DoubleSide,
  Entity,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { Clay, Tool, TraySlot } from '../core/components.js';
import { DESK, desk } from '../core/desk.js';
import { deskEvents } from '../core/events.js';
import { Label } from '../feedback/label.js';
import { sfx } from '../feedback/sfx.js';
import { deskState, markDirty } from '../persist/state.js';

type Step = 'pull' | 'squeeze' | 'flip' | 'ask' | 'done';

/** Where the first cube should land: front center, in easy reach. */
const TARGET = new Vector3(0, 0, 0.08);

const HINT: Record<Step, string> = {
  pull: 'Pinch a cube · pull it here',
  squeeze: 'Close your hand · squeeze',
  flip: 'Flip it over',
  ask: 'Now ask Deska to make one',
  done: '',
};

/**
 * First five minutes: a 60 second guided flow with no text walls, just a
 * bobbing pointer, a target ring and a two-to-four word label per step.
 * pull a cube → squeeze it into an hourglass → flip it → timer starts →
 * "Now ask Deska to make one" over the orb. Every step advances on the real
 * physical event, so there is nothing to read or confirm.
 */
export class OnboardingSystem extends createSystem({
  slots: { required: [TraySlot] },
}) {
  private step: Step = 'done';
  private started = false;
  private pointer!: Mesh;
  private ring!: Mesh;
  private label!: Label;
  private subject: Entity | null = null;
  private time = 0;
  private stepTime = 0;
  private v = new Vector3();

  init(): void {
    this.pointer = new Mesh(
      new ConeGeometry(0.012, 0.03, 16),
      new MeshStandardMaterial({
        color: '#ffb35c',
        emissive: new Color('#ff9a3d'),
        emissiveIntensity: 0.8,
        roughness: 0.5,
      }),
    );
    this.pointer.rotation.x = Math.PI; // point down
    this.pointer.visible = false;
    this.ring = new Mesh(
      new RingGeometry(0.045, 0.052, 40),
      new MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.label = new Label(0.17);
    desk.group!.add(this.pointer, this.ring, this.label.sprite);

    this.cleanupFuncs.push(
      deskEvents.on((e) => {
        if (this.step === 'pull' && e.type === 'settled' && this.isPlainClay(e.entity)) {
          this.subject = e.entity;
          this.go('squeeze');
        } else if (this.step === 'squeeze' && e.type === 'archetype') {
          if (e.archetype === 'hourglass') {
            this.subject = e.entity;
            this.go('flip');
          } else {
            this.label.show('Nice · now a cube, squeezed', 3);
          }
        } else if (this.step === 'squeeze' && e.type === 'settled' && this.isPlainClay(e.entity)) {
          this.subject = e.entity; // they moved or swapped cubes: follow the newest
        } else if (this.step === 'flip' && e.type === 'settled' && e.entity === this.subject && e.flipped) {
          this.go('ask');
        } else if (this.step === 'ask' && e.type === 'spawned' && e.entity.hasComponent(Tool)) {
          this.go('done');
        }
      }),
    );
  }

  private isPlainClay(e: Entity): boolean {
    return e.hasComponent(Clay) && !e.hasComponent(Tool) && !e.hasComponent(TraySlot);
  }

  private go(step: Step): void {
    this.step = step;
    this.stepTime = 0;
    if (step !== 'pull') sfx.lock();
    if (step === 'ask' || step === 'done') {
      deskState.snapshot.onboardingDone = true;
      markDirty();
    }
    if (step === 'done') {
      this.label.show('That’s Deska. It grows every day.', 4);
      this.label.setPersistent('');
      this.pointer.visible = false;
      this.ring.visible = false;
      return;
    }
    this.label.setPersistent(HINT[step]);
  }

  /** Start (or replay with ?onboard) once the saved desk has loaded. */
  private maybeStart(): void {
    this.started = true;
    const replay = new URLSearchParams(location.search).has('onboard');
    if (deskState.snapshot.onboardingDone && !replay) return;
    this.go('pull');
  }

  update(delta: number): void {
    this.time += delta;
    this.stepTime += delta;
    if (!this.started) {
      if (deskState.loaded) this.maybeStart();
      return;
    }
    if (this.step === 'done') {
      this.label.update(delta);
      return;
    }

    // Where the pointer hovers for this step.
    let anchor: Vector3 | null = null;
    let ring: Vector3 | null = null;
    if (this.step === 'pull') {
      const cube = Array.from(this.queries.slots.entities).find(
        (e) => e.getValue(TraySlot, 'primitive') === 'cube',
      );
      anchor = cube?.object3D ? this.v.copy(cube.object3D.position) : this.v.set(-0.13, 0.03, DESK.tray.z);
      ring = TARGET;
    } else if (this.step === 'squeeze' || this.step === 'flip') {
      const o = this.subject?.active ? this.subject.object3D : null;
      if (o) anchor = this.v.copy(o.position);
    } else if (this.step === 'ask') {
      anchor = this.v.set(-0.36, 0.04, -0.17);
    }

    const bob = Math.sin(this.time * 3.2) * 0.008;
    if (anchor) {
      this.pointer.visible = true;
      this.pointer.position.set(anchor.x, anchor.y + 0.075 + bob, anchor.z);
      this.pointer.rotation.y += delta * 1.5;
      this.label.sprite.position.set(anchor.x, anchor.y + 0.13, anchor.z);
    } else {
      this.pointer.visible = false;
    }
    if (ring) {
      this.ring.visible = true;
      this.ring.position.set(ring.x, 0.002, ring.z);
      const s = 1 + 0.12 * Math.sin(this.time * 3);
      this.ring.scale.set(s, s, 1);
    } else {
      this.ring.visible = false;
    }

    // A flip step that takes long gets a nudge with the motion spelled out.
    if (this.step === 'flip' && this.stepTime > 12 && this.stepTime - delta <= 12) {
      this.label.show('Pinch · turn your wrist · let go', 4);
    }
    this.label.update(delta);
  }
}
