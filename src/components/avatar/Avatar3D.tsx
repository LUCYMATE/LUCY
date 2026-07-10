import { useState, useEffect, Suspense, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel } from './VrmModel';
import { useAvatarState } from '../../lib/store/avatarState';
import { BOT_NAME, getAvatarModelUrl } from '../../config/bot-profile';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Lock, Unlock, Move, Maximize2, Monitor } from 'lucide-react';

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

function FlyingKisses({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<any[]>([]);
  const hasSpawnedRef = useRef<boolean>(false);
  const lastSpawnTimeRef = useRef<number>(0);

  useFrame((_state, delta) => {
    if (active) {
      const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
      const localTime = (Date.now() - lastOverride) / 1000.0;

      if (lastOverride !== lastSpawnTimeRef.current) {
        lastSpawnTimeRef.current = lastOverride;
        hasSpawnedRef.current = false;
        setParticles([]);
      }

      // Spawn exactly once when the hand extends at t=1.2s
      if (localTime >= 1.2 && !hasSpawnedRef.current) {
        setParticles([
          { id: Math.random(), x: -0.15, y: 0,   vx: -0.05, vy: 0.2,  life: 1.0, scale: 0.8 },
          { id: Math.random(), x:  0.15, y: -0.1, vx:  0.05, vy: 0.15, life: 1.0, scale: 1.1 },
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
          <Html key={p.id} position={[p.x, p.y, 0]} center zIndexRange={[50, 0]}>
            <div style={{
              opacity: p.life > 0.4 ? 1 : p.life / 0.4,
              transform: `scale(${scale})`,
              pointerEvents: 'none',
              userSelect: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 32 32" style={{
                width: '50px', height: '50px',
                filter: 'drop-shadow(0px 4px 10px rgba(236, 72, 153, 0.6))'
              }}>
                <defs>
                  <linearGradient id={`kissGrad-${p.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"   stopColor="#fbcfe8" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
                <path
                  d="M16 28.5C16 28.5 3 19.5 3 10.5C3 5.5 7.5 2 11.5 2C14 2 15.5 3.5 16 5C16.5 3.5 18 2 20.5 2C24.5 2 29 5.5 29 10.5C29 19.5 16 28.5 16 28.5Z"
                  fill={`url(#kissGrad-${p.id})`}
                />
              </svg>
            </div>
          </Html>
        );
      })}
    </group>
  );
}


const ZOOM = 250; // 1 3D unit = 250 pixels.

function SceneManager({ isPetMode }: { isPetMode?: boolean }) {
  const {
    isSpeaking,
    isThinking,
    isListening,
    basePose,
    isWalking,
    emotion,
    worldPosition,
    setWorldPosition,
    targetPosition,
    setTargetPosition,
    isDragging,
    setIsDragging,
    avatarScale,
  } = useAvatarState();

  const groupRef = useRef<THREE.Group>(null);
  const cursorTargetRef = useRef<{ x: number, y: number, z: number } | null>(null);
  const [internalMoveDir, setInternalMoveDir] = useState(0);

  // Listen for settings changes to avatarScale
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

  useEffect(() => {
    let cancelled = false;
    
    // Fetch custom avatar URL from native Rust backend
    import('../../lib/system/assetDB').then(({ getAssetUrl, getAsset }) => {
      getAsset('custom-avatar').then(asset => {
        if (cancelled || !asset || asset.type !== 'vrm') return;
        getAssetUrl('custom-avatar').then(url => {
          if (!cancelled && url) {
            setModelUrl(url);
          }
        });
      }).catch(e => console.warn('Failed to fetch custom avatar info', e));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Smoothly move the model towards targetPosition if we aren't dragging
  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    if (isDragging && cursorTargetRef.current) {
      const deltaX = cursorTargetRef.current.x - groupRef.current.position.x;
      const deltaY = cursorTargetRef.current.y - groupRef.current.position.y;
      
      // Elastic spring lag towards the cursor
      groupRef.current.position.x += deltaX * 0.15;
      groupRef.current.position.y += deltaY * 0.15;
      
      // Update physics/animator state
      useAvatarState.getState().setDragOffset({ x: deltaX, y: deltaY });
      useAvatarState.getState().setWorldPosition({
        x: groupRef.current.position.x,
        y: groupRef.current.position.y,
        z: groupRef.current.position.z
      });

      if (internalMoveDir !== Math.PI) setInternalMoveDir(Math.PI);
    } else if (targetPosition) {
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      const distance = Math.sqrt(diffX * diffX + diffY * diffY);

      if (isWalking && distance > 0.01) {
        // Constant speed for walking to match animation and prevent sliding
        const speed = basePose.startsWith('peek') ? 0.8 : 1.5; // units/sec
        const step = speed * delta;
        if (distance <= step) {
          groupRef.current.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
        } else {
          groupRef.current.position.x += (diffX / distance) * step;
          groupRef.current.position.y += (diffY / distance) * step;
        }
      } else {
        // Gentle lerp for small corrections when not walking
        groupRef.current.position.lerp(
          new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z),
          delta * 5.0
        );
      }

      let targetRotY = Math.PI; // default forward

      if (distance > 0.05 && isWalking) {
        targetRotY = -Math.atan2(diffX, diffY);
      } else if (basePose.startsWith('peek')) {
        targetRotY = Math.PI; // Face the user to peek over the edge
      }

      if (distance < 0.05 && isWalking) {
        useAvatarState.getState().setIsWalking(false);
      }

      if (targetRotY !== internalMoveDir) {
        setInternalMoveDir(targetRotY);
      }
    }
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only left click for dragging
    if (groupRef.current) {
      const currentPos = {
        x: groupRef.current.position.x,
        y: groupRef.current.position.y,
        z: groupRef.current.position.z
      };
      useAvatarState.getState().setWorldPosition(currentPos);
      cursorTargetRef.current = { ...currentPos };
    }
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging && cursorTargetRef.current) {
      const movementX = e.movementX / ZOOM;
      const movementY = -e.movementY / ZOOM;

      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const edgeX = (ww / 2) / ZOOM;

      cursorTargetRef.current.x = Math.max(-edgeX - 0.5, Math.min(edgeX + 0.5, cursorTargetRef.current.x + movementX));
      cursorTargetRef.current.y = cursorTargetRef.current.y + movementY;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsDragging(false);
    useAvatarState.getState().setDragOffset({ x: 0, y: 0 });
    const finalPos = useAvatarState.getState().worldPosition;
    setTargetPosition({ ...finalPos });
    e.currentTarget.releasePointerCapture(e.pointerId);

    // If dropped while peeking, reset to stand
    if (useAvatarState.getState().basePose.startsWith('peek')) {
      useAvatarState.getState().setBasePose('stand');
      useAvatarState.getState().setIsWalking(false);
    }
  };

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Don't close if clicking inside the menu
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

  // ─── Auto-walk to screen edge for peek poses ─────────────────────────────
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
    <group ref={groupRef}>
      {/* Dynamic Scale from Settings */}
      <group scale={avatarScale} position={[0, -1.2, 0]}>
        {/* Stool for sitting */}
        <Stool visible={isCurrentlySitting} />

        <FlyingKisses active={basePose === 'flying-kiss'} />

        <VrmModel
          url={modelUrl}
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
        </div>

        {contextMenu && createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
          />,
          document.body
        )}
      </Html>
    </group>
  );
}

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { isAvatarLocked, setIsAvatarLocked, avatarScale, setAvatarScale, setBasePose, setTargetPosition } = useAvatarState();

  const setSize = (pct: number) => {
    localStorage.setItem('soltini_avatar_size', pct.toString());
    setAvatarScale(pct / 100);
    window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
  };

  const handleLockAvatar = () => {
    const val = !isAvatarLocked;
    setIsAvatarLocked(val);
    localStorage.setItem('soltini_avatar_locked', String(val));
    setContextMenu(null);
  };

  const exitPetMode = () => {
    try {
      window.dispatchEvent(new CustomEvent('soltini-exit-pet-mode'));
    } catch (e) {}
    onClose();
  };

  const resetPosition = () => {
    setTargetPosition({ x: 0, y: -0.5, z: 0 });
    onClose();
  };

  // Keep menu within screen bounds
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

      <button onClick={toggleLock} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-white/10 rounded-lg transition-colors text-left">
        {isAvatarLocked ? <Lock className="w-4 h-4 text-pink-400" /> : <Unlock className="w-4 h-4" />}
        {isAvatarLocked ? 'Unlock Position' : 'Lock Position'}
      </button>

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



export function Avatar3D({ isPetMode }: { isPetMode?: boolean }) {
  return (
    <div className="w-full h-full pointer-events-none">
      <Canvas
        dpr={1}
        gl={{ powerPreference: "low-power", antialias: true }}
        style={{ pointerEvents: 'none' }}
      >
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
