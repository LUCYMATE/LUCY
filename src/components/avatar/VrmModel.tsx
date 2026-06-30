import { useEffect, useState } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import { BasePose, Emotion } from './animations/core';
import { useVrmAnimator } from './animations/useVrmAnimator';

interface VrmModelProps {
  url: string;
  isSpeaking: boolean;
  isThinking?: boolean;
  isListening?: boolean;
  basePose?: BasePose;
  isWalking?: boolean;
  emotion?: Emotion;
  moveDirection?: number; // -1 for left, 1 for right, 0 for forward
}

export function VrmModel({ 
  url, 
  isSpeaking, 
  isThinking = false, 
  isListening = false, 
  basePose = 'sit', 
  isWalking = false,
  emotion = 'neutral',
  moveDirection = 0
}: VrmModelProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });

  useEffect(() => {
    if (!gltf?.userData.vrm) return;
    const loadedVrm = gltf.userData.vrm as VRM;
    loadedVrm.scene.traverse((obj) => { obj.frustumCulled = false; });
    
    // Initial rotation facing forward
    loadedVrm.scene.rotation.y = Math.PI;

    setVrm(loadedVrm);
  }, [gltf]);

  // Delegate all animation logic to our custom hook
  useVrmAnimator({
    vrm,
    isSpeaking,
    isThinking,
    isListening,
    basePose,
    isWalking,
    emotion,
    moveDirection
  });

  return (
    <group>
      <primitive object={gltf.scene} />
    </group>
  );
}
