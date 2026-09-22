import { useEffect } from 'react';
// @ts-ignore
import { createPortal } from 'react-dom';
import { Avatar3D } from './Avatar3D';
import { Live2DViewer } from './Live2DViewer';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { BasePose } from './animations/core';
import { DesktopRect } from '../../lib/store/avatarState';

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
    isAvatarLocked,
    avatarEngine,
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
    isAvatarLocked: s.isAvatarLocked,
    avatarEngine: s.avatarEngine,
  })));

  // Desktop Rectangles Polling
  useEffect(() => {
    const poll = async () => {
      const s = useAvatarState.getState();
      if (s.isSleepMode) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const rawRects = await invoke<DesktopRect[]>('get_desktop_rectangles');
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const rects = rawRects.map(r => ({
          ...r,
          x: r.x / dpr,
          y: r.y / dpr,
          width: r.width / dpr,
          height: r.height / dpr,
        }));
        console.log('[DesktopMate] Polled rectangles:', rects);
        s.setDesktopRectangles(rects);
        const errorEl = document.getElementById('backend-error-alert');
        if (errorEl) errorEl.remove();
      } catch (e) {
        console.warn('Failed to poll desktop rectangles', e);
        if (!document.getElementById('backend-error-alert')) {
          const div = document.createElement('div');
          div.id = 'backend-error-alert';
          div.className = 'fixed top-20 left-1/2 -translate-x-1/2 bg-red-600 text-white p-4 rounded-xl z-[9999] pointer-events-auto shadow-2xl font-bold text-center border-4 border-white';
          div.innerHTML = '⚠️ BACKEND RESTART REQUIRED ⚠️<br/>You must kill the terminal (Ctrl+C) and run "npm run tauri dev" again!<br/>The new Window Snapping feature cannot work until you restart.';
          document.body.appendChild(div);
        }
      }
    };
    
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

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
      const minY = -edgeY + 0.48 * avatarScale;
      const maxY = edgeY + 0.48 * avatarScale;

      const screenToWorld = (screenX: number, screenY: number) => {
        return {
          x: (screenX - ww / 2) / 250,
          y: -(screenY - wh / 2) / 250,
        };
      };

      const rects = s.desktopRectangles || [];
      const taskbars = rects.filter(r => r.is_taskbar && r.x < ww && r.x + r.width > 0 && r.y < wh && r.y + r.height > 0);
      const windows = rects.filter(r => !r.is_taskbar && r.x < ww && r.x + r.width > 0 && r.y < wh && r.y + r.height > 0);

      let targetX = currentX;
      let targetY = currentY;
      let targetPose: BasePose = 'sit';

      if (s.anchor) {
        // Locked to a window or taskbar
        targetPose = Math.random() > 0.5 ? 'sit' : 'sleep';
        targetX = currentX;
        
        // Recalculate Y in case scale changed, ensuring perfect resting
        const edgeWorldY = -(s.anchor.rect.y - wh / 2) / 250;
        targetY = edgeWorldY + (s.anchor.type === 'taskbar' ? 1.2 : 1.15) * avatarScale;
        
        setBasePose(targetPose);
        setTargetPosition({ x: targetX, y: targetY, z: 0 });
        setIsWalking(true);
        return;
      }

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
      } else if (r < 0.80) {
        // Just wander around normally
        targetPose = 'stand';
        if (!s.isAvatarLocked) {
          targetX = minX + Math.random() * (maxX - minX);
          targetY = minY + Math.random() * (maxY - minY);
        }
      } else if (r < 0.90) {
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

    }, 8000); // 8-second interval so users don't wait forever to see magic

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
        const bottomY = -edgeY + 0.5 * newScale;
        s.setAvatarScale(newScale);
        setTargetPosition({ x: 0, y: bottomY, z: 0 });
        setBasePose('dynamic-talk');
      } else if (r < 0.75) {
        // 25% chance: Side edge, leaning in
        const newScale = 2.0;
        const bottomY = -edgeY + 0.5 * newScale;
        const isLeft = Math.random() > 0.5;
        s.setAvatarScale(newScale);
        setTargetPosition({ x: isLeft ? -edgeX + 0.3 : edgeX - 0.3, y: bottomY, z: 0 });
        setBasePose('lean');
      } else {
        // 25% chance: Standing up, offset, natural
        const newScale = 1.6;
        const bottomY = -edgeY + 0.5 * newScale;
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
        {avatarEngine === 'live2d' ? <Live2DViewer /> : <Avatar3D />}
      </div>
    </>,
    document.body
  );
}
