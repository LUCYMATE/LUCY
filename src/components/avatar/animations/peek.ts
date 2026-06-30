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
  fr(VRMHumanBoneName.Hips,         0, 0, isLeft ? 0.2 : -0.2, poseSmooth); 
  fr(VRMHumanBoneName.Spine,        0.1, isLeft ? -0.3 : 0.3, isLeft ? 0.4 : -0.4, poseSmooth); 
  fr(VRMHumanBoneName.Chest,        0, 0, 0, poseSmooth);

  fr(VRMHumanBoneName.LeftUpperLeg,  0.1, 0, 0.05,  poseSmooth); 
  fr(VRMHumanBoneName.RightUpperLeg, 0.1, 0, -0.05, poseSmooth);

  // Keep body shifted offscreen but spine rotated inwards
  tr(VRMHumanBoneName.Hips, isLeft ? -0.3 : 0.3, 0, 0, poseSmooth);

  if (isLeft) {
    // Peeking from left edge: BOTH arms hold the wall
    fr(VRMHumanBoneName.RightUpperArm, -0.6, 0.2, 1.0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm, -0.4, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,     0.3, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.RightHand,     0.15, 0.05, 0, poseSmooth);
    
    fr(VRMHumanBoneName.LeftUpperArm,  -0.4, 0.5, 0.8, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,  -0.5, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,      0.3, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.LeftHand,      0.15, -0.05, 0, poseSmooth);

    bendFingers('Right');
    bendFingers('Left');
  } else {
    // Peeking from right edge: BOTH arms hold the wall
    fr(VRMHumanBoneName.LeftUpperArm,  -0.6, -0.2, -1.0, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,  -0.4, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,      0.3, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.LeftHand,     -0.15, 0.05, 0, poseSmooth);
    
    fr(VRMHumanBoneName.RightUpperArm, -0.4, -0.5, -0.8, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm, -0.5, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      0.3, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.RightHand,     -0.15, -0.05, 0, poseSmooth);

    bendFingers('Right');
    bendFingers('Left');
  }
}
