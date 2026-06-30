import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

export interface BoneRest {
  [boneName: string]: {
    quaternion: THREE.Quaternion;
    position: THREE.Vector3;
  };
}

export type BasePose = 'sit' | 'stand' | 'peek-left' | 'peek-right';
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking';

// The global smoothing factor
export const SMOOTHING = 0.07;

/**
 * Slerp a bone's rotation toward a target that is: rest * delta(dx,dy,dz)
 */
export function slerpFromRest(
  bone: THREE.Object3D | null | undefined,
  restQ: THREE.Quaternion,
  dx: number,
  dy: number,
  dz: number,
  alpha: number
) {
  if (!bone) return;
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz, 'XYZ'));
  const target = restQ.clone().multiply(delta);
  bone.quaternion.slerp(target, alpha);
}

/**
 * Lerp a bone's position toward a target that is: rest + delta(dx,dy,dz)
 */
export function translateFromRest(
  bone: THREE.Object3D | null | undefined,
  restP: THREE.Vector3,
  dx: number,
  dy: number,
  dz: number,
  alpha: number
) {
  if (!bone) return;
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
  VRMHumanBoneName.LeftThumbProximal, VRMHumanBoneName.LeftThumbIntermediate, VRMHumanBoneName.LeftThumbDistal,
  VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.LeftIndexDistal,
  VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.LeftMiddleDistal,
  VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.LeftRingDistal,
  VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.LeftLittleDistal,
  VRMHumanBoneName.RightThumbProximal, VRMHumanBoneName.RightThumbIntermediate, VRMHumanBoneName.RightThumbDistal,
  VRMHumanBoneName.RightIndexProximal, VRMHumanBoneName.RightIndexIntermediate, VRMHumanBoneName.RightIndexDistal,
  VRMHumanBoneName.RightMiddleProximal, VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal,
  VRMHumanBoneName.RightRingProximal, VRMHumanBoneName.RightRingIntermediate, VRMHumanBoneName.RightRingDistal,
  VRMHumanBoneName.RightLittleProximal, VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal,
];
