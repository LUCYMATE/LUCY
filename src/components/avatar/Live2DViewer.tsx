import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';
import { useAvatarState } from '../../lib/store/avatarState';
import { useEngineStore } from '../../lib/store/engineStore';
import { useShallow } from 'zustand/react/shallow';
import { AvatarContextMenu } from './AvatarContextMenu';
import { animationBridge } from './animations/avatarAnimationBridge';

const ZOOM = 250;

// Ensure PIXI is available globally for pixi-live2d-display
if (typeof window !== 'undefined') {
  (window as any).PIXI = PIXI;
  try {
    Live2DModel.registerTicker(PIXI.Ticker);
  } catch {
    // Already registered
  }
  // Global RAM Saving: aggressive texture GC mode
  try {
    PIXI.settings.GC_MODE = PIXI.GC_MODES.AUTO;
    PIXI.settings.GC_MAX_IDLE = 300; // GC unused textures every 5-10 seconds
  } catch (_) {}

  // Safe fallback if GPU or WebView2 throws checkMaxIfStatementsInShader
  if ((PIXI as any).BatchRenderer) {
    try {
      (PIXI as any).BatchRenderer.defaultMaxTextures = 16;
      (PIXI as any).BatchRenderer.prototype.contextChange = function () {
        const gl = this.renderer?.gl;
        if (!gl || gl.isContextLost?.()) {
          this.maxTextures = 1;
          this._shader = this.shaderGenerator.generateShader(1);
          this._packedGeometries = [];
          for (let i = 0; i < this._packedGeometryPoolSize; i++) {
            this._packedGeometries[i] = new this.geometryClass();
          }
          this.initFlushBuffers();
          return;
        }
        let units = 1;
        try {
          units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 1;
        } catch (_) {
          units = 1;
        }
        this.maxTextures = Math.max(1, Math.min(units, (PIXI as any).BatchRenderer.defaultMaxTextures || 16));
        try {
          if ((PIXI as any).checkMaxIfStatementsInShader) {
            this.maxTextures = (PIXI as any).checkMaxIfStatementsInShader(this.maxTextures, gl);
          }
        } catch (_) {
          this.maxTextures = 1;
        }
        this.maxTextures = Math.max(1, this.maxTextures || 1);
        this._shader = this.shaderGenerator.generateShader(this.maxTextures);
        this._packedGeometries = [];
        for (let i = 0; i < this._packedGeometryPoolSize; i++) {
          this._packedGeometries[i] = new this.geometryClass();
        }
        this.initFlushBuffers();
      };
    } catch (_) {}
  }
}

export function Live2DViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<InstanceType<typeof Live2DModel> | null>(null);
  const appLifecycleRef = useRef(0);
  const hitboxRef = useRef<HTMLDivElement>(null);
  const baseScaleRef = useRef(1);

  const [isAppReady, setIsAppReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Smoothed animation parameter values for natural transitions across bridge
  const animValuesRef = useRef<Record<string, number>>({
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    bodyAngleX: 0,
    bodyAngleZ: 0,
    eyeL: 1.0,
    eyeR: 1.0,
    eyeBallX: 0,
    eyeBallY: 0,
    mouthForm: 0,
    browLY: 0,
    browRY: 0,
    armLShoulder: 0,
    armLElbow: 0,
    armLWrist: 0,
    handL: 0,
    armRShoulder: 0,
    armRElbow: 0,
    armRWrist: 0,
    handR: 0,
  });

  const {
    selectedLive2dModel,
    avatarScale,
    basePose,
  } = useAvatarState(
    useShallow((s) => ({
      selectedLive2dModel: s.selectedLive2dModel,
      avatarScale: s.avatarScale,
      basePose: s.basePose,
    }))
  );

  // Dynamic FPS Limiter (Throttles PIXI ticker to 20-30 FPS on idle, 15 FPS on sleep, 60 FPS when active)
  useEffect(() => {
    const updateFps = () => {
      const app = appRef.current;
      if (!app) return;
      const lowFpsSetting = localStorage.getItem('lucy_low_fps') === 'true';
      const s = useAvatarState.getState();
      const isActive = s.isSpeaking || s.isThinking || s.isDragging;
      const targetFps = isActive
        ? (lowFpsSetting ? 30 : 60)
        : (s.basePose === 'sleep' ? 15 : (lowFpsSetting ? 20 : 30));

      app.ticker.maxFPS = targetFps;
      try {
        PIXI.Ticker.shared.maxFPS = targetFps;
      } catch (_) {}
    };

    updateFps();
    const unsub = useAvatarState.subscribe(updateFps);
    window.addEventListener('lucy-settings-changed', updateFps);
    return () => {
      unsub();
      window.removeEventListener('lucy-settings-changed', updateFps);
    };
  }, [isAppReady]);

  // Stop conflicting canned motions when procedural poses run so mathematical bridge drives model cleanly
  const prevPoseRef = useRef(basePose);
  useEffect(() => {
    if (prevPoseRef.current !== basePose) {
      prevPoseRef.current = basePose;
      const model = modelRef.current;
      if (model) {
        try {
          const isProcedural = /dance|kiss|point|stretch|lean|caress|lie-down|edge-lean|dynamic-talk|sit|sleep/i.test(basePose);
          if (isProcedural) {
            model.stopMotions();
          }
        } catch (_) {}
      }
    }
  }, [basePose]);

  // Pointer & Drag handling
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    startWorldX: number;
    startWorldY: number;
    hasMoved: boolean;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Left click only
    const s = useAvatarState.getState();
    if (s.isSpeaking) {
      try {
        useEngineStore.getState().interruptSpeech();
      } catch (_) {}
    }
    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWorldX: s.worldPosition.x,
      startWorldY: s.worldPosition.y,
      hasMoved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const info = dragInfoRef.current;
    if (!info) return;

    const deltaX = e.clientX - info.startX;
    const deltaY = e.clientY - info.startY;

    if (!info.hasMoved && Math.hypot(deltaX, deltaY) > 6) {
      info.hasMoved = true;
      const s = useAvatarState.getState();
      s.setIsDragging(true);
      s.setBasePose('stand');
      s.setIsWalking(false);
    }

    if (info.hasMoved) {
      const s = useAvatarState.getState();
      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const edgeX = (ww / 2) / ZOOM;
      const edgeY = (wh / 2) / ZOOM;

      const newWorldX = Math.max(-edgeX, Math.min(edgeX, info.startWorldX + deltaX / ZOOM));
      const newWorldY = Math.max(-edgeY, Math.min(edgeY + 0.3 * avatarScale, info.startWorldY - deltaY / ZOOM));

      s.setWorldPosition({ x: newWorldX, y: newWorldY, z: 0 });
      s.setTargetPosition({ x: newWorldX, y: newWorldY, z: 0 });
      s.setDragOffset({ x: deltaX / ZOOM, y: -deltaY / ZOOM });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const info = dragInfoRef.current;
    dragInfoRef.current = null;
    const s = useAvatarState.getState();

    if (info && !info.hasMoved) {
      const model = modelRef.current;
      if (model) {
        try {
          model.tap(e.clientX, e.clientY);
        } catch (_) {}

        // Sweet procedural tap reaction without disparate canned motion files
        s.setEmotion('happy');
        setTimeout(() => {
          if (useAvatarState.getState().emotion === 'happy') {
            useAvatarState.getState().setEmotion('neutral');
          }
        }, 2200);
      }
    } else if (info && info.hasMoved) {
      s.setIsDragging(false);
      s.setDragOffset({ x: 0, y: 0 });

      // Grounding & snapping check
      const finalX = s.worldPosition.x;
      const finalY = s.worldPosition.y;
      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const screenX = finalX * ZOOM + ww / 2;
      const feetY = finalY - 1.2 * avatarScale;
      const screenFeetY = -feetY * ZOOM + wh / 2;

      let snapped = false;
      if (s.desktopRectangles) {
        const threshold = 50;
        for (const rect of s.desktopRectangles) {
          if (screenX >= rect.x - 50 && screenX <= rect.x + rect.width + 50) {
            const isMatch = rect.is_taskbar
              ? screenFeetY > rect.y - threshold
              : Math.abs(screenFeetY - rect.y) < threshold;

            if (isMatch) {
              snapped = true;
              s.setAnchor({ type: rect.is_taskbar ? 'taskbar' : 'window', rect });
              const edgeWorldY = -(rect.y - wh / 2) / ZOOM;
              s.setTargetPosition({
                x: finalX,
                y: edgeWorldY + (rect.is_taskbar ? 1.2 : 1.15) * avatarScale,
                z: 0,
              });
              s.setIsAvatarLocked(true);
              s.setBasePose('sit');
              break;
            }
          }
        }
      }

      if (!snapped) {
        s.setAnchor(null);
        s.setTargetPosition({ x: finalX, y: finalY, z: 0 });
        if (s.isAvatarLocked) {
          s.setLockedPosition({ x: finalX, y: finalY, z: 0 });
        }
      }

      if (s.basePose.startsWith('peek')) {
        s.setBasePose('stand');
        s.setPrePeekPosition(null);
      }
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleCloseMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.avatar-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleCloseMenu);
    return () => window.removeEventListener('pointerdown', handleCloseMenu);
  }, []);

  // 1. Initialize PIXI.Application once per component lifecycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const lifecycle = ++appLifecycleRef.current;
    let app = appRef.current;
    try {
      // React StrictMode replays Effects in development. Reuse the same renderer
      // during that replay instead of destroying and re-binding its WebGL canvas.
      if (!app) {
        app = new PIXI.Application({
          view: canvas,
          resizeTo: window,
          backgroundAlpha: 0,
          antialias: false, // Disables 4x MSAA renderbuffers, saving ~100MB+ GPU RAM
          autoDensity: true,
          powerPreference: 'low-power',
          resolution: Math.min(window.devicePixelRatio || 1, 1.25), // Caps canvas framebuffer on high-DPI screens
        });
        appRef.current = app;
      }
      // Set initial maxFPS cap to prevent runaway CPU loops
      app.ticker.maxFPS = 30;
      try {
        PIXI.Ticker.shared.maxFPS = 30;
      } catch (_) {}

      // Cubism 4 mask FBO clearColor sanitization:
      // Cubism 4 sets gl.clearColor(1, 1, 1, 1) during mask rendering and never restores it.
      // Restore gl.clearColor(0, 0, 0, 0) after every render frame to guarantee full transparency.
      try {
        app.renderer.on('postrender', () => {
          const gl = (app.renderer as any).gl as WebGLRenderingContext | null;
          if (gl && typeof gl.clearColor === 'function' && !gl.isContextLost?.()) {
            gl.clearColor(0, 0, 0, 0);
          }
        });
      } catch (_) {}

      setIsAppReady(true);
    } catch (e) {
      console.error('[Live2DViewer] Failed to initialize PIXI Application:', e);
      setLoadError(`Failed to initialize WebGL: ${e instanceof Error ? e.message : String(e)}`);
      setIsLoading(false);
    }

    // Background Inactivity Throttling: Pause ticker when minimized or tab/window hidden
    const handleVisibilityChange = () => {
      if (!appRef.current) return;
      if (document.hidden) {
        appRef.current.ticker.stop();
      } else {
        appRef.current.ticker.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Defer destruction one microtask. StrictMode immediately re-runs setup;
      // the next setup increments the lifecycle and cancels this simulated teardown.
      queueMicrotask(() => {
        if (appLifecycleRef.current !== lifecycle || !app || appRef.current !== app) return;
        try {
          app.stop();
          PIXI.utils.clearTextureCache();
          app.destroy(false, { children: true, texture: true, baseTexture: true });
        } catch (e) {
          console.warn('[Live2DViewer] Renderer cleanup failed:', e);
        } finally {
          appRef.current = null;
          modelRef.current = null;
        }
      });
    };
  }, []);

  // 2. Load & Swap Live2D Models inside the existing PIXI application
  useEffect(() => {
    if (!isAppReady || !appRef.current) return;
    const app = appRef.current;

    let isCancelled = false;
    setIsLoading(true);
    setLoadError(null);

    // Safely tear down previous model from the stage and remove all internal listeners to prevent memory leak
    if (modelRef.current) {
      try {
        const oldModel = modelRef.current;
        const internal = oldModel.internalModel as any;
        if (internal) {
          internal.removeAllListeners?.('beforeModelUpdate');
          internal.removeAllListeners?.();
        }
        app.stage.removeChild(oldModel);
        oldModel.destroy({ children: true, texture: true, baseTexture: true });
      } catch (_) {}
      modelRef.current = null;

      // Aggressively flush PIXI texture cache & invoke WebGL texture GC
      try {
        PIXI.utils.clearTextureCache();
        if (app.renderer && (app.renderer as any).textureGC) {
          (app.renderer as any).textureGC.run();
        }
      } catch (_) {}
    }

    const modelPath = `/live2d/models/${selectedLive2dModel}/${selectedLive2dModel}.model3.json`;

    Live2DModel.from(modelPath, { autoHitTest: false, autoFocus: false })
      .then((model) => {
        if (isCancelled) {
          try {
            model.destroy({ children: true, texture: true, baseTexture: true });
          } catch (_) {}
          return;
        }

        modelRef.current = model;

        // Anchor at bottom-center so avatar stands grounded
        model.anchor.set(0.5, 0.88);

        // Normalize initial scale
        const designHeight = (model.internalModel as any)?.height || model.height || 2048;
        const targetHeight = 420;
        const baseScale = targetHeight / designHeight;
        baseScaleRef.current = baseScale;

        const currentScale = useAvatarState.getState().avatarScale || 1.0;
        model.scale.set(baseScale * currentScale);

        // Position model centered on screen
        const s = useAvatarState.getState();
        const curPos = s.worldPosition;
        const screenX = curPos.x * ZOOM + window.innerWidth / 2;
        const screenY = -curPos.y * ZOOM + window.innerHeight / 2;
        model.position.set(screenX, screenY);

        // Real-time animation, lip-sync, gestures & poses hook via AnimationBridge
        const internal = model.internalModel as any;
        if (internal) {
          // Completely deactivate and clear all disparate built-in motions (.motion3.json)
          // so all models execute identical, synchronized procedural animations
          try {
            model.stopMotions();
            internal.motionManager?.stopAllMotions();
          } catch (_) {}

          if (internal.motionManager) {
            internal.motionManager.groups = {};
            internal.motionManager.definitions = {};
            internal.motionManager.defaultIdleMotion = '';
            internal.motionManager.playing = false;
            if (internal.motionManager.state) {
              internal.motionManager.state.shouldRequestIdleMotion = () => false;
            }
          }

          if (internal.settings) {
            internal.settings.motions = {};
          }

          model.motion = () => Promise.resolve(false);

          internal.on('beforeModelUpdate', () => {
            const state = useAvatarState.getState();
            const core = internal.coreModel;
            if (!core) return;

            const t = performance.now() / 1000;
            const gestures = animationBridge.computeGestures({
              t,
              isSpeaking: state.isSpeaking,
              isThinking: state.isThinking,
              isListening: state.isListening,
              basePose: state.basePose,
              emotion: state.emotion,
              avatarScale: state.avatarScale || 1.0,
            });

            // Unified parameter application driving head, body, face, and talking hand/arm gestures
            animationBridge.applyToLive2DModel(
              model,
              selectedLive2dModel,
              gestures,
              animValuesRef.current,
              0.16
            );
          });
        }

        app.stage.addChild(model);
        setIsLoading(false);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error('[Live2DViewer] Failed to load model:', err);
        setLoadError(String(err?.message || err));
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedLive2dModel, isAppReady]);

  // Window mouse tracking for Live2D focus (throttled to 30Hz to prevent CPU spikes on mouse move)
  useEffect(() => {
    let lastFocusTime = 0;
    const handleGlobalPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastFocusTime < 33) return;
      lastFocusTime = now;
      const model = modelRef.current;
      if (model) {
        model.focus(e.clientX, e.clientY);
      }
    };
    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handleGlobalPointerMove);
  }, []);

  // Frame update loop for stationary placement, sitting offset, smooth scaling, and direct DOM hitboxes
  // Zero React re-renders to maintain minimal, stable CPU/RAM usage
  useEffect(() => {
    let lastFrameTime = performance.now();
    let animationFrameId = 0;

    const updateLoop = () => {
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastFrameTime) / 1000);
      lastFrameTime = now;

      const s = useAvatarState.getState();
      const model = modelRef.current;

      if (model) {
        const currentScale = s.avatarScale || 1.0;
        const curPos = s.worldPosition;
        let targetScreenX = curPos.x * ZOOM + window.innerWidth / 2;
        let targetScreenY = -curPos.y * ZOOM + window.innerHeight / 2;
        const isSitting = s.basePose === 'sit' || s.basePose === 'sitting';
        const sitOffset = (isSitting ? 40 : 0) * currentScale;

        // Screen-Edge Peeking Positioning & Dance Hip Bounce
        const isPeekLeft = s.basePose === 'peek-left';
        const isPeekRight = s.basePose === 'peek-right';
        const peekBobY = (s.basePose.startsWith('peek') ? Math.sin(now / 350) * 4 : 0) * currentScale;
        const isDancing = s.basePose === 'dance' || s.basePose === 'dancing';
        const danceBobY = (isDancing ? Math.sin(now / 150) * 7.5 : 0) * currentScale;

        if (isPeekLeft) {
          // Dock to left screen edge with avatar peeking inward
          targetScreenX = 70 * currentScale;
        } else if (isPeekRight) {
          // Dock to right screen edge with avatar peeking inward
          targetScreenX = window.innerWidth - 70 * currentScale;
        }

        const targetY = targetScreenY + sitOffset + peekBobY + danceBobY;

        // Smoothly lerp model position
        const curX = model.position.x || targetScreenX;
        const curY = model.position.y || targetY;
        const nextX = curX + (targetScreenX - curX) * Math.min(1, delta * 8.0);
        const nextY = curY + (targetY - curY) * Math.min(1, delta * 8.0);

        model.position.set(nextX, nextY);

        // Smooth scale
        const baseScale = baseScaleRef.current || 1;
        const currentFactor = model.scale.x / baseScale;
        if (Math.abs(currentFactor - currentScale) > 0.002) {
          const nextFactor = currentFactor + (currentScale - currentFactor) * Math.min(1, delta * 6.0);
          model.scale.set(baseScale * nextFactor);
        }

        // Direct DOM Hitbox positioning without React state updates (prevents 60Hz component re-renders)
        const dw = Math.max(160, model.width * 0.85);
        const dh = Math.max(240, model.height * 0.95);
        const el = hitboxRef.current;
        if (el) {
          const leftPx = `${Math.round(nextX - dw / 2)}px`;
          const topPx = `${Math.round(nextY - dh * 0.88)}px`;
          const widthPx = `${Math.round(dw)}px`;
          const heightPx = `${Math.round(dh)}px`;

          if (el.style.left !== leftPx) el.style.left = leftPx;
          if (el.style.top !== topPx) el.style.top = topPx;
          if (el.style.width !== widthPx) el.style.width = widthPx;
          if (el.style.height !== heightPx) el.style.height = heightPx;
        }
      }

      animationFrameId = requestAnimationFrame(updateLoop);
    };

    animationFrameId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="w-full h-full pointer-events-none relative select-none">
      <canvas ref={canvasRef} className="w-full h-full pointer-events-none absolute inset-0" />

      {/* Pulsing loading indicator */}
      {isLoading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none">
          <div className="w-9 h-9 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 animate-ping opacity-75" />
          <span className="text-[11px] font-bold text-pink-300 uppercase tracking-wider animate-pulse">
            Loading {selectedLive2dModel}...
          </span>
        </div>
      )}

      {/* Error notification if asset fails to load */}
      {loadError && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-red-600/90 backdrop-blur-md text-white px-4 py-2 rounded-xl text-xs font-bold border border-red-400 pointer-events-auto shadow-2xl">
          Live2D Load Error: {loadError}
        </div>
      )}

      {/* Draggable Hitbox over the avatar - zero React re-renders for ultra-low CPU */}
      {!isLoading && (
        <div
          ref={hitboxRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={handleContextMenu}
          className="fixed cursor-grab active:cursor-grabbing pointer-events-auto z-[60]"
          style={{
            left: 0,
            top: 0,
            width: 200,
            height: 380,
            borderRadius: '24px',
            willChange: 'left, top',
          }}
          title={`${selectedLive2dModel.toUpperCase()} (Live2D) - Drag to move, Tap to interact, Right-click for menu`}
        />
      )}

      {/* Radial Context Menu */}
      {contextMenu &&
        createPortal(
          <AvatarContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
          />,
          document.body
        )}
    </div>
  );
}
