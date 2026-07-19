import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { slerpFromRest, translateFromRest, BoneRest, SMOOTHING } from './core';

export function applyVersatilePoses(
  vrm: VRM,
  rest: BoneRest,
  t: number,
  pose: string,
  targetPos?: { x: number; y: number; z: number } | null
) {
  const fr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    slerpFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.quaternion, dx, dy, dz, alpha);
  const tr = (name: VRMHumanBoneName, dx: number, dy: number, dz: number, alpha = SMOOTHING) =>
    translateFromRest(vrm.humanoid?.getNormalizedBoneNode(name), rest[name]?.position, dx, dy, dz, alpha);

  const poseSmooth = 0.05;

  // ── Shared organic micro-motions ─────────────────────────────────────────
  const breathPrimary   = Math.sin(t * 1.8) * 0.015;   // chest expansion
  const breathSecondary = Math.sin(t * 0.9) * 0.008;   // slow overlay
  const breathing       = breathPrimary + breathSecondary;
  const microSway       = Math.cos(t * 0.55) * 0.006;  // weight-shift
  const shoulderRise    = (Math.sin(t * 1.8) + 1) * 0.005; // rises with inhale

  // ═══════════════════════════════════════════════════════════════════════════
  // LIE-DOWN — Prone on stomach, chin propped on hands, feet playfully kicking
  // ═══════════════════════════════════════════════════════════════════════════
  if (pose === 'lie-down') {
    // Hips rotate to lay the body flat (X = -π/2 ≈ -1.57)
    // Translate down and forward so the model rests on the "ground plane"
    fr(VRMHumanBoneName.Hips, -1.57, 0, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips, 0, -0.55, 0.3, poseSmooth);

    // Spine chain arches upward so the chest lifts off the ground
    // Each segment adds a small counter-rotation to create a natural curve
    fr(VRMHumanBoneName.Spine,      0.35 + breathing, 0, microSway, poseSmooth);
    fr(VRMHumanBoneName.Chest,      0.30 + breathing * 0.7, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest, 0.20 + breathing * 0.5, 0, 0, poseSmooth);

    // Neck counter-bends so head looks forward/up naturally
    fr(VRMHumanBoneName.Neck, 0.25, 0, 0, poseSmooth);

    // Head — gentle idle look-around while lying
    const headIdleY = Math.sin(t * 0.6) * 0.12; // slow left-right
    const headIdleX = Math.sin(t * 0.4) * 0.04; // slight nod
    fr(VRMHumanBoneName.Head,
      -0.15 + headIdleX,
      headIdleY,
      Math.cos(t * 0.7) * 0.03, // tiny tilt
      poseSmooth);

    // ── Legs kicked up behind — playful alternating swing ──────────────────
    // Upper legs stay mostly aligned with the prone body
    fr(VRMHumanBoneName.LeftUpperLeg,  -0.15, 0.15, -0.08, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg, -0.10, -0.15, 0.08, poseSmooth);

    // Lower legs swing up and down in a lazy alternating pattern
    const kickL = Math.sin(t * 1.8) * 0.25;
    const kickR = Math.sin(t * 1.8 + 1.2) * 0.20; // phase offset for asymmetry
    fr(VRMHumanBoneName.LeftLowerLeg,  -1.4 + kickL, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -1.2 + kickR, 0, 0, poseSmooth);

    // Feet point naturally (plantar flexion)
    fr(VRMHumanBoneName.LeftFoot,  0.3, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.3, 0, 0, poseSmooth);

    // ── Arms — chin-on-hands prop pose ────────────────────────────────────
    // Both arms come up and forward, elbows planted, forearms vertical,
    // hands meeting under the chin
    fr(VRMHumanBoneName.LeftShoulder,  0, 0, -shoulderRise, poseSmooth);
    fr(VRMHumanBoneName.RightShoulder, 0, 0,  shoulderRise, poseSmooth);

    fr(VRMHumanBoneName.LeftUpperArm,   0.8,  0.4, 0.7, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -1.8, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.3, 0, 0.2, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.8, -0.4, -0.7, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0,  1.8, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      -0.3, 0, -0.2, poseSmooth);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE-LEAN — Leaning forward over the screen edge, hands gripping the rim
  // Body sways naturally while hands stay "anchored" via counter-rotation
  // ═══════════════════════════════════════════════════════════════════════════
  else if (pose === 'edge-lean') {
    // Organic body sway — two overlapping sine waves for non-repetitive feel
    const swayX = Math.sin(t * 1.1) * 0.08 + Math.sin(t * 0.7) * 0.04;
    const swayZ = Math.cos(t * 0.9) * 0.05 + Math.cos(t * 0.5) * 0.03;

    // Hips tilt forward (leaning over edge) with lateral sway
    fr(VRMHumanBoneName.Hips, 0.35 + swayZ, 0, swayX, poseSmooth);
    tr(VRMHumanBoneName.Hips, swayX * 0.3, -0.12 + breathing, swayZ * 0.2, poseSmooth);

    // Spine chain distributes the lean and counters sway for stability
    fr(VRMHumanBoneName.Spine,      0.20, microSway, swayX * 0.3, poseSmooth);
    fr(VRMHumanBoneName.Chest,      0.15 + breathing, swayX * 0.2, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest, 0.05 + breathing * 0.5, 0, 0, poseSmooth);

    // Shoulders rise/fall with breath
    fr(VRMHumanBoneName.LeftShoulder,  0, 0, -shoulderRise, poseSmooth);
    fr(VRMHumanBoneName.RightShoulder, 0, 0,  shoulderRise, poseSmooth);

    // Neck and head counter-sway so the face stays relatively stable
    // (like a real person's vestibulo-ocular reflex)
    fr(VRMHumanBoneName.Neck, -0.15 - swayZ * 0.5, -swayX * 0.4, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,
      -0.35 + Math.sin(t * 0.8) * 0.03 - swayZ * 0.3,
      Math.sin(t * 0.5) * 0.08 - swayX * 0.5,
      Math.cos(t * 0.6) * 0.02,
      poseSmooth);

    // ── Pseudo-IK arms — counter-rotate against body sway ─────────────────
    // The arms need to "undo" the parent bone rotations to keep the wrists
    // at a fixed world-space position (gripping the screen edge).
    fr(VRMHumanBoneName.LeftUpperArm,   0.15 - swayZ * 0.6, -0.25, 0.45 - swayX * 0.5, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.55, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.6, 0, 0.1, poseSmooth);

    fr(VRMHumanBoneName.RightUpperArm,  0.15 - swayZ * 0.6, 0.25, -0.45 - swayX * 0.5, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.55, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      -0.6, 0, -0.1, poseSmooth);

    // Legs: slight wide stance, knees slightly bent for balance
    fr(VRMHumanBoneName.LeftUpperLeg,   -0.15 - swayZ * 0.3, 0.15, -0.20 - swayX * 0.3, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,   0.25, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,       -0.10, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg,  -0.15 - swayZ * 0.3, -0.15, 0.20 - swayX * 0.3, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg,  0.25, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot,      -0.10, 0, 0, poseSmooth);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMIC-TALK — Desktop Mate speaking mode: one hand grips edge, other gestures
  // Rich body language with weight shifts, breathing, and expressive hand motion
  // ═══════════════════════════════════════════════════════════════════════════
  else if (pose === 'dynamic-talk') {
    // Two-layer sway for organic non-repetitive motion
    const swayX = Math.sin(t * 1.3) * 0.10 + Math.sin(t * 0.6) * 0.06;
    const swayZ = Math.cos(t * 1.0) * 0.06 + Math.cos(t * 0.4) * 0.04;
    // "Emphasis" pulses — simulates speech energy bursts
    const emphasis = Math.abs(Math.sin(t * 3.5)) * 0.04;

    fr(VRMHumanBoneName.Hips, 0.30 + swayZ, 0, swayX, poseSmooth);
    tr(VRMHumanBoneName.Hips, swayX * 0.3, -0.10 + breathing, swayZ * 0.2, poseSmooth);

    fr(VRMHumanBoneName.Spine,      0.18 + emphasis, microSway, swayX * 0.3, poseSmooth);
    fr(VRMHumanBoneName.Chest,      0.12 + breathing + emphasis * 0.5, swayX * 0.15, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest, 0.05 + breathing * 0.5 + emphasis * 0.3, 0, 0, poseSmooth);

    fr(VRMHumanBoneName.LeftShoulder,  0, 0, -shoulderRise, poseSmooth);
    fr(VRMHumanBoneName.RightShoulder, 0, 0,  shoulderRise + emphasis, poseSmooth);

    // Head counters sway, with expressive nods on speech emphasis
    fr(VRMHumanBoneName.Neck, -0.12 - swayZ * 0.4, -swayX * 0.3, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,
      -0.30 + Math.sin(t * 0.9) * 0.03 - swayZ * 0.25 - emphasis * 0.8,
      Math.sin(t * 0.5) * 0.06 - swayX * 0.4,
      Math.cos(t * 0.7) * 0.02,
      poseSmooth);

    // ── Left hand anchored to taskbar (Pseudo-IK) ─────────────────────────
    fr(VRMHumanBoneName.LeftUpperArm,   0.15 - swayZ * 0.5, -0.25, 0.45 - swayX * 0.4, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.55, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.6, 0, 0.1, poseSmooth);

    // ── Right arm — expressive gesturing (pointing/waving) ────────────────
    // The arm cycles through slight variations synchronized to speech emphasis
    const gestureWave = Math.sin(t * 2.2) * 0.15; // forearm wave
    fr(VRMHumanBoneName.RightUpperArm,
      -0.9 - swayZ * 0.3 - emphasis * 1.5,
      0.25 + gestureWave * 0.3,
      -0.3 - swayX * 0.3,
      poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.15 + gestureWave, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      emphasis * -0.5, 0, -0.4, poseSmooth);

    // Index finger extended, others curled (pointing gesture)
    fr(VRMHumanBoneName.RightIndexProximal,       0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightIndexIntermediate,    0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightMiddleProximal,       0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightRingProximal,         0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightLittleProximal,       0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightThumbProximal,        0, -0.5, 0, poseSmooth);

    // Legs: wide stance, slight weight shift with sway
    fr(VRMHumanBoneName.LeftUpperLeg,   -0.12 - swayZ * 0.2, 0.12, -0.18 - swayX * 0.2, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,   0.20, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,       -0.08, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg,  -0.12 - swayZ * 0.2, -0.12, 0.18 - swayX * 0.2, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg,  0.20, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot,      -0.08, 0, 0, poseSmooth);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POINT — One hand points outward, body weight shifts to support
  // ═══════════════════════════════════════════════════════════════════════════
  else if (pose === 'point') {
    // Subtle living idle motion
    const weightShift = Math.sin(t * 0.7) * 0.02;

    fr(VRMHumanBoneName.Hips, 0.05, weightShift, 0, poseSmooth);
    tr(VRMHumanBoneName.Hips, 0, breathing * 0.5, 0, poseSmooth);

    fr(VRMHumanBoneName.Spine,      0.06 + breathing, -weightShift * 0.5, 0, poseSmooth);
    fr(VRMHumanBoneName.Chest,      0.04 + breathing * 0.7, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.UpperChest, breathing * 0.5, 0, 0, poseSmooth);

    fr(VRMHumanBoneName.LeftShoulder,  0, 0, -shoulderRise, poseSmooth);
    fr(VRMHumanBoneName.RightShoulder, 0, 0,  shoulderRise, poseSmooth);

    // Left arm hangs naturally at side with slight bend
    fr(VRMHumanBoneName.LeftUpperArm,   0.08, -0.08, 1.1, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerArm,   0, -0.15, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftHand,       -0.1, 0, 0, poseSmooth);

    // Right arm — extended point with slight bob
    const pointBob = Math.sin(t * 1.5) * 0.03;
    fr(VRMHumanBoneName.RightUpperArm,  -1.1 + pointBob, 0.25, -0.15, poseSmooth);
    fr(VRMHumanBoneName.RightLowerArm,  0, 0.08, 0, poseSmooth);
    fr(VRMHumanBoneName.RightHand,      0, 0, -0.4, poseSmooth);

    // Index extended, others curled
    fr(VRMHumanBoneName.RightIndexProximal,       0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightIndexIntermediate,    0, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightMiddleProximal,       0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightRingProximal,         0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightLittleProximal,       0, 0, -1.2, poseSmooth);
    fr(VRMHumanBoneName.RightThumbProximal,        0, -0.5, 0, poseSmooth);

    // Head turns slightly toward pointing direction
    fr(VRMHumanBoneName.Neck, -0.03, 0.08, 0, poseSmooth);
    fr(VRMHumanBoneName.Head,
      -0.06 + Math.sin(t * 0.5) * 0.02,
      0.15 + Math.cos(t * 0.3) * 0.03,
      0, poseSmooth);

    // Legs: natural standing, slight weight on back foot
    fr(VRMHumanBoneName.LeftUpperLeg,   0.04, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftLowerLeg,   -0.02, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.LeftFoot,       0.01, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightUpperLeg,  0.06, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightLowerLeg,  -0.03, 0, 0, poseSmooth);
    fr(VRMHumanBoneName.RightFoot,      0.015, 0, 0, poseSmooth);
  }
}
