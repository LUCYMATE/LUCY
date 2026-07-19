import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';

export function applyVersatilePoses(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  pose: string,
  targetPos?: { x: number; y: number; z: number } | null
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);
  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.05;
  const breathing = Math.sin(t * 2.0) * 0.02;

  if (pose === 'lie-down') {
    // Laying on stomach with feet up
    fr(VRMHumanBoneName.Hips,         -1.5, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips,         0, -0.6, 0.4, poseSmooth);

    // Spine arches up slightly so head looks up
    fr(VRMHumanBoneName.Spine,        0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   breathing, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Neck,         0.2, 0, 0, poseSmooth);
    
    // Head looks slightly up and around
    fr(VRMHumanBoneName.Head,
      -0.2 + Math.sin(t * 1.5) * 0.05,
      Math.sin(t * 0.8) * 0.2,
      0, poseSmooth);

    // Legs kicked up behind
    fr(VRMHumanBoneName.LeftUpperLeg,   -0.2, 0.2, -0.1, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,   -1.8 + Math.sin(t * 2.5) * 0.2, 0, 0, poseSmooth); 
    fr(VRMHumanBoneName.LeftFoot,       0.2, 0, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperLeg,  -0.1, -0.2, 0.1, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg,  -1.5 + Math.cos(t * 2.2) * 0.15, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot,      0.2, 0, 0, poseSmooth);

    // Arms propped up
    fr(VRMHumanBoneName.LeftUpperArm,   1.2, 0.5, 1.0, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -1.5, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.5, 0, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  1.2, -0.5, -1.0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 1.5, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      -0.5, 0, 0, poseSmooth);
  }
  
  else if (pose === 'edge-lean') {
    // Leaning forward over the screen edge
    fr(VRMHumanBoneName.Hips,         0.4, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips,         0, -0.15 + breathing, 0, poseSmooth);

    fr(VRMHumanBoneName.Spine,        0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Neck,         -0.2, 0, 0, poseSmooth);
    
    fr(VRMHumanBoneName.Head,
      -0.5 + Math.sin(t * 1.2) * 0.05,
      Math.sin(t * 0.7) * 0.15,
      Math.cos(t * 0.9) * 0.05, poseSmooth);

    // Hands resting on the "screen edge"
    fr(VRMHumanBoneName.LeftUpperArm,   0.2, -0.3, 0.5, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.6, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.8, 0, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.2, 0.3, -0.5, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.6, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      -0.8, 0, 0, poseSmooth);
    
    // Legs wide for balance
    fr(VRMHumanBoneName.LeftUpperLeg,   -0.2, 0.2, -0.3, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,   0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg,  -0.2, -0.2, 0.3, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg,  0.3, 0, 0, poseSmooth);
  }

  else if (pose === 'point') {
    // Dynamic pointing
    fr(VRMHumanBoneName.Hips,         0.1, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips,         0, 0, 0, poseSmooth);
    
    fr(VRMHumanBoneName.Spine,        0.1, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0.1, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   breathing, 0, 0, poseSmooth);

    // Left arm resting
    fr(VRMHumanBoneName.LeftUpperArm,   0.1, -0.1, 1.2, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.2, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.2, 0, 0, poseSmooth);

    // Right arm pointing
    // Forward is -Z, Up is +Y, Right is -X (wait, VRM space: +X is Left, -X is Right, +Y is Up, +Z is Back)
    fr(VRMHumanBoneName.RightUpperArm,  -1.2, 0.3, -0.2, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.1, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      0, 0, -0.5, poseSmooth);

    // Extend index finger, curl others
    fr(VRMHumanBoneName.RightIndexProximal, 0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightIndexIntermediate, 0, 0, 0, poseSmooth);
    
    fr(VRMHumanBoneName.RightMiddleProximal, 0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightRingProximal, 0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightLittleProximal, 0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightThumbProximal, 0, -0.5, 0, poseSmooth);

    // Head looks toward the point direction
    fr(VRMHumanBoneName.Head, -0.1, 0.2, 0, poseSmooth);
  }
}
