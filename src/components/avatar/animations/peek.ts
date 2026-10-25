import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';

export function applyPeek(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  isLeft: boolean
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.06;

  // Gentle organic breathing and curious micro-sway
  const breathe = Math.sin(t * 1.6) * 0.015;
  const curiousSway = Math.sin(t * 0.9) * 0.02;

  // Finger bend helper for gripping/touching the virtual edge
  const bendFingers = (prefix: 'Left' | 'Right') => {
    ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].forEach(finger => {
      ['Proximal', 'Intermediate', 'Distal'].forEach(joint => {
        const boneName = `${prefix}${finger}${joint}` as VRMHumanBoneName;
        if (finger === 'Thumb') {
          fr(boneName, 0, 0, prefix === 'Left' ? -0.25 : 0.25, poseSmooth);
        } else {
          if (joint === 'Proximal') {
            fr(boneName, 0, 0, prefix === 'Left' ? -0.85 : 0.85, poseSmooth);
          } else {
            fr(boneName, 0, 0, prefix === 'Left' ? -0.55 : 0.55, poseSmooth);
          }
        }
      });
    });
  };

  const rotSign = isLeft ? 1 : -1;  // 1 leans right (into screen from left), -1 leans left
  const trSign  = isLeft ? -1 : 1;  // Translation shift

  // ── 1. Hips & Spine Lean into the screen ──────────────────────────────────
  fr(VRMHumanBoneName.Hips,         0.02, 0, rotSign * 0.18 + curiousSway * 0.4, poseSmooth);
  fr(VRMHumanBoneName.Spine,        0.08, rotSign * -0.25, rotSign * 0.35 + curiousSway, poseSmooth);
  fr(VRMHumanBoneName.Chest,        0.02, rotSign * -0.08, rotSign * 0.12 + breathe, poseSmooth);

  // Subtle leg brace to ground the peek
  fr(VRMHumanBoneName.LeftUpperLeg,  0.08, 0, rotSign * -0.06, poseSmooth);
  fr(VRMHumanBoneName.RightUpperLeg, 0.08, 0, rotSign * 0.06, poseSmooth);

  // Slight horizontal shift to lean around the virtual wall
  tr(VRMHumanBoneName.Hips, trSign * 0.25 + curiousSway * 0.05, -0.02, 0, poseSmooth);

  // ── 2. Neck & Head: Curious, engaging gaze directly at user ───────────────
  fr(VRMHumanBoneName.Neck, 0.05, rotSign * 0.26, rotSign * -0.16 + breathe, poseSmooth);
  fr(
    VRMHumanBoneName.Head,
    0.08 + Math.sin(t * 1.8) * 0.025,
    rotSign * 0.36,
    rotSign * -0.22 + curiousSway * 0.5,
    poseSmooth
  );

  // ── 3. Arms & Hands: Natural peeking gesture holding the edge ─────────────
  const innerPrefix = isLeft ? 'Left' : 'Right';
  const outerPrefix = isLeft ? 'Right' : 'Left';

  const innerUpperArm = VRMHumanBoneName[`${innerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const innerLowerArm = VRMHumanBoneName[`${innerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const innerHand     = VRMHumanBoneName[`${innerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  const outerUpperArm = VRMHumanBoneName[`${outerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const outerLowerArm = VRMHumanBoneName[`${outerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const outerHand     = VRMHumanBoneName[`${outerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  // Outer arm (crosses forward towards the wall/corner)
  fr(outerUpperArm, -0.45, rotSign * -0.2, rotSign * 0.95 + curiousSway * 0.3, poseSmooth);
  fr(outerLowerArm, -0.35, 0, 0, poseSmooth);
  fr(outerHand,      0.25, 0, 0, poseSmooth);
  tr(outerHand,      trSign * -0.12, 0.04, 0, poseSmooth);

  // Inner arm (holding onto the wall frame)
  fr(innerUpperArm, -0.35, rotSign * -0.45, rotSign * 0.75 + curiousSway * 0.2, poseSmooth);
  fr(innerLowerArm, -0.45, 0, 0, poseSmooth);
  fr(innerHand,      0.25, 0, 0, poseSmooth);
  tr(innerHand,      trSign * -0.12, -0.04, 0, poseSmooth);

  bendFingers(outerPrefix as 'Left' | 'Right');
  bendFingers(innerPrefix as 'Left' | 'Right');
}
