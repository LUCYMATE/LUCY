import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { useAvatarState } from '../../../lib/store/avatarState';
import { BoneRest, BONE_LIST, BasePose, Emotion } from './core';
import { applyLocomotion } from './locomotion';
import { applyGestures } from './gestures';
import { applyPeek } from './peek';
import { applyExpressions } from './expressions';

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
  moveDirection: number; // -1 for left, 1 for right, 0 for stationary/forward
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
  
  // Internal state machine for specific animations
  const [isGreeting, setIsGreeting] = useState(true);

  // 1. Capture initial rest pose when VRM loads
  useEffect(() => {
    if (!vrm) return;
    
    // Reset to T/A-pose first
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

    // Trigger greeting animation for 3 seconds on load
    setIsGreeting(true);
    const greetingTimer = setTimeout(() => setIsGreeting(false), 3000);

    return () => clearTimeout(greetingTimer);
  }, [vrm]);

  // 2. No more internal peek phase needed; we wait for walking to finish


  // 3. The Main Animation Loop
  useFrame((state) => {
    if (!vrm) return;
    
    if (useAvatarState.getState().isDragging) {
      if (vrm.springBoneManager) {
        vrm.springBoneManager.reset();
      }
    }

    const delta = state.clock.getDelta();
    vrm.update(delta);

    const t = state.clock.elapsedTime;
    const rest = restPose.current;
    
    // Determine overall state overrides
    const actualIsWalking = isWalking;
    const isSitting = basePose === 'sit';
    const isPeeking = basePose.startsWith('peek') && !isWalking;
    const isPeekLeft = basePose === 'peek-left';
    
    const actuallyHearing = isListening && useAvatarState.getState().isHearingSound;

    // Model Rotation: moveDirection is now the exact targetRotationY in radians
    if (vrm.scene) {
      vrm.scene.rotation.y = lerpAngle(vrm.scene.rotation.y, moveDirection, 0.1);
    }

    if (isPeeking) {
      // Run peek sequence (overrides locomotion and some gestures)
      applyPeek(vrm, rest, t, isPeekLeft);
      
      // Still apply expressions
      applyExpressions(vrm, t, isSpeaking, actuallyHearing, isThinking, emotion);
    } else {
      // Normal locomotion (walk/sit/stand)
      applyLocomotion(vrm, rest, t, actualIsWalking, isSitting);
      
      // Normal upper body gestures
      applyGestures(vrm, rest, t, isGreeting, isSpeaking, isThinking, actuallyHearing, actualIsWalking, emotion, isSitting);
      
      // Facial expressions and lip sync
      applyExpressions(vrm, t, isSpeaking, actuallyHearing, isThinking, emotion);
    }

    // Auto Blink Logic (Blink roughly every 4 seconds)
    const blinkCycle = t % 4.0;
    let blinkValue = 0;
    if (blinkCycle < 0.1) {
      // Quick blink down
      blinkValue = blinkCycle / 0.1;
    } else if (blinkCycle < 0.2) {
      // Quick blink up
      blinkValue = 1.0 - ((blinkCycle - 0.1) / 0.1);
    }
    
    // Only apply blink if we aren't already expressing something that overrides eyes (like happy/sad)
    // Actually, VRM expressions blend nicely, so we can always apply blink
    if (vrm.expressionManager) {
      vrm.expressionManager.setValue('blink', blinkValue);
    }
  });
}
