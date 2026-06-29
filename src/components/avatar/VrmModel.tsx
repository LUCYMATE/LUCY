import { useEffect, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRM, VRMExpressionPresetName, VRMHumanBoneName } from '@pixiv/three-vrm';
import * as THREE from 'three';

interface VrmModelProps {
  url: string;
  isSpeaking: boolean;
  isThinking?: boolean;
  isListening?: boolean;
}

interface BoneRest {
  [boneName: string]: THREE.Quaternion;
}

// Slerp a bone toward a target that is: rest * delta(dx,dy,dz)
function slerpFromRest(
  bone: THREE.Object3D | null | undefined,
  rest: THREE.Quaternion,
  dx: number, dy: number, dz: number,
  alpha: number
) {
  if (!bone) return;
  const delta  = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz, 'XYZ'));
  const target = rest.clone().multiply(delta);
  bone.quaternion.slerp(target, alpha);
}

// All bones we snapshot + animate
const BONE_LIST: VRMHumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
];

export function VrmModel({ url, isSpeaking, isThinking, isListening }: VrmModelProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const restPose = useRef<BoneRest>({});

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });

  useEffect(() => {
    if (!gltf?.userData.vrm) return;
    const loadedVrm = gltf.userData.vrm as VRM;

    loadedVrm.scene.traverse((obj) => { obj.frustumCulled = false; });
    loadedVrm.scene.rotation.y = Math.PI;

    // Reset to model's own rest/T/A-pose
    loadedVrm.humanoid.resetNormalizedPose();

    // Capture every bone's true rest quaternion — our animation baseline
    const snap: BoneRest = {};
    for (const name of BONE_LIST) {
      const node = loadedVrm.humanoid.getNormalizedBoneNode(name);
      if (node) {
        snap[name] = node.quaternion.clone();
        const e = new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ');
        console.log(`[REST] ${name}: x=${e.x.toFixed(3)} y=${e.y.toFixed(3)} z=${e.z.toFixed(3)}`);
      }
    }
    restPose.current = snap;

    setVrm(loadedVrm);
  }, [gltf]);

  useFrame((state, delta) => {
    if (!vrm) return;
    vrm.update(delta);

    const t    = state.clock.elapsedTime;
    const rest = restPose.current;
    const S    = 0.07; // global slerp smoothing

    const fr = (
      name: VRMHumanBoneName,
      dx: number, dy: number, dz: number,
      alpha: number = S
    ) => slerpFromRest(
      vrm.humanoid?.getNormalizedBoneNode(name),
      rest[name] ?? new THREE.Quaternion(),
      dx, dy, dz, alpha
    );

    // ══════════════════════════════════════════════════════════════════════
    // 1. SITTING POSE — always applied first as the permanent baseline
    //    In VRM normalized space, upper-leg rest = pointing straight down (-Y).
    //    To sit: rotate thighs forward ~90° → delta x = +1.45 rad
    //    To bend knees:  lower-leg backward  → delta x = -1.35 rad
    //    Feet:           dorsiflexion        → delta x = +0.5  rad
    //    Hips:           tilt forward so pelvis matches chair → delta x = +0.2 rad
    // ══════════════════════════════════════════════════════════════════════
    const sitSmooth = 0.05; // slower transition into sit

    fr(VRMHumanBoneName.Hips,         0.18, 0, 0, sitSmooth);  // pelvis tips forward
    fr(VRMHumanBoneName.Spine,        0.05, 0, 0, sitSmooth);  // slight upright lean
    fr(VRMHumanBoneName.Chest,        0,    0, 0, sitSmooth);

    // Thighs: swing forward to horizontal
    fr(VRMHumanBoneName.LeftUpperLeg,  1.45, 0, 0.05,  sitSmooth); // slight splay
    fr(VRMHumanBoneName.RightUpperLeg, 1.45, 0, -0.05, sitSmooth);

    // Knees: bend backward so lower legs hang down
    fr(VRMHumanBoneName.LeftLowerLeg,  -1.35, 0, 0, sitSmooth);
    fr(VRMHumanBoneName.RightLowerLeg, -1.35, 0, 0, sitSmooth);

    // Feet: point slightly downward (ankle relaxed)
    fr(VRMHumanBoneName.LeftFoot,  0.45, 0, 0, sitSmooth);
    fr(VRMHumanBoneName.RightFoot, 0.45, 0, 0, sitSmooth);

    // ══════════════════════════════════════════════════════════════════════
    // 2. BREATHING — always on, subtle chest rise
    // ══════════════════════════════════════════════════════════════════════
    const breathe = Math.sin(t * 1.15) * 0.012;
    const sway    = Math.sin(t * 0.5)  * 0.008;

    fr(VRMHumanBoneName.UpperChest, breathe, 0, sway * 0.3, 0.04);

    // ══════════════════════════════════════════════════════════════════════
    // 3. HEAD & SPINE — state driven
    // ══════════════════════════════════════════════════════════════════════
    if (isSpeaking) {
      // Very lively head movement while talking
      fr(VRMHumanBoneName.Neck, 0.04, Math.cos(t * 1.8) * 0.05, 0, S);
      fr(VRMHumanBoneName.Head,
        Math.sin(t * 2.2) * 0.12,  // double head tilt
        Math.cos(t * 1.6) * 0.14,  // double head turn
        Math.sin(t * 1.1) * 0.05,
        S);

    } else if (isThinking) {
      fr(VRMHumanBoneName.Neck, 0, 0.1, 0, S * 0.5);
      fr(VRMHumanBoneName.Head,
        -0.14,
        0.2 + Math.sin(t * 0.4) * 0.08,
        0.05,
        S * 0.5);

    } else if (isListening) {
      // ACTIVE LISTENING: Pronounced nodding as if agreeing with you
      fr(VRMHumanBoneName.Spine, 0.05 + Math.sin(t * 1.2) * 0.02, 0, 0, S * 0.6); // spine rocks slightly
      fr(VRMHumanBoneName.Neck, 0, -0.08, -0.04, S * 0.6);
      fr(VRMHumanBoneName.Head,
        0.06 + Math.sin(t * 3.5) * 0.06 + Math.sin(t * 1.2) * 0.04, // active double-nods
        -0.14,
        -0.09,
        S * 0.6);

      // Keep elbow relatively low, point forearm to ear (User's custom tweaks restored)
      fr(VRMHumanBoneName.LeftUpperArm,  -.7,  -1.3,  0.2, S * 0.6); 
      fr(VRMHumanBoneName.LeftLowerArm,    0,    -3,    0, S * 0.6); 
      fr(VRMHumanBoneName.LeftHand,     -0.5,     0, -0.5, S * 0.6);

      fr(VRMHumanBoneName.RightUpperArm,  0.2, 0.4, -1.25, S * 0.6);
      fr(VRMHumanBoneName.RightLowerArm,  0, 1.4, 0, S * 0.6);
      fr(VRMHumanBoneName.RightHand,      -0.1, 0, -0.1, S * 0.6);

    } else {
      // Idle: slow natural look-around
      fr(VRMHumanBoneName.Neck, 0, 0, 0, S * 0.35);
      fr(VRMHumanBoneName.Head,
        Math.sin(t * 0.4)  * 0.04,
        Math.sin(t * 0.55) * Math.cos(t * 0.3) * 0.09,
        0,
        S * 0.35);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 4. ARMS & HANDS
    // ══════════════════════════════════════════════════════════════════════
    const idleSway = Math.sin(t * 0.8) * 0.02;

    const rArmBase = { x: 0.2, y: 0.4, z: -1.25 };
    const rElbowBase = { x: 0, y: 1.4, z: 0 }; 
    const rHandBase = { x: -0.1, y: 0, z: -0.1 };

    const lArmBase = { x: 0.2, y: -0.4, z: 1.25 };
    const lElbowBase = { x: 0, y: -1.4, z: 0 }; 
    const lHandBase = { x: -0.1, y: 0, z: 0.1 };

    if (isSpeaking) {
      const g        = t * 2.1;
      // MUCH larger and more expressive arm gestures
      const swing    = Math.sin(g)         * 0.45;  
      const counter  = Math.sin(g + 1.1)   * 0.15;
      const elbowR   = Math.sin(g * 1.35)  * 0.40;
      const elbowL   = Math.sin(g * 1.1)   * 0.20;
      const wristR   = Math.sin(g * 1.8)   * 0.35;
      const rise     = Math.abs(Math.sin(g * 0.7)) * 0.50;

      // RIGHT arm: primary gesturing arm
      fr(VRMHumanBoneName.RightUpperArm,  rArmBase.x + rise, rArmBase.y + swing, rArmBase.z + 0.4, S);
      fr(VRMHumanBoneName.RightLowerArm,  rElbowBase.x, rElbowBase.y + elbowR, rElbowBase.z, S);
      fr(VRMHumanBoneName.RightHand,      rHandBase.x + wristR, rHandBase.y, rHandBase.z, S);

      // LEFT arm: subtle balance
      fr(VRMHumanBoneName.LeftUpperArm,   lArmBase.x, lArmBase.y + counter, lArmBase.z, S);
      fr(VRMHumanBoneName.LeftLowerArm,   lElbowBase.x, lElbowBase.y - elbowL, lElbowBase.z, S);
      fr(VRMHumanBoneName.LeftHand,       lHandBase.x, lHandBase.y, lHandBase.z, S);

    } else if (isThinking) {
      fr(VRMHumanBoneName.RightUpperArm,  0.5,  0.8, -0.6, S * 0.6); 
      fr(VRMHumanBoneName.RightLowerArm,  0,    2.2,  0,   S * 0.6); 
      fr(VRMHumanBoneName.RightHand,      0,    0,    0,   S * 0.6);

      fr(VRMHumanBoneName.LeftUpperArm,   lArmBase.x, lArmBase.y, lArmBase.z, S * 0.6);
      fr(VRMHumanBoneName.LeftLowerArm,   lElbowBase.x, lElbowBase.y, lElbowBase.z, S * 0.6);
      fr(VRMHumanBoneName.LeftHand,       lHandBase.x, lHandBase.y, lHandBase.z, S * 0.6);

    } else if (isListening) {
      // Keep elbow relatively low, point forearm to ear
      fr(VRMHumanBoneName.LeftUpperArm,   0,   -0.8,  0.2, S * 0.6); 
      fr(VRMHumanBoneName.LeftLowerArm,   0,   -2.6,  0,   S * 0.6); 
      fr(VRMHumanBoneName.LeftHand,      -0.5,  0,   -0.5, S * 0.6);

      fr(VRMHumanBoneName.RightUpperArm,  rArmBase.x, rArmBase.y, rArmBase.z, S * 0.6);
      fr(VRMHumanBoneName.RightLowerArm,  rElbowBase.x, rElbowBase.y, rElbowBase.z, S * 0.6);
      fr(VRMHumanBoneName.RightHand,      rHandBase.x, rHandBase.y, rHandBase.z, S * 0.6);

    } else {
      fr(VRMHumanBoneName.RightUpperArm,  rArmBase.x + idleSway, rArmBase.y, rArmBase.z, S * 0.4);
      fr(VRMHumanBoneName.RightLowerArm,  rElbowBase.x, rElbowBase.y, rElbowBase.z, S * 0.4);
      fr(VRMHumanBoneName.RightHand,      rHandBase.x, rHandBase.y, rHandBase.z, S * 0.4);

      fr(VRMHumanBoneName.LeftUpperArm,   lArmBase.x + idleSway, lArmBase.y, lArmBase.z, S * 0.4);
      fr(VRMHumanBoneName.LeftLowerArm,   lElbowBase.x, lElbowBase.y, lElbowBase.z, S * 0.4);
      fr(VRMHumanBoneName.LeftHand,       lHandBase.x, lHandBase.y, lHandBase.z, S * 0.4);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 5. EXPRESSIONS — blinking + lip sync
    // ══════════════════════════════════════════════════════════════════════
    if (vrm.expressionManager) {
      const bp    = t % 4.0;
      const blink = bp < 0.08 ? 1
                  : bp < 0.18 ? 1 - (bp - 0.08) / 0.10
                  : 0;
      vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blink);

      if (isSpeaking) {
        // Mouth opens MUCH wider, and faster to simulate active talking
        const aa = Math.min(1.0, Math.max(0, Math.sin(t * 15.0) * 1.4 + Math.sin(t * 8.5) * 0.5));
        const ih = Math.min(1.0, Math.max(0, Math.sin(t * 11.2) * 0.7));
        vrm.expressionManager.setValue(VRMExpressionPresetName.Aa,    aa);
        vrm.expressionManager.setValue(VRMExpressionPresetName.Ih,    ih);
        vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.3);
      } else {
        vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, 0);
        vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, 0);
        vrm.expressionManager.setValue(
          VRMExpressionPresetName.Happy,
          isListening ? 0.35 : isThinking ? 0.0 : 0.12
        );
      }
    }
  });

  return (
    <group>
      <primitive object={gltf.scene} />
    </group>
  );
}
