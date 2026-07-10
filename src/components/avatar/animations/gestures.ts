import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, BoneRest, SMOOTHING, Emotion } from './core';

export function applyGestures(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  isGreeting: boolean,
  isSpeaking: boolean,
  isThinking: boolean,
  isListening: boolean,
  isWalking: boolean,
  emotion: Emotion,
  isSitting: boolean,
  isDragging: boolean,
  basePose: string
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);

  // Breathing and idle sway (always on)
  const breathe = Math.sin(t * 1.15) * 0.012;
  const sway    = Math.sin(t * 0.5)  * 0.008;
  fr(VRMHumanBoneName.UpperChest, breathe, 0, sway * 0.3, 0.04);

  const idleSway = Math.sin(t * 0.8) * 0.02;

  const rArmBase = { x: 0.2, y: 0.4, z: -1.25 };
  const rElbowBase = { x: 0, y: 1.4, z: 0 }; 
  const rHandBase = { x: -0.1, y: 0, z: -0.1 };

  const lArmBase = { x: 0.2, y: -0.4, z: 1.25 };
  const lElbowBase = { x: 0, y: -1.4, z: 0 }; 
  const lHandBase = { x: -0.1, y: 0, z: 0.1 };

  if (isDragging) {
    // Arms crossed defensively while dangling (annoyed/resisting being dragged)
    const struggle = Math.sin(t * 12.0) * 0.05; // tiny frustrated wiggle
    
    // Right arm
    fr(VRMHumanBoneName.RightUpperArm, 0.5, -0.3 + struggle, -1.2, SMOOTHING * 2);
    fr(VRMHumanBoneName.RightLowerArm, 0, 2.2, 0, SMOOTHING * 2); // POSITIVE Y bends right elbow inward
    fr(VRMHumanBoneName.RightHand, -0.2, 0, 0, SMOOTHING * 2);

    // Left arm
    fr(VRMHumanBoneName.LeftUpperArm, 0.5, 0.3 - struggle, 1.2, SMOOTHING * 2);
    fr(VRMHumanBoneName.LeftLowerArm, 0, -2.2, 0, SMOOTHING * 2); // NEGATIVE Y bends left elbow inward
    fr(VRMHumanBoneName.LeftHand, -0.2, 0, 0, SMOOTHING * 2);

  } else if (isGreeting) {
    // "Hi" wave animation
    const wave = Math.sin(t * 15) * 0.5; // Fast hand wave
    fr(VRMHumanBoneName.RightUpperArm, 0, 0, -1.8, 0.1);
    fr(VRMHumanBoneName.RightLowerArm, 0, 2.0, 0, 0.1);
    fr(VRMHumanBoneName.RightHand, 0, 0, wave, 0.2);

    fr(VRMHumanBoneName.LeftUpperArm, lArmBase.x, lArmBase.y, lArmBase.z, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm, lElbowBase.x, lElbowBase.y, lElbowBase.z, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand, lHandBase.x, lHandBase.y, lHandBase.z, SMOOTHING);
    
    fr(VRMHumanBoneName.Head, 0.1, -0.1, 0.05, 0.1);
    fr(VRMHumanBoneName.Neck, 0.05, -0.1, 0, 0.1);

  } else if (isSpeaking) {
    // Speaking gestures based on emotion
    const g = t * 2.1;
    
    let swingMult = 1.0;
    let headTilt = 1.0;
    
    if (emotion === 'angry') {
      swingMult = 1.8;
      headTilt = 0.5;
    } else if (emotion === 'happy') {
      swingMult = 1.4;
      headTilt = 1.5;
    } else if (emotion === 'sad') {
      swingMult = 0.3;
      headTilt = 0.8;
      fr(VRMHumanBoneName.Spine, 0.1, 0, 0, 0.1); // slouch
    }

    const swing    = Math.sin(g)         * 0.45 * swingMult;  
    const counter  = Math.sin(g + 1.1)   * 0.15 * swingMult;
    const elbowR   = Math.sin(g * 1.35)  * 0.40 * swingMult;
    const elbowL   = Math.sin(g * 1.1)   * 0.20 * swingMult;
    const wristR   = Math.sin(g * 1.8)   * 0.35;
    const rise     = Math.abs(Math.sin(g * 0.7)) * 0.50 * swingMult;

    // Head while speaking
    fr(VRMHumanBoneName.Neck, 0.04, Math.cos(t * 1.8) * 0.05, 0, SMOOTHING);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 2.2) * 0.12 * headTilt,
      Math.cos(t * 1.6) * 0.14 * headTilt,
      Math.sin(t * 1.1) * 0.05 * headTilt,
      SMOOTHING);

    // Arms
    fr(VRMHumanBoneName.RightUpperArm,  rArmBase.x + rise, rArmBase.y + swing, rArmBase.z + 0.4, SMOOTHING);
    fr(VRMHumanBoneName.RightLowerArm,  rElbowBase.x, rElbowBase.y + elbowR, rElbowBase.z, SMOOTHING);
    fr(VRMHumanBoneName.RightHand,      rHandBase.x + wristR, rHandBase.y, rHandBase.z, SMOOTHING);

    fr(VRMHumanBoneName.LeftUpperArm,   lArmBase.x, lArmBase.y + counter, lArmBase.z, SMOOTHING);
    fr(VRMHumanBoneName.LeftLowerArm,   lElbowBase.x, lElbowBase.y - elbowL, lElbowBase.z, SMOOTHING);
    fr(VRMHumanBoneName.LeftHand,       lHandBase.x, lHandBase.y, lHandBase.z, SMOOTHING);

  } else if (isThinking) {
    fr(VRMHumanBoneName.Neck, 0, 0.1, 0, SMOOTHING * 0.5);
    fr(VRMHumanBoneName.Head, -0.14, 0.2 + Math.sin(t * 0.4) * 0.08, 0.05, SMOOTHING * 0.5);

    fr(VRMHumanBoneName.RightUpperArm,  0.5,  0.8, -0.6, SMOOTHING * 0.6); 
    fr(VRMHumanBoneName.RightLowerArm,  0,    2.2,  0,   SMOOTHING * 0.6); 
    fr(VRMHumanBoneName.RightHand,      0,    0,    0,   SMOOTHING * 0.6);

    fr(VRMHumanBoneName.LeftUpperArm,   lArmBase.x, lArmBase.y, lArmBase.z, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.LeftLowerArm,   lElbowBase.x, lElbowBase.y, lElbowBase.z, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.LeftHand,       lHandBase.x, lHandBase.y, lHandBase.z, SMOOTHING * 0.6);

  } else if (isListening) {
    // Active listening (nodding)
    fr(VRMHumanBoneName.Spine, 0.05 + Math.sin(t * 1.2) * 0.02, 0, 0, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.Neck, 0, -0.08, -0.04, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.Head,
      0.06 + Math.sin(t * 3.5) * 0.06 + Math.sin(t * 1.2) * 0.04,
      -0.14,
      -0.09,
      SMOOTHING * 0.6);

    fr(VRMHumanBoneName.LeftUpperArm,  -.7,  -1.3,  0.2, SMOOTHING * 0.6); 
    fr(VRMHumanBoneName.LeftLowerArm,    0,    -3,    0, SMOOTHING * 0.6); 
    fr(VRMHumanBoneName.LeftHand,     -0.5,     0, -0.5, SMOOTHING * 0.6);

    fr(VRMHumanBoneName.RightUpperArm,  rArmBase.x, rArmBase.y, rArmBase.z, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.RightLowerArm,  rElbowBase.x, rElbowBase.y, rElbowBase.z, SMOOTHING * 0.6);
    fr(VRMHumanBoneName.RightHand,      rHandBase.x, rHandBase.y, rHandBase.z, SMOOTHING * 0.6);

  } else {
    // Idle state
    fr(VRMHumanBoneName.Neck, 0, 0, 0, SMOOTHING * 0.35);
    fr(VRMHumanBoneName.Head,
      Math.sin(t * 0.4)  * 0.04,
      Math.sin(t * 0.55) * Math.cos(t * 0.3) * 0.09,
      0,
      SMOOTHING * 0.35);

    if (isWalking) {
      // Arms swing while walking (opposite to legs)
      const walkSpeed = 6.0;
      const wt = t * walkSpeed;
      const armSwing = 0.3;
      // Right arm swings with left leg
      fr(VRMHumanBoneName.RightUpperArm, -Math.sin(wt) * armSwing, 0, -1.0, 0.2);
      fr(VRMHumanBoneName.RightLowerArm, 0, 0.5, 0, 0.2);
      // Left arm swings with right leg
      fr(VRMHumanBoneName.LeftUpperArm, -Math.sin(wt + Math.PI) * armSwing, 0, 1.0, 0.2);
      fr(VRMHumanBoneName.LeftLowerArm, 0, -0.5, 0, 0.2);
    } else {
      // Calculate slow random sways
      const idleArmSwayX = Math.sin(t * 0.7) * 0.03;
      const idleArmSwayZ = Math.cos(t * 0.5) * 0.05;
      const elbowSway = Math.sin(t * 0.9) * 0.04;

      if (basePose === 'sleep') {
        fr(VRMHumanBoneName.RightUpperArm, 0.2, 0, -1.4, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightLowerArm, 0, 0.8, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightHand, 0, 0, 0, SMOOTHING * 0.4);
        
        fr(VRMHumanBoneName.LeftUpperArm, 0.2, 0, 1.4, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftLowerArm, 0, -0.8, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftHand, 0, 0, 0, SMOOTHING * 0.4);
      } else if (isSitting) {
        // Hands resting on lap (arms perfectly vertical & pulled tightly inward, elbows bent less)
        fr(VRMHumanBoneName.RightUpperArm, 0 + idleArmSwayX, 0, -1.5 + idleArmSwayZ, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightLowerArm, 0, 0.9 + elbowSway, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightHand, -0.2, 0, 0, SMOOTHING * 0.4);

        fr(VRMHumanBoneName.LeftUpperArm, 0 + idleArmSwayX, 0, 1.5 - idleArmSwayZ, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftLowerArm, 0, -0.9 - elbowSway, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftHand, -0.2, 0, 0, SMOOTHING * 0.4);
      } else {
        // Hanging straight down by sides (downward Z rotation)
        fr(VRMHumanBoneName.RightUpperArm, 0.1 + idleArmSwayX, 0, -1.25 + idleArmSwayZ, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightLowerArm, 0, 0.1 + elbowSway, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.RightHand, 0, 0, 0, SMOOTHING * 0.4);

        fr(VRMHumanBoneName.LeftUpperArm, 0.1 + idleArmSwayX, 0, 1.25 - idleArmSwayZ, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftLowerArm, 0, -0.1 - elbowSway, 0, SMOOTHING * 0.4);
        fr(VRMHumanBoneName.LeftHand, 0, 0, 0, SMOOTHING * 0.4);
      }
    }
  }
}
