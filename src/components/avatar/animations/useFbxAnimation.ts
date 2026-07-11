/**
 * useFbxAnimation.ts
 *
 * Plays FBX (and BVH) animation clips on a VRM avatar using the
 * Logical Converting Bridge from vrmAnimation.ts.
 *
 * Architecture (matches reference project's VrmViewer.tsx):
 *  1. FBXLoader loads the file once (via useLoader for caching).
 *  2. retargetClip() maps track names and bakes basis quaternions ONCE at load time.
 *  3. A native THREE.AnimationMixer targeting vrm.scene plays the retargeted clip.
 *  4. useFrame at priority -1 only calls mixer.update(delta) — no per-frame bone copy.
 *  5. vrm.update(delta) is NOT called here. It is called exclusively by useVrmAnimator
 *     (priority 0, runs after this hook) so spring-bone physics (hair, clothing)
 *     simulate against the final bone state once per frame → natural waving.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';
import { retargetClip } from './vrmAnimation';

// Module-level cache: URL → loaded FBX/BVH data.
// Each file is parsed exactly once; subsequent mounts receive the cached object instantly.
const fbxCache = new Map<string, any>();

export function clearFbxCache() {
  fbxCache.clear();
}

export function useFbxAnimation(vrm: VRM | null, url: string, active: boolean, type: 'fbx' | 'bvh' = 'fbx', loop: boolean = false) {
  // Initialise from cache so the animation starts immediately if already loaded
  const [loadedData, setLoadedData] = useState<any>(() => fbxCache.get(url) ?? null);
  
  useEffect(() => {
    if (!url) return;

    // Already cached — nothing to do
    if (fbxCache.has(url)) {
      setLoadedData(fbxCache.get(url));
      return;
    }

    let cancelled = false;
    const LoaderClass = type === 'bvh' ? BVHLoader : FBXLoader;
    const loader = new LoaderClass();
    
    loader.load(url, (data) => {
      if (!cancelled) {
        // --- MEMORY OPTIMIZATION ---
        // The FBX file contains 3D meshes (geometry, materials, textures) which consume GPU VRAM.
        // We ONLY need the animation clip and the bone hierarchy.
        // By disposing the geometries and materials instantly, we free the GPU memory 
        // while safely caching the lightweight animation data in regular RAM!
        if (data instanceof THREE.Object3D) {
          data.traverse((obj: any) => {
            if (obj.isMesh) {
              obj.geometry?.dispose();
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m: any) => m.dispose());
              } else {
                obj.material?.dispose();
              }
              // Nullify references so garbage collector can sweep them
              obj.geometry = null;
              obj.material = null;
            }
          });
        }
        
        fbxCache.set(url, data); // cache the lightweight hierarchy for next mount
        setLoadedData(data);
      }
    }, undefined, (err) => {
      console.warn("Failed to load animation:", err);
    });
    
    return () => {
      cancelled = true;
      // Do NOT dispose or null out setLoadedData \u2014 the cached object is shared.
    };
  }, [url, type]);


  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    if (!vrm || !loadedData || !url) return;

    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current.uncacheRoot(vrm.scene);
      mixerRef.current = null;
      actionRef.current = null;
    }

    let rawClip: THREE.AnimationClip | null = null;
    let sourceHierarchy: THREE.Object3D | undefined = undefined;

    if (type === 'fbx') {
      const fbx = loadedData as THREE.Group;
      if (!fbx.animations?.length) return;
      fbx.updateMatrixWorld(true);
      rawClip = fbx.animations[0];
      sourceHierarchy = fbx;
    } else {
      // BVH returns an object with .clip and .skeleton
      const bvh = loadedData;
      if (!bvh.clip) return;
      rawClip = bvh.clip;
      
      // We must build a hierarchy to get the rest rotations for the bones!
      // BVHLoader returns a skeleton. We can build a dummy SkinnedMesh to act as the source hierarchy.
      const dummyGeo = new THREE.BufferGeometry();
      const dummyMat = new THREE.MeshBasicMaterial();
      const dummyMesh = new THREE.SkinnedMesh(dummyGeo, dummyMat);
      
      dummyMesh.bind(bvh.skeleton);
      dummyMesh.add(bvh.skeleton.bones[0]); // add root bone
      dummyMesh.updateMatrixWorld(true);
      
      sourceHierarchy = dummyMesh;
    }

    vrm.scene.updateMatrixWorld(true);
    const retargeted = retargetClip(rawClip, vrm, sourceHierarchy);

    // Create a mixer targeting vrm.scene (same root the ref project uses)
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixerRef.current = mixer;

    // Determine if this animation should loop forever or play once
    const shouldLoop = loop;

    const action = mixer.clipAction(retargeted);
    if (shouldLoop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actionRef.current = action;

    // When the animation finishes (LoopOnce only), reset to standing pose
    if (!shouldLoop) {
      mixer.addEventListener('finished', () => {
        useAvatarState.getState().setBasePose('stand');
      });
    }

    // ── Auto-start if already active when the FBX finishes loading ──────────
    // The `active` effect below runs on mount but actionRef is null at that point
    // (FBX hasn't loaded yet), so .play() would be skipped. We must also start
    // the action here, right after it's created, when active is already true.
    if (active) {
      action.reset().fadeIn(0.25).play();
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(vrm.scene);
      mixerRef.current = null;
      actionRef.current = null;
    };
  }, [vrm, loadedData]);

  // ── Play / stop the action when `active` changes AFTER load ──────────────
  // This handles the case where active toggles while the FBX is already loaded.
  useEffect(() => {
    if (!actionRef.current) return;
    if (active) {
      actionRef.current.reset().fadeIn(0.25).play();
    } else {
      actionRef.current.fadeOut(0.25);
    }
  }, [active]);

  // ── Per-frame: advance the mixer only (priority -1 → runs before useVrmAnimator) ──
  // DO NOT call vrm.update(delta) here. useVrmAnimator (priority 0) calls it
  // after all bone writes, ensuring hair/clothing physics run exactly once.
  useFrame((_state, delta) => {
    if (active && mixerRef.current) {
      mixerRef.current.update(delta);
    }
  }, -1);
}

import { getAsset, getAssetUrl } from '../../../lib/system/assetDB';

export function useDynamicFbxAnimation(vrm: VRM | null, slug: string) {
  const [fbxUrl, setFbxUrl] = useState<string | null>(null);
  const [assetType, setAssetType] = useState<'fbx' | 'bvh'>('fbx');
  
  useEffect(() => {
    if (!slug) {
      setFbxUrl(null);
      return;
    }
    
    let cancelled = false;

    const fetchCustomFbx = async () => {
      try {
        const asset = await getAsset(slug);
        if (!asset || (asset.type !== 'fbx' && asset.type !== 'bvh') || cancelled) return;
        
        const url = await getAssetUrl(slug);
        if (!url || cancelled) return;

        setAssetType(asset.type as 'fbx' | 'bvh');
        setFbxUrl(url);
      } catch (e) {
        console.warn('Failed to load custom FBX/BVH from DB', e);
      }
    };
    
    fetchCustomFbx();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Use the standard hook with the dynamic URL.
  // Note: active is always true if fbxUrl is present, because this hook only runs when the basePose == slug.
  useFbxAnimation(vrm, fbxUrl || '', !!fbxUrl, assetType);
}
