import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

export interface BoneRest {
  [boneName: string]: {
    quaternion: THREE.Quaternion;
    position: THREE.Vector3;
  };
}

export type BasePose = 'sit' | 'stand' | 'peek-left' | 'peek-right' | 'sultry-sit' | 'stretch' | 'lean' | 'hip-cock' | 'body-roll' | 'spread-legs' | 'arch' | 'caress' | 'squeeze' | 'fingerwarm' | 'flying-kiss';
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'flirty';

// The global smoothing factor (higher = faster convergence to pose)
export const SMOOTHING = 0.12;

// Finger joint names for bending
export const FINGER_JOINTS = [
  'Proximal', 'Intermediate', 'Distal'
] as const;

export const FINGER_NAMES = [
  'Thumb', 'Index', 'Middle', 'Ring', 'Little'
] as const;

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
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz, 'XYZ'));
  const target = restQ.clone().multiply(delta);
  bone.quaternion.slerp(target, alpha);
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
  const target = new THREE.Vector3(restP.x + dx, restP.y + dy, restP.z + dz);
  bone.position.lerp(target, alpha);
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
