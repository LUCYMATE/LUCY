import { useRef, useEffect, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations, Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function ChestFramer() {
  const { camera, scene } = useThree();
  const [target, setTarget] = useState<[number, number, number]>([0, 1.4, 0]);

  useEffect(() => {
    // Wait a brief moment for the model to be fully parsed and added to the scene
    const timeout = setTimeout(() => {
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Calculate chest position (roughly 25% from the center towards the top)
      const chestY = center.y + size.y * 0.25;
      
      // Calculate distance to frame the upper body nicely
      // The smaller the multiplier, the closer the camera
      const distance = center.z + size.y * 0.8;
      
      // Position the camera
      camera.position.set(center.x, chestY, distance);
      
      // Update camera
      camera.updateProjectionMatrix();

      // Update target
      setTarget([center.x, chestY, center.z]);
    }, 100);
    
    return () => clearTimeout(timeout);
  }, [camera, scene]);

  return <OrbitControls target={target} enableZoom={false} enablePan={false} enableRotate={false} makeDefault />;
}

function Model({ isSpeaking, isThinking, isListening }: { isSpeaking: boolean, isThinking?: boolean, isListening?: boolean }) {
  // Load the GLTF model. It's safe to assume it's at /myra.glb
  const { scene, materials, animations } = useGLTF('/myra.glb');
  const group = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Object3D | null>(null);
  const rightArmRef = useRef<THREE.Object3D | null>(null);
  const leftForeArmRef = useRef<THREE.Object3D | null>(null);
  const rightForeArmRef = useRef<THREE.Object3D | null>(null);
  const headRef = useRef<THREE.Object3D | null>(null);
  const jawRef = useRef<THREE.Object3D | null>(null);
  const baseRotationRecorded = useRef(false);

  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    scene.traverse(child => {
      const name = child.name.toLowerCase();
      // Look for shoulder/arm bones. Only match "arm" if it's not forearm.
      if (name.includes('left') && name.includes('arm') && !name.includes('fore')) leftArmRef.current = child;
      if (name.includes('right') && name.includes('arm') && !name.includes('fore')) rightArmRef.current = child;
      if (name.includes('left') && (name.includes('forearm') || name.includes('elbow'))) leftForeArmRef.current = child;
      if (name.includes('right') && (name.includes('forearm') || name.includes('elbow'))) rightForeArmRef.current = child;
      if (name.includes('head')) headRef.current = child;
      if (name.includes('jaw')) jawRef.current = child;
    });
  }, [scene]);

  // Since we don't know the exact animation names, we'll try to find common ones
  useEffect(() => {
    if (names.length === 0) return;
    
    // Guess talking/thinking/idle animations
    let talkingAnim = names.find(n => n.toLowerCase().includes('talk') || n.toLowerCase().includes('speak'));
    let thinkingAnim = names.find(n => n.toLowerCase().includes('think'));
    let idleAnim = names.find(n => n.toLowerCase().includes('idle'));
    
    // Fallbacks if not found
    if (!idleAnim) idleAnim = names[0];
    if (!talkingAnim) talkingAnim = idleAnim;
    if (!thinkingAnim) thinkingAnim = idleAnim;

    const currentAnim = isSpeaking ? talkingAnim : (isThinking ? thinkingAnim : idleAnim);
    
    if (currentAnim && actions[currentAnim]) {
      actions[currentAnim]?.reset().fadeIn(0.5).play();
      
      return () => {
        actions[currentAnim]?.fadeOut(0.5);
      };
    }
  }, [isSpeaking, isThinking, actions, names]);

  // Very basic fallback if no animations exist
  useFrame((state, delta) => {
    if (group.current) {
      if (names.length === 0) {
        if (isSpeaking) {
           group.current.scale.y = 1; // Removed jumping
           
           const time = state.clock.elapsedTime;
           
           // Arm up/down oscillation
           const armUpMovement = Math.sin(time * 3) * 0.2;
           // Arm inward/outward oscillation
           const armInward = Math.sin(time * 2.5) * 0.1;

           // Upper arms point down but forward slightly
           if (leftArmRef.current) {
             leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, -1.2, 0.1);
             leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -0.4 + armUpMovement, 0.1);
             leftArmRef.current.rotation.y = THREE.MathUtils.lerp(leftArmRef.current.rotation.y, -0.2, 0.1);
           }
           if (rightArmRef.current) {
             rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 1.2, 0.1);
             rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, -0.4 + armUpMovement * 0.8, 0.1);
             rightArmRef.current.rotation.y = THREE.MathUtils.lerp(rightArmRef.current.rotation.y, 0.2, 0.1);
           }
           
           // Forearms fold inwards to the chest/stomach
           const foreArmFold = Math.sin(time * 3.5) * 0.1;
           if (leftForeArmRef.current) {
             leftForeArmRef.current.rotation.z = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.z, 0, 0.1);
             // Positive X usually bends elbow forward/in toward chest if negative went backward
             leftForeArmRef.current.rotation.x = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.x, 1.4 + foreArmFold, 0.1);
             // Y helps angle it inwards towards the center
             leftForeArmRef.current.rotation.y = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.y, 0.5, 0.1);
           }
           if (rightForeArmRef.current) {
             rightForeArmRef.current.rotation.z = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.z, 0, 0.1);
             rightForeArmRef.current.rotation.x = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.x, 1.4 + foreArmFold, 0.1);
             rightForeArmRef.current.rotation.y = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.y, -0.5, 0.1);
           }

           // Mouth/Jaw talking animation
           if (jawRef.current) jawRef.current.rotation.x = Math.max(0, Math.sin(time * 15)) * 0.25;
           if (headRef.current) headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, Math.sin(time * 2) * 0.05, 0.1);

        } else {
           group.current.scale.y = THREE.MathUtils.lerp(group.current.scale.y, 1, 0.1);
           
           // Close to lap during stop
           if (leftArmRef.current) {
             leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, -1.35, 0.1);
             leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -0.1, 0.1);
             leftArmRef.current.rotation.y = THREE.MathUtils.lerp(leftArmRef.current.rotation.y, 0, 0.1);
           }
           if (rightArmRef.current) {
             rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 1.35, 0.1);
             rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, -0.1, 0.1);
             rightArmRef.current.rotation.y = THREE.MathUtils.lerp(rightArmRef.current.rotation.y, 0, 0.1);
           }

           // Forearms almost straight
           if (leftForeArmRef.current) {
             leftForeArmRef.current.rotation.z = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.z, -0.1, 0.1);
             leftForeArmRef.current.rotation.x = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.x, 0, 0.1);
             leftForeArmRef.current.rotation.y = THREE.MathUtils.lerp(leftForeArmRef.current.rotation.y, 0, 0.1);
           }
           if (rightForeArmRef.current) {
             rightForeArmRef.current.rotation.z = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.z, 0.1, 0.1);
             rightForeArmRef.current.rotation.x = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.x, 0, 0.1);
             rightForeArmRef.current.rotation.y = THREE.MathUtils.lerp(rightForeArmRef.current.rotation.y, 0, 0.1);
           }

           // Reset head/jaw
           if (jawRef.current) jawRef.current.rotation.x = THREE.MathUtils.lerp(jawRef.current.rotation.x, 0, 0.2);
           if (headRef.current) headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, 0, 0.1);
        }
      }
      if (isListening && !isSpeaking) {
        if (headRef.current) {
          // Keep it to a small attentive head rotation while actual mic audio is arriving.
          headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, -0.12, 0.08);
          headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, 0.01, 0.08);
          headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, 0, 0.08);
        }
      } else if (isThinking && !isSpeaking) {
         group.current.rotation.y = Math.sin(state.clock.elapsedTime * 2) * 0.2;
      } else {
         group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, 0, 0.05);
        group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, 0, 0.05);
        group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, 0, 0.05);
      }
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload('/myra.glb');

export function Myra3D({ isSpeaking, isThinking, isListening }: { isSpeaking: boolean, isThinking?: boolean, isListening?: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none z-[100]">
      <Canvas camera={{ position: [0, 0.2, 3], fov: 45 }} gl={{ alpha: true }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[0, 2, 2]} intensity={2.5} />
        <spotLight position={[0, 4, 3]} angle={0.4} penumbra={1} intensity={1.5} castShadow />
        <Suspense fallback={null}>
          <Environment preset="city" />
          <ChestFramer />
          <Model isSpeaking={isSpeaking} isThinking={isThinking} isListening={isListening} />
        </Suspense>
      </Canvas>
    </div>
  );
}
