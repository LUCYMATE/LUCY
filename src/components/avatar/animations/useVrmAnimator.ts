import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';
import { BoneRest, BONE_LIST, BasePose, Emotion } from './core';
import { applyLocomotion } from './locomotion';
import { applyGestures } from './gestures';
import { applyPeek } from './peek';
import { applyExpressions, clearExpressionCache } from './expressions';
import { applyFlirty, applyFlirtyIdleSway } from '../../../premium/flirty';

function lerpAngle(a: number, b: number, t: number) {
  const dt = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + dt * t;
}

interface AnimatorProps {
  vrm: VRM | null;
  isSpeaking: boolean;
  isThinking: boolean;
  isListening: boolean;
  basePose: BasePose;
  isWalking: boolean;
  emotion: Emotion;
  moveDirection: number;
}

export function useVrmAnimator({
  vrm,
  isSpeaking,
  isThinking,
  isListening,
  basePose,
  isWalking,
  emotion,
  moveDirection,
}: AnimatorProps) {
  const restPose = useRef<BoneRest>({});
  const [isGreeting, setIsGreeting] = useState(true);

  // 1. Capture initial rest pose when VRM loads
  useEffect(() => {
    if (!vrm) return;
    
    // Reset expression cache for the new VRM model
    clearExpressionCache();
    
    vrm.humanoid.resetNormalizedPose();

    const snap: BoneRest = {};
    for (const name of BONE_LIST) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) {
        snap[name] = {
          quaternion: node.quaternion.clone(),
          position: node.position.clone()
        };
      }
    }
    restPose.current = snap;

    setIsGreeting(true);
    const greetingTimer = setTimeout(() => setIsGreeting(false), 3000);
    return () => clearTimeout(greetingTimer);
  }, [vrm]);

  // 1.5 When transitioning between poses, clean up non-driven bones (like fingers).
  // We DO NOT reset the main body bones here, because we want them to smoothly 
  // interpolate back to their rest pose organically without a 1-frame T-pose flash.
  useEffect(() => {
    if (!vrm) return;
    const fingerBones = [
      VRMHumanBoneName.LeftThumbMetacarpal, VRMHumanBoneName.LeftThumbProximal, VRMHumanBoneName.LeftThumbDistal,
      VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.LeftIndexDistal,
      VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.LeftMiddleDistal,
      VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.LeftRingDistal,
      VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.LeftLittleDistal,
      VRMHumanBoneName.RightThumbMetacarpal, VRMHumanBoneName.RightThumbProximal, VRMHumanBoneName.RightThumbDistal,
      VRMHumanBoneName.RightIndexProximal, VRMHumanBoneName.RightIndexIntermediate, VRMHumanBoneName.RightIndexDistal,
      VRMHumanBoneName.RightMiddleProximal, VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal,
      VRMHumanBoneName.RightRingProximal, VRMHumanBoneName.RightRingIntermediate, VRMHumanBoneName.RightRingDistal,
      VRMHumanBoneName.RightLittleProximal, VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal,
    ];
    for (const name of fingerBones) {
      const node = vrm.humanoid?.getNormalizedBoneNode(name);
      const r = restPose.current[name];
      if (node && r) {
        node.quaternion.copy(r.quaternion);
      }
    }
  }, [basePose, vrm]);

  // 2. UNIFIED animation loop
  //    Order: locomotion → flirty pose → gestures → expressions → high-priority active
  //    vrm.update() called LAST so spring bones simulate against final posed skeleton.
  useFrame((state, delta) => {
    if (!vrm) return;

    const t     = state.clock.elapsedTime;
    const rest  = restPose.current;

    const isSitting   = basePose === 'sit';
    const isPeeking   = basePose.startsWith('peek') && !isWalking;
    const isPeekLeft  = basePose === 'peek-left';
    const isFlirtyPose =
      basePose === 'caress'      ||
      basePose === 'stretch'     ||
      basePose === 'lean'        ||
      basePose === 'flying-kiss';

    const actuallyHearing = isListening && useAvatarState.getState().isHearingSound;

    // Detect if the current pose is driven entirely by an FBX animation
    const proceduralPoses = ['sit', 'stand', 'peek-left', 'peek-right', 'stretch', 'lean', 'caress', 'sleep'];
    const isFbxPose = !proceduralPoses.includes(basePose);

    // To prevent the avatar from freezing for 2-3 frames while the FBX file loads from disk,
    // we force procedural animations to continue playing for 0.5 seconds after switching to an FBX pose.
    const timeSincePoseChange = (Date.now() - useAvatarState.getState().lastPoseOverrideTime) / 1000;
    const shouldSkipProcedural = isFbxPose && timeSincePoseChange > 0.5;

    // ── Model facing ──────────────────────────────────────────────────────
    // Do NOT force model facing if an FBX animation is playing, 
    // otherwise animations that spin the character around will be blocked!
    if (vrm.scene && !shouldSkipProcedural) {
      vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, moveDirection, 0.1);
    }

    // ── Step 1: Body / locomotion (hips, spine, legs) ─────────────────────
    if (isPeeking) {
      applyPeek(vrm, rest, t, isPeekLeft);
    } else if (!shouldSkipProcedural) {
      applyLocomotion(vrm, rest, t, isWalking, isSitting, useAvatarState.getState().isDragging, useAvatarState.getState().dragOffset, basePose);
    }

    // ── Step 2: Flirty pose (body shape override) ─────────────────────────
    if (isFlirtyPose && !isWalking && !shouldSkipProcedural) {
      applyFlirty(vrm, rest, t, basePose);
    }

    // Flirty idle sway when emotion is flirty but no active flirty pose
    if (!isSpeaking && !isThinking && !isWalking && emotion === 'flirty' && !isFlirtyPose && !isPeeking && !isFbxPose) {
      applyFlirtyIdleSway(vrm, rest, t);
    }

    const shouldSpeak = isSpeaking && !isFbxPose;

    // ── Step 3: Upper-body gestures (arms, head, neck) ────────────────────
    if (!shouldSkipProcedural) {
      applyGestures(
        vrm, rest, t,
        isGreeting, shouldSpeak, isThinking, actuallyHearing,
        isWalking, emotion, isSitting, useAvatarState.getState().isDragging, basePose
      );
    }

    // ── Step 4: Expressions (face, blink, lip sync) ───────────────────────
    applyExpressions(vrm, t, shouldSpeak, actuallyHearing, isThinking, emotion, basePose);

    // ── Step 5: High-priority active animations ───────────────────────────
    // FBX takes over for flying-kiss, so we only do procedural flirty poses for the rest
    if (basePose === 'caress' || basePose === 'stretch' || basePose === 'lean') {
      if (!isWalking) applyFlirty(vrm, rest, t, basePose);
    }

    // ── Update spring bones, look-at, expression manager ─────────────────
    // Must be AFTER all bone writes so spring bones simulate against final pose
    // Clamp delta to prevent physics explosions on frame drops
    const clampedDelta = Math.min(delta, 1/30);
    vrm.update(clampedDelta);
  });
}
