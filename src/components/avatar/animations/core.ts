import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

export interface BoneRest {
  [boneName: string]: {
    quaternion: THREE.Quaternion;
    position: THREE.Vector3;
  };
}

// Built-in poses; string & {} allows any additional custom animation slug.
export type BasePose = 'sit' | 'stand' | 'peek-left' | 'peek-right' | 'stretch' | 'lean' | 'flying-kiss' | 'caress' | 'dance' | 'dancing' | 'sleep' | 'lie-down' | 'edge-lean' | 'point' | (string & {});
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'flirty';


// The global smoothing factor
export const SMOOTHING = 0.07;

// Static reusable objects to prevent per-frame garbage collection.
// These are allocated ONCE at module load time and reused forever.
const _euler   = new THREE.Euler(0, 0, 0, 'XYZ');
const _delta   = new THREE.Quaternion();
const _target  = new THREE.Quaternion();
const _posTarget = new THREE.Vector3();

/**
 * Slerp a bone's rotation toward a target that is: rest * delta(dx,dy,dz)
 */
export function slerpFromRest(
  bone: THREE.Object3D | null | undefined,
  restQ: THREE.Quaternion | undefined,
  dx: number,
  dy: number,
  dz: number,
  alpha: number
) {
  if (!bone || !restQ) return;
  _euler.set(dx, dy, dz);
  _delta.setFromEuler(_euler);
  _target.copy(restQ).multiply(_delta);
  bone.quaternion.slerp(_target, alpha);
}

/**
 * Lerp a bone's position toward a target that is: rest + delta(dx,dy,dz)
 */
export function translateFromRest(
  bone: THREE.Object3D | null | undefined,
  restP: THREE.Vector3 | undefined,
  dx: number,
  dy: number,
  dz: number,
  alpha: number
) {
  if (!bone || !restP) return;
  _posTarget.set(restP.x + dx, restP.y + dy, restP.z + dz);
  bone.position.lerp(_posTarget, alpha);
}

export const BONE_LIST: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  VRMHumanBoneName.LeftThumbMetacarpal, VRMHumanBoneName.LeftThumbProximal, VRMHumanBoneName.LeftThumbDistal,
  VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.LeftIndexDistal,
  VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.LeftMiddleDistal,
  VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.LeftRingDistal,
  VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.LeftLittleDistal,
  VRMHumanBoneName.RightThumbMetacarpal, VRMHumanBoneName.RightThumbProximal, VRMHumanBoneName.RightThumbDistal,
  VRMHumanBoneName.RightIndexProximal, VRMHumanBoneName.RightIndexIntermediate, VRMHumanBoneName.RightIndexDistal,
  VRMHumanBoneName.RightMiddleProximal, VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal,
  VRMHumanBoneName.RightRingProximal, VRMHumanBoneName.RightRingIntermediate, VRMHumanBoneName.RightRingDistal,
  VRMHumanBoneName.RightLittleProximal, VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal,
];
