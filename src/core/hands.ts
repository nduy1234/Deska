import { createSystem, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/**
 * Per-hand state derived from IWSDK's tracked hand joints and pinch select
 * state. Everything downstream (manipulation, sculpting, tool sensors,
 * recenter) reads this instead of touching XR input directly.
 *
 * Joint indices follow the WebXR hand joint order.
 */
const J_WRIST = 0;
const J_THUMB_TIP = 4;
const J_INDEX_TIP = 9;
const J_MIDDLE_META = 10;
const J_MIDDLE_TIP = 14;
const J_RING_TIP = 19;

export type Side = 'left' | 'right';

export interface HandState {
  side: Side;
  tracked: boolean;
  isHand: boolean;
  pinching: boolean;
  pinchStart: boolean;
  pinchEnd: boolean;
  /** 0..1, continuous thumb-index closure. */
  pinchStrength: number;
  /** 0 open hand .. 1 fist. */
  curl: number;
  pinchPoint: Vector3;
  indexTip: Vector3;
  palmCenter: Vector3;
  /** Center of the space the hand closes around (palm + fingertips). */
  graspPoint: Vector3;
  /** World-space unit vector out of the palm. */
  palmNormal: Vector3;
  /** Wrist orientation in world space. */
  rotation: Quaternion;
  /** Pinch point velocity, m/s. */
  velocity: Vector3;
}

function makeHand(side: Side): HandState {
  return {
    side,
    tracked: false,
    isHand: false,
    pinching: false,
    pinchStart: false,
    pinchEnd: false,
    pinchStrength: 0,
    curl: 0,
    pinchPoint: new Vector3(),
    indexTip: new Vector3(),
    palmCenter: new Vector3(),
    graspPoint: new Vector3(),
    palmNormal: new Vector3(0, 1, 0),
    rotation: new Quaternion(),
    velocity: new Vector3(),
  };
}

export const hands: Record<Side, HandState> = {
  left: makeHand('left'),
  right: makeHand('right'),
};

export const SIDES: readonly Side[] = ['left', 'right'];

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** Sign of the joint Y axis that points out of the palm (WebXR: +Y is dorsal). */
const PALM_AXIS_SIGN = -1;

export class HandSystem extends createSystem({}) {
  private jointMat = new Matrix4();
  private gripMat = new Matrix4();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private prevPinch = { left: new Vector3(), right: new Vector3() };

  update(delta: number): void {
    const xr = this.input.xr;
    for (const side of SIDES) {
      const h = hands[side];
      const select = xr.getSelectState(side);
      const source = xr.getPrimaryInputSource(side);
      const wasTracked = h.tracked;
      h.isHand = !!source?.hand;
      h.tracked = false;

      if (h.isHand) {
        const adapter = xr.visualAdapters.hand[side];
        const joints = adapter.jointTransforms;
        const grip = adapter.gripSpace;
        if (joints && grip && joints.length >= 25 * 16) {
          grip.updateWorldMatrix(true, false);
          this.gripMat.copy(grip.matrixWorld);
          this.joint(joints, J_THUMB_TIP, this.tmp);
          this.joint(joints, J_INDEX_TIP, h.indexTip);
          h.pinchPoint.copy(this.tmp).add(h.indexTip).multiplyScalar(0.5);

          // Palm: middle metacarpal, offset a little out of the palm.
          this.jointMat
            .fromArray(joints, J_MIDDLE_META * 16)
            .premultiply(this.gripMat);
          h.palmCenter.setFromMatrixPosition(this.jointMat);
          h.palmNormal
            .setFromMatrixColumn(this.jointMat, 1)
            .normalize()
            .multiplyScalar(PALM_AXIS_SIGN);
          this.jointMat.decompose(this.tmp2, h.rotation, this.tmp);

          // Grasp point: centroid of palm, thumb, index and middle tips.
          this.joint(joints, J_THUMB_TIP, this.tmp);
          h.graspPoint.copy(h.palmCenter).add(this.tmp).add(h.indexTip);
          h.graspPoint.add(this.joint(joints, J_MIDDLE_TIP, this.tmp2)).multiplyScalar(0.25);

          // Curl: fingertips pulled in toward the wrist.
          this.joint(joints, J_WRIST, this.tmp);
          let d = 0;
          d += this.tmp2.distanceTo(this.tmp);
          d += this.joint(joints, J_RING_TIP, this.tmp2).distanceTo(this.tmp);
          d /= 2;
          h.curl = Math.max(0, Math.min(1, (0.16 - d) / 0.075));
          h.pinchStrength = adapter.getPinchStrength();
          h.tracked = true;
        }
      } else if (source) {
        // Controllers are never required, but keep them usable for dev.
        const space = this.player.raySpaces[side];
        space.updateWorldMatrix(true, false);
        h.pinchPoint.setFromMatrixPosition(space.matrixWorld);
        h.indexTip.copy(h.pinchPoint);
        h.palmCenter.copy(h.pinchPoint);
        h.graspPoint.copy(h.pinchPoint);
        space.getWorldQuaternion(h.rotation);
        h.palmNormal.set(0, -1, 0).applyQuaternion(h.rotation);
        h.pinchStrength = select.active ? 1 : 0;
        h.curl = 0;
        h.tracked = true;
      }

      if (h.tracked && wasTracked && delta > 0) {
        h.velocity
          .copy(h.pinchPoint)
          .sub(this.prevPinch[side])
          .divideScalar(delta);
      } else {
        h.velocity.set(0, 0, 0);
      }
      this.prevPinch[side].copy(h.pinchPoint);

      const pinching = h.tracked && select.active;
      h.pinchStart = pinching && !h.pinching;
      h.pinchEnd = !pinching && h.pinching;
      h.pinching = pinching;
    }
  }

  private joint(joints: Float32Array, index: number, out: Vector3): Vector3 {
    this.jointMat.fromArray(joints, index * 16).premultiply(this.gripMat);
    return out.setFromMatrixPosition(this.jointMat);
  }
}
