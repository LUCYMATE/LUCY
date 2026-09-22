import { useState, useEffect, Suspense, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel, clearVrmCache, clearAssetResolutionCache } from './VrmModel';
import { clearFbxCache } from './animations/useFbxAnimation';
import { useAvatarState } from '../../lib/store/avatarState';
import { useEngineStore } from '../../lib/store/engineStore';
import { useShallow } from 'zustand/react/shallow';
import { X, Lock, Unlock, Mic, MicOff, Settings, MessageCircle, Maximize2, Power, Wand2, CalendarClock, Trash2, Clock, Terminal, Layers, ChevronLeft, LogOut } from 'lucide-react';
import { emitCrossWindow, listenCrossWindow } from '../../lib/events/crossWindowEventBus';
import { AvatarContextMenu } from './AvatarContextMenu';

// Highly optimized FPS limiter using rAF instead of setInterval
function FpsLimiter() {
  const { invalidate } = useThree();
  const [limit, setLimit] = useState(() => localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
  const isActive = useRef(false);

  useEffect(() => {
    const handleFpsChange = () => setLimit(localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
    const unsub = listenCrossWindow('soltini-settings-changed', handleFpsChange);
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = useAvatarState.subscribe((s) => {
      isActive.current = s.isSpeaking || s.isThinking || s.isWalking || s.isDragging;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let lastTime = 0;
    let frameId = 0;

    const loop = (time: number) => {
      // 60/30 FPS when active, 15 FPS when idle to keep breathing/blinking alive with 4x less CPU overhead
      const currentLimit = isActive.current ? limit : 15;
      const interval = 1000 / currentLimit;

      if (time - lastTime >= interval) {
        lastTime = time - ((time - lastTime) % interval);
        invalidate();
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [limit, invalidate]);
  return null;
}

// Forces Chromium to discard the WebGL context and GPU memory immediately when Canvas unmounts
function WebGLContextLoser() {
  const { gl } = useThree();
  useEffect(() => {
    return () => {
      setTimeout(() => {
        try {
          const ext = gl.extensions.get('WEBGL_lose_context') as any;
          if (ext) ext.loseContext();
          gl.dispose();
        } catch (e) {
          console.error("Failed to aggressively release WebGL Context", e);
        }
      }, 0);
    };
  }, [gl]);
  return null;
}

function Stool({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <group position={[0, 0, -0.1]} scale={1}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 32]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.225, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.45, 16]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.3} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 32]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} metalness={0.2} />
      </mesh>
    </group>
  );
}

// Optimized WebGL particles without heavy <Html> DOM overhead
function FlyingKisses({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<any[]>([]);
  const hasSpawnedRef = useRef<boolean>(false);
  const lastSpawnTimeRef = useRef<number>(0);

  // Pre-create geometry and material to avoid GC hitches
  const particleGeo = useMemo(() => new THREE.PlaneGeometry(0.2, 0.2), []);
  const particleMat = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, '#fbcfe8');
      grad.addColorStop(1, '#ec4899');
      ctx.fillStyle = grad;
      ctx.beginPath();
      // Simple heart path scaled to 64x64
      ctx.moveTo(32, 57);
      ctx.bezierCurveTo(32, 57, 6, 39, 6, 21);
      ctx.bezierCurveTo(6, 11, 15, 4, 23, 4);
      ctx.bezierCurveTo(28, 4, 31, 7, 32, 10);
      ctx.bezierCurveTo(33, 7, 36, 4, 41, 4);
      ctx.bezierCurveTo(49, 4, 58, 11, 58, 21);
      ctx.bezierCurveTo(58, 39, 32, 57, 32, 57);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  }, []);

  useFrame((_state, delta) => {
    if (active) {
      const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
      const localTime = (Date.now() - lastOverride) / 1000.0;

      if (lastOverride !== lastSpawnTimeRef.current) {
        lastSpawnTimeRef.current = lastOverride;
        hasSpawnedRef.current = false;
        setParticles([]);
      }

      if (localTime >= 1.2 && !hasSpawnedRef.current) {
        setParticles([
          { id: Math.random(), x: -0.15, y: 0, vx: -0.05, vy: 0.2, life: 1.0, scale: 0.8 },
          { id: Math.random(), x: 0.15, y: -0.1, vx: 0.05, vy: 0.15, life: 1.0, scale: 1.1 },
        ]);
        hasSpawnedRef.current = true;
      }
    } else {
      hasSpawnedRef.current = false;
    }

    if (particles.length > 0) {
      setParticles(prev => prev.map(p => {
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.life -= delta * 0.7;
        return p;
      }).filter(p => p.life > 0));
    }
  });

  if (particles.length === 0) return null;

  return (
    <group position={[0, 1.45, 0.4]}>
      {particles.map(p => {
        const age = 1.0 - p.life;
        const scale = Math.min(1.0, age * 5.0) * p.scale + (age * 0.5);
        return (
          <mesh 
            key={p.id} 
            geometry={particleGeo} 
            material={particleMat} 
            position={[p.x, p.y, 0]} 
            scale={[scale, scale, scale]} 
          />
        );
      })}
    </group>
  );
}

const ZOOM = 250; 
const _lerpTarget = new THREE.Vector3();

// We moved DragHitboxes outside the Canvas to fix the Tauri transparent click-through system.


function SceneManager() {
  const {
    isSpeaking, isThinking, isListening, basePose, isWalking, emotion,
    worldPosition, targetPosition, isDragging, avatarScale, setTargetPosition
  } = useAvatarState(useShallow(s => ({
    isSpeaking: s.isSpeaking,
    isThinking: s.isThinking,
    isListening: s.isListening,
    basePose: s.basePose,
    isWalking: s.isWalking,
    emotion: s.emotion,
    worldPosition: s.worldPosition,
    targetPosition: s.targetPosition,
    isDragging: s.isDragging,
    avatarScale: s.avatarScale,
    setTargetPosition: s.setTargetPosition
  })));

  const groupRef = useRef<THREE.Group>(null);
  const scaleGroupRef = useRef<THREE.Group>(null);
  const [internalMoveDir, setInternalMoveDir] = useState(Math.PI);

  useEffect(() => {
    const onSettingsChanged = () => {
      const val = localStorage.getItem('soltini_avatar_size');
      if (val) {
        const n = parseFloat(val);
        if (!isNaN(n)) useAvatarState.getState().setAvatarScale(n / 100);
      }
    };
    window.addEventListener('soltini-settings-changed', onSettingsChanged);
    return () => window.removeEventListener('soltini-settings-changed', onSettingsChanged);
  }, []);

  const initialModelUrl = typeof window !== 'undefined' && localStorage.getItem('soltini_has_custom_avatar') === 'false' ? '/lucy.vrm' : null;
  const [modelUrl, setModelUrl] = useState<string | null>(initialModelUrl);
  const [vrmReloadKey, setVrmReloadKey] = useState(0);
  const blobUrlRef = useRef<string | null>(null);
  const modelUrlRef = useRef<string | null>(initialModelUrl);

  const refreshModelUrl = (forceBustCache = false) => {
    import('../../lib/system/assetDB').then(({ getAssetDataUrl, getAsset }) => {
      getAsset('custom-avatar').then(asset => {
        if (!asset || asset.type !== 'vrm') {
          localStorage.setItem('soltini_has_custom_avatar', 'false');
          if (useAvatarState.getState().flipCustomModel) {
            useAvatarState.getState().setFlipCustomModel(false);
            localStorage.setItem('soltini_flip_vrm', 'false');
          }
          if (modelUrlRef.current !== '/lucy.vrm' || forceBustCache) {
            if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
            if (modelUrlRef.current !== '/lucy.vrm' || forceBustCache) clearVrmCache?.();
            modelUrlRef.current = '/lucy.vrm';
            setModelUrl('/lucy.vrm');
            setVrmReloadKey(k => k + 1);
          }
          return;
        }
        
        localStorage.setItem('soltini_has_custom_avatar', 'true');
        getAssetDataUrl('custom-avatar').then(url => {
          if (url) {
            if (modelUrlRef.current !== url || forceBustCache) {
              if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(blobUrlRef.current);
              blobUrlRef.current = url;
              clearVrmCache?.();
              modelUrlRef.current = url;
              setModelUrl(url);
              setVrmReloadKey(k => k + 1);
            }
          }
        });
      });
    });
  };

  useEffect(() => {
    refreshModelUrl(false);
    
    const onSettingsChanged = () => {
      clearFbxCache();
      clearAssetResolutionCache();
    };
    
    const onVrmChanged = () => {
      clearFbxCache();
      clearAssetResolutionCache();
      refreshModelUrl(true);
    };
    
    const unsubs = [
      listenCrossWindow('soltini-settings-changed', onSettingsChanged),
      listenCrossWindow('soltini-vrm-changed', onVrmChanged)
    ];
    return () => {
      unsubs.forEach(u => u());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    let distance = 0;
    if (targetPosition) {
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      distance = Math.sqrt(diffX * diffX + diffY * diffY);

      let positionChanged = false;
      if (isWalking && distance > 0.01 && !isDragging) {
        const speed = basePose.startsWith('peek') ? 0.8 : 1.5;
        const step = speed * delta;
        if (distance <= step) {
          groupRef.current.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
        } else {
          groupRef.current.position.x += (diffX / distance) * step;
          groupRef.current.position.y += (diffY / distance) * step;
        }
        positionChanged = true;
      } else {
        _lerpTarget.set(targetPosition.x, targetPosition.y, targetPosition.z);
        // Only keep lerping (and flag a change) while the avatar is still noticeably moving.
        // Once it has effectively arrived, we stop both the math and the per-frame store write,
        // which previously fired ~15-60x/sec even on a perfectly still avatar.
        if (distance > 0.0005 || isDragging) {
          groupRef.current.position.lerp(_lerpTarget, isDragging ? 0.2 : delta * 5.0);
          positionChanged = true;
        }
      }

      // Only push the new position into the store when the avatar actually moved. This avoids
      // a per-frame Zustand notification (and any downstream IPC/subscriber work) while idle.
      if (positionChanged) {
        useAvatarState.getState().setWorldPosition({
          x: groupRef.current.position.x,
          y: groupRef.current.position.y,
          z: groupRef.current.position.z
        });
      }

      const flip = useAvatarState.getState().flipCustomModel;
      let targetRotY = flip ? 0 : Math.PI;

      if (distance > 0.05 && isWalking && !isDragging) {
        targetRotY = -Math.atan2(diffX, diffY) + (flip ? Math.PI : 0);
      } else if (basePose.startsWith('peek')) {
        targetRotY = flip ? 0 : Math.PI;
      }

      if (distance < 0.05 && isWalking && !isDragging) {
        useAvatarState.getState().setIsWalking(false);
      }

      if (targetRotY !== internalMoveDir) {
        setInternalMoveDir(targetRotY);
      }
    }

    // Smooth Scale Logic
    if (scaleGroupRef.current) {
      const currentScale = scaleGroupRef.current.scale.x;
      const isArrived = distance < 0.05;
      
      // If she is growing, wait until she reaches the destination before scaling up.
      // If she is shrinking, do it immediately so she doesn't block the screen while walking.
      const targetS = (avatarScale > currentScale && !isArrived && isWalking) ? currentScale : avatarScale;
      
      if (Math.abs(currentScale - targetS) > 0.001) {
        const newScale = THREE.MathUtils.lerp(currentScale, targetS, delta * 6.0);
        scaleGroupRef.current.scale.setScalar(newScale);
      }
    }
  });

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.pet-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, []);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
    }
    if (scaleGroupRef.current) {
      scaleGroupRef.current.scale.setScalar(avatarScale); // Initial set
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const edgeX = (ww / 2) / ZOOM;
    const currentPos = useAvatarState.getState().worldPosition;

    if (basePose === 'peek-left') {
      setTargetPosition({ x: -(edgeX + 0.1), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    } else if (basePose === 'peek-right') {
      setTargetPosition({ x: (edgeX + 0.1), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePose]);

  const isCurrentlySitting = basePose === 'sit' && !isWalking;
  const y_head  = isCurrentlySitting ? 1.03 : 1.45;
  const y_waist = isCurrentlySitting ? 0.43 : 0.85;
  const y_feet  = 0.15;

  return (
    <group ref={groupRef}>
      <group ref={scaleGroupRef}>
        <group position={[0, -1.2, 0]}>
          <Stool visible={isCurrentlySitting} />
          <FlyingKisses active={basePose === 'flying-kiss'} />

          {modelUrl && (
            <VrmModel
              url={modelUrl}
              reloadKey={vrmReloadKey}
              isSpeaking={isSpeaking}
              isThinking={isThinking}
              isListening={isListening}
              basePose={basePose}
              isWalking={isWalking}
              emotion={emotion}
              moveDirection={internalMoveDir}
              isSitting={isCurrentlySitting}
            />
          )}
        </group>
      </group>

      <Html center zIndexRange={[100, 0]}>
        <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
          <DragHitboxes avatarScale={avatarScale} />
        </div>
      </Html>
    </group>
  );
}



function DragHitboxes({ avatarScale }: { avatarScale: number }) {
  const { basePose, isWalking } = useAvatarState(useShallow(s => ({ basePose: s.basePose, isWalking: s.isWalking })));
  const cursorTargetRef = useRef<{ x: number, y: number, z: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useAvatarState.getState();
    cursorTargetRef.current = { ...s.worldPosition };
    s.setIsDragging(true);
    // Snap out of any stuck animation when grabbed
    s.setBasePose('stand');
    s.setIsWalking(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = useAvatarState.getState();
    if (s.isDragging && cursorTargetRef.current) {
      const movementX = e.movementX / ZOOM;
      const movementY = -e.movementY / ZOOM;

      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const edgeX = (ww / 2) / ZOOM;
      const edgeY = (wh / 2) / ZOOM;
      
      const minX = -edgeX;
      const maxX = edgeX;
      const maxY = edgeY + 0.2 * avatarScale;
      const minY = -edgeY + 0.2 * avatarScale;

      cursorTargetRef.current.x = Math.max(minX, Math.min(maxX, cursorTargetRef.current.x + movementX));
      cursorTargetRef.current.y = Math.max(minY, Math.min(maxY, cursorTargetRef.current.y + movementY));

      s.setTargetPosition({ ...cursorTargetRef.current });
      
      const diffX = cursorTargetRef.current.x - s.worldPosition.x;
      const diffY = cursorTargetRef.current.y - s.worldPosition.y;
      s.setDragOffset({ x: diffX, y: diffY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = useAvatarState.getState();
    s.setIsDragging(false);
    s.setDragOffset({ x: 0, y: 0 });

    const finalX = cursorTargetRef.current?.x ?? s.worldPosition.x;
    const finalY = cursorTargetRef.current?.y ?? s.worldPosition.y;

    const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const wh = typeof window !== 'undefined' ? window.innerHeight : 800;

    const screenX = finalX * 250 + ww / 2;
    // Check if the feet are near the top edge
    const feetY = finalY - 1.2 * avatarScale;
    const screenFeetY = -feetY * 250 + wh / 2;

    let snapped = false;

    if (s.desktopRectangles) {
      const threshold = 50; // snap threshold in pixels
      for (const rect of s.desktopRectangles) {
        if (screenX >= rect.x - 50 && screenX <= rect.x + rect.width + 50) {
          
          let isMatch = false;
          if (rect.is_taskbar) {
            // Taskbar is at the bottom, so if they drag it anywhere near or below the top edge, snap it!
            isMatch = screenFeetY > rect.y - threshold;
          } else {
            // Windows: must be near the title bar specifically
            isMatch = Math.abs(screenFeetY - rect.y) < threshold;
          }

          if (isMatch) {
            snapped = true;
            s.setAnchor({ type: rect.is_taskbar ? 'taskbar' : 'window', rect });
            const edgeWorldY = -(rect.y - wh / 2) / 250;
            s.setTargetPosition({ 
              x: finalX, 
              y: edgeWorldY + (rect.is_taskbar ? 1.2 : 1.15) * avatarScale,
              z: 0 
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

    e.currentTarget.releasePointerCapture(e.pointerId);
    
    if (s.basePose.startsWith('peek')) {
      s.setBasePose('stand');
      s.setIsWalking(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.avatar-context-menu')) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', handleClick);
    return () => window.removeEventListener('pointerdown', handleClick);
  }, []);

  const isCurrentlySitting = basePose === 'sit' && !isWalking;
  const y_head  = isCurrentlySitting ? 1.03 : 1.45;
  const y_waist = isCurrentlySitting ? 0.43 : 0.85;
  const y_feet  = 0.15;

  const getHandleStyle = (yLocal: number, widthBase: number, heightBase: number) => {
    const w = widthBase * avatarScale;
    const h = heightBase * avatarScale;
    const yPixel = (-1.2 * avatarScale + yLocal * avatarScale) * ZOOM;
    return {
      position: 'absolute' as const,
      width: w,
      height: h,
      left: `calc(50% - ${w / 2}px)`,
      top: `${-yPixel - h / 2}px`,
      borderRadius: '50%',
    };
  };

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_head, 120, 120)}
      />
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_waist, 160, 200)}
      />
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-grab active:cursor-grabbing pointer-events-auto"
        style={getHandleStyle(y_feet, 180, 100)}
      />
      {contextMenu && createPortal(
        <AvatarContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} />,
        document.body
      )}
    </>
  );
}

function AvatarLoader() {
  return (
    <Html center>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        userSelect: 'none',
        pointerEvents: 'none',
      }}>
        {/* Pulsing glow orb */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.9) 0%, rgba(236,72,153,0.4) 60%, transparent 100%)',
          boxShadow: '0 0 20px rgba(167,139,250,0.6), 0 0 40px rgba(236,72,153,0.2)',
          animation: 'avatar-pulse 1.4s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes avatar-pulse {
            0%, 100% { transform: scale(0.85); opacity: 0.6; }
            50% { transform: scale(1.15); opacity: 1; }
          }
        `}</style>
      </div>
    </Html>
  );
}

export function Avatar3D() {
  return (
    <div className="w-full h-full pointer-events-none relative">
      <Canvas
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ powerPreference: "low-power", antialias: true, alpha: true }}
        style={{ pointerEvents: 'none' }}
      >
        <WebGLContextLoser />
        <FpsLimiter />
        <OrthographicCamera makeDefault position={[0, 0, 5]} zoom={ZOOM} />

        <Suspense fallback={<AvatarLoader />}>
          <ambientLight intensity={0.8} color="#ffffff" />
          <directionalLight position={[0, 2, 2]} intensity={1} color="#ffffff" />
          <SceneManager />
        </Suspense>
      </Canvas>
    </div>
  );
}
