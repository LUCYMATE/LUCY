import { useEffect, useRef } from 'react';
// Suppress missing declaration file error when @types/react-dom is not installed
// @ts-ignore
import { createPortal } from 'react-dom';
import { Syra3D } from './Syra3D';
import { useAvatarState } from '../../lib/store/avatarState';
import { BasePose } from './animations/core';

interface AvatarControllerProps {
  isPetMode?: boolean;
}

export function AvatarController({ isPetMode = false }: AvatarControllerProps) {
  const { 
    isSpeaking, 
    isThinking, 
    isListening, 
    setBasePose,
    setIsWalking,
    setTargetPosition,
    isDragging
  } = useAvatarState();

  const blush = useAvatarState(s => s.emotion === 'flirty');
  

  // Sync isPetMode to state for HeartParticles
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
      
      const edgeX = (ww / 2) / 250; 
      const edgeY = (wh / 2) / 250;
      const innerMaxX = Math.max(0, edgeX - 0.8);
      const innerMaxY = Math.max(0, edgeY - 0.8);

      let targetX = currentX;
      let targetY = currentY;
      let targetPose: BasePose = 'sit';

      const affection = useAvatarState.getState().affectionLevel;
      const flirtyChance = Math.min(0.35, 0.05 + (affection / 100) * 0.3);
      const sensualPoses: BasePose[] = ['body-roll', 'caress', 'squeeze', 'spread-legs', 'arch', 'flying-kiss'];

      if (r < 0.04) {
        targetPose = 'peek-left';
        // SceneManager auto-walks to left edge — just set a reasonable Y
        targetX = currentX; // SceneManager will override X
        targetY = currentY;
      } else if (r < 0.08) {
        targetPose = 'peek-right';
        // SceneManager auto-walks to right edge — just set a reasonable Y
        targetX = currentX; // SceneManager will override X
        targetY = currentY;
      } else if (r < 0.08 + flirtyChance * 0.5) {
        const sensualR = Math.random();
        if (sensualR < 0.15) {
          targetPose = 'sultry-sit';
        } else if (sensualR < 0.3) {
          targetPose = 'stretch';
        } else if (sensualR < 0.45) {
          targetPose = 'hip-cock';
        } else if (sensualR < 0.55) {
          targetPose = 'fingerwarm';
        } else {
          targetPose = sensualPoses[Math.floor(Math.random() * sensualPoses.length)];
        }
        targetX = (Math.random() - 0.5) * (innerMaxX * 2);
        targetY = (Math.random() - 0.5) * (innerMaxY * 2);
      } else if (r < 0.70) {
        const casualR = Math.random();
        if (casualR < 0.15) targetPose = 'stretch';
        else if (casualR < 0.30) targetPose = 'lean';
        else targetPose = 'stand';
        targetX = (Math.random() - 0.5) * (innerMaxX * 2);
        targetY = (Math.random() - 0.5) * (innerMaxY * 2);
      } else if (r < 0.85) {
        targetPose = 'sit';
        targetX = (Math.random() - 0.5) * (innerMaxX * 2);
        targetY = (Math.random() - 0.5) * (innerMaxY * 2);
      } else if (r < 0.95) {
        const casualR = Math.random();
        if (casualR < 0.20) targetPose = 'stretch';
        else if (casualR < 0.40) targetPose = 'lean';
        else targetPose = 'stand';
        targetX = currentX;
      } else {
        targetPose = 'sit';
        targetX = currentX;
      }

      setBasePose(targetPose);
      setTargetPosition({ x: targetX, y: targetY, z: 0 });
      
      setIsWalking(true);

    }, 15000); 

    return () => {
      clearInterval(wanderInterval);
    }
  }, [isSpeaking, isListening, isThinking, isDragging, setBasePose, setIsWalking, setTargetPosition]);

  return createPortal(
    <>
      <div className="fixed inset-0 pointer-events-none z-[50]">
        <Syra3D isPetMode={isPetMode} />
      </div>
    </>,
    document.body
  );
}
