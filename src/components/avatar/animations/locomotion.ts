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
    // STANDING (IDLE) — layered breathing + organic micro-sway
    // Primary breathing: 0.28 breath/sec ≈ natural 17 breaths/min
    const breathCycle = Math.sin(t * 1.8);
    const breathSlow  = Math.sin(t * 0.9);   // secondary slow layer
    const sway        = Math.cos(t * 0.55) * 0.012;  // weight-shift sway
    const microWobble = Math.sin(t * 1.1)  * 0.004;  // secondary spine wobble
    const hipBob      = Math.abs(breathCycle) * 0.003; // very subtle hip lift

    // Hips: gentle weight-shift + micro vertical bob from breathing
    fr(VRMHumanBoneName.Hips, 0, sway * 0.5, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips, 0, hipBob, 0, poseSmooth);

    // Spine: counter-rotates to balance hip sway — looks alive
    fr(VRMHumanBoneName.Spine,
      breathCycle * 0.012 + 0.02,   // slight forward lean as chest expands
      -sway * 0.4 + microWobble,    // counter hip + micro wobble
      Math.cos(t * 0.65) * 0.003,   // side-to-side breath motion
      poseSmooth);

    // Chest: expands on inhale (X), rises slightly (Y offset done via spring bones)
    fr(VRMHumanBoneName.Chest,
      breathCycle * 0.015,
      0,
      Math.sin(t * 0.4) * 0.002,
      poseSmooth);

    // Upper chest: broadens slightly on inhale
    fr(VRMHumanBoneName.UpperChest,
      breathCycle * 0.010,
      0,
      0,
      poseSmooth);

    // Shoulders: rise and fall with breath naturally
    const shoulderRise = (breathCycle + 1) * 0.008; // 0 to 0.016 rad
    fr(VRMHumanBoneName.LeftShoulder,  0, 0, -shoulderRise, poseSmooth);
    fr(VRMHumanBoneName.RightShoulder, 0, 0,  shoulderRise, poseSmooth);

    // Head: gentle natural look-around drift (not locked forward)
    const headLookX = Math.sin(t * 0.42) * 0.035 + Math.sin(t * 0.27) * 0.015;
    const headLookY = Math.cos(t * 0.38) * 0.055 + Math.cos(t * 0.19) * 0.020;
    // Counters spine sway so eyes appear more horizontally stable
    fr(VRMHumanBoneName.Neck, breathCycle * -0.005, -sway * 0.2, 0, poseSmooth * 0.7);
    fr(VRMHumanBoneName.Head, headLookX, headLookY, breathSlow * 0.006, poseSmooth * 0.7);

    // Legs: very slight natural micro-bend (prevents locked-knee look)
    fr(VRMHumanBoneName.LeftUpperLeg,  0.05, 0,  0.05, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, 0.05, 0, -0.05, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  -0.02, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -0.02, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0.015, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.015, 0, 0, poseSmooth);
  }
}
