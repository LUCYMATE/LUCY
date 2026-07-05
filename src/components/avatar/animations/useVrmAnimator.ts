import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { VRM } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';
import { BoneRest, BONE_LIST, BasePose, Emotion } from './core';
import { applyLocomotion } from './locomotion';
import { applyGestures } from './gestures';
import { applyPeek } from './peek';
import { applyExpressions } from './expressions';
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

  // 2. UNIFIED animation loop
  //    Order: locomotion → flirty pose → gestures → expressions → high-priority active
  //    vrm.update() called LAST so spring bones simulate against final posed skeleton.
  useFrame((state) => {
    if (!vrm) return;

    const delta = state.clock.getDelta();
    const t     = state.clock.elapsedTime;
    const rest  = restPose.current;

    const isSitting   = basePose === 'sit';
    const isPeeking   = basePose.startsWith('peek') && !isWalking;
    const isPeekLeft  = basePose === 'peek-left';
    const isFlirtyPose =
      basePose === 'caress'      ||
      basePose === 'stretch'     ||
      basePose === 'lean';

    const actuallyHearing = isListening && useAvatarState.getState().isHearingSound;

    // ── Model facing ──────────────────────────────────────────────────────
    if (vrm.scene) {
      vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, moveDirection, 0.1);
    }

    // ── Step 1: Body / locomotion (hips, spine, legs) ─────────────────────
    if (isPeeking) {
      applyPeek(vrm, rest, t, isPeekLeft);
    } else {
      applyLocomotion(vrm, rest, t, isWalking, isSitting);
    }

    // ── Step 2: Flirty pose (body shape override) ─────────────────────────
    if (isFlirtyPose && !isWalking) {
      applyFlirty(vrm, rest, t, basePose);
    }

    // Flirty idle sway when emotion is flirty but no active flirty pose
    if (!isSpeaking && !isThinking && !isWalking && emotion === 'flirty' && !isFlirtyPose && !isPeeking) {
      applyFlirtyIdleSway(vrm, rest, t);
    }

    const shouldSpeak = isSpeaking && basePose !== 'flying-kiss';

    // ── Step 3: Upper-body gestures (arms, head, neck) ────────────────────
    applyGestures(
      vrm, rest, t,
      isGreeting, shouldSpeak, isThinking, actuallyHearing,
      isWalking, emotion, isSitting
    );

    // ── Step 4: Expressions (face, blink, lip sync) ───────────────────────
    applyExpressions(vrm, t, shouldSpeak, actuallyHearing, isThinking, emotion);

    // ── Step 5: High-priority active animations ───────────────────────────
    // flying-kiss must override talking gestures, so it runs last
    if (basePose === 'flying-kiss' && !isWalking) {
      applyFlirty(vrm, rest, t, basePose);
    }

    // ── Update spring bones, look-at, expression manager ─────────────────
    // Must be AFTER all bone writes so spring bones simulate against final pose
    vrm.update(delta);
  });
}
