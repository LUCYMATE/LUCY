import { useEffect, useRef } from 'react';
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

  // Autonomous Pose & Animation Orchestrator (Stationary - No Walking)
  // Only cycles through calm, companion idle poses. Dance and Kiss are strictly on-demand.
  useEffect(() => {
    const poseInterval = setInterval(() => {
      const s = useAvatarState.getState();

      // Pause pose cycling for 60 seconds after a manual pose override
      const timeSinceLastOverride = Date.now() - s.lastPoseOverrideTime;
      if (timeSinceLastOverride < 60000) return;

      if (s.isSpeaking || s.isThinking || s.isDragging || s.basePose.startsWith('peek')) return;

      const r = Math.random();
      let targetPose: BasePose = s.basePose;

      if (s.anchor) {
        // Snapped to a window or taskbar
        targetPose = Math.random() > 0.4 ? 'sit' : 'sleep';
      } else if (r < 0.35) {
        targetPose = 'sit';
      } else if (r < 0.70) {
        targetPose = 'stand';
      } else if (r < 0.85) {
        targetPose = 'stretch';
      } else if (r < 0.95) {
        targetPose = 'lean';
      } else {
        targetPose = 'sleep';
      }

      setBasePose(targetPose);
      setIsWalking(false);
    }, 12000);

    return () => {
      clearInterval(poseInterval);
    };
  }, [isSpeaking, isListening, isThinking, isDragging, setBasePose, setIsWalking]);

  // Performance Pose Reversion Manager (Dancing / Kissing / Point / Caress play on-demand, then return to idle)
  useEffect(() => {
    const isSpecialAction = 
      basePose === 'flying-kiss' || 
      basePose.includes('kiss') || 
      basePose === 'dance' || 
      basePose === 'dancing' ||
      basePose === 'point' ||
      basePose === 'caress';

    if (isSpecialAction) {
      // Synchronized duration matching 3D FBX clips (kiss: 4.8s, dance: 8.0s, point: 4.0s)
      const duration = basePose.includes('kiss') ? 4800 : (basePose === 'point' ? 4000 : 8000);
      const timer = setTimeout(() => {
        const s = useAvatarState.getState();
        // Only auto-revert if avatar is not actively speaking (speech-completion handler handles the rest)
        if (!s.isSpeaking) {
          const currentP = (s.basePose || '').toLowerCase();
          if (/dance|kiss|point|caress/i.test(currentP)) {
            s.setBasePose(s.anchor ? 'sit' : 'stand');
          }
        }
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [basePose]);

  // Speech-Completion Pose Stopper: When avatar finishes talking, immediately stop action & performance poses
  const prevSpeakingRef = useRef(isSpeaking);
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = isSpeaking;

    if (wasSpeaking && !isSpeaking) {
      const s = useAvatarState.getState();
      const p = (s.basePose || '').toLowerCase();
      // If currently dancing, blowing kiss, pointing, caressing, or talking, return to calm idle immediately
      if (/dynamic-talk|lean|dance|kiss|point|caress/i.test(p)) {
        s.setBasePose(s.anchor ? 'sit' : 'stand');
      }
      s.setPreSpeakingState(null);
      s.setIsWalking(false);
    }
  }, [isSpeaking]);

  // Screen Edge Peeking Coordinator (Positions avatar at screen edge when peeking)
  useEffect(() => {
    const s = useAvatarState.getState();
    const ZOOM = 250;
    const halfWidth = (window.innerWidth / 2) / ZOOM;

    if (basePose === 'peek-left' || basePose === 'peek-right') {
      if (!s.prePeekPosition) {
        s.setPrePeekPosition({ ...s.worldPosition });
      }
      const edgeTargetX = basePose === 'peek-left'
        ? -halfWidth + 0.28
        : halfWidth - 0.28;

      s.setTargetPosition({
        x: edgeTargetX,
        y: s.worldPosition.y,
        z: 0,
      });
    } else if (s.prePeekPosition) {
      // Exiting peek mode: return to pre-peek position
      s.setTargetPosition({ ...s.prePeekPosition });
      s.setPrePeekPosition(null);
    }
  }, [basePose]);

  // Dynamic Talking (Desktop Mate Style) Orchestrator (Stationary)
  useEffect(() => {
    const s = useAvatarState.getState();
    if (!s.isDynamicTalkingEnabled) return;

    if (isSpeaking) {
      if (!s.preSpeakingState) {
        s.setPreSpeakingState({
          position: { ...s.worldPosition },
          scale: s.avatarScale,
          pose: s.basePose,
        });
      }

      const r = Math.random();
      if (r < 0.5) {
        setBasePose('dynamic-talk');
      } else if (r < 0.75) {
        setBasePose('lean');
      } else {
        setBasePose('stand');
      }
      setIsWalking(false);
    } else {
      if (s.preSpeakingState) {
        const revertPose = s.anchor ? 'sit' : (s.preSpeakingState.pose === 'dynamic-talk' ? 'stand' : s.preSpeakingState.pose);
        setBasePose(revertPose);
        s.setPreSpeakingState(null);
        setIsWalking(false);
      }
    }
  }, [isSpeaking, setBasePose, setIsWalking]);

  return createPortal(
    <>
      <div className="fixed inset-0 pointer-events-none z-[50]">
        {avatarEngine === 'live2d' ? <Live2DViewer /> : <Avatar3D />}
      </div>
    </>,
    document.body
  );
}
