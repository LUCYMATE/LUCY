import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';

export function applyLocomotion(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  isWalking: boolean,
  isSitting: boolean
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.05;

  if (isSitting && !isWalking) {
    // SITTING POSES
    const breath = Math.sin(t * 2.5) * 0.005;
    const sway = Math.cos(t * 1.2) * 0.01;

    fr(VRMHumanBoneName.Hips,         0.18, 0, 0, poseSmooth); 
    fr(VRMHumanBoneName.Spine,        0.05, sway, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        breath, 0, 0, poseSmooth);
    
    // Occasional head look around
    const headLookX = Math.sin(t * 0.7) * 0.03;
    const headLookY = Math.cos(t * 0.4) * 0.05;
    fr(VRMHumanBoneName.Head, headLookX, headLookY, 0, poseSmooth);
    
    fr(VRMHumanBoneName.LeftUpperLeg,  1.45, 0, 0.05,  poseSmooth); 
    fr(VRMHumanBoneName.RightUpperLeg, 1.45, 0, -0.05, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  -1.35, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -1.35, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0.45, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.45, 0, 0, poseSmooth);

    // Translate hips down so feet stay planted
    tr(VRMHumanBoneName.Hips, 0, -0.42 + breath, 0, poseSmooth); 

  } else if (isWalking) {
    // WALKING CYCLE
    const walkSpeed = 6.0;
    const wt = t * walkSpeed;
    
    // Hips bob up and down, and sway slightly
    const hipBob = Math.abs(Math.sin(wt)) * 0.03;
    const hipSway = Math.cos(wt) * 0.05;
    fr(VRMHumanBoneName.Hips, 0, hipSway, 0, 0.1);
    tr(VRMHumanBoneName.Hips, 0, hipBob, 0, 0.1); // return to normal height + bob
    
    // Spine counter-sway
    fr(VRMHumanBoneName.Spine, 0, -hipSway * 0.5, 0, 0.1);
    fr(VRMHumanBoneName.Head, 0, 0, 0, 0.1); // keep head straight while walking

    // Legs: reciprocal swinging
    const legSwing = 0.4;
    const lSwing = Math.sin(wt) * legSwing;
    const rSwing = Math.sin(wt + Math.PI) * legSwing;
    
    // Knee bending during forward swing
    const lKnee = Math.max(0, -Math.cos(wt)) * 0.5;
    const rKnee = Math.max(0, -Math.cos(wt + Math.PI)) * 0.5;

    fr(VRMHumanBoneName.LeftUpperLeg, lSwing, 0, 0, 0.2);
    fr(VRMHumanBoneName.LeftLowerLeg, -lKnee, 0, 0, 0.2);
    fr(VRMHumanBoneName.RightUpperLeg, rSwing, 0, 0, 0.2);
    fr(VRMHumanBoneName.RightLowerLeg, -rKnee, 0, 0, 0.2);
    
    // Keep feet relatively flat
    fr(VRMHumanBoneName.LeftFoot, lKnee * 0.5, 0, 0, 0.2);
    fr(VRMHumanBoneName.RightFoot, rKnee * 0.5, 0, 0, 0.2);

  } else {
    // STANDING (IDLE)
    const breath = Math.sin(t * 2.5) * 0.005;
    const sway = Math.cos(t * 1.2) * 0.015;

    fr(VRMHumanBoneName.Hips,         0, 0, 0, poseSmooth); 
    fr(VRMHumanBoneName.Spine,        0, sway, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        breath, 0, 0, poseSmooth);

    // Occasional head look around
    const headLookX = Math.sin(t * 0.7) * 0.03;
    const headLookY = Math.cos(t * 0.4) * 0.05;
    fr(VRMHumanBoneName.Head, headLookX, headLookY, 0, poseSmooth);

    fr(VRMHumanBoneName.LeftUpperLeg,  0.05, 0, 0.05,  poseSmooth); 
    fr(VRMHumanBoneName.RightUpperLeg, 0.05, 0, -0.05, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, 0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0, 0, 0, poseSmooth);

    // Reset hip translation with breathing bob
    tr(VRMHumanBoneName.Hips, 0, breath, 0, poseSmooth);
  }
}
