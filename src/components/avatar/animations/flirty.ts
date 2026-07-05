import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';
import { useAvatarState } from '../../../lib/store/avatarState';

export function applyFlirty(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  pose: string,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);
  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.05;

  if (pose === 'sultry-sit') {
    const breath = Math.sin(t * 2.5) * 0.02;
    const sway = Math.cos(t * 1.2) * 0.04;

    fr(VRMHumanBoneName.Hips,         0.25, sway, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        0.08, sway * 0.5, 0.1, poseSmooth);
    fr(VRMHumanBoneName.Chest,        breath, 0, 0.15, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   breath * 0.5, 0, 0.08, poseSmooth);

    fr(VRMHumanBoneName.Head,
      Math.sin(t * 0.6) * 0.08,
      0.15 + Math.cos(t * 0.4) * 0.12,
      0, poseSmooth);
    fr(VRMHumanBoneName.Neck, 0, 0.08, 0.05, poseSmooth);

    fr(VRMHumanBoneName.LeftUpperLeg,  1.5, 0, -0.35, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, 1.2, 0, 0.35,  poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  -1.4, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -1.1, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0.5, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.3, 0, 0, poseSmooth);

    tr(VRMHumanBoneName.Hips, 0, -0.42 + breath, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.1, -0.3, -1.3, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.3, 0, SMOOTHING);
    fr(VRMHumanBoneName.RightHand,     -0.3, 0, 0, SMOOTHING);

    fr(VRMHumanBoneName.LeftUpperArm,   0.3, 0.6, 1.0, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.3, 0, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand,      -0.3, 0, 0, SMOOTHING);
  }

  else if (pose === 'stretch') {
    const stretchPhase = Math.sin(t * 2.0);
    const stretchEase = Math.abs(Math.sin(t * 1.5)) * 0.5 + 0.2;

    fr(VRMHumanBoneName.Hips,         0.05, Math.sin(t * 0.8) * 0.03, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        -0.15, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        -0.12, 0, 0, poseSmooth);

    tr(VRMHumanBoneName.Hips, 0, 0.05, 0, poseSmooth);

    // Z = +1.4 for RightArm goes UP (0 is T-pose, -1.25 is straight down)
    // Z = -1.4 for LeftArm goes UP (0 is T-pose, +1.25 is straight down)
    fr(VRMHumanBoneName.RightUpperArm,  -0.3, 0, 1.4, 0.15);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0, 0, 0.15);
    fr(VRMHumanBoneName.RightHand,      0, 0, stretchPhase * 0.2, 0.15);

    fr(VRMHumanBoneName.LeftUpperArm,   -0.3, 0, -1.4, 0.15);
    fr(VRMHumanBoneName.LeftLowerArm,   0, 0, 0, 0.15);
    fr(VRMHumanBoneName.LeftHand,       0, 0, stretchPhase * 0.2, 0.15);

    fr(VRMHumanBoneName.Head, -0.2 + stretchEase * 0.08, 0, 0, 0.1);
    fr(VRMHumanBoneName.Neck, -0.1, 0, 0, 0.1);

    const sigh = Math.sin(t * 8.0) * 0.01;
    fr(VRMHumanBoneName.UpperChest, sigh, 0, 0, 0.06);
  }

  else if (pose === 'lean') {
    fr(VRMHumanBoneName.Hips,         0.05, 0.1, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        -0.02, 0.2, 0.05, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0.02, 0.2, 0.05, poseSmooth);
    fr(VRMHumanBoneName.Neck,         0, 0.1, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 1.2) * 0.03,
      Math.sin(t * 0.8) * 0.3, // Look side to side
      0.02, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.2, -0.3, -1.0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.5, 0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.RightHand,     -0.3, 0, 0, SMOOTHING * 0.4);

    fr(VRMHumanBoneName.LeftUpperArm,   0.6, 0.8, 1.2, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -2.0, 0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.LeftHand,      -0.4, 0, 0, SMOOTHING * 0.4);
  }

  else if (pose === 'hip-cock') {
    const sway = Math.sin(t * 0.8) * 0.03;

    fr(VRMHumanBoneName.Hips,         0.1, 0.15 + sway, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        0.03, -0.08, 0.1, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0, 0.05, 0.08, poseSmooth);
    tr(VRMHumanBoneName.Hips,         0, -0.03 + sway * 0.5, 0, poseSmooth);

    fr(VRMHumanBoneName.Neck,         0.02, -0.05, 0.05, poseSmooth);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 0.5) * 0.03,
      -0.08,
      0.05, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.15, 0.1, -1.4, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.8, 0, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.RightHand,     -0.3, 0, 0, SMOOTHING * 0.5);

    fr(VRMHumanBoneName.LeftUpperArm,   0.1, -0.2, 1.3, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.5, 0, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftHand,       0, 0, 0, SMOOTHING * 0.5);
  }

  else if (pose === 'body-roll') {
    const roll = Math.sin(t * 1.5) * 0.2;
    fr(VRMHumanBoneName.Hips,         roll * 0.5, roll * 0.3, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        roll * 0.8, roll * 0.2, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        roll * 1.0, roll * 0.1, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   roll * 0.6, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Neck,         roll * 0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,         roll * 0.2, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips, 0, Math.sin(t * 1.5) * 0.03, 0, poseSmooth);

    fr(VRMHumanBoneName.LeftUpperLeg,  0.1, 0, -0.3 - roll * 0.15, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, 0.1, 0, 0.3 + roll * 0.15, poseSmooth);
  }

  else if (pose === 'spread-legs') {
    const rock = Math.sin(t * 1.2) * 0.03;
    fr(VRMHumanBoneName.Hips,         0.05 + rock, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        0.05, 0, 0.1, poseSmooth);
    fr(VRMHumanBoneName.Chest,        0.02, 0, 0.05, poseSmooth);

    fr(VRMHumanBoneName.Head,
      Math.sin(t * 0.6) * 0.06,
      -0.15 + Math.cos(t * 0.4) * 0.05,
      0, poseSmooth);
    fr(VRMHumanBoneName.Neck, 0, -0.08, 0, poseSmooth);

    fr(VRMHumanBoneName.LeftUpperLeg,  0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, 0, 0,  1.2, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, 0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0.1, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.1, 0, 0, poseSmooth);

    tr(VRMHumanBoneName.Hips, 0, -0.1 + rock * 0.5, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0, -0.3, -1.0, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.2, 0, SMOOTHING);
    fr(VRMHumanBoneName.RightHand,     -0.2, 0, 0, SMOOTHING);
    fr(VRMHumanBoneName.LeftUpperArm,   0, 0.3, 1.0, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.2, 0, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand,      -0.2, 0, 0, SMOOTHING);
  }

  else if (pose === 'arch') {
    const archPhase = Math.sin(t * 1.2) * 0.5 + 0.5;
    fr(VRMHumanBoneName.Hips,         -0.15, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        -0.2 * archPhase, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        -0.3 * archPhase, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   -0.15 * archPhase, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Neck,         0.08, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,         0.15 * archPhase, 0, 0, poseSmooth);

    tr(VRMHumanBoneName.Hips, 0, -0.08 * archPhase, 0, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  -0.3, 0, -1.5, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.5, 0, SMOOTHING);
    fr(VRMHumanBoneName.LeftUpperArm,   -0.3, 0, 1.5, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.5, 0, SMOOTHING);
  }

  else if (pose === 'caress') {
    const caressPhase = Math.sin(t * 2.0) * 0.5 + 0.5;

    fr(VRMHumanBoneName.RightUpperArm,  -0.2, -0.1, -0.8, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  0, 1.2, 0.3, SMOOTHING);
    fr(VRMHumanBoneName.RightHand,      caressPhase * 0.5, 0, caressPhase * 0.4, SMOOTHING);

    fr(VRMHumanBoneName.LeftUpperArm,   0.1, 0.8, 1.0, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -1.0, 0, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand,       caressPhase * 0.4, 0, -caressPhase * 0.4, SMOOTHING);

    fr(VRMHumanBoneName.Spine, 0, caressPhase * 0.06, 0, SMOOTHING);
    fr(VRMHumanBoneName.Chest, 0, caressPhase * 0.05, 0, SMOOTHING);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 1.5) * 0.06,
      -0.08,
      0.05, SMOOTHING);
  }

  else if (pose === 'squeeze') {
    const sq = Math.sin(t * 3.0) * 0.5 + 0.5;

    fr(VRMHumanBoneName.RightUpperArm,  0, 0, -0.8, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  0, 1.8, 0.5, SMOOTHING);
    fr(VRMHumanBoneName.RightHand,      sq * 0.6, 0, sq * 0.5, SMOOTHING);

    fr(VRMHumanBoneName.LeftUpperArm,   0, 0, 0.8, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -1.8, -0.5, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand,       sq * 0.6, 0, -sq * 0.5, SMOOTHING);

    fr(VRMHumanBoneName.UpperChest, 0, sq * 0.08, 0, SMOOTHING);
    fr(VRMHumanBoneName.Neck, 0.03, 0, 0, SMOOTHING);
    fr(VRMHumanBoneName.Head,
      -sq * 0.08,
      sq * 0.06,
      0, SMOOTHING);
  }

  else if (pose === 'fingerwarm') {
    const warm = Math.sin(t * 6.0) * 0.5 + 0.5;
    const rock = Math.sin(t * 1.5) * 0.01;

    fr(VRMHumanBoneName.Hips,         0.15 + rock, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        0.08, 0, 0.05, poseSmooth);
    fr(VRMHumanBoneName.Chest,        Math.sin(t * 2.0) * 0.015, 0, 0.03, poseSmooth);
    fr(VRMHumanBoneName.UpperChest,   Math.sin(t * 2.0) * 0.01, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Neck,         0.05, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 0.4) * 0.04,
      -0.1 + Math.cos(t * 0.3) * 0.06,
      0, poseSmooth);

    // Sitting legs — spread slightly
    fr(VRMHumanBoneName.LeftUpperLeg,  1.3, 0, -0.25, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, 1.3, 0, 0.25,  poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,  -1.2, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -1.2, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,  0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.3, 0, 0, poseSmooth);

    tr(VRMHumanBoneName.Hips, 0, -0.4 + rock, 0, poseSmooth);

    // Right hand between legs, waving
    fr(VRMHumanBoneName.RightUpperArm,  0.6, 0.2, -1.0, 0.06);
    fr(VRMHumanBoneName.RightLowerArm,  0, 1.6, 0.3, 0.06);
    fr(VRMHumanBoneName.RightHand,      Math.sin(t * 8.0) * 0.35, Math.sin(t * 4.0) * 0.1, 0, 0.08);

    // Left arm resting on side
    fr(VRMHumanBoneName.LeftUpperArm,   0.3, -0.3, 1.2, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.5, 0, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftHand,       -0.1, 0, 0, SMOOTHING * 0.5);
  }
  else if (pose === 'flying-kiss') {
    const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
    const localTime = (Date.now() - lastOverride) / 1000.0;
    
    // Detailed Timeline for a realistic flying kiss:
    // 0.0 - 0.8s: Hand comes to mouth, palm faces inward, body bows forward
    // 0.8 - 1.2s: Hold at mouth, lips pucker
    // 1.2 - 1.6s: Hand extends outward, palm turns up/out, body straightens
    // 1.6 - 2.0s: Hold extension
    // 2.0 - 2.8s: Lower hand back to resting position

    // Phasing helpers (0 to 1)
    const phaseToMouth = Math.min(1.0, localTime / 0.8);
    const phaseExtend = localTime > 1.2 ? Math.min(1.0, (localTime - 1.2) / 0.4) : 0;
    const phaseDrop = localTime > 2.0 ? Math.min(1.0, (localTime - 2.0) / 0.8) : 0;

    // Body bow (leans forward into the kiss, then back up)
    const bow = (Math.sin(phaseToMouth * Math.PI * 0.5) * (1 - phaseDrop)) * 0.15;
    fr(VRMHumanBoneName.Hips,         bow * 0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        bow * 0.4, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        bow * 0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,         bow * 0.2, 0.1, 0.05, 0.06);

    // Right Arm Kinematics
    // Rest -> Mouth -> Extend -> Rest
    
    // Idle/Resting values
    const rUpperIdle = { dx: 0.1, dy: 0, dz: -1.2 };
    const rLowerIdle = { dx: 0, dy: 0, dz: 0 };
    const rHandIdle = { dx: 0, dy: 0, dz: 0 };

    // At mouth values
    const rUpperMouth = { dx: 0.2, dy: -0.2, dz: -1.2 };
    const rLowerMouth = { dx: 0, dy: 2.2, dz: 0.3 };
    const rHandMouth = { dx: 0.5, dy: 0, dz: 0 }; // bend wrist inward

    // Extended outward values
    const rUpperExtend = { dx: -0.3, dy: 0.2, dz: -1.0 };
    const rLowerExtend = { dx: 0, dy: 0.4, dz: 0 };
    const rHandExtend = { dx: -0.2, dy: 0, dz: 0.2 }; // palm up

    let currUpper = { ...rUpperIdle };
    let currLower = { ...rLowerIdle };
    let currHand = { ...rHandIdle };

    if (localTime <= 1.2) {
      // Interpolate from Rest to Mouth
      const tM = Math.sin(phaseToMouth * Math.PI * 0.5); // ease out
      currUpper = { dx: rUpperIdle.dx + (rUpperMouth.dx - rUpperIdle.dx) * tM, dy: rUpperIdle.dy + (rUpperMouth.dy - rUpperIdle.dy) * tM, dz: rUpperIdle.dz + (rUpperMouth.dz - rUpperIdle.dz) * tM };
      currLower = { dx: rLowerIdle.dx + (rLowerMouth.dx - rLowerIdle.dx) * tM, dy: rLowerIdle.dy + (rLowerMouth.dy - rLowerIdle.dy) * tM, dz: rLowerIdle.dz + (rLowerMouth.dz - rLowerIdle.dz) * tM };
      currHand = { dx: rHandIdle.dx + (rHandMouth.dx - rHandIdle.dx) * tM, dy: rHandIdle.dy + (rHandMouth.dy - rHandIdle.dy) * tM, dz: rHandIdle.dz + (rHandMouth.dz - rHandIdle.dz) * tM };
    } else if (localTime <= 2.0) {
      // Interpolate from Mouth to Extend
      const tE = Math.sin(phaseExtend * Math.PI * 0.5);
      currUpper = { dx: rUpperMouth.dx + (rUpperExtend.dx - rUpperMouth.dx) * tE, dy: rUpperMouth.dy + (rUpperExtend.dy - rUpperMouth.dy) * tE, dz: rUpperMouth.dz + (rUpperExtend.dz - rUpperMouth.dz) * tE };
      currLower = { dx: rLowerMouth.dx + (rLowerExtend.dx - rLowerMouth.dx) * tE, dy: rLowerMouth.dy + (rLowerExtend.dy - rLowerMouth.dy) * tE, dz: rLowerMouth.dz + (rLowerExtend.dz - rLowerMouth.dz) * tE };
      currHand = { dx: rHandMouth.dx + (rHandExtend.dx - rHandMouth.dx) * tE, dy: rHandMouth.dy + (rHandExtend.dy - rHandMouth.dy) * tE, dz: rHandMouth.dz + (rHandExtend.dz - rHandMouth.dz) * tE };
    } else {
      // Interpolate from Extend back to Rest
      const tD = Math.sin(phaseDrop * Math.PI * 0.5);
      currUpper = { dx: rUpperExtend.dx + (rUpperIdle.dx - rUpperExtend.dx) * tD, dy: rUpperExtend.dy + (rUpperIdle.dy - rUpperExtend.dy) * tD, dz: rUpperExtend.dz + (rUpperIdle.dz - rUpperExtend.dz) * tD };
      currLower = { dx: rLowerExtend.dx + (rLowerIdle.dx - rLowerExtend.dx) * tD, dy: rLowerExtend.dy + (rLowerIdle.dy - rLowerExtend.dy) * tD, dz: rLowerExtend.dz + (rLowerIdle.dz - rLowerExtend.dz) * tD };
      currHand = { dx: rHandExtend.dx + (rHandIdle.dx - rHandExtend.dx) * tD, dy: rHandExtend.dy + (rHandIdle.dy - rHandExtend.dy) * tD, dz: rHandExtend.dz + (rHandIdle.dz - rHandExtend.dz) * tD };
    }

    fr(VRMHumanBoneName.RightUpperArm,  currUpper.dx, currUpper.dy, currUpper.dz, 0.15);
    fr(VRMHumanBoneName.RightLowerArm,  currLower.dx, currLower.dy, currLower.dz, 0.15);
    fr(VRMHumanBoneName.RightHand,      currHand.dx, currHand.dy, currHand.dz, 0.15);
    
    // Left arm resting on side
    fr(VRMHumanBoneName.LeftUpperArm,   0.3, -0.3, 1.2, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.5, 0, SMOOTHING * 0.5);

    // Expressions: Pucker lips during the hold at mouth (0.8 - 1.2)
    if (vrm.expressionManager) {
      const pucker = (localTime > 0.6 && localTime < 1.4) ? 1.0 : (localTime >= 1.4 ? Math.max(0, 1.0 - (localTime - 1.4)*3) : localTime * 1.5);
      const openMouth = phaseExtend * (1 - phaseDrop);
      
      vrm.expressionManager.setValue('aa', openMouth * 0.5);
      vrm.expressionManager.setValue('ih', pucker * 0.7);
      vrm.expressionManager.setValue('ou', pucker * 1.0);
    }
  }
}

export function applyKissGesture(
  vrm: VRM,
  rest: BoneRest,
  t: number,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  if (vrm.expressionManager) {
    const kissPhase = Math.sin(t * 8.0) * 0.5 + 0.5;
    vrm.expressionManager.setValue('aa', kissPhase * 0.4);
    vrm.expressionManager.setValue('ih', kissPhase * 0.6);
    vrm.expressionManager.setValue('ou', kissPhase * 0.8);
  }

  fr(VRMHumanBoneName.RightUpperArm,  0.2, 0, -1.2, 0.06);
  fr(VRMHumanBoneName.RightLowerArm,  0, 2.0, 0, 0.06);
  fr(VRMHumanBoneName.RightHand,      Math.sin(t * 8.0) * 0.3, 0, 0, 0.08);
  fr(VRMHumanBoneName.Head,           0.05, 0, 0, 0.06);
}

export function applyHairFlipGesture(
  vrm: VRM,
  rest: BoneRest,
  t: number,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  const flipPhase = Math.sin(t * 6.0) * 0.5 + 0.5;

  fr(VRMHumanBoneName.RightUpperArm,  -0.3, 0.4, -1.5, 0.08);
  fr(VRMHumanBoneName.RightLowerArm,  0, 2.8, 0, 0.08);
  fr(VRMHumanBoneName.RightHand,      flipPhase * 0.5, 0, 0, 0.08);

  fr(VRMHumanBoneName.Head,
    -0.1 * flipPhase,
    0.25 * flipPhase,
    0.08 * flipPhase, 0.06);
  fr(VRMHumanBoneName.Neck,
    0,
    0.12 * flipPhase,
    0.05 * flipPhase, 0.06);
  fr(VRMHumanBoneName.UpperChest,
    0,
    0.08 * flipPhase,
    0.05 * flipPhase, 0.06);
}

export function applyFlirtyIdleSway(
  vrm: VRM,
  rest: BoneRest,
  t: number,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  const hipSway = Math.sin(t * 0.6) * 0.06;
  const bodySway = Math.sin(t * 0.6 + Math.PI) * 0.03;

  fr(VRMHumanBoneName.Hips, 0, hipSway, 0, 0.03);
  fr(VRMHumanBoneName.Spine, 0, bodySway, 0, 0.03);
  fr(VRMHumanBoneName.Chest, 0, bodySway * 0.5, 0, 0.03);

  fr(VRMHumanBoneName.Head,
    Math.sin(t * 0.8) * 0.02 + Math.sin(t * 0.5) * 0.03,
    Math.cos(t * 0.5) * 0.04,
    0, 0.03);

  // Adjusted to be halfway between T-pose (0) and A-pose (1.45) -> ~0.8
  fr(VRMHumanBoneName.RightUpperArm,  Math.sin(t * 0.7) * 0.02, 0, -0.8, SMOOTHING * 0.4);
  fr(VRMHumanBoneName.LeftUpperArm,   Math.sin(t * 0.7 + 0.5) * 0.02, 0, 0.8, SMOOTHING * 0.4);
}
