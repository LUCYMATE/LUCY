import { useEffect } from 'react';
// @ts-ignore
import { createPortal } from 'react-dom';
import { Avatar3D } from './Avatar3D';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { BasePose } from './animations/core';

interface AvatarControllerProps {
  onLoad?: () => void;
}

export function AvatarController({ onLoad }: AvatarControllerProps) {
  const {
    isSpeaking,
    isThinking,
    isListening,
    basePose,
    setBasePose,
    setIsWalking,
    targetPosition,
    setTargetPosition,
    isDragging,
    isAvatarLocked
  } = useAvatarState(useShallow(s => ({
    isSpeaking: s.isSpeaking,
    isThinking: s.isThinking,
    isListening: s.isListening,
    basePose: s.basePose,
    setBasePose: s.setBasePose,
    setIsWalking: s.setIsWalking,
    targetPosition: s.targetPosition,
    setTargetPosition: s.setTargetPosition,
    isDragging: s.isDragging,
    isAvatarLocked: s.isAvatarLocked
  })));


  // Autonomous Wandering Orchestrator in 3D Space
  useEffect(() => {
    const wanderInterval = setInterval(() => {
      const s = useAvatarState.getState();

      // Pause wandering for 60 seconds after a manual pose override
      const timeSinceLastOverride = Date.now() - s.lastPoseOverrideTime;
      if (timeSinceLastOverride < 60000) return;

      if (s.isSpeaking || s.isThinking || s.isDragging) return;

      const r = Math.random();

      const currentX = s.worldPosition.x;
      const currentY = s.worldPosition.y;
      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;

      const edgeX   = (ww / 2) / 250;
      const edgeY   = (wh / 2) / 250;
      const avatarScale = s.avatarScale || 1;
      const minX = -edgeX;
      const maxX = edgeX;
      const minY = -edgeY - 0.15 * avatarScale;
      const maxY = edgeY - 0.15 * avatarScale;

      let targetX = currentX;
      let targetY = currentY;
      let targetPose: BasePose = 'sit';

      if (r < 0.04) {
        targetPose = 'peek-left';
        targetX = currentX;
        targetY = currentY;
      } else if (r < 0.08) {
        targetPose = 'peek-right';
        targetX = currentX;
        targetY = currentY;
      } else if (r < 0.30) {
        // Casual expressive poses
        const casualR = Math.random();
        if (casualR < 0.2) targetPose = 'stretch';
        else if (casualR < 0.4) targetPose = 'lean';
        else if (casualR < 0.6) targetPose = 'lie-down';
        else if (casualR < 0.8) targetPose = 'edge-lean';
        else targetPose = 'stand';
        if (!s.isAvatarLocked) {
          targetX = minX + Math.random() * (maxX - minX);
          targetY = minY + Math.random() * (maxY - minY);
        }
      } else if (r < 0.70) {
        targetPose = 'stand';
        if (!s.isAvatarLocked) {
          targetX = minX + Math.random() * (maxX - minX);
          targetY = minY + Math.random() * (maxY - minY);
        }
      } else if (r < 0.85) {
        targetPose = 'sit';
        if (!s.isAvatarLocked) {
          targetX = minX + Math.random() * (maxX - minX);
          targetY = minY + Math.random() * (maxY - minY);
        }
      } else if (r < 0.95) {
        targetPose = 'stand';
        targetX = currentX;
      } else {
        targetPose = 'sit';
        targetX = currentX;
      }

      if (s.isAvatarLocked && targetPose !== 'peek-left' && targetPose !== 'peek-right') {
        // Force the avatar to return to its user-defined locked position when not peeking
        targetX = s.lockedPosition?.x ?? 0;
        targetY = s.lockedPosition?.y ?? 0;
      }

      setBasePose(targetPose);
      setTargetPosition({ x: targetX, y: targetY, z: 0 });
      setIsWalking(true);

    }, 15000);

    return () => {
      clearInterval(wanderInterval);
    };
  }, [isSpeaking, isListening, isThinking, isDragging, setBasePose, setIsWalking, setTargetPosition]);

  // Dynamic Talking (Desktop Mate Style) Orchestrator
  useEffect(() => {
    const s = useAvatarState.getState();
    if (!s.isDynamicTalkingEnabled) return;

    if (isSpeaking) {
      // Save current state
      if (!s.preSpeakingState) {
        s.setPreSpeakingState({
          position: { ...s.worldPosition },
          scale: s.avatarScale,
          pose: s.basePose,
        });
      }

      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const edgeX = (ww / 2) / 250;
      const edgeY = (wh / 2) / 250;
      
      const r = Math.random();
      
      if (r < 0.5) {
        // 50% chance: Bottom center, big face, dynamic taskbar anchoring
        const newScale = 2.5;
        const bottomY = -edgeY - 0.15 * newScale;
        s.setAvatarScale(newScale);
        setTargetPosition({ x: 0, y: bottomY, z: 0 });
        setBasePose('dynamic-talk');
      } else if (r < 0.75) {
        // 25% chance: Side edge, leaning in
        const newScale = 2.0;
        const bottomY = -edgeY - 0.15 * newScale;
        const isLeft = Math.random() > 0.5;
        s.setAvatarScale(newScale);
        setTargetPosition({ x: isLeft ? -edgeX + 0.3 : edgeX - 0.3, y: bottomY, z: 0 });
        setBasePose('lean');
      } else {
        // 25% chance: Standing up, offset, natural
        const newScale = 1.6;
        const bottomY = -edgeY - 0.15 * newScale;
        s.setAvatarScale(newScale);
        setTargetPosition({ x: (Math.random() - 0.5) * 1.5, y: bottomY, z: 0 });
        setBasePose('stand');
      }
      
      setIsWalking(true);
      
    } else {
      // Restore state when done speaking
      if (s.preSpeakingState) {
        s.setAvatarScale(s.preSpeakingState.scale);
        setTargetPosition(s.preSpeakingState.position);
        setBasePose(s.preSpeakingState.pose);
        s.setPreSpeakingState(null);
        setIsWalking(true); // Smoothly move back
      }
    }
  }, [isSpeaking, setTargetPosition, setBasePose, setIsWalking]);

  return createPortal(
    <>
      <div className="fixed inset-0 pointer-events-none z-[50]">
        <Avatar3D />
      </div>
    </>,
    document.body
  );
}
