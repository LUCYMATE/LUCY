import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { VRM } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';
import { BoneRest, BONE_LIST, BasePose, Emotion } from './core';
import { applyLocomotion } from './locomotion';
import { applyGestures } from './gestures';
import { applyPeek } from './peek';
import { applyExpressions } from './expressions';
import { applyFlirty, applyFlirtyIdleSway } from './flirty';

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

  // 1. Capture initial rest pose
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

  // 2. UNIFIED animation loop — everything runs every frame, no if/else branching.
  //    Each function writes to bones via slerp, so they all blend naturally.
  //    Order matters: later writes have higher priority because slerp blends
  //    from the current (already-written) value toward the new target.
  //
  //    Order:
  //      1. Locomotion (sit/stand/walk body + legs)
  //      2. Pose overrides (peek / flirty — body shape)
  //      3. Gestures (arms + head — speaking, thinking, listening, idle, greeting)
  //      4. Expressions (face, lip sync, blink)
  //
  //    Because gestures run AFTER locomotion/pose, the talking arms blend
  //    on top of whatever body position is set — so you get walking+talking,
  //    peeking+talking, flirty+talking, moving+listening, all at once.
  //
  useFrame((state) => {
    if (!vrm) return;

    const delta = state.clock.getDelta();
    const t = state.clock.elapsedTime;
    const rest = restPose.current;

    const isSittingPose = basePose === 'sit' || basePose === 'sultry-sit' || basePose === 'fingerwarm';
    const isPeeking  = basePose.startsWith('peek') && !isWalking;
    const isPeekLeft = basePose === 'peek-left';
    const isFlirtyPose =
      basePose === 'sultry-sit' || basePose === 'stretch' || basePose === 'lean' ||
      basePose === 'hip-cock'   || basePose === 'body-roll'|| basePose === 'spread-legs' ||
      basePose === 'arch'       || basePose === 'caress'   || basePose === 'squeeze' ||
      basePose === 'fingerwarm';

    const actuallyHearing = isListening && useAvatarState.getState().isHearingSound;

    // ── Model facing ──────────────────────────────────────────────────────
    if (vrm.scene) {
      vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, moveDirection, 0.1);
    }

    // ── Step 1: Body / locomotion (hips, spine, legs) ─────────────────────
    // Peek and locomotion are mutually exclusive for the BODY only,
    // because peek physically repositions the whole skeleton.
    if (isPeeking) {
      applyPeek(vrm, rest, t, isPeekLeft);
    } else {
      applyLocomotion(
        vrm, rest, t,
        isWalking, isSittingPose,
        basePose === 'hip-cock' ? 'hip-cock' : undefined
      );
    }

    // ── Step 2: Flirty pose (body shape override) ─────────────────────────
    // Runs on top of locomotion. applyFlirty overwrites body bones via slerp
    // so the flirty shape blends in over the sit/stand base.
    // Active animations like 'flying-kiss' are skipped here and run at the very end to override talking.
    if (isFlirtyPose && !isWalking) {
      applyFlirty(vrm, rest, t, basePose);
    }

    // Flirty idle sway (subtle body rock when emotion is flirty but no active pose)
    if (!isSpeaking && !isThinking && !isWalking && emotion === 'flirty' && !isFlirtyPose && !isPeeking) {
      applyFlirtyIdleSway(vrm, rest, t);
    }

    // ── Step 3: Upper-body gestures (arms, head, neck) ────────────────────
    // ALWAYS runs — whether walking, peeking, sitting, flirty, etc.
    applyGestures(
      vrm, rest, t,
      isGreeting, isSpeaking, isThinking, actuallyHearing,
      isWalking, emotion, isSittingPose, isPeeking,
      /* skipIdleArms = */ isFlirtyPose && !isWalking && !isSpeaking && !isThinking && !actuallyHearing
    );

    // ── Step 4: Expressions (face, blink, lip sync) ───────────────────────
    applyExpressions(vrm, t, isSpeaking, actuallyHearing, isThinking, emotion);

    // ── Step 5: High-Priority Active Animations ───────────────────────────
    // These must override all procedural talking/listening gestures and lip sync.
    if (basePose === 'flying-kiss' && !isWalking) {
      applyFlirty(vrm, rest, t, basePose);
    }

    // Update spring bones, look-at, and expression manager
    vrm.update(delta);
  });
}
