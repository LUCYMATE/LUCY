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
        const key = `${prefix}${finger}${joint}` as keyof typeof VRMHumanBoneName;
        const boneName = VRMHumanBoneName[key];
        
        // Reversed finger bends to curl inward
        if (finger === 'Thumb') {
          fr(boneName, 0, 0, prefix === 'Left' ? 0.2 : -0.2, poseSmooth);
        } else {
          if (joint === 'Proximal') {
            fr(boneName, 0, 0, prefix === 'Left' ? 0.8 : -0.8, poseSmooth); 
          } else {
            fr(boneName, 0, 0, prefix === 'Left' ? 0.5 : -0.5, poseSmooth);
          }
        }
      });
    });
  };

  // Reversed all signs because math was perfectly mirrored
  const rotSign = isLeft ? -1 : 1; 
  const trSign = isLeft ? -1 : 1; 
  const bendSign = isLeft ? 1 : -1; 

  // Lean INTO the screen with a much stronger and more natural curve
  fr(VRMHumanBoneName.Hips,         0.05, 0, bendSign * 0.25, poseSmooth); 
  fr(VRMHumanBoneName.Spine,        0.15, rotSign * -0.3, bendSign * 0.35, poseSmooth); 
  fr(VRMHumanBoneName.Chest,        0.1, 0, bendSign * 0.15, poseSmooth);
  fr(VRMHumanBoneName.UpperChest,   0.05, 0, bendSign * 0.1, poseSmooth);
  fr(VRMHumanBoneName.Neck,         0.05, rotSign * 0.2, 0, poseSmooth);
  fr(VRMHumanBoneName.Head,         -0.1, rotSign * 0.2, 0, poseSmooth);

  fr(VRMHumanBoneName.LeftUpperLeg,  0.1, 0, bendSign * -0.05, poseSmooth); 
  fr(VRMHumanBoneName.RightUpperLeg, 0.1, 0, bendSign * 0.05, poseSmooth);

  // Keep body shifted offscreen, adjusted for perfect visibility
  tr(VRMHumanBoneName.Hips, trSign * 0.10, 0, 0, poseSmooth);

  // Inner/Outer prefixes reversed: 
  // e.g. on Right edge (isLeft=false), her Left arm is closest to the screen edge
  const innerPrefix = isLeft ? 'Right' : 'Left';
  const outerPrefix = isLeft ? 'Left' : 'Right';

  const innerUpperArm = VRMHumanBoneName[`${innerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const innerLowerArm = VRMHumanBoneName[`${innerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const innerHand = VRMHumanBoneName[`${innerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  const outerUpperArm = VRMHumanBoneName[`${outerPrefix}UpperArm` as keyof typeof VRMHumanBoneName];
  const outerLowerArm = VRMHumanBoneName[`${outerPrefix}LowerArm` as keyof typeof VRMHumanBoneName];
  const outerHand = VRMHumanBoneName[`${outerPrefix}Hand` as keyof typeof VRMHumanBoneName];

  // Outer arm (crosses the body to hold the wall)
  fr(outerUpperArm, -0.6, rotSign * -0.2, -rotSign * 1.0, poseSmooth);
  fr(outerLowerArm, -0.4, 0, 0, poseSmooth);
  fr(outerHand,      0.3, 0, 0, poseSmooth);
  tr(outerHand,      trSign * -0.15, 0.05, 0, poseSmooth);
  
  // Inner arm (closest to the wall)
  fr(innerUpperArm, -0.4, rotSign * -0.5, rotSign * 0.8, poseSmooth);
  fr(innerLowerArm, -0.5, 0, 0, poseSmooth);
  fr(innerHand,      0.3, 0, 0, poseSmooth);
  tr(innerHand,      trSign * -0.15, -0.05, 0, poseSmooth);

  bendFingers(outerPrefix as 'Left' | 'Right');
  bendFingers(innerPrefix as 'Left' | 'Right');
}
