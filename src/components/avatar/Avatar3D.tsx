import { useState, useEffect, Suspense, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel, clearVrmCache, clearAssetResolutionCache } from './VrmModel';
import { clearFbxCache } from './animations/useFbxAnimation';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { X, Lock, Unlock } from 'lucide-react';

// Highly optimized FPS limiter using rAF instead of setInterval
function FpsLimiter() {
  const { invalidate } = useThree();
  const [limit, setLimit] = useState(() => localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
  const isActive = useRef(false);

  useEffect(() => {
    const handleFpsChange = () => setLimit(localStorage.getItem('soltini_low_fps') === 'true' ? 30 : 60);
    window.addEventListener('soltini-settings-changed', handleFpsChange);
    return () => window.removeEventListener('soltini-settings-changed', handleFpsChange);
  }, []);

  useEffect(() => {
    const unsub = useAvatarState.subscribe((s) => {
      isActive.current = s.isSpeaking || s.isThinking || s.isWalking || s.isListening || s.isHearingSound || s.isDragging;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let lastTime = 0;
    let frameId = 0;
    const interval = 1000 / limit;

    const loop = (time: number) => {
      if (isActive.current && time - lastTime >= interval) {
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


function SceneManager({ isPetMode }: { isPetMode?: boolean }) {
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
  const [internalMoveDir, setInternalMoveDir] = useState(0);

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

  const [modelUrl, setModelUrl] = useState<string>('/soltini.vrm');
  const [vrmReloadKey, setVrmReloadKey] = useState(0);
  const blobUrlRef = useRef<string | null>(null);

  const refreshModelUrl = (forceBustCache = false) => {
    import('../../lib/system/assetDB').then(({ getAssetDataUrl, getAsset }) => {
      getAsset('custom-avatar').then(asset => {
        if (!asset || asset.type !== 'vrm') {
          if (modelUrl !== '/soltini.vrm' || forceBustCache) {
            if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
            clearVrmCache?.();
            setModelUrl('/soltini.vrm');
            setVrmReloadKey(k => k + 1);
          }
          return;
        }
        getAssetDataUrl('custom-avatar').then(url => {
          if (url) {
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = url;
            clearVrmCache?.();
            setModelUrl(url);
            setVrmReloadKey(k => k + 1);
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
    
    window.addEventListener('soltini-settings-changed', onSettingsChanged);
    window.addEventListener('soltini-vrm-changed', onVrmChanged);
    return () => {
      window.removeEventListener('soltini-settings-changed', onSettingsChanged);
      window.removeEventListener('soltini-vrm-changed', onVrmChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    if (targetPosition) {
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      const distance = Math.sqrt(diffX * diffX + diffY * diffY);

      if (isWalking && distance > 0.01 && !isDragging) {
        const speed = basePose.startsWith('peek') ? 0.8 : 1.5;
        const step = speed * delta;
        if (distance <= step) {
          groupRef.current.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
        } else {
          groupRef.current.position.x += (diffX / distance) * step;
          groupRef.current.position.y += (diffY / distance) * step;
        }
      } else {
        _lerpTarget.set(targetPosition.x, targetPosition.y, targetPosition.z);
        groupRef.current.position.lerp(_lerpTarget, isDragging ? 0.2 : delta * 5.0);
      }

      useAvatarState.getState().setWorldPosition({
        x: groupRef.current.position.x,
        y: groupRef.current.position.y,
        z: groupRef.current.position.z
      });

      let targetRotY = Math.PI;

      if (distance > 0.05 && isWalking && !isDragging) {
        targetRotY = -Math.atan2(diffX, diffY);
      } else if (basePose.startsWith('peek')) {
        targetRotY = Math.PI;
      }

      if (distance < 0.05 && isWalking && !isDragging) {
        useAvatarState.getState().setIsWalking(false);
      }

      if (targetRotY !== internalMoveDir) {
        setInternalMoveDir(targetRotY);
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
      <group scale={avatarScale} position={[0, -1.2, 0]}>
        <Stool visible={isCurrentlySitting} />
        <FlyingKisses active={basePose === 'flying-kiss'} />

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
      </group>

      <Html center zIndexRange={[100, 0]}>
        <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
          <DragHitboxes avatarScale={avatarScale} />
        </div>
      </Html>
    </group>
  );
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { isAvatarLocked, setIsAvatarLocked, avatarScale, setAvatarScale } = useAvatarState(useShallow(s => ({
    isAvatarLocked: s.isAvatarLocked,
    setIsAvatarLocked: s.setIsAvatarLocked,
    avatarScale: s.avatarScale,
    setAvatarScale: s.setAvatarScale
  })));
  const [isLowFps, setIsLowFps] = useState(() => localStorage.getItem('soltini_low_fps') === 'true');

  const setSize = (pct: number) => {
    localStorage.setItem('soltini_avatar_size', pct.toString());
    setAvatarScale(pct / 100);
    window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
  };

  const handleLockAvatar = () => {
    const val = !isAvatarLocked;
    setIsAvatarLocked(val);
    localStorage.setItem('soltini_avatar_locked', String(val));
    onClose();
  };

  const toggleLowFps = () => {
    const val = !isLowFps;
    setIsLowFps(val);
    localStorage.setItem('soltini_low_fps', String(val));
    window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
  };

  const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const wh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const menuW = 200;
  const menuH = 340;
  const finalX = x + menuW > ww ? ww - menuW - 10 : x;
  const finalY = y + menuH > wh ? wh - menuH - 10 : y;

  return (
    <div
      className="pet-context-menu fixed glass pointer-events-auto flex flex-col p-2 z-[9999] rounded-2xl border border-pink-500/20 shadow-xl shadow-pink-500/10 text-white font-sans overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      style={{ left: finalX, top: finalY, width: menuW, backdropFilter: 'blur(16px)' }}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-pink-400 mb-2 px-2 pt-1 flex justify-between items-center">
        Avatar Options
        <X className="w-3 h-3 cursor-pointer opacity-50 hover:opacity-100" onClick={onClose} />
      </div>

      <button onClick={handleLockAvatar} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-white/10 rounded-lg transition-colors text-left">
        {isAvatarLocked ? <Lock className="w-4 h-4 text-pink-400" /> : <Unlock className="w-4 h-4" />}
        {isAvatarLocked ? 'Unlock Position' : 'Lock Position'}
      </button>

      <div className="px-2 py-1 flex items-center justify-between text-sm">
        <span className="text-white/50 text-xs">Low FPS Mode (30)</span>
        <button
          onClick={toggleLowFps}
          className={`relative w-8 h-4 rounded-full transition-colors ${isLowFps ? 'bg-pink-500' : 'bg-white/20'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isLowFps ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="my-1 border-t border-white/10" />

      <div className="px-2 py-1 flex flex-col gap-1">
        <span className="text-[10px] text-white/50 uppercase">Size</span>
        <input 
          type="range" min="50" max="200" step="10" 
          value={Math.round(avatarScale * 100)} 
          onChange={(e) => setSize(parseInt(e.target.value))}
          className="w-full h-1 bg-white/20 rounded-full appearance-none accent-pink-500 cursor-pointer"
        />
        <div className="flex gap-1 mt-1">
          <button onClick={() => setSize(70)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-0.5">S</button>
          <button onClick={() => setSize(100)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-0.5">M</button>
          <button onClick={() => setSize(150)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-0.5">L</button>
        </div>
      </div>

      <div className="my-1 border-t border-white/10" />

      <div className="px-2 py-1.5 flex items-center justify-between text-sm">
        <span className="text-white/50">Current Pose</span>
        <span className="capitalize text-pink-400 font-medium">{useAvatarState.getState().basePose}</span>
      </div>
    </div>
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
      const edgeX = (ww / 2) / ZOOM;

      cursorTargetRef.current.x = Math.max(-edgeX - 0.5, Math.min(edgeX + 0.5, cursorTargetRef.current.x + movementX));
      cursorTargetRef.current.y = cursorTargetRef.current.y + movementY;

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
    s.setTargetPosition({ ...s.worldPosition });
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
      if ((e.target as HTMLElement).closest('.pet-context-menu')) return;
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
    const yPixel = (-1.2 + yLocal * avatarScale) * ZOOM;
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
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} />,
        document.body
      )}
    </>
  );
}

export function Avatar3D({ isPetMode }: { isPetMode?: boolean }) {
  return (
    <div className="w-full h-full pointer-events-none relative">
      <Canvas
        dpr={1}
        frameloop="always"
        gl={{ powerPreference: "low-power", antialias: true, alpha: true }}
        style={{ pointerEvents: 'none' }}
      >
        <FpsLimiter />
        <OrthographicCamera makeDefault position={[0, 0, 5]} zoom={ZOOM} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.8} color="#ffffff" />
          <directionalLight position={[0, 2, 2]} intensity={1} color="#ffffff" />
          <SceneManager isPetMode={isPetMode} />
        </Suspense>
      </Canvas>
    </div>
  );
}
