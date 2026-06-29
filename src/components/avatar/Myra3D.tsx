import { useState, useEffect, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { VrmModel } from './VrmModel';

function ChestFramer() {
  const { camera, scene } = useThree();
  const [target, setTarget] = useState<[number, number, number]>([0, 1.4, 0]);

  useEffect(() => {
    // Wait a brief moment for the model to be fully parsed and added to the scene
    const timeout = setTimeout(() => {
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Focus on the center of the bounding box (often around the chest/neck for avatars)
      const targetY = center.y;
      
      // Calculate distance to frame the full body (increase multiplier)
      // Usually VRM models are 1.4-1.7m tall
      const distance = center.z + size.y * 1.15;
      
      // Position the camera
      camera.position.set(center.x, targetY, Math.max(distance, 1.5));
      
      // Update camera
      camera.updateProjectionMatrix();

      // Update target
      setTarget([center.x, targetY, center.z]);
    }, 500); // slightly longer timeout for VRM
    
    return () => clearTimeout(timeout);
  }, [camera, scene]);

  // Enable rotation so the user can drag the model around
  return <OrbitControls target={target} enableZoom={false} enablePan={false} enableRotate={true} makeDefault />;
}

export function Myra3D({ isSpeaking, isThinking, isListening }: { isSpeaking: boolean, isThinking?: boolean, isListening?: boolean, onHoverChange?: (hover: boolean) => void }) {
  return (
    <div className="absolute inset-0 z-[100]" style={{ pointerEvents: 'auto' }}>
      <Canvas 
        camera={{ position: [0, 1.4, 3], fov: 45 }}
        gl={{
          alpha: true,
          antialias: true,                    // Enable smooth edges
          powerPreference: "high-performance",
          precision: "highp",                 // Use high precision shaders
          preserveDrawingBuffer: false,
        }}
        dpr={Math.min(window.devicePixelRatio, 2)} // Native res up to 2x (crisp on 1080p & 4K)
        eventSource={typeof document !== 'undefined' ? document.body : undefined}
      >
        {/* Richer lighting for better model quality */}
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 4, 3]}  intensity={2.0} color="#ffffff" />
        <directionalLight position={[-2, 2, -1]} intensity={0.6} color="#c0d8ff" /> {/* cool fill */}
        <spotLight
          position={[0, 5, 2]}
          angle={0.35}
          penumbra={0.8}
          intensity={1.2}
          color="#fff8f0"
        />
        <Suspense fallback={null}>
          <Environment preset="studio" /> {/* studio gives cleaner, sharper model appearance */}
          <ChestFramer />
          <VrmModel 
            url="/myra.vrm" 
            isSpeaking={isSpeaking} 
            isThinking={isThinking} 
            isListening={isListening} 
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

