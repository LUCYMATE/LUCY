import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { BasePose, Emotion } from './animations/core';
import { useVrmAnimator } from './animations/useVrmAnimator';
import { useFbxAnimation } from './animations/useFbxAnimation';

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
  // Store original collider radii for ALL colliders
  const colliderOrigRadii = useRef<Map<any, number>>(new Map());

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

        // ── Fix ALL spring-bone physics ──────────────────────────────────────
        if (loadedVrm.springBoneManager) {
          const manager = loadedVrm.springBoneManager as any;

          const rawJoints: any[] = [];
          if (manager.joints) {
            manager.joints.forEach((j: any) => rawJoints.push(j));
          } else if (manager.springBones) {
            manager.springBones.forEach((j: any) => rawJoints.push(j));
          }

          rawJoints.forEach((joint) => {
            const s = joint.settings;
            if (!s) return;

            const boneName = (joint.bone?.name || '').toLowerCase();
            if (boneName.includes('ear') || boneName.includes('kemomimi') || 
                boneName.includes('tail') || boneName.includes('shippo') ||
                boneName.includes('breast') || boneName.includes('bust')) {
              return;
            }

            if (!s.gravityDir) {
              s.gravityDir = new THREE.Vector3(0, -1, 0);
            } else {
              s.gravityDir.set(0, -1, 0);
            }
            s.gravityPower = Math.max(s.gravityPower ?? 0, 0.15);
          });

          const rawColliders: any[] = [];
          if (manager.colliders) {
            if (Array.isArray(manager.colliders)) {
              rawColliders.push(...manager.colliders);
            } else if (typeof manager.colliders.forEach === 'function') {
              manager.colliders.forEach((c: any) => rawColliders.push(c));
            }
          }

          colliderOrigRadii.current.clear();
          rawColliders.forEach((collider) => {
            const shape = collider.shape;
            if (shape && typeof shape.radius === 'number') {
              colliderOrigRadii.current.set(collider, shape.radius);
            }
          });
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

  // ─── Sitting: disable ALL colliders so skirt/hair fall naturally ───────────
  // When seated the legs bend upward and colliders push spring-bone cloth UP.
  // Zeroing ALL radii while sitting lets gravity alone position the fabric.
  // We also reset the spring simulation so cloth immediately falls from rest
  // instead of staying stuck in the "pushed up" state.
  useEffect(() => {
    if (!vrm?.springBoneManager) return;
    const manager = vrm.springBoneManager as any;

    const rawColliders: any[] = [];
    if (manager.colliders) {
      if (Array.isArray(manager.colliders)) {
        rawColliders.push(...manager.colliders);
      } else if (typeof manager.colliders.forEach === 'function') {
        manager.colliders.forEach((c: any) => rawColliders.push(c));
      }
    }

    rawColliders.forEach((collider) => {
      const savedRadius = colliderOrigRadii.current.get(collider);
      if (savedRadius === undefined) return;
      const shape = collider.shape;
      if (shape && typeof shape.radius === 'number') {
        shape.radius = isSitting ? 0.001 : savedRadius;
      }
    });

    // Reset spring bone simulation when sitting so cloth re-settles by gravity
    if (isSitting) {
      manager.reset?.();
    }
  }, [isSitting, vrm]);

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

  useFbxAnimation(vrm, '/Blow A Kiss.fbx', basePose === 'flying-kiss');

  if (!vrm) return null;

  return (
    <group>
      <primitive object={vrm.scene} />
    </group>
  );
}
