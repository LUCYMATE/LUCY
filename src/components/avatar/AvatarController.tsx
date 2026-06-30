import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Myra3D } from './Myra3D';
import { useAvatarState } from '../../lib/store/avatarState';
import { BasePose } from './animations/core';

interface AvatarControllerProps {
  isMiniMode?: boolean;
}

export function AvatarController({ isMiniMode = false }: AvatarControllerProps) {
  const { 
    isSpeaking, 
    isThinking, 
    isListening, 
    emotion,
    basePose,
    setBasePose,
    isWalking,
    setIsWalking,
    setTargetPosition,
    isDragging
  } = useAvatarState();
  
  const walkTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Autonomous Wandering Orchestrator in 3D Space
  useEffect(() => {
    if (isMiniMode) return;
    
    const wanderInterval = setInterval(() => {
      // Don't wander if active or dragging
      if (isSpeaking || isListening || isThinking || isDragging) return;
      
      const r = Math.random();
      
      const currentX = useAvatarState.getState().worldPosition.x;
      const currentY = useAvatarState.getState().worldPosition.y;
      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      
      // Calculate screen boundaries
      const edgeX = (ww / 2) / 250; 
      const edgeY = (wh / 2) / 250;
      const innerMaxX = Math.max(0, edgeX - 0.8); // padding to keep her fully visible when standing/sitting
      const innerMaxY = Math.max(0, edgeY - 0.8);

      let targetX = currentX;
      let targetY = currentY;
      let targetPose: BasePose = 'sit';

      if (r < 0.075) {
        targetPose = 'peek-left';
        // Go completely outside the left edge to peek
        targetX = -edgeX - 0.4; 
      } else if (r < 0.15) {
        targetPose = 'peek-right';
        // Go completely outside the right edge to peek
        targetX = edgeX + 0.4;  
      } else if (r < 0.45) {
        targetPose = 'stand';
        // Anywhere strictly inside the screen
        targetX = (Math.random() - 0.5) * (innerMaxX * 2); 
        targetY = (Math.random() - 0.5) * (innerMaxY * 2);
      } else if (r < 0.75) {
        targetPose = 'sit';
        targetX = (Math.random() - 0.5) * (innerMaxX * 2);
        targetY = (Math.random() - 0.5) * (innerMaxY * 2);
      } else if (r < 0.85) {
        targetPose = 'stand';
        targetX = currentX; // stay in place
      } else {
        targetPose = 'sit';
        targetX = currentX; // stay in place
      }

      setBasePose(targetPose);
      setTargetPosition({ x: targetX, y: targetY, z: 0 }); // update 3D target
      
      setIsWalking(true);
      if (walkTimerRef.current) clearTimeout(walkTimerRef.current);

    }, 20000); 

    return () => {
      clearInterval(wanderInterval);
      if (walkTimerRef.current) clearTimeout(walkTimerRef.current);
    }
  }, [isSpeaking, isListening, isThinking, isMiniMode, isDragging, setBasePose, setIsWalking, setTargetPosition]);

  if (isMiniMode) return null;

  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[50]">
      <Myra3D />
    </div>,
    document.body
  );
}
