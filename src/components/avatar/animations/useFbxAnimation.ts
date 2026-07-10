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

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useLoader, useFrame } from '@react-three/fiber';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRM } from '@pixiv/three-vrm';
import { useAvatarState } from '../../../lib/store/avatarState';
import { retargetClip } from './vrmAnimation';

export function useFbxAnimation(vrm: VRM | null, url: string, active: boolean) {
  // ── Load the FBX once (cached by useLoader) ──────────────────────────────
  const fbx = useLoader(FBXLoader, url);

  // ── Mixer and action refs ────────────────────────────────────────────────
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  // ── Retarget and create mixer ONCE when vrm + fbx are ready ─────────────
  useEffect(() => {
    if (!vrm || !fbx || !fbx.animations?.length) return;

    // Clean up previous mixer if vrm/fbx changed
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current.uncacheRoot(vrm.scene);
      mixerRef.current = null;
      actionRef.current = null;
    }

    // Ensure world matrices are current before retargeting
    fbx.updateMatrixWorld(true);
    vrm.scene.updateMatrixWorld(true);

    // Retarget the raw FBX clip to VRM bone names with basis conversion (once!)
    const rawClip = fbx.animations[0];
    const retargeted = retargetClip(rawClip, vrm, fbx);

    // Create a mixer targeting vrm.scene (same root the ref project uses)
    const mixer = new THREE.AnimationMixer(vrm.scene);
    mixerRef.current = mixer;

    const action = mixer.clipAction(retargeted);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    actionRef.current = action;

    // When the animation finishes, reset the avatar to the standing pose
    mixer.addEventListener('finished', () => {
      useAvatarState.getState().setBasePose('stand');
    });

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(vrm.scene);
      mixerRef.current = null;
      actionRef.current = null;
    };
  }, [vrm, fbx]);

  // ── Play / stop the action when `active` changes ─────────────────────────
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
