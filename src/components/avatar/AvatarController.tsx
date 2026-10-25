import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
// @ts-ignore
import { createPortal } from 'react-dom';
import { AvatarErrorBoundary } from './AvatarErrorBoundary';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { BasePose } from './animations/core';
import { DesktopRect } from '../../lib/store/avatarState';
import { listenCrossWindow } from '../../lib/events/crossWindowEventBus';
import { AVATAR_CONFIGURATION_CHANGED, type AvatarConfigurationChange } from '../../lib/store/avatarConfiguration';

const Avatar3D = lazy(() => import('./Avatar3D').then(module => ({ default: module.Avatar3D })));
let live2dCorePromise: Promise<void> | null = null;
const Live2DViewer = lazy(async () => {
  if (!(window as any).Live2DCubismCore) {
    if (!live2dCorePromise) {
      live2dCorePromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/live2d/core/live2dcubismcore.min.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          live2dCorePromise = null;
          reject(new Error('Could not load the Live2D runtime.'));
        };
        document.head.appendChild(script);
      });
    }
    await live2dCorePromise;
  }
  const module = await import('./Live2DViewer');
  return { default: module.Live2DViewer };
});

interface AvatarControllerProps {
  onLoad?: () => void;
}

export function AvatarController({ onLoad }: AvatarControllerProps) {
  const [readyEngine, setReadyEngine] = useState<string | null>(null);
  // Settings runs in another WebView, so its Zustand store is not the renderer's store.
  useEffect(() => listenCrossWindow<AvatarConfigurationChange>(AVATAR_CONFIGURATION_CHANGED, (change) => {
    const updates: Partial<ReturnType<typeof useAvatarState.getState>> = {};

    if (change.avatarEngine === 'vrm' || change.avatarEngine === 'live2d') {
      updates.avatarEngine = change.avatarEngine;
      localStorage.setItem('lucy_avatar_engine', change.avatarEngine);
    }
    if (typeof change.selectedLive2dModel === 'string' && change.selectedLive2dModel.trim()) {
      updates.selectedLive2dModel = change.selectedLive2dModel;
      localStorage.setItem('lucy_live2d_model', change.selectedLive2dModel);
    }
    if (typeof change.avatarSize === 'number' && Number.isFinite(change.avatarSize)) {
      const size = Math.max(50, Math.min(200, Math.round(change.avatarSize)));
      localStorage.setItem('lucy_avatar_size', String(size));
      updates.avatarScale = size / 100;
    }
    if (Object.keys(updates).length > 0) useAvatarState.setState(updates);
  }), []);

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
    isSleepMode,
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
    isSleepMode: s.isSleepMode,
  })));

  const markRendererReady = useCallback(() => {
    setReadyEngine(avatarEngine);
    onLoad?.();
  }, [avatarEngine, onLoad]);

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
        }))
        
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

  if (isSleepMode) {
    return null;
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 pointer-events-none z-[50]"
      >
        <AvatarErrorBoundary key={avatarEngine}>
          <Suspense fallback={null}>
            {avatarEngine === 'live2d'
              ? <Live2DViewer onReady={markRendererReady} />
              : <Avatar3D onReady={markRendererReady} />}
          </Suspense>
        </AvatarErrorBoundary>
        {readyEngine !== avatarEngine && <AvatarEngineFallback />}
      </div>
    </>,
    document.body
  );
}

function AvatarEngineFallback() {
  const { avatarScale, worldPosition, setIsDragging, setWorldPosition, setTargetPosition, setDragOffset, setBasePose, setIsWalking } =
    useAvatarState(useShallow(s => ({
      avatarScale: s.avatarScale,
      worldPosition: s.worldPosition,
      setIsDragging: s.setIsDragging,
      setWorldPosition: s.setWorldPosition,
      setTargetPosition: s.setTargetPosition,
      setDragOffset: s.setDragOffset,
      setBasePose: s.setBasePose,
      setIsWalking: s.setIsWalking,
    })));
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; worldX: number; worldY: number } | null>(null);
  const width = 210 * avatarScale;
  const height = 420 * avatarScale;

  useEffect(() => () => {
    if (dragRef.current) {
      setIsDragging(false);
      setDragOffset({ x: 0, y: 0 });
    }
  }, [setDragOffset, setIsDragging]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      worldX: worldPosition.x,
      worldY: worldPosition.y,
    };
    setIsDragging(true);
    setBasePose('stand');
    setIsWalking(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const x = Math.max(-window.innerWidth / 500, Math.min(window.innerWidth / 500, drag.worldX + (event.clientX - drag.startX) / 250));
    const y = Math.max(-window.innerHeight / 500, Math.min(window.innerHeight / 500, drag.worldY - (event.clientY - drag.startY) / 250));
    const position = { x, y, z: 0 };
    setWorldPosition(position);
    setTargetPosition(position);
    setDragOffset({ x: (event.clientX - drag.startX) / 250, y: -(event.clientY - drag.startY) / 250 });
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
  };

  return (
    <div
      aria-label="Avatar loading; drag to move"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      className="fixed pointer-events-auto cursor-grab active:cursor-grabbing z-[60]"
      style={{
        left: `calc(50% + ${worldPosition.x * 250 - width / 2}px)`,
        top: `calc(50% - ${worldPosition.y * 250 + height * 0.88}px)`,
        width,
        height,
        opacity: 0,
        touchAction: 'none',
      }}
    />
  );
}
