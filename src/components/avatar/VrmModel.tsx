import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { BasePose, Emotion } from './animations/core';
import { useVrmAnimator } from './animations/useVrmAnimator';
import { useFbxAnimation } from './animations/useFbxAnimation';
import { standardizeVrmBoneNames } from './animations/vrmAnimation';
import { useAvatarState } from '../../lib/store/avatarState';
import { getAsset, getAssetUrl } from '../../lib/system/assetDB';

// Global cache to prevent model from disappearing and reloading on remounts
let globalCachedVrm: VRM | null = null;
let globalCachedUrl: string | null = null;
let isGlobalLoading = false;
let globalLoadCallbacks: ((vrm: VRM | null) => void)[] = [];

interface VrmModelProps {
  url: string;
  isSpeaking: boolean;
  isThinking?: boolean;
  isListening?: boolean;
  basePose?: BasePose;
  isWalking?: boolean;
  emotion?: Emotion;
  moveDirection?: number;
  isSitting?: boolean;
}

// ─── Dispose helper ───────────────────────────────────────────────────────────
function disposeVrm(vrm: VRM) {
  try {
    vrm.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: THREE.Material) => {
          if (!m) return;
          Object.values(m).forEach((v) => {
            if (v instanceof THREE.Texture) v.dispose();
          });
          m.dispose();
        });
      }
    });
  } catch (_) { /* best-effort */ }
}

export function VrmModel({
  url,
  isSpeaking,
  isThinking = false,
  isListening = false,
  basePose = 'sit',
  isWalking = false,
  emotion = 'neutral',
  moveDirection = 0,
  isSitting = false,
}: VrmModelProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const pendantRef = useRef<THREE.Group | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Manual load / dispose cycle ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    if (globalCachedUrl === url && globalCachedVrm) {
      if (mountedRef.current) setVrm(globalCachedVrm);
      return;
    }

    if (isGlobalLoading) {
      const callback = (loaded: VRM | null) => {
        if (!cancelled && mountedRef.current && loaded) {
          setVrm(loaded);
        }
      };
      globalLoadCallbacks.push(callback);
      return () => {
        cancelled = true;
        globalLoadCallbacks = globalLoadCallbacks.filter(cb => cb !== callback);
      };
    }

    isGlobalLoading = true;
    globalCachedUrl = url;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        isGlobalLoading = false;
        
        if (!gltf?.userData.vrm) {
          globalLoadCallbacks.forEach(cb => cb(null));
          globalLoadCallbacks = [];
          return;
        }
        
        const loadedVrm = gltf.userData.vrm as VRM;

        // ── Basic setup ─────────────────────────────────────────────────────
        loadedVrm.scene.traverse((obj) => { obj.frustumCulled = false; });
        loadedVrm.scene.rotation.y = Math.PI;

        // ── Standardize humanoid bone names for AnimationMixer targeting ────
        // Must happen before any animation is retargeted so that track names
        // like "leftUpperArm.quaternion" resolve to the correct scene nodes.
        standardizeVrmBoneNames(loadedVrm);


        if (globalCachedVrm && globalCachedVrm !== loadedVrm) {
          disposeVrm(globalCachedVrm);
        }
        globalCachedVrm = loadedVrm;

        if (!cancelled && mountedRef.current) {
          setVrm(loadedVrm);
        }

        globalLoadCallbacks.forEach(cb => cb(loadedVrm));
        globalLoadCallbacks = [];
      },
      undefined,
      (err) => {
        isGlobalLoading = false;
        globalLoadCallbacks.forEach(cb => cb(null));
        globalLoadCallbacks = [];
        if (!cancelled) console.error('[VrmModel] load error:', err);
      }
    );

    return () => {
      cancelled = true;
      if (mountedRef.current) setVrm(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ─── Smart pose-transition detection ───────────────────────────────────────
  // Instead of a hardcoded frame counter, we track the actual angular velocity
  // of the core skeleton (Hips) to detect exactly when a pose transition is
  // "completely achieved". This permanently fixes physics for ANY future
  // animations (short or long), and uses minimal CPU/RAM (O(1) angle check).
  const prevHipsQuat = useRef(new THREE.Quaternion());
  const transitionState = useRef({ active: false, settledCount: 0, frameCount: 0 });
  
  const prevBasePoseRef = useRef('');
  const prevIsWalkingRef = useRef(false);

  useEffect(() => {
    if (basePose !== prevBasePoseRef.current || isWalking !== prevIsWalkingRef.current) {
      prevBasePoseRef.current = basePose;
      prevIsWalkingRef.current = isWalking;
      transitionState.current = { active: true, settledCount: 0, frameCount: 0 };
    }
  }, [basePose, isWalking]);

  useFrame(() => {
    if (!vrm?.springBoneManager || !vrm.humanoid) return;
    
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (!hips) return;

    const state = transitionState.current;
    
    if (state.active) {
      state.frameCount++;
      const angleDiff = hips.quaternion.angleTo(prevHipsQuat.current);
      
      // If rotation is extremely small (< 0.1 deg/frame), the interpolation is finishing
      if (angleDiff < 0.001) {
        state.settledCount++;
        // 5 consecutive settled frames = pose completely achieved
        if (state.settledCount > 5) state.active = false;
      } else {
        state.settledCount = 0;
      }

      // Safety fallback: never reset for more than 120 frames (2s) to prevent
      // looping animations (like walking) from permanently freezing physics.
      if (state.frameCount > 120) {
        state.active = false;
      }

      // Clear world-space inertia while transitioning
      if (state.active) {
        vrm.scene.updateMatrixWorld(true);
        (vrm.springBoneManager as any).reset?.();
      }
    }

    // Always track previous rotation for the next frame
    prevHipsQuat.current.copy(hips.quaternion);
  }, -3); // priority -3: runs before wind(-2), FBX(-1), animator(0)

  // ─── Add pendant accessory ────────────────────────────────────────────────
  useEffect(() => {
    if (!vrm) return;

    if (pendantRef.current) {
      pendantRef.current.parent?.remove(pendantRef.current);
      pendantRef.current = null;
    }

    const neckBone = vrm.humanoid?.getNormalizedBoneNode('neck');
    if (!neckBone) return;

    const pendant = new THREE.Group();

    const chainGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.08, 6);
    const chainMat = new THREE.MeshStandardMaterial({ color: '#c0c0c0', metalness: 0.8, roughness: 0.2 });
    const chain = new THREE.Mesh(chainGeo, chainMat);
    chain.position.set(0, -0.04, 0);
    pendant.add(chain);

    const gemGeo = new THREE.OctahedronGeometry(0.015);
    const gemMat = new THREE.MeshStandardMaterial({
      color: '#7dd3fc',
      metalness: 0.3,
      roughness: 0.1,
      emissive: '#7dd3fc',
      emissiveIntensity: 0.1,
    });
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.position.set(0, -0.08, 0);
    pendant.add(gem);

    pendant.position.set(0, -0.02, 0.04);
    neckBone.add(pendant);
    pendantRef.current = pendant;

    return () => {
      if (pendantRef.current) {
        pendantRef.current.parent?.remove(pendantRef.current);
        chainGeo.dispose(); chainMat.dispose();
        gemGeo.dispose();   gemMat.dispose();
        pendantRef.current = null;
      }
    };
  }, [vrm]);

  // ─── Drag wind + idle micro-wind → natural hair/cloth physics ─────────────
  // When dragged: measure movement velocity → inject as external wind into the
  // spring-bone manager so hair trails behind naturally.
  // When idle: gentle oscillating micro-wind keeps hair softly alive.
  const prevWorldPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const windVelocity = useRef<THREE.Vector3>(new THREE.Vector3());

  useFrame((_state, delta) => {
    if (!vrm?.springBoneManager) return;
    const manager = vrm.springBoneManager as any;

    const { isDragging, worldPosition } = useAvatarState.getState();
    const curPos = new THREE.Vector3(worldPosition.x, worldPosition.y, worldPosition.z);

    // Compute velocity from position delta (units/sec)
    const rawVel = curPos.clone().sub(prevWorldPos.current).divideScalar(Math.max(delta, 0.001));
    prevWorldPos.current.copy(curPos);

    // Smooth velocity so hair doesn't snap
    windVelocity.current.lerp(rawVel, isDragging ? 0.25 : 0.08);

    const t = _state.clock.elapsedTime;

    // Idle micro-wind: subtle sinusoidal breeze when not being dragged hard
    const idleWindX = Math.sin(t * 0.6) * 0.015 + Math.sin(t * 1.3) * 0.008;
    const idleWindZ = Math.cos(t * 0.8) * 0.010;

    // Drag contribution: scale velocity to a reasonable wind magnitude
    // (drag at 2 units/sec = 0.3 wind units — hair flies without over-shooting)
    const dragScale = isDragging ? 0.15 : 0.0;

    const finalWind = new THREE.Vector3(
      -windVelocity.current.x * dragScale + idleWindX,
      0,
      -windVelocity.current.z * dragScale + idleWindZ,
    );

    // Inject wind into spring-bone manager's externalForce if the API exists.
    // Do NOT fall back to modifying gravityDir per-joint — that overrides the model
    // author's tuning and makes hair robotic. If no externalForce API, skip wind.
    if (manager.externalForce) {
      manager.externalForce.copy(finalWind);
    } else if (manager.setExternalForce) {
      manager.setExternalForce(finalWind);
    }
    // No fallback gravityDir manipulation — Pixiv VRM handles physics natively.
  }, -2); // priority -2: runs before FBX (-1) and animator (0)

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

  useFbxAnimation(vrm, '/blowkiss.fbx', basePose === 'flying-kiss');
  useFbxAnimation(vrm, '/dance.fbx', basePose === 'dance' || basePose === 'dancing');

  const isCustomPose = !['sit', 'stand', 'peek-left', 'peek-right', 'stretch', 'lean', 'flying-kiss', 'dance', 'dancing', 'caress'].includes(basePose);

  if (!vrm) return null;

  return (
    <group>
      <primitive object={vrm.scene} />
      {isCustomPose && <DynamicFbxPlayer vrm={vrm} slug={basePose} />}
    </group>
  );
}


function DynamicFbxPlayer({ vrm, slug }: { vrm: VRM | null, slug: string }) {
  const [fbxUrl, setFbxUrl] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<'fbx' | 'bvh'>('fbx');
  
  useEffect(() => {
    let cancelled = false;
    
    const fetchCustom = async () => {
      try {
        const asset = await getAsset(slug);
        if (!asset || (asset.type !== 'fbx' && asset.type !== 'bvh') || cancelled) return;
        
        const url = await getAssetUrl(slug);
        if (!url || cancelled) return;

        setAssetType(asset.type as 'fbx' | 'bvh');
        setFbxUrl(url);
      } catch (e) {
        console.warn('Failed to load dynamic FBX/BVH', e);
      }
    };
    
    fetchCustom();
    
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!fbxUrl) return null;
  return <FbxPlayer vrm={vrm} url={fbxUrl} active={true} type={assetType} />;
}

function FbxPlayer({ vrm, url, active, type }: { vrm: VRM | null, url: string, active: boolean, type: 'fbx' | 'bvh' }) {
  useFbxAnimation(vrm, url, active, type);
  return null;
}
