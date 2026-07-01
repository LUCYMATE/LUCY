import { useState, useEffect, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Mic, MicOff } from 'lucide-react';
import { Environment, Html, OrthographicCamera } from '@react-three/drei';
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
    setIsDragging
  } = useAvatarState();

  const groupRef = useRef<THREE.Group>(null);
  const [internalMoveDir, setInternalMoveDir] = useState(0);
  const [avatarScale, setAvatarScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const val = localStorage.getItem('myra_avatar_size');
      if (val) {
        const scaleVal = parseInt(val, 10);
        if (!isNaN(scaleVal)) {
          setAvatarScale(scaleVal / 100);
        }
      }
    };
    
    updateScale();
    
    window.addEventListener('myra-settings-changed', updateScale);
    return () => window.removeEventListener('myra-settings-changed', updateScale);
  }, []);

  // Smoothly move the model towards targetPosition if we aren't dragging
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    if (isDragging) {
      // Direct position update
      groupRef.current.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
      if (internalMoveDir !== 0) setInternalMoveDir(0);
    } else if (targetPosition) {
      // Lerp towards target
      const speed = basePose.startsWith('peek') && isWalking ? 1.0 : 3.0;
      groupRef.current.position.lerp(
        new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z),
        delta * speed
      );
      
      // Calculate move direction locally to avoid React state thrashing
      const diffX = targetPosition.x - groupRef.current.position.x;
      const diffY = targetPosition.y - groupRef.current.position.y;
      const distance = Math.sqrt(diffX*diffX + diffY*diffY);
      
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
        // Clamp manual dragging so she can't be thrown out of the window
        x: Math.max(-edgeX, Math.min(edgeX, currentPos.x + movementX)),
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

  return (
    <group ref={groupRef}>
      {/* Dynamic Scale from Settings */}
      <group scale={avatarScale} position={[0, -1.2, 0]}>
        <Stool visible={basePose === 'sit' && !isWalking} />
        <VrmModel 
          url="/myra.vrm" 
          isSpeaking={isSpeaking} 
          isThinking={isThinking} 
          isListening={isListening} 
          basePose={basePose}
          isWalking={isWalking}
          emotion={emotion}
          moveDirection={internalMoveDir}
        />
      </group>

      <Html center zIndexRange={[100, 0]}>
        <div 
          className="flex flex-col items-center justify-between pointer-events-none relative"
          style={{ width: 420, height: 660, marginTop: -120 }} 
        >
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-48 h-48 rounded-full cursor-grab active:cursor-grabbing pointer-events-auto"
            title="Drag Myra (Head)"
          />
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-60 h-72 rounded-full cursor-grab active:cursor-grabbing pointer-events-auto"
            title="Drag Myra (Waist)"
          />
          <div 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="w-72 h-36 rounded-full cursor-grab active:cursor-grabbing pointer-events-auto"
            title="Drag Myra (Feet)"
          />
        </div>
      </Html>
    </group>
  );
}

export function Myra3D({ isPetMode }: { isPetMode?: boolean }) {
  return (
    <div className="w-full h-full pointer-events-none">
      <Canvas
        dpr={1} 
        gl={{ powerPreference: "default", antialias: true }}
        style={{ pointerEvents: 'none' }}
      >
        <OrthographicCamera makeDefault position={[0, 0, 5]} zoom={ZOOM} />
        
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 2, 2]} intensity={2.0} />
        <directionalLight position={[-2, -2, -2]} intensity={0.5} />
        <directionalLight position={[0, 5, 2]} intensity={1.0} />
        
        <Suspense fallback={null}>
          <Environment preset="city" />
          <SceneManager isPetMode={isPetMode} />
        </Suspense>
      </Canvas>
    </div>
  );
}
