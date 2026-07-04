import { useState, useEffect, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Mic, MicOff } from 'lucide-react';
import { Html, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel } from './VrmModel';
import { useAvatarState } from '../../lib/store/avatarState';

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
    blush,
    wearClothes,
    avatarScale,
  } = useAvatarState();

  const groupRef = useRef<THREE.Group>(null);
  const [internalMoveDir, setInternalMoveDir] = useState(0);

  // Smoothly move the model towards targetPosition if we aren't dragging
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    if (isDragging) {
      // Direct position update
      groupRef.current.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
      if (internalMoveDir !== 0) setInternalMoveDir(0);
    } else if (targetPosition) {
      // Calculate move direction locally to avoid React state thrashing
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      const distance = Math.sqrt(diffX*diffX + diffY*diffY);
      
      if (isWalking && distance > 0.01) {
        // Constant speed for walking to match animation and prevent "sliding"
        const speed = basePose.startsWith('peek') ? 0.8 : 1.5; // units per second
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

      // Stop walking exactly when arrived
      if (distance < 0.05 && isWalking) {
        useAvatarState.getState().setIsWalking(false);
      }

      if (targetRotY !== internalMoveDir) {
        setInternalMoveDir(targetRotY); // Repurpose as exact rotation angle
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
        // Allow slight off-screen dragging for peek adjustments
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
  // When basePose changes to peek-left/peek-right, automatically walk to the
  // appropriate screen edge FIRST, then the peek animation applies on arrival
  // (isPeeking is only true when !isWalking in the animator).
  useEffect(() => {
    const ww = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const edgeX = (ww / 2) / ZOOM;
    const currentPos = useAvatarState.getState().worldPosition;

    if (basePose === 'peek-left') {
      // Walk towards left edge but keep shoulder/chest visible, then lean right
      setTargetPosition({ x: -(edgeX - 0.35), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    } else if (basePose === 'peek-right') {
      // Walk towards right edge but keep shoulder/chest visible
      setTargetPosition({ x: (edgeX - 0.35), y: currentPos.y, z: currentPos.z });
      useAvatarState.getState().setIsWalking(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePose]);


  const isCurrentlySitting = (basePose === 'sit' || basePose === 'sultry-sit' || basePose === 'fingerwarm') && !isWalking;
  const y_head = isCurrentlySitting ? 1.03 : 1.45;
  const y_waist = isCurrentlySitting ? 0.43 : 0.85;
  const y_feet = 0.15;

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
        {/* Show stool for ALL sitting poses */}
        <Stool visible={isCurrentlySitting} />


        <VrmModel 
          url={wearClothes ? '/syra.vrm' : '/syranude.vrm'}
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

      {/* blush effect removed — was showing as a plain box above model */}

      <Html center zIndexRange={[100, 0]}>
        <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_head, 160, 160)}
            title="Drag Syra (Head)"
          />
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_waist, 200, 240)}
            title="Drag Syra (Waist)"
          />
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing pointer-events-auto"
            style={getHandleStyle(y_feet, 220, 120)}
            title="Drag Syra (Feet)"
          />
        </div>
      </Html>
    </group>
  );
}



export function Syra3D({ isPetMode }: { isPetMode?: boolean }) {
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
