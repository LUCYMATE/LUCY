import { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { BasePose, Emotion } from './animations/core';
import { useVrmAnimator } from './animations/useVrmAnimator';
import { useFbxAnimation } from './animations/useFbxAnimation';
import { standardizeVrmBoneNames } from './animations/vrmAnimation';
import { useAvatarState } from '../../lib/store/avatarState';
import { getAsset, getAssetDataUrl } from '../../lib/system/assetDB';

// Global cache to prevent model from disappearing and reloading on remounts
let globalCachedVrm: VRM | null = null;
let globalCachedUrl: string | null = null;
let isGlobalLoading = false;
let globalLoadCallbacks: ((vrm: VRM | null) => void)[] = [];

/** Strip ?t=... cache-bust param for comparison purposes */
function baseUrl(url: string) {
  return url.split('?')[0];
}

// ─── Dispose helper ───────────────────────────────────────────────────────────
function disposeVrm(vrm: VRM) {
  try {
    if (vrm.scene) {
      VRMUtils.deepDispose(vrm.scene);
      vrm.scene.removeFromParent();
    }
    // Also explicitly call vrm.dispose() to clear internal springbones/materials if supported
    if (typeof (vrm as any).dispose === 'function') {
      (vrm as any).dispose();
    }
  } catch (e) { 
    console.error('Error during VRM disposal:', e);
  }
}

/** Called by Avatar3D when a new VRM is uploaded, so the next render triggers a fresh load. */
export function clearVrmCache() {
  if (globalCachedVrm) {
    disposeVrm(globalCachedVrm);
    globalCachedVrm = null;
  }
  globalCachedUrl = null;
  isGlobalLoading = false;
  globalLoadCallbacks = [];
}

interface VrmModelProps {
  url: string;
  reloadKey?: number;  
  isSpeaking: boolean;
  isThinking?: boolean;
  isListening?: boolean;
  basePose?: BasePose;
  isWalking?: boolean;
  emotion?: Emotion;
  moveDirection?: number;
  isSitting?: boolean;
}

export function VrmModel({
  url,
  reloadKey = 0,
  isSpeaking,
  isThinking = false,
  isListening = false,
  basePose = 'sit',
  isWalking = false,
  emotion = 'neutral',
  moveDirection = Math.PI,
  isSitting = false,
}: VrmModelProps) {
  const [vrm, setVrm] = useState<VRM | null>(globalCachedVrm);
  const pendantRef = useRef<THREE.Group | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Manual load / dispose cycle ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    if (globalCachedUrl && baseUrl(globalCachedUrl) === baseUrl(url) && globalCachedVrm) {
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
    globalLoadCallbacks = [];

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

        // --- VRAM Optimizations ---
        try {
          VRMUtils.removeUnnecessaryVertices(loadedVrm.scene);
          VRMUtils.combineSkeletons(loadedVrm.scene);
          VRMUtils.combineMorphs(loadedVrm);
        } catch(e) { console.warn("VRM optimization pass failed", e); }

        // Aggressive Texture Downscaler (Limits RAM/VRAM usage)
        const downscaleTexture = (texture: any, maxSize: number = 1024) => {
          if (!texture || !texture.image) return texture;
          const img = texture.image;
          const width = img.width || img.videoWidth;
          const height = img.height || img.videoHeight;
          if (!width || !height || (width <= maxSize && height <= maxSize)) return texture;
          
          const scale = Math.min(maxSize / width, maxSize / height);
          const newWidth = Math.floor(width * scale);
          const newHeight = Math.floor(height * scale);
          
          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, newWidth, newHeight);
            const newTexture = new THREE.CanvasTexture(canvas);
            newTexture.colorSpace = texture.colorSpace;
            newTexture.flipY = texture.flipY;
            newTexture.wrapS = texture.wrapS;
            newTexture.wrapT = texture.wrapT;
            newTexture.minFilter = texture.minFilter;
            newTexture.magFilter = texture.magFilter;
            newTexture.generateMipmaps = texture.generateMipmaps;
            texture.dispose(); // Free original high-res texture from RAM
            return newTexture;
          }
          return texture;
        };

        loadedVrm.scene.traverse((obj: any) => { 
          obj.frustumCulled = false; 
          if (obj.isMesh && obj.material) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            materials.forEach((mat: any) => {
              if (mat.map) mat.map = downscaleTexture(mat.map);
              if (mat.normalMap) mat.normalMap = downscaleTexture(mat.normalMap);
              if (mat.emissiveMap) mat.emissiveMap = downscaleTexture(mat.emissiveMap);
            });
          }
        });
        
        loadedVrm.scene.rotation.y = Math.PI;

        standardizeVrmBoneNames(loadedVrm);

        // Delete the previous model if one existed in the cache to free RAM immediately
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
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reloadKey]);

  // ─── Smart pose-transition detection ───────────────────────────────────────
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
      
      if (angleDiff < 0.001) {
        state.settledCount++;
        if (state.settledCount > 5) state.active = false;
      } else {
        state.settledCount = 0;
      }

      if (state.frameCount > 120) {
        state.active = false;
      }

      if (state.active) {
        (vrm.springBoneManager as any).reset?.();
      }
    }

    prevHipsQuat.current.copy(hips.quaternion);
  }, -3); 

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

  // Custom wind simulation removed to save CPU.

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

  const isFlyingKiss = basePose === 'flying-kiss';
  const isDancing = basePose === 'dance' || basePose === 'dancing';
  const isCustomPose = !['sit', 'stand', 'peek-left', 'peek-right', 'stretch', 'lean', 'flying-kiss', 'dance', 'dancing', 'caress', 'sleep'].includes(basePose);

  if (!vrm) return null;

  return (
    <group>
      <primitive object={vrm.scene} />
      {isFlyingKiss && <FbxPlayer vrm={vrm} url="/blowkiss.fbx" active={true} type="fbx" loop={false} />}
      {isDancing && <FbxPlayer vrm={vrm} url="/dance.fbx" active={true} type="fbx" loop={false} />}
      {isCustomPose && <DynamicFbxPlayer vrm={vrm} slug={basePose} />}
    </group>
  );
}


let _cacheBustCounter = 0;

export function clearAssetResolutionCache() {
  _cacheBustCounter++;
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
        
        const url = await getAssetDataUrl(slug);
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

  useEffect(() => {
    if (!fbxUrl) return; 
    let cancelled = false;
    
    const reFetchCustom = async () => {
      try {
        const asset = await getAsset(slug);
        if (!asset || (asset.type !== 'fbx' && asset.type !== 'bvh') || cancelled) return;
        
        const url = await getAssetDataUrl(slug);
        if (!url || cancelled) return;

        setAssetType(asset.type as 'fbx' | 'bvh');
        setFbxUrl(url);
      } catch (e) {
        console.warn('Failed to reload dynamic FBX/BVH', e);
      }
    };
    
    reFetchCustom();
    
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_cacheBustCounter]);

  if (!fbxUrl) return null;
  return <FbxPlayer vrm={vrm} url={fbxUrl} active={true} type={assetType} loop={false} />;
}

function FbxPlayer({ vrm, url, active, type, loop }: { vrm: VRM | null, url: string, active: boolean, type: 'fbx' | 'bvh', loop: boolean }) {
  useFbxAnimation(vrm, url, active, type, loop);
  return null;
}
