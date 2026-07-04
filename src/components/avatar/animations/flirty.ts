import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';

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

    fr(VRMHumanBoneName.RightUpperArm,  stretchPhase * 0.4 - 0.2, 0.2, -1.8, 0.15);
    fr(VRMHumanBoneName.RightLowerArm,  0, 2.5, 0, 0.15);
    fr(VRMHumanBoneName.RightHand,      0, 0, stretchPhase * 0.3, 0.15);

    fr(VRMHumanBoneName.LeftUpperArm,   stretchPhase * 0.4 - 0.2, -0.2, 1.8, 0.15);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -2.5, 0, 0.15);
    fr(VRMHumanBoneName.LeftHand,       0, 0, stretchPhase * 0.3, 0.15);

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

  fr(VRMHumanBoneName.RightUpperArm,  Math.sin(t * 0.7) * 0.02, 0, -1.3, SMOOTHING * 0.4);
  fr(VRMHumanBoneName.LeftUpperArm,   Math.sin(t * 0.7 + 0.5) * 0.02, 0, 1.3, SMOOTHING * 0.4);
}
