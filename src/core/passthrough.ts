import { createSystem, Entity, Vector3, VisibilityState, XRPlane } from '@iwsdk/core';
import { desk } from './desk.js';

/**
 * Stretch: mixed-reality mode. When the session is passthrough (immersive-ar),
 * hide the virtual room and snap the desk top to a detected real table plane
 * at seated height in front of you. Without plane detection the desk keeps
 * its seated anchor and palms-up recenter still works.
 *
 * Not yet verified in the emulator or on device.
 */
export class PassthroughSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private ar = false;
  private snapped = false;
  private head = new Vector3();
  private p = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        const blend = this.world.session?.environmentBlendMode;
        const ar = s !== VisibilityState.NonImmersive && !!blend && blend !== 'opaque';
        if (ar !== this.ar) this.setAR(ar);
      }),
    );
    this.queries.planes.subscribe('qualify', (e) => this.tryPlane(e));
  }

  private setAR(ar: boolean): void {
    this.ar = ar;
    this.snapped = false;
    const room = this.world.getSceneObject('room');
    if (room) room.visible = !ar;
    if (ar) this.scene.background = null;
    for (const e of this.queries.planes.entities) this.tryPlane(e);
  }

  /** A horizontal plane 0.5–1.0 m high within reach of the head is a table. */
  private tryPlane(e: Entity): void {
    if (!this.ar || this.snapped || !desk.group) return;
    const plane = e.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
    if (plane?.orientation !== 'horizontal' || !e.object3D) return;
    e.object3D.getWorldPosition(this.p);
    this.camera.getWorldPosition(this.head);
    const horiz = Math.hypot(this.p.x - this.head.x, this.p.z - this.head.z);
    if (this.p.y < 0.5 || this.p.y > 1.0 || horiz > 0.9) return;
    desk.group.position.y = this.p.y + 0.002;
    // The real table is the desk now: hide the virtual top and legs.
    for (const c of desk.group.children) {
      if (c.type === 'Mesh' && c.name === '') c.visible = false;
    }
    this.snapped = true;
  }
}
