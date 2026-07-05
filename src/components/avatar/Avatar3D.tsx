import { useState, useEffect, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel } from './VrmModel';
import { useAvatarState } from '../../lib/store/avatarState';
import { BOT_NAME, getAvatarModelUrl } from '../../config/bot-profile';

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

  useFrame((_state, delta) => {
    if (active) {
      const lastOverride = useAvatarState.getState().lastPoseOverrideTime;
      const localTime = (Date.now() - lastOverride) / 1000.0;

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
                filter: 'drop-shadow(0px 4px 10px rgba(125, 211, 252, 0.6))'
              }}>
                <defs>
                  <linearGradient id={`kissGrad-${p.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"   stopColor="#bae6fd" />
                    <stop offset="100%" stopColor="#38bdf8" />
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
  const [internalMoveDir, setInternalMoveDir] = useState(0);

  // Listen for settings changes to avatarScale
  useEffect(() => {
    const onSettingsChanged = () => {
      const val = localStorage.getItem('myra_avatar_size');
      if (val) {
        const n = parseFloat(val);
        if (!isNaN(n)) useAvatarState.getState().setAvatarScale(n / 100);
      }
    };
    window.addEventListener('myra-settings-changed', onSettingsChanged);
    return () => window.removeEventListener('myra-settings-changed', onSettingsChanged);
  }, []);

  // Smoothly move the model towards targetPosition if we aren't dragging
  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    if (isDragging) {
      groupRef.current.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
      if (internalMoveDir !== 0) setInternalMoveDir(0);
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
    if (groupRef.current) {
      useAvatarState.getState().setWorldPosition({
        x: groupRef.current.position.x,
        y: groupRef.current.position.y,
        z: groupRef.current.position.z
      });
    }
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      const currentPos = useAvatarState.getState().worldPosition;
      const movementX = e.movementX / ZOOM;
      const movementY = -e.movementY / ZOOM;

      const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const edgeX = (ww / 2) / ZOOM;

      const newPos = {
        x: Math.max(-edgeX - 0.5, Math.min(edgeX + 0.5, currentPos.x + movementX)),
        y: currentPos.y + movementY,
        z: currentPos.z
      };
      setWorldPosition(newPos);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    const finalPos = useAvatarState.getState().worldPosition;
    setTargetPosition({ ...finalPos });
    e.currentTarget.releasePointerCapture(e.pointerId);

    // If dropped while peeking, reset to stand
    if (useAvatarState.getState().basePose.startsWith('peek')) {
      useAvatarState.getState().setBasePose('stand');
      useAvatarState.getState().setIsWalking(false);
    }
  };

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
          url={getAvatarModelUrl(true)}
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
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_head, 120, 120)}
          />
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_waist, 160, 200)}
          />
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_feet, 180, 100)}
          />
        </div>
      </Html>
    </group>
  );
}



export function Avatar3D({ isPetMode }: { isPetMode?: boolean }) {
  return (
    <div className="w-full h-full pointer-events-none">
      <Canvas
        dpr={1}
        gl={{ powerPreference: "default", antialias: true }}
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
