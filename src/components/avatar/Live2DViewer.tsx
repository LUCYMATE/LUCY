import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { AvatarContextMenu } from './AvatarContextMenu';

const ZOOM = 250;

// Ensure PIXI is available globally for pixi-live2d-display
if (typeof window !== 'undefined') {
  (window as any).PIXI = PIXI;
  try {
    Live2DModel.registerTicker(PIXI.Ticker);
  } catch {
    // Already registered
  }

  // WebView2 ANGLE shader guard:
  // On Windows WebView2 ANGLE D3D11, checkMaxIfStatementsInShader's compilation test
  // can fail down to 0 and throw "Invalid value of 0 passed to checkMaxIfStatementsInShader".
  // Fix: patch checkMaxIfStatementsInShader and safely catch errors in contextChange, falling back to 1 texture.
  try {
    if ((PIXI as any).BatchRenderer) {
      const origContextChange = (PIXI as any).BatchRenderer.prototype.contextChange;
      (PIXI as any).BatchRenderer.prototype.contextChange = function (this: any) {
        try {
          return origContextChange.call(this);
        } catch (err) {
          console.warn('[Live2DViewer] Safe BatchRenderer fallback to maxTextures=1:', err);
          this.maxTextures = 1;
          this._shader = this.shaderGenerator.generateShader(1);
          if (!this._packedGeometries) {
            this._packedGeometries = [];
          }
          for (let i = 0; i < this._packedGeometryPoolSize; i++) {
            this._packedGeometries[i] = new this.geometryClass();
          }
          this.initFlushBuffers();
        }
      };
    }
  } catch (_) {}
}

export function Live2DViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<InstanceType<typeof Live2DModel> | null>(null);
  const baseScaleRef = useRef(1);
  const isSpeakingRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hitbox, setHitbox] = useState({ left: 0, top: 0, width: 200, height: 380 });

  const { selectedLive2dModel, isSpeaking, avatarScale } = useAvatarState(
    useShallow((s) => ({
      selectedLive2dModel: s.selectedLive2dModel,
      isSpeaking: s.isSpeaking,
      avatarScale: s.avatarScale,
    }))
  );

  // Keep speaking ref in sync without triggering re-renders
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Drag state
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    startWorldX: number;
    startWorldY: number;
    hasMoved: boolean;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useAvatarState.getState();
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
    }
    if (info.hasMoved) {
      const s = useAvatarState.getState();
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      const edgeX = (ww / 2) / ZOOM;
      const edgeY = (wh / 2) / ZOOM;
      const newWorldX = Math.max(-edgeX, Math.min(edgeX, info.startWorldX + deltaX / ZOOM));
      const newWorldY = Math.max(-edgeY, Math.min(edgeY, info.startWorldY - deltaY / ZOOM));
      s.setWorldPosition({ x: newWorldX, y: newWorldY, z: 0 });
      s.setTargetPosition({ x: newWorldX, y: newWorldY, z: 0 });
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
        try { model.tap(e.clientX, e.clientY); } catch (_) {}
        s.setEmotion('happy');
        setTimeout(() => {
          if (useAvatarState.getState().emotion === 'happy') {
            useAvatarState.getState().setEmotion('neutral');
          }
        }, 2200);
      }
    } else if (info && info.hasMoved) {
      s.setIsDragging(false);
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
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

  // Main Live2D Initialization & Lifecycle — exact fba6cda approach
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create PIXI Application — identical to working commit fba6cda.
    // Do NOT pass backgroundColor alongside backgroundAlpha; only backgroundAlpha: 0.
    let app: PIXI.Application;
    try {
      app = new PIXI.Application({
        view: canvas,
        resizeTo: window,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 1.25),
      });

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
    } catch (initErr: any) {
      console.error('[Live2DViewer] Failed to initialize PIXI Application:', initErr);
      setLoadError(initErr?.message ? `Failed to initialize WebGL: ${initErr.message}` : 'Failed to initialize WebGL');
      setIsLoading(false);
      return;
    }
    appRef.current = app;

    const modelPath = `/live2d/models/${selectedLive2dModel}/${selectedLive2dModel}.model3.json`;

    Live2DModel.from(modelPath, { autoInteract: false })
      .then((model) => {
        if (isCancelled) {
          model.destroy({ children: true, texture: true, baseTexture: true });
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

        model.scale.set(baseScale * (useAvatarState.getState().avatarScale || 1.0));

        // Initial position
        const currentPos = useAvatarState.getState().worldPosition;
        const screenX = currentPos.x * ZOOM + window.innerWidth / 2;
        const screenY = -currentPos.y * ZOOM + window.innerHeight / 2;
        model.position.set(screenX, screenY);

        // Real-time lip sync via beforeModelUpdate hook
        const internal = model.internalModel as any;
        if (internal) {
          internal.on('beforeModelUpdate', () => {
            if (isSpeakingRef.current) {
              const t = performance.now() / 1000;
              const aa = Math.min(1.0, Math.max(0, Math.sin(t * 15.0) * 1.4 + Math.sin(t * 8.5) * 0.5));
              const core = internal.coreModel;
              if (core) {
                try { core.setParameterValueById('ParamMouthOpenY', aa); } catch (_) {}
                try { core.setParameterValueById('ParamA', aa); } catch (_) {}
                try { core.setParameterValueById('PARAM_MOUTH_OPEN_Y', aa); } catch (_) {}
              }
            }
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

    // Window mouse tracking for eye focus
    const handleGlobalPointerMove = (e: PointerEvent) => {
      const model = modelRef.current;
      if (model) {
        model.focus(e.clientX, e.clientY);
      }
    };
    window.addEventListener('pointermove', handleGlobalPointerMove);

    // Animation & Position Update Loop
    let lastFrameTime = performance.now();
    const updateLoop = () => {
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastFrameTime) / 1000);
      lastFrameTime = now;

      const s = useAvatarState.getState();
      const model = modelRef.current;

      if (model) {
        // Lerp towards targetPosition if active
        if (s.targetPosition && !s.isDragging) {
          const cur = s.worldPosition;
          const tgt = s.targetPosition;
          const diffX = tgt.x - cur.x;
          const diffY = tgt.y - cur.y;
          const dist = Math.hypot(diffX, diffY);

          if (dist > 0.005) {
            const nextX = cur.x + diffX * Math.min(1, delta * 3.5);
            const nextY = cur.y + diffY * Math.min(1, delta * 3.5);
            s.setWorldPosition({ x: nextX, y: nextY, z: 0 });
          } else {
            s.setTargetPosition(null);
            s.setIsWalking(false);
          }
        }

        // Apply world position to screen coordinates
        const curPos = s.worldPosition;
        const sx = curPos.x * ZOOM + window.innerWidth / 2;
        const sy = -curPos.y * ZOOM + window.innerHeight / 2;
        model.position.set(sx, sy);

        // Smooth scale
        const currentFactor = model.scale.x / (baseScaleRef.current || 1);
        const targetFactor = s.avatarScale || 1;
        if (Math.abs(currentFactor - targetFactor) > 0.002) {
          const nextFactor = currentFactor + (targetFactor - currentFactor) * Math.min(1, delta * 6.0);
          model.scale.set(baseScaleRef.current * nextFactor);
        }

        // Update Hitbox bounds
        const dw = Math.max(160, model.width * 0.85);
        const dh = Math.max(220, model.height * 0.95);
        setHitbox({
          left: sx - dw / 2,
          top: sy - dh * 0.88,
          width: dw,
          height: dh,
        });
      }

      animationFrameId = requestAnimationFrame(updateLoop);
    };

    let animationFrameId = requestAnimationFrame(updateLoop);

    // Unmount and WebGL cleanup
    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointermove', handleGlobalPointerMove);

      if (modelRef.current) {
        try {
          modelRef.current.destroy({ children: true, texture: true, baseTexture: true });
        } catch (_) {}
        modelRef.current = null;
      }

      if (appRef.current) {
        try {
          appRef.current.stop();
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch (_) {}
        appRef.current = null;
      }

      // Discard WebGL Context
      if (canvas) {
        try {
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          const ext = gl?.getExtension('WEBGL_lose_context');
          ext?.loseContext();
        } catch (_) {}
      }
    };
  }, [selectedLive2dModel]);

  return (
    <div className="w-full h-full pointer-events-none relative select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full pointer-events-none absolute inset-0 bg-transparent"
        style={{ background: 'transparent' }}
      />

      {/* Pulsing loading orb while model loads */}
      {isLoading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none">
          <div className="w-9 h-9 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 animate-ping opacity-75" />
          <span className="text-[11px] font-bold text-pink-300 uppercase tracking-wider animate-pulse">
            Loading {selectedLive2dModel}...
          </span>
        </div>
      )}

      {/* Error display if asset missing */}
      {loadError && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-red-600/90 backdrop-blur-md text-white px-4 py-2 rounded-xl text-xs font-bold border border-red-400 pointer-events-auto shadow-2xl">
          Live2D Load Error: {loadError}
        </div>
      )}

      {/* Draggable Hitbox over the avatar */}
      {!isLoading && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={handleContextMenu}
          className="fixed cursor-grab active:cursor-grabbing pointer-events-auto z-[60]"
          style={{
            left: `${hitbox.left}px`,
            top: `${hitbox.top}px`,
            width: `${hitbox.width}px`,
            height: `${hitbox.height}px`,
            borderRadius: '24px',
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
