import { useEffect } from 'react';
// @ts-ignore
import { createPortal } from 'react-dom';
import { Avatar3D } from './Avatar3D';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { BasePose } from './animations/core';

interface AvatarControllerProps {
  isPetMode?: boolean;
}

export function AvatarController({ isPetMode = false }: AvatarControllerProps) {
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

  // Sync isPetMode to state
  useEffect(() => {
    useAvatarState.getState().setIsPetMode(isPetMode);
  }, [isPetMode]);

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
        if (casualR < 0.33) targetPose = 'stretch';
        else if (casualR < 0.66) targetPose = 'lean';
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

  return createPortal(
    <>
      <div className="fixed inset-0 pointer-events-none z-[50]">
        <Avatar3D isPetMode={isPetMode} />
      </div>
    </>,
    document.body
  );
}
