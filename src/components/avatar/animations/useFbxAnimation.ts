import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLoader, useFrame } from '@react-three/fiber';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';

const mixamoToVrm: Record<string, string> = {
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',
  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  // Fingers are optional, we can include them if the animation relies on hand shapes
  mixamorigLeftHandThumb1: 'leftThumbProximal',
  mixamorigLeftHandThumb2: 'leftThumbIntermediate',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigRightHandThumb1: 'rightThumbProximal',
  mixamorigRightHandThumb2: 'rightThumbIntermediate',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigHips: 'hips',
  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
};

export function useFbxAnimation(vrm: VRM | null, url: string, active: boolean) {
  const fbx = useLoader(FBXLoader, url);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const action = useRef<THREE.AnimationAction | null>(null);

  useEffect(() => {
    if (!vrm || !fbx || !fbx.animations.length) return;

    if (!mixer.current) {
      mixer.current = new THREE.AnimationMixer(fbx);
      action.current = mixer.current.clipAction(fbx.animations[0]);
      // Play once and clamp when finished (don't loop continuously)
      action.current.setLoop(THREE.LoopOnce, 1);
      action.current.clampWhenFinished = true;
      
      mixer.current.addEventListener('finished', () => {
        useAvatarState.getState().setBasePose('stand');
      });
    }

    if (active) {
      action.current.reset().fadeIn(0.2).play();
    } else {
      action.current.fadeOut(0.2);
    }
  }, [vrm, fbx, active]);

  const fbxBoneCache = useRef<Record<string, THREE.Object3D>>({});
  const vrmBoneCache = useRef<Record<string, THREE.Object3D>>({});
  const fbxRestWorldCache = useRef<Record<string, THREE.Quaternion>>({});
  const vrmRestWorldCache = useRef<Record<string, THREE.Quaternion>>({});
  const fbxRestPosCache = useRef<Record<string, THREE.Vector3>>({});
  const vrmRestPosCache = useRef<Record<string, THREE.Vector3>>({});

  useEffect(() => {
    if (!vrm || !fbx) return;
    
    // Ensure both skeletons are in pure T-pose before capturing rest rotations
    vrm.humanoid?.resetNormalizedPose();
    fbx.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);

    const fCache: Record<string, THREE.Object3D> = {};
    const vCache: Record<string, THREE.Object3D> = {};
    const fRest: Record<string, THREE.Quaternion> = {};
    const vRest: Record<string, THREE.Quaternion> = {};
    const fPosRest: Record<string, THREE.Vector3> = {};
    const vPosRest: Record<string, THREE.Vector3> = {};

    for (const [mixamoName, vrmName] of Object.entries(mixamoToVrm)) {
      const fbxNode = fbx.getObjectByName(mixamoName);
      const vrmNode = vrm.humanoid?.getNormalizedBoneNode(vrmName as any);
      if (fbxNode && vrmNode) {
        fCache[mixamoName] = fbxNode;
        vCache[mixamoName] = vrmNode;

        const fwq = new THREE.Quaternion();
        fbxNode.getWorldQuaternion(fwq);
        fRest[mixamoName] = fwq;

        const vwq = new THREE.Quaternion();
        vrmNode.getWorldQuaternion(vwq);
        vRest[mixamoName] = vwq;

        if (vrmName === 'hips') {
           const fPos = new THREE.Vector3();
           fbxNode.getWorldPosition(fPos);
           fPosRest[mixamoName] = fPos;

           const vPos = new THREE.Vector3();
           vrmNode.getWorldPosition(vPos);
           vPosRest[mixamoName] = vPos;
        }
      }
    }

    fbxBoneCache.current = fCache;
    vrmBoneCache.current = vCache;
    fbxRestWorldCache.current = fRest;
    vrmRestWorldCache.current = vRest;
    fbxRestPosCache.current = fPosRest;
    vrmRestPosCache.current = vPosRest;

  }, [vrm, fbx]);

  // Priority -1: Runs after Priority 0 (useVrmAnimator) so FBX takes precedence and overwrites procedural
  useFrame((_state, delta) => {
    if (active && mixer.current) {
      mixer.current.update(delta);
      
      // Update world matrices for FBX armature to ensure accurate world rotations
      fbx.updateMatrixWorld(true);

      const parentWorldQ = new THREE.Quaternion();

      // Apply world rotation DELTAS to VRM
      for (const mixamoName of Object.keys(mixamoToVrm)) {
        const fbxNode = fbxBoneCache.current[mixamoName];
        const vrmNode = vrmBoneCache.current[mixamoName];
        const fbxRestQ = fbxRestWorldCache.current[mixamoName];
        const vrmRestQ = vrmRestWorldCache.current[mixamoName];
        
        if (fbxNode && vrmNode && fbxRestQ && vrmRestQ) {
          const fbxCurrentWorldQ = new THREE.Quaternion();
          fbxNode.getWorldQuaternion(fbxCurrentWorldQ);
          
          // Calculate the exact 3D rotational difference from the FBX's resting T-pose
          // worldDelta = fbxCurrent * fbxRest^-1
          const worldDelta = fbxCurrentWorldQ.clone().multiply(fbxRestQ.clone().invert());
          
          // Apply that exact difference to the VRM's resting T-pose
          // vrmTargetWorldQ = worldDelta * vrmRest
          const vrmTargetWorldQ = worldDelta.clone().multiply(vrmRestQ);

          if (vrmNode.parent) {
            vrmNode.parent.getWorldQuaternion(parentWorldQ);
            const localQ = parentWorldQ.invert().multiply(vrmTargetWorldQ);
            vrmNode.quaternion.copy(localQ);
          } else {
            vrmNode.quaternion.copy(vrmTargetWorldQ);
          }

          // Handle Hips Position Translation (Squatting/Jumping)
          const mixamoToVrmName = mixamoToVrm[mixamoName];
          if (mixamoToVrmName === 'hips') {
            const fPosRest = fbxRestPosCache.current[mixamoName];
            const vPosRest = vrmRestPosCache.current[mixamoName];
            if (fPosRest && vPosRest && fPosRest.y > 0) {
              const fbxCurrentWorldPos = new THREE.Vector3();
              fbxNode.getWorldPosition(fbxCurrentWorldPos);
              
              const posWorldDelta = fbxCurrentWorldPos.clone().sub(fPosRest);
              // Scale it based on the leg length difference (hip height ratio)
              const scale = vPosRest.y / fPosRest.y;
              posWorldDelta.multiplyScalar(scale);
              
              const vrmTargetWorldPos = vPosRest.clone().add(posWorldDelta);
              
              if (vrmNode.parent) {
                const localTarget = vrmNode.parent.worldToLocal(vrmTargetWorldPos.clone());
                vrmNode.position.copy(localTarget);
              } else {
                vrmNode.position.copy(vrmTargetWorldPos);
              }
            }
          }
        }
      }
      
      // Ensure spring bones are updated with the new FBX poses
      vrm.update(delta);
    }
  }, -1);
}
