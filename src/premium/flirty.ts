import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from '../components/avatar/animations/core';
import { useAvatarState } from '../lib/store/avatarState';

export function applyFlirty(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  pose: string,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.05;

  if (pose === 'caress') {
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
      Math.sin(t * 0.8) * 0.3,
      0.02, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.2, -0.3, -1.0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.5, 0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.RightHand,     -0.3, 0, 0, SMOOTHING * 0.4);

    fr(VRMHumanBoneName.LeftUpperArm,   0.6, 0.8, 1.2, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -2.0, 0, SMOOTHING * 0.4);
    fr(VRMHumanBoneName.LeftHand,      -0.4, 0, 0, SMOOTHING * 0.4);
  }

  else if (pose === 'flying-kiss') {
    const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
    const localTime = (Date.now() - lastOverride) / 1000.0;

    // Timeline:
    // 0.0 - 0.8s: Hand comes to mouth
    // 0.8 - 1.2s: Hold at mouth (lips pucker)
    // 1.2 - 1.6s: Hand extends outward
    // 1.6 - 2.0s: Hold extension
    // 2.0 - 2.8s: Lower hand back to rest

    const phaseToMouth = Math.min(1.0, localTime / 0.8);
    const phaseExtend = localTime > 1.2 ? Math.min(1.0, (localTime - 1.2) / 0.4) : 0;
    const phaseDrop = localTime > 2.0 ? Math.min(1.0, (localTime - 2.0) / 0.8) : 0;

    const bow = (Math.sin(phaseToMouth * Math.PI * 0.5) * (1 - phaseDrop)) * 0.15;
    fr(VRMHumanBoneName.Hips,         bow * 0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Spine,        bow * 0.4, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,        bow * 0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,         bow * 0.2, 0.1, 0.05, 0.06);

    const rUpperIdle   = { dx: 0.1,  dy: 0,    dz: -1.2 };
    const rLowerIdle   = { dx: 0,    dy: 0,    dz: 0    };
    const rHandIdle    = { dx: 0,    dy: 0,    dz: 0    };
    const rUpperMouth  = { dx: 0.2,  dy: -0.2, dz: -1.2 };
    const rLowerMouth  = { dx: 0,    dy: 2.2,  dz: 0.3  };
    const rHandMouth   = { dx: 0.5,  dy: 0,    dz: 0    };
    const rUpperExtend = { dx: -0.3, dy: 0.2,  dz: -1.0 };
    const rLowerExtend = { dx: 0,    dy: 0.4,  dz: 0    };
    const rHandExtend  = { dx: -0.2, dy: 0,    dz: 0.2  };

    let currUpper = { ...rUpperIdle };
    let currLower = { ...rLowerIdle };
    let currHand  = { ...rHandIdle  };

    const lerp3 = (
      a: { dx: number; dy: number; dz: number },
      b: { dx: number; dy: number; dz: number },
      t2: number
    ) => ({ dx: a.dx + (b.dx - a.dx) * t2, dy: a.dy + (b.dy - a.dy) * t2, dz: a.dz + (b.dz - a.dz) * t2 });

    if (localTime <= 1.2) {
      const tM = Math.sin(phaseToMouth * Math.PI * 0.5);
      currUpper = lerp3(rUpperIdle, rUpperMouth, tM);
      currLower = lerp3(rLowerIdle, rLowerMouth, tM);
      currHand  = lerp3(rHandIdle,  rHandMouth,  tM);
    } else if (localTime <= 2.0) {
      const tE = Math.sin(phaseExtend * Math.PI * 0.5);
      currUpper = lerp3(rUpperMouth, rUpperExtend, tE);
      currLower = lerp3(rLowerMouth, rLowerExtend, tE);
      currHand  = lerp3(rHandMouth,  rHandExtend,  tE);
    } else {
      const tD = Math.sin(phaseDrop * Math.PI * 0.5);
      currUpper = lerp3(rUpperExtend, rUpperIdle, tD);
      currLower = lerp3(rLowerExtend, rLowerIdle, tD);
      currHand  = lerp3(rHandExtend,  rHandIdle,  tD);
    }

    fr(VRMHumanBoneName.RightUpperArm,  currUpper.dx, currUpper.dy, currUpper.dz, 0.15);
    fr(VRMHumanBoneName.RightLowerArm,  currLower.dx, currLower.dy, currLower.dz, 0.15);
    fr(VRMHumanBoneName.RightHand,      currHand.dx,  currHand.dy,  currHand.dz,  0.15);

    // Left arm resting on side
    fr(VRMHumanBoneName.LeftUpperArm,   0.3, -0.3, 1.2, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.5, 0, SMOOTHING * 0.5);

    // Expressions: pucker lips during the hold at mouth
    if (vrm.expressionManager) {
      const pucker = (localTime > 0.6 && localTime < 1.4)
        ? 1.0
        : (localTime >= 1.4
          ? Math.max(0, 1.0 - (localTime - 1.4) * 3)
          : localTime * 1.5);
      const openMouth = phaseExtend * (1 - phaseDrop);

      vrm.expressionManager.setValue('aa', openMouth * 0.5);
      vrm.expressionManager.setValue('ih', pucker * 0.7);
      vrm.expressionManager.setValue('ou', pucker * 1.0);
    }
  }
}

export function applyFlirtyIdleSway(
  vrm: VRM,
  rest: BoneRest,
  t: number,
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  const hipSway  = Math.sin(t * 0.6) * 0.06;
  const bodySway = Math.sin(t * 0.6 + Math.PI) * 0.03;

  fr(VRMHumanBoneName.Hips,  0, hipSway,        0, 0.03);
  fr(VRMHumanBoneName.Spine, 0, bodySway,        0, 0.03);
  fr(VRMHumanBoneName.Chest, 0, bodySway * 0.5,  0, 0.03);

  fr(VRMHumanBoneName.Head,
    Math.sin(t * 0.8) * 0.02 + Math.sin(t * 0.5) * 0.03,
    Math.cos(t * 0.5) * 0.04,
    0, 0.03);

  fr(VRMHumanBoneName.RightUpperArm, Math.sin(t * 0.7) * 0.02,        0, -0.8, SMOOTHING * 0.4);
  fr(VRMHumanBoneName.LeftUpperArm,  Math.sin(t * 0.7 + 0.5) * 0.02,  0,  0.8, SMOOTHING * 0.4);
}
