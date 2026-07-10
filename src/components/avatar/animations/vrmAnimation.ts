/**
 * vrmAnimation.ts
 *
 * Logical Converting Bridge — FBX / BVH → VRM
 * Adapted from the reference project (refrence/src/lib/vrmAnimation.ts).
 *
 * Key design:
 *  - Retargeting is done ONCE at load time (not per-frame).
 *  - The resulting AnimationClip targets the renamed VRM bone nodes directly.
 *  - A native THREE.AnimationMixer plays the clip on vrm.scene.
 *  - vrm.update(delta) is called ONLY by useVrmAnimator so spring-bone physics
 *    (hair, clothing) simulate against the final posed skeleton each frame,
 *    producing natural waving instead of jitter.
 */

import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';

// ─── Bone name map: Mixamo / common formats → VRM humanoid standard ──────────

export const BONE_MAP: Record<string, string> = {
  // Hips
  hips: 'hips',
  mixamorighips: 'hips',
  root: 'hips',
  pelvis: 'hips',
  b_hips: 'hips',

  // Spine & Chest
  spine: 'spine',
  mixamorigspine: 'spine',
  b_spine: 'spine',
  spine1: 'chest',
  mixamorigspine1: 'chest',
  chest: 'chest',
  b_chest: 'chest',
  spine2: 'upperChest',
  mixamorigspine2: 'upperChest',
  upperchest: 'upperChest',
  b_upperchest: 'upperChest',

  // Neck & Head
  neck: 'neck',
  mixamorigneck: 'neck',
  b_neck: 'neck',
  head: 'head',
  mixamorighead: 'head',
  b_head: 'head',

  // Left Arm
  leftshoulder: 'leftShoulder',
  mixamorigleftshoulder: 'leftShoulder',
  l_shoulder: 'leftShoulder',
  leftarm: 'leftUpperArm',
  mixamorigleftarm: 'leftUpperArm',
  leftupperarm: 'leftUpperArm',
  l_uparm: 'leftUpperArm',
  leftforearm: 'leftLowerArm',
  mixamorigleftforearm: 'leftLowerArm',
  leftlowerarm: 'leftLowerArm',
  l_forearm: 'leftLowerArm',
  lefthand: 'leftHand',
  mixamoriglefthand: 'leftHand',
  l_hand: 'leftHand',

  // Right Arm
  rightshoulder: 'rightShoulder',
  mixamorigrightshoulder: 'rightShoulder',
  r_shoulder: 'rightShoulder',
  rightarm: 'rightUpperArm',
  mixamorigrightarm: 'rightUpperArm',
  rightupperarm: 'rightUpperArm',
  r_uparm: 'rightUpperArm',
  rightforearm: 'rightLowerArm',
  mixamorigrightforearm: 'rightLowerArm',
  rightlowerarm: 'rightLowerArm',
  r_forearm: 'rightLowerArm',
  righthand: 'rightHand',
  mixamorigrighthand: 'rightHand',
  r_hand: 'rightHand',

  // Left Leg
  leftupleg: 'leftUpperLeg',
  mixamorigleftupleg: 'leftUpperLeg',
  leftupperleg: 'leftUpperLeg',
  l_thigh: 'leftUpperLeg',
  thigh_l: 'leftUpperLeg',
  leftthigh: 'leftUpperLeg',
  leg_l: 'leftUpperLeg',

  leftleg: 'leftLowerLeg',
  mixamorigleftleg: 'leftLowerLeg',
  leftlowerleg: 'leftLowerLeg',
  l_calf: 'leftLowerLeg',
  calf_l: 'leftLowerLeg',
  leftshin: 'leftLowerLeg',
  knee_l: 'leftLowerLeg',

  leftfoot: 'leftFoot',
  mixamorigleftfoot: 'leftFoot',
  l_foot: 'leftFoot',
  foot_l: 'leftFoot',
  left_foot: 'leftFoot',
  ankle_l: 'leftFoot',

  lefttoebase: 'leftToes',
  mixamoriglefttoebase: 'leftToes',
  l_toe: 'leftToes',
  toe_l: 'leftToes',
  lefttoe: 'leftToes',
  ball_l: 'leftToes',

  // Right Leg
  rightupleg: 'rightUpperLeg',
  mixamorigrightupleg: 'rightUpperLeg',
  rightupperleg: 'rightUpperLeg',
  r_thigh: 'rightUpperLeg',
  thigh_r: 'rightUpperLeg',
  rightthigh: 'rightUpperLeg',
  leg_r: 'rightUpperLeg',

  rightleg: 'rightLowerLeg',
  mixamorigrightleg: 'rightLowerLeg',
  rightlowerleg: 'rightLowerLeg',
  r_calf: 'rightLowerLeg',
  calf_r: 'rightLowerLeg',
  rightshin: 'rightLowerLeg',
  knee_r: 'rightLowerLeg',

  rightfoot: 'rightFoot',
  mixamorigrightfoot: 'rightFoot',
  r_foot: 'rightFoot',
  foot_r: 'rightFoot',
  right_foot: 'rightFoot',
  ankle_r: 'rightFoot',

  righttoebase: 'rightToes',
  mixamorigrighttoebase: 'rightToes',
  r_toe: 'rightToes',
  toe_r: 'rightToes',
  righttoe: 'rightToes',
  ball_r: 'rightToes',
};

/** Standard VRM humanoid bone names used for validation. */
export const VRM_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

// ─── Track name parser ────────────────────────────────────────────────────────

/**
 * Extracts bone name and track property from an AnimationClip track name.
 * e.g. "mixamorigLeftArm.quaternion" → { boneName: "mixamorigLeftArm", property: "quaternion" }
 */
export function parseTrackName(trackName: string): { boneName: string; property: string } | null {
  const dotIndex = trackName.lastIndexOf('.');
  if (dotIndex === -1) return null;

  let namePart = trackName.substring(0, dotIndex);
  const property = trackName.substring(dotIndex + 1);

  // Strip hierarchical prefix (e.g. "root/hips" → "hips")
  const slashIndex = namePart.lastIndexOf('/');
  if (slashIndex !== -1) namePart = namePart.substring(slashIndex + 1);

  // Strip namespace (e.g. "Armature:Hips" → "Hips")
  const colonIndex = namePart.lastIndexOf(':');
  if (colonIndex !== -1) namePart = namePart.substring(colonIndex + 1);

  return { boneName: namePart, property };
}

// ─── Load-time retargeting ────────────────────────────────────────────────────

/**
 * Retargets an AnimationClip from Mixamo/BVH/custom rig to VRM.
 *
 * Called ONCE when the animation file is loaded.
 * The returned clip can be played directly on vrm.scene via AnimationMixer.
 *
 * @param sourceClip      The raw AnimationClip from FBXLoader or BVHLoader.
 * @param vrm             The loaded VRM model (must have bone nodes renamed first).
 * @param sourceHierarchy Optional: the source armature (FBX group or BVH root bone)
 *                        used to compute world-space basis quaternion offsets.
 */
export function retargetClip(
  sourceClip: THREE.AnimationClip,
  vrm: VRM,
  sourceHierarchy?: THREE.Object3D,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  if (sourceHierarchy) sourceHierarchy.updateMatrixWorld(true);
  vrm.scene.updateMatrixWorld(true);

  sourceClip.tracks.forEach((track) => {
    const parsed = parseTrackName(track.name);
    if (!parsed) return;

    const { boneName, property } = parsed;
    
    // Normalize bone name for lookup (strip _Skele suffix here, not in parseTrackName!)
    let lookupName = boneName.toLowerCase();
    if (lookupName.endsWith('_skele')) {
      lookupName = lookupName.substring(0, lookupName.length - 6);
    }
    const lowerBoneName = lookupName;

    // Resolve which VRM humanoid bone this track targets
    const mappedBoneName =
      BONE_MAP[lowerBoneName] ?? (VRM_BONES.includes(boneName) ? boneName : null);

    if (!mappedBoneName) {
      // Keep root-level fallback
      if (boneName === 'hips' || boneName === 'root') {
        tracks.push(cloneTrackWithName(track, `${boneName}.${property}`));
      }
      return;
    }

    // Make sure the VRM model actually has this bone
    const vrmBone = vrm.humanoid?.getNormalizedBone(mappedBoneName as any);
    if (!vrmBone?.node) return;

    // After VrmModel renames bones, node.name === mappedBoneName
    const targetName = `${vrmBone.node.name}.${property}`;

    // Only transfer position for hips; all other bones use quaternion only
    if (property === 'position' && mappedBoneName !== 'hips') return;

    let retargetedTrack = track;

    if (property === 'quaternion') {
      const times = track.times;
      const values = track.values.slice();

      const restRotationInverse = new THREE.Quaternion();
      const parentRestWorldRotation = new THREE.Quaternion();
      const _quatA = new THREE.Quaternion();

      if (sourceHierarchy) {
        const mixamoRigNode = sourceHierarchy.getObjectByName(boneName);
        if (mixamoRigNode) {
          mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
          if (mixamoRigNode.parent) {
            mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
          } else {
            parentRestWorldRotation.identity();
          }

          // Bake coordinate-system change into every keyframe value
          for (let i = 0; i < values.length; i += 4) {
            _quatA.fromArray(values, i);
            _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
            _quatA.toArray(values, i);
          }
        }
      }

      // Handle VRM 0.0 axis negation
      const finalValues = values.map((v, i) =>
        vrm.meta?.metaVersion === '0' && i % 2 === 0 ? -v : v
      );

      retargetedTrack = new THREE.QuaternionKeyframeTrack(targetName, times, finalValues);

    } else if (property === 'position' && mappedBoneName === 'hips') {
      const times = track.times;
      const values = track.values.slice();

      // Scale hip translation to match VRM model's proportions
      let hipsPositionScale = 1.0;
      if (sourceHierarchy) {
        let sourceHips = sourceHierarchy.getObjectByName('mixamorigHips');
        if (!sourceHips) {
          sourceHierarchy.traverse((child) => {
            if (child.name.toLowerCase().includes('hips')) sourceHips = child;
          });
        }
        if (sourceHips && vrm.humanoid?.normalizedRestPose?.hips?.position) {
          const motionHipsHeight = sourceHips.position.y;
          const vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips.position[1];
          if (motionHipsHeight > 0) {
            hipsPositionScale = vrmHipsHeight / motionHipsHeight;
          }
        }
      }

      // Fallback scale: unit-detect (FBX is in cm, VRM in m)
      if (hipsPositionScale === 1.0) {
        let maxVal = 0;
        for (const v of values) if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
        hipsPositionScale = maxVal > 10 ? 0.01 : 1.0;
      }

      // Get the initial height of the animation and the avatar's natural height
      const initialFbxY = values[1] || 0; // index 1 is Y of the first frame
      const vrmRestY = vrm.humanoid?.normalizedRestPose?.hips?.position?.[1] || 0;

      const finalValues = values.map((v, i) => {
        const axis = i % 3; // 0=X, 1=Y, 2=Z
        
        // Block absolute X and Z translations so the animation plays IN-PLACE
        if (axis !== 1) return 0;

        // For Y axis, calculate the delta from the FBX's starting height,
        // scale it, and add it to the VRM's natural rest height. This ensures
        // the avatar never snaps to an absolute floor, but hovers perfectly.
        const deltaY = (v - initialFbxY) * hipsPositionScale;
        return vrmRestY + deltaY;
      });

      retargetedTrack = new THREE.VectorKeyframeTrack(targetName, times, finalValues);

    } else {
      retargetedTrack = cloneTrackWithName(track, targetName);
    }

    tracks.push(retargetedTrack);
  });

  return new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks);
}

function cloneTrackWithName(track: THREE.KeyframeTrack, newName: string): THREE.KeyframeTrack {
  const Cls = (track as any).constructor;
  return new Cls(newName, track.times, track.values, (track as any).createInterpolant);
}

// ─── Standardize VRM rig node names ──────────────────────────────────────────

/**
 * Renames VRM humanoid bone nodes to their standard humanoid bone names.
 * Must be called immediately after loading the VRM model.
 *
 * This allows AnimationClip tracks like "leftUpperArm.quaternion" to resolve
 * directly to the correct node via THREE.AnimationMixer, without any custom
 * name-lookup logic at runtime.
 */
export function standardizeVrmBoneNames(vrm: VRM): void {
  if (!vrm.humanoid) return;
  Object.entries(vrm.humanoid.normalizedHumanBones).forEach(([boneName, bone]) => {
    if (bone?.node) {
      bone.node.name = boneName;
    }
  });
}
