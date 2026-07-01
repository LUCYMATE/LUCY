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

  const poseSmooth = 0.05;

  // Finger bend helper
  const bendFingers = (prefix: 'Left' | 'Right') => {
    ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].forEach(finger => {
      ['Proximal', 'Intermediate', 'Distal'].forEach(joint => {
        const boneName = `${prefix}${finger}${joint}` as VRMHumanBoneName;
        // Thumb rotates slightly differently than other fingers
        if (finger === 'Thumb') {
          fr(boneName, 0, 0, prefix === 'Left' ? -0.2 : 0.2, poseSmooth);
        } else {
          if (joint === 'Proximal') {
            fr(boneName, 0, 0, prefix === 'Left' ? -0.8 : 0.8, poseSmooth); // Bend inwards
          } else {
            fr(boneName, 0, 0, prefix === 'Left' ? -0.5 : 0.5, poseSmooth);
          }
        }
      });
    });
  };

  // Lean INTO the screen
  fr(VRMHumanBoneName.Hips,         0, 0, isLeft ? -0.2 : 0.2, poseSmooth); 
  fr(VRMHumanBoneName.Spine,        0.1, isLeft ? 0.3 : -0.3, isLeft ? -0.4 : 0.4, poseSmooth); 
  fr(VRMHumanBoneName.Chest,        0, 0, 0, poseSmooth);

  fr(VRMHumanBoneName.LeftUpperLeg,  0.1, 0, 0.05,  poseSmooth); 
  fr(VRMHumanBoneName.RightUpperLeg, 0.1, 0, -0.05, poseSmooth);

  // Keep body shifted offscreen but spine rotated inwards
  tr(VRMHumanBoneName.Hips, isLeft ? -0.3 : 0.3, 0, 0, poseSmooth);

  const innerPrefix = isLeft ? 'Left' : 'Right';
  const outerPrefix = isLeft ? 'Right' : 'Left';

  const reachZ = isLeft ? 1 : -1;
  const twistY = isLeft ? 1 : -1;
  const shiftX = isLeft ? 1 : -1;

  const innerUpperArm = VRMHumanBoneName[`${innerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const innerLowerArm = VRMHumanBoneName[`${innerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const innerHand = VRMHumanBoneName[`${innerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  const outerUpperArm = VRMHumanBoneName[`${outerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const outerLowerArm = VRMHumanBoneName[`${outerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const outerHand = VRMHumanBoneName[`${outerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  // Outer arm (crosses the body to hold the wall)
  fr(outerUpperArm, -0.6, twistY * 0.2, reachZ * 1.0, poseSmooth);
  fr(outerLowerArm, -0.4, 0, 0, poseSmooth);
  fr(outerHand,      0.3, 0, 0, poseSmooth);
  tr(outerHand,      shiftX * 0.15, 0.05, 0, poseSmooth);
  
  // Inner arm (closest to the wall)
  fr(innerUpperArm, -0.4, twistY * 0.5, reachZ * 0.8, poseSmooth);
  fr(innerLowerArm, -0.5, 0, 0, poseSmooth);
  fr(innerHand,      0.3, 0, 0, poseSmooth);
  tr(innerHand,      shiftX * 0.15, -0.05, 0, poseSmooth);

  bendFingers(outerPrefix as 'Left' | 'Right');
  bendFingers(innerPrefix as 'Left' | 'Right');
}
