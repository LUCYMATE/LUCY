import { BasePose, Emotion } from './core';
import { getActiveAudioPlayer } from '../../../lib/audio/audio-player';

/**
 * AvatarAnimationBridge
 * 
 * Unified animation coordinator between 3D (VRM) and 2D (Live2D).
 * Synchronizes speech cadence, conversational hand/arm gestures,
 * expressive poses, screen-edge peeking, and model parameter adaptation.
 */

export interface BridgeAnimationState {
  t: number; // time in seconds
  isSpeaking: boolean;
  isThinking: boolean;
  isListening: boolean;
  basePose: BasePose;
  emotion: Emotion;
  avatarScale: number;
}

export interface Live2DGestureOutputs {
  // Head & Body angles
  angleX: number;
  angleY: number;
  angleZ: number;
  bodyAngleX: number;
  bodyAngleY: number;
  bodyAngleZ: number;
  // Face
  eyeLOpen: number;
  eyeROpen: number;
  eyeBallX: number;
  eyeBallY: number;
  browLY: number;
  browRY: number;
  mouthForm: number;
  mouthOpenY: number;
  // Arm & Hand Gesture Channels (Normalized: -1.0 to 1.0)
  armLShoulder: number;
  armLElbow: number;
  armLWrist: number;
  handL: number;
  armRShoulder: number;
  armRElbow: number;
  armRWrist: number;
  handR: number;
  // Screen Edge Peeking Offsets
  peekEdge: 'left' | 'right' | 'none';
  peekScreenX?: number;
  isSitting: boolean;
}

export class AvatarAnimationBridge {
  private static instance: AvatarAnimationBridge;
  private activePose: BasePose = 'stand';
  private poseStartTime = 0;

  public static getInstance(): AvatarAnimationBridge {
    if (!AvatarAnimationBridge.instance) {
      AvatarAnimationBridge.instance = new AvatarAnimationBridge();
    }
    return AvatarAnimationBridge.instance;
  }

  /**
   * Computes unified gesture signals for both 2D and 3D based on avatar state
   */
  public computeGestures(state: BridgeAnimationState): Live2DGestureOutputs {
    const { t, isSpeaking, isThinking, isListening, basePose, emotion } = state;

    if (basePose !== this.activePose) {
      this.activePose = basePose;
      this.poseStartTime = t;
    }
    const poseElapsed = Math.max(0, t - this.poseStartTime);

    // 1. Natural Breathing & Organic Micro-Sway
    const breathe = (Math.sin(t * 1.8) + 1.0) * 0.5;
    const microSwayX = Math.sin(t * 0.8) * 1.5;
    const microSwayZ = Math.cos(t * 0.6) * 1.2;

    // 2. Base Eye Blinking (every 3.5s)
    const blinkCycle = t % 3.5;
    let eyeOpen = 1.0;
    if (blinkCycle < 0.16) {
      eyeOpen = 1.0 - Math.sin((blinkCycle / 0.16) * Math.PI);
    }
    let eyeLOpen = eyeOpen;
    let eyeROpen = eyeOpen;

    // 3. Conversational Speech Phrasing & Cadence Synthesizer
    let tAngleX = microSwayX;
    let tAngleY = 0;
    let tAngleZ = microSwayZ;
    let tBodyAngleX = 0;
    let tBodyAngleY = 0;
    let tBodyAngleZ = 0;
    let tEyeBallX = 0;
    let tEyeBallY = 0;
    let tMouthForm = 0;
    let tBrowLY = 0;
    let tBrowRY = 0;
    let tMouthOpen = 0;

    // Hand/Arm channels (0 = resting by side, positive = raised/gesturing outward)
    let armLShoulder = 0;
    let armLElbow = 0;
    let armLWrist = 0;
    let handL = 0;
    let armRShoulder = 0;
    let armRElbow = 0;
    let armRWrist = 0;
    let handR = 0;

    let peekEdge: 'left' | 'right' | 'none' = 'none';

    // ── AI Interactive State Modulations ─────────────────────────────────────
    if (isThinking) {
      tAngleZ = -12.0;
      tAngleY = 7.0;
      tEyeBallY = 0.55;
      tEyeBallX = -0.35;
      tBrowLY = 0.2;
      tBrowRY = -0.1;
      // Hand near chin / thinking gesture
      armRShoulder = 0.35;
      armRElbow = 0.65;
      armRWrist = -0.3;
      handR = 0.4;
    } else if (isListening) {
      tAngleY = -4.0;
      tAngleZ = 4.0;
      eyeOpen = Math.min(1.2, eyeOpen + 0.15);
      tBrowLY = 0.15;
      tBrowRY = 0.15;
    }

    // ── Speech Cadence & Expressive Hand Gesturing ───────────────────────────
    if (isSpeaking) {
      // Audio-reactive mouth opening driven by real-time speech volume from Web Audio FFT
      const audioVol = getActiveAudioPlayer()?.getSpeechVolume() ?? 0;
      tMouthOpen = audioVol > 0.02 ? audioVol : Math.min(0.6, Math.max(0, Math.sin(t * 14.0) * 0.7));

      // Conversational Phrasing (~2.8 second phrase cycles)
      const phraseProgress = (t % 2.8) / 2.8;
      const phraseEnvelope = Math.sin(phraseProgress * Math.PI); // 0 -> 1 -> 0

      // Fast syllabic pulse simulating natural speech bursts
      const syllable = Math.sin(t * 11.0) * 0.35 + Math.sin(t * 6.0) * 0.65;
      const speechEmphasis = Math.max(0, syllable);

      // Head punctuates speech with rhythmic nodding and conversational tilt
      tAngleY = Math.sin(t * 4.5) * 3.5;
      tAngleX = Math.sin(t * 2.2) * 2.8 - speechEmphasis * 2.5; // subtle nods on emphasis
      tAngleZ += Math.sin(t * 1.5) * 2.0;

      // Primary gesturing arm (Right arm conversational beats)
      armRShoulder = phraseEnvelope * (0.35 + speechEmphasis * 0.35);
      armRElbow = phraseEnvelope * (0.45 + speechEmphasis * 0.30);
      armRWrist = Math.sin(t * 4.0) * 0.35 + speechEmphasis * 0.25;
      handR = phraseEnvelope * 0.6;

      // Secondary balancing gestures (Left arm subtle elevation & sway)
      const leftCadence = Math.sin((t + 1.4) * 1.6);
      if (leftCadence > 0.2) {
        armLShoulder = leftCadence * 0.22;
        armLElbow = leftCadence * 0.28;
        armLWrist = Math.cos(t * 3.0) * 0.2;
        handL = leftCadence * 0.3;
      }
    }

    // ── Base Poses ───────────────────────────────────────────────────────────
    // ── Base Poses ───────────────────────────────────────────────────────────
    const p = (basePose || '').toLowerCase().trim();

    if (p === 'dynamic-talk' || p === 'talk') {
      // High-energy speaking pose: broad hand gestures, active posture
      const talkWave = Math.sin(t * 3.2) * 0.3;
      tAngleY = Math.sin(t * 5.0) * 5.0;
      tAngleX = Math.sin(t * 2.8) * 4.0;
      tBodyAngleZ = Math.sin(t * 2.0) * 4.0;

      armRShoulder = 0.6 + talkWave;
      armRElbow = 0.7 + talkWave * 0.5;
      armRWrist = -0.3 + talkWave;
      handR = 0.8;

      armLShoulder = 0.3;
      armLElbow = 0.4;
      armLWrist = 0.2;
      handL = 0.4;
    } else if (p === 'peek-left') {
      peekEdge = 'left';
      tAngleX = 22.0;
      tAngleZ = 16.0;
      tAngleY = 6.0;
      tBodyAngleX = 14.0;
      tBodyAngleZ = 18.0;
      tEyeBallX = 0.7;
      tEyeBallY = 0.15;
      tBrowLY = 0.3;
      tBrowRY = 0.3;
      tMouthForm = 0.5;
      eyeOpen = Math.min(1.2, eyeOpen + 0.15);

      armRShoulder = 0.45;
      armRElbow = 0.6;
      armRWrist = 0.4;
      handR = 0.7;

      armLShoulder = 0.3;
      armLElbow = 0.5;
      armLWrist = 0.3;
      handL = 0.5;
    } else if (p === 'peek-right') {
      peekEdge = 'right';
      tAngleX = -22.0;
      tAngleZ = -16.0;
      tAngleY = 6.0;
      tBodyAngleX = -14.0;
      tBodyAngleZ = -18.0;
      tEyeBallX = -0.7;
      tEyeBallY = 0.15;
      tBrowLY = 0.3;
      tBrowRY = 0.3;
      tMouthForm = 0.5;
      eyeOpen = Math.min(1.2, eyeOpen + 0.15);

      armLShoulder = 0.45;
      armLElbow = 0.6;
      armLWrist = -0.4;
      handL = 0.7;

      armRShoulder = 0.3;
      armRElbow = 0.5;
      armRWrist = -0.3;
      handR = 0.5;
    } else if (p.includes('kiss')) {
      // 4-Phase Cinematic Sequence matching 3D blowkiss.fbx (total 4.8s cycle)
      const kCycle = poseElapsed % 4.8;

      if (kCycle < 1.2) {
        // Phase 1 (0.0 - 1.2s): Wind-up — sweet anticipation, hand rises gracefully towards lips
        const prog = kCycle / 1.2;
        const ease = prog * prog * (3 - 2 * prog);
        tAngleZ = 6.0 * ease;
        tAngleY = 4.0 * ease;
        tAngleX = 2.0 * ease;
        tMouthForm = 0.8 * ease;
        tBrowLY = 0.3 * ease;
        tBrowRY = 0.3 * ease;

        armRShoulder = 0.65 * ease;
        armRElbow = 0.75 * ease;
        armRWrist = -0.35 * ease;
        handR = 0.85 * ease;
        armLShoulder = 0.08;
      } else if (kCycle < 2.4) {
        // Phase 2 (1.2 - 2.4s): Touch lips & sweet playful wink!
        tAngleZ = 9.0;
        tAngleY = 6.0;
        tAngleX = 2.0;
        tMouthForm = 1.0;
        tMouthOpen = 0.15;
        tBrowLY = 0.45;
        tBrowRY = 0.45;
        // Playful one-eye wink matching 3D visual!
        eyeLOpen = 0.0;
        eyeROpen = 1.15;

        armRShoulder = 0.72;
        armRElbow = 0.90;
        armRWrist = -0.45;
        handR = 0.95;
        armLShoulder = 0.08;
      } else if (kCycle < 3.8) {
        // Phase 3 (2.4 - 3.8s): Blow kiss outward toward user
        const prog = (kCycle - 2.4) / 1.4;
        const blowPulse = Math.sin(prog * Math.PI);
        tAngleX = -3.0 + prog * 5.0;
        tAngleZ = 9.0 * (1 - prog * 0.5);
        tAngleY = 6.0 * (1 - prog * 0.6);
        tBodyAngleX = 8.0 * blowPulse;
        tMouthOpen = 0.45 * blowPulse;
        tMouthForm = 0.85;
        tBrowLY = 0.4;
        tBrowRY = 0.4;
        eyeLOpen = 1.25;
        eyeROpen = 1.25;

        armRShoulder = 0.72 + prog * 0.18;
        armRElbow = 0.90 * (1 - prog * 0.65);
        armRWrist = -0.45 + prog * 0.75;
        handR = 1.0;
        armLShoulder = 0.15 * blowPulse;
      } else {
        // Phase 4 (3.8 - 4.8s): Settle gracefully with warm beaming smile
        const prog = Math.min(1.0, (kCycle - 3.8) / 1.0);
        tAngleX = 2.0 * (1 - prog);
        tAngleZ = 4.5 * (1 - prog);
        tAngleY = 2.4 * (1 - prog);
        tBodyAngleX = 0;
        tMouthForm = 1.0;
        tBrowLY = 0.4 * (1 - prog * 0.3);
        tBrowRY = 0.4 * (1 - prog * 0.3);
        eyeLOpen = 1.05;
        eyeROpen = 1.05;

        armRShoulder = 0.72 * (1 - prog);
        armRElbow = 0.30 * (1 - prog);
        armRWrist = 0;
        handR = 0.5 * (1 - prog);
      }
    } else if (p === 'dance' || p === 'dancing') {
      // 126 BPM 4-Bar Idol Choreography matching 3D dance.fbx (7.6s cycle)
      const danceCycle = poseElapsed % 7.6;
      const beat = (danceCycle * 2.1) % 1.0; // 0 to 1 on every beat
      const beatPulse = Math.sin(beat * Math.PI);

      // Rhythmic lateral torso and head sway
      tBodyAngleZ = Math.sin(danceCycle * Math.PI * 1.05) * 18.0;
      tAngleZ = -Math.sin(danceCycle * Math.PI * 1.05) * 12.0;
      tAngleX = Math.cos(danceCycle * Math.PI * 2.1) * 6.0;
      tAngleY = Math.sin(danceCycle * Math.PI * 1.05) * 8.0;
      tBodyAngleX = Math.abs(Math.sin(danceCycle * Math.PI * 2.1)) * 5.0;

      // Sweet idol expressions & sync winks on transitions
      tMouthForm = 0.95;
      tBrowLY = 0.4;
      tBrowRY = 0.4;
      const isWink = (danceCycle > 1.7 && danceCycle < 2.0) || (danceCycle > 5.5 && danceCycle < 5.8);
      eyeLOpen = isWink ? 0.05 : (1.1 + beatPulse * 0.1);
      eyeROpen = 1.1 + beatPulse * 0.1;

      if (danceCycle < 1.9) {
        // Bar 1: Right arm high pump / Left arm wave at waist
        armRShoulder = 0.65 + beatPulse * 0.25;
        armRElbow = 0.75 + beatPulse * 0.15;
        armRWrist = Math.sin(danceCycle * 8) * 0.4;
        handR = 0.85;

        armLShoulder = 0.22;
        armLElbow = 0.35 + beatPulse * 0.18;
        armLWrist = -0.25;
        handL = 0.6;
      } else if (danceCycle < 3.8) {
        // Bar 2: Left arm high pump / Right arm wave at waist
        armLShoulder = 0.65 + beatPulse * 0.25;
        armLElbow = 0.75 + beatPulse * 0.15;
        armLWrist = -Math.sin(danceCycle * 8) * 0.4;
        handL = 0.85;

        armRShoulder = 0.22;
        armRElbow = 0.35 + beatPulse * 0.18;
        armRWrist = 0.25;
        handR = 0.6;
      } else if (danceCycle < 5.7) {
        // Bar 3: Both arms cheering together (idol heart/cheer wave)
        armRShoulder = 0.72 + beatPulse * 0.2;
        armRElbow = 0.55;
        armRWrist = Math.cos(danceCycle * 6) * 0.35;
        handR = 0.9;

        armLShoulder = 0.72 + beatPulse * 0.2;
        armLElbow = 0.55;
        armLWrist = -Math.cos(danceCycle * 6) * 0.35;
        handL = 0.9;
      } else {
        // Bar 4: Hip groove & alternating arm swings across hips
        const swing = Math.sin(danceCycle * 6.5) * 0.35;
        armRShoulder = 0.35 + swing;
        armRElbow = 0.45;
        armRWrist = swing * 0.5;
        handR = 0.7;

        armLShoulder = 0.35 - swing;
        armLElbow = 0.45;
        armLWrist = -swing * 0.5;
        handL = 0.7;
      }
    } else if (p === 'point' || p === 'pointing') {
      // Firm pointing gesture outward with index finger extended
      tAngleY = 8.0;
      tAngleX = 2.0;
      tAngleZ = -3.0;
      tBodyAngleX = 6.0;
      tBodyAngleZ = -4.0;
      tBrowLY = 0.25;
      tBrowRY = 0.25;
      eyeOpen = 1.1;

      armRShoulder = 0.85;
      armRElbow = 0.25;
      armRWrist = 0.15;
      handR = 1.0;

      armLShoulder = 0.1;
      armLElbow = 0.15;
      handL = 0.2;
    } else if (p === 'stretch' || p === 'stretching') {
      // Both arms stretched high up, head arched back in refreshing yawn/stretch
      const stretchPulse = Math.sin(t * 1.5) * 0.1;
      tAngleX = -12.0 + stretchPulse * 20.0;
      tAngleY = Math.sin(t * 1.2) * 6.0;
      tBodyAngleX = -8.0;
      tBodyAngleZ = Math.sin(t * 1.5) * 8.0;
      tBrowLY = 0.4;
      tBrowRY = 0.4;
      eyeOpen = 0.3; // relaxed bliss

      armRShoulder = 0.95 + stretchPulse;
      armRElbow = 0.4;
      armRWrist = 0.2;
      armLShoulder = 0.95 + stretchPulse;
      armLElbow = 0.4;
      armLWrist = -0.2;
      handR = 0.8;
      handL = 0.8;
    } else if (p === 'caress' || p === 'pet') {
      // Gentle sweet caress: head tilts toward hand, blushing, hand brushes hair
      const caressWave = Math.sin(t * 1.8) * 0.15;
      tAngleZ = 12.0 + caressWave * 12.0;
      tAngleY = -4.0;
      tAngleX = 4.0;
      tMouthForm = 0.85;
      tBrowLY = 0.35;
      tBrowRY = 0.35;
      eyeOpen = 0.9;

      armRShoulder = 0.6 + caressWave;
      armRElbow = 0.75 + caressWave * 0.5;
      armRWrist = -0.35;
      handR = 0.7;

      armLShoulder = 0.15;
      armLElbow = 0.2;
      handL = 0.3;
    } else if (p === 'lie-down' || p === 'lying') {
      // Prone relaxed pose, propped chin
      const lieBreath = Math.sin(t * 1.6) * 4.0;
      tAngleX = 14.0 + lieBreath;
      tAngleZ = 8.0;
      tAngleY = Math.sin(t * 0.8) * 6.0;
      tBodyAngleX = 16.0;
      tBodyAngleZ = 10.0;
      tMouthForm = 0.6;
      eyeOpen = 0.85;

      armRShoulder = 0.6;
      armRElbow = 0.8;
      armRWrist = -0.3;
      armLShoulder = 0.6;
      armLElbow = 0.8;
      armLWrist = 0.3;
      handR = 0.5;
      handL = 0.5;
    } else if (p === 'edge-lean') {
      // Leaning over screen edge, looking down/forward into window
      const edgeSway = Math.sin(t * 1.2) * 6.0;
      tAngleX = 18.0;
      tAngleY = edgeSway;
      tAngleZ = Math.cos(t * 1.2) * 5.0;
      tBodyAngleX = 15.0;
      tBodyAngleZ = edgeSway * 0.8;
      eyeOpen = 1.15;
      tEyeBallY = 0.4;

      armRShoulder = 0.4;
      armRElbow = 0.5;
      armRWrist = 0.3;
      armLShoulder = 0.4;
      armLElbow = 0.5;
      armLWrist = -0.3;
      handR = 0.6;
      handL = 0.6;
    } else if (p === 'lean' || p === 'leaning') {
      tAngleZ = 12.0;
      tBodyAngleZ = 12.0;
      tBodyAngleX = 6.0;
      tAngleX = 5.0;
      tMouthForm = 0.5;
      armRShoulder = 0.25;
      armRElbow = 0.4;
      armLShoulder = 0.15;
    } else if (p === 'thinking' || p === 'think') {
      tAngleZ = -12.0;
      tAngleY = 7.0;
      tEyeBallY = 0.55;
      tEyeBallX = -0.35;
      tBrowLY = 0.25;
      tBrowRY = -0.15;
      armRShoulder = 0.45;
      armRElbow = 0.75;
      armRWrist = -0.35;
      handR = 0.5;
    } else if (p === 'sleep' || p === 'sleeping') {
      eyeOpen = 0;
      tAngleY = -15.0;
      tAngleZ = 6.0;
      tAngleX = 4.0;
      armRShoulder = 0.05;
      armLShoulder = 0.05;
    } else if (p === 'sit' || p === 'sitting') {
      // Universal Relaxed Seated Posture for all 2D models
      // Body leans forward comfortably resting weight onto the seat/ledge
      tBodyAngleX = 6.0 + Math.sin(t * 0.5) * 0.8;
      // Head tilts casually with gentle living idle shift
      tAngleX = 3.5 + Math.sin(t * 0.7) * 0.8;
      tAngleZ = 2.5 + Math.sin(t * 0.4) * 1.6;
      tAngleY = Math.cos(t * 0.3) * 2.0;
      // Gaze comfortably angled slightly downward toward user/screen
      tEyeBallY = -0.22;
      tEyeBallX = Math.sin(t * 0.25) * 0.15;
      // Content, peaceful resting smile
      tMouthForm = 0.45;
      tBrowLY = 0.15;
      tBrowRY = 0.15;

      // Arms resting naturally in front on lap / ledge
      armRShoulder = 0.08;
      armRElbow = 0.35;
      armRWrist = -0.15;
      handR = 0.35;

      armLShoulder = 0.08;
      armLElbow = 0.35;
      armLWrist = 0.15;
      handL = 0.35;
    }

    // ── Emotion Modulations ──────────────────────────────────────────────────
    switch (emotion) {
      case 'happy':
        tMouthForm = 1.0;
        tBrowLY = 0.4;
        tBrowRY = 0.4;
        break;
      case 'sad':
        tBrowLY = -0.7;
        tBrowRY = -0.7;
        tMouthForm = -0.6;
        tAngleY -= 5.0;
        break;
      case 'angry':
        tBrowLY = -0.8;
        tBrowRY = -0.8;
        tMouthForm = -0.4;
        break;
      case 'surprised':
        tBrowLY = 0.8;
        tBrowRY = 0.8;
        eyeOpen = 1.3;
        break;
      case 'flirty':
        tMouthForm = 0.8;
        tBrowLY = 0.3;
        tBrowRY = 0.3;
        tAngleZ += 4.0;
        break;
    }

    return {
      angleX: tAngleX,
      angleY: tAngleY,
      angleZ: tAngleZ,
      bodyAngleX: tBodyAngleX,
      bodyAngleY: tBodyAngleY,
      bodyAngleZ: tBodyAngleZ,
      eyeLOpen,
      eyeROpen,
      eyeBallX: tEyeBallX,
      eyeBallY: tEyeBallY,
      browLY: tBrowLY,
      browRY: tBrowRY,
      mouthForm: tMouthForm,
      mouthOpenY: tMouthOpen,
      armLShoulder,
      armLElbow,
      armLWrist,
      handL,
      armRShoulder,
      armRElbow,
      armRWrist,
      handR,
      peekEdge,
      isSitting: p === 'sit' || p === 'sitting',
    };
  }

  /**
   * Applies the computed gesture outputs to any Live2D model instance,
   * automatically mapping parameters for Rozen, Maya, Friday, Shiroko, Venom, Icy,
   * or any standard Cubism 4 model.
   */
  public applyToLive2DModel(
    model: any,
    modelId: string,
    gestures: Live2DGestureOutputs,
    currentLerpedVals: Record<string, number>,
    lerpSpeed = 0.15
  ): void {
    if (!model) return;
    const internal = model.internalModel as any;
    const core = internal?.coreModel;
    if (!core) return;

    // Helper to safely set Live2D parameter by ID if supported
    const setParam = (id: string, val: number) => {
      try {
        core.setParameterValueById(id, val);
      } catch (_) {}
    };

    // Smooth Lerp Helper
    const lerp = (key: string, target: number) => {
      const cur = currentLerpedVals[key] ?? target;
      const next = cur + (target - cur) * lerpSpeed;
      currentLerpedVals[key] = next;
      return next;
    };

    // 1. Standard Head & Body
    setParam('ParamAngleX', lerp('angleX', gestures.angleX));
    setParam('ParamAngleY', lerp('angleY', gestures.angleY));
    setParam('ParamAngleZ', lerp('angleZ', gestures.angleZ));
    setParam('ParamBodyAngleX', lerp('bodyAngleX', gestures.bodyAngleX));
    setParam('ParamBodyAngleY', lerp('bodyAngleY', gestures.bodyAngleY));
    setParam('ParamBodyAngleZ', lerp('bodyAngleZ', gestures.bodyAngleZ));

    // 2. Eyes, Brows & Mouth
    const eyeL = lerp('eyeL', gestures.eyeLOpen);
    const eyeR = lerp('eyeR', gestures.eyeROpen);
    setParam('ParamEyeLOpen', eyeL);
    setParam('ParamEyeROpen', eyeR);
    setParam('ParamEyeBallX', lerp('eyeBallX', gestures.eyeBallX));
    setParam('ParamEyeBallY', lerp('eyeBallY', gestures.eyeBallY));
    setParam('ParamBrowLY', lerp('browLY', gestures.browLY));
    setParam('ParamBrowRY', lerp('browRY', gestures.browRY));
    setParam('ParamMouthForm', lerp('mouthForm', gestures.mouthForm));

    if (gestures.mouthOpenY > 0.01) {
      setParam('ParamMouthOpenY', gestures.mouthOpenY);
      setParam('ParamA', gestures.mouthOpenY);
      setParam('PARAM_MOUTH_OPEN_Y', gestures.mouthOpenY);
    }

    // 3. Natural Breathing for all models (slower, peaceful resting rate if sitting)
    const breathSpeed = gestures.isSitting ? 1.2 : 1.8;
    setParam('ParamBreath', (Math.sin(performance.now() / 1000 * breathSpeed) + 1.0) * 0.5);

    // Universal Seated Leg & Hip Parameters (applied safely if model supports them)
    if (gestures.isSitting) {
      setParam('ParamLeftShoulderUp', -8.0);
      setParam('ParamRightShoulderUp', -8.0);
      setParam('ParamLegL', -25.0);
      setParam('ParamLegR', -25.0);
      setParam('ParamLegAngleL', 15.0);
      setParam('ParamLegAngleR', -15.0);
      setParam('ParamLowerBody', 10.0);
      setParam('ParamWaist', 5.0);
    }

    // 4. Model-Specific Arm & Hand Parameter Adapters
    const armRS = lerp('armRShoulder', gestures.armRShoulder);
    const armRE = lerp('armRElbow', gestures.armRElbow);
    const armRW = lerp('armRWrist', gestures.armRWrist);
    const handRVal = lerp('handR', gestures.handR);

    const armLS = lerp('armLShoulder', gestures.armLShoulder);
    const armLE = lerp('armLElbow', gestures.armLElbow);
    const armLW = lerp('armLWrist', gestures.armLWrist);
    const handLVal = lerp('handL', gestures.handL);

    switch (modelId.toLowerCase()) {
      case 'rozen':
        // Param61 = 1.0 removes watermark layer completely
        setParam('Param61', 1.0);
        // Hide clutter / accessories
        setParam('JiaJu', 0.0);
        setParam('ShouBing', 0.0);
        setParam('Param41', 0.0);
        setParam('Param40', 0.0);
        setParam('Param53', 0.0);

        // Right hand & arm rotation
        setParam('Param_Angle_Rotation17', armRS * 28.0);
        setParam('Param_Angle_Rotation18', armRE * 24.0);
        setParam('Param_Angle_Rotation23', armRW * 18.0);
        setParam('Param_Angle_Rotation21', armRS * 14.0);
        setParam('Param_Angle_Rotation22', armRE * 12.0);

        // Left hand & arm rotation
        setParam('Param_Angle_Rotation31', armLS * 28.0);
        setParam('Param_Angle_Rotation29', armLE * 24.0);
        setParam('Param_Angle_Rotation30', armLW * 18.0);
        break;

      case 'maya':
        setParam('ParamLeftShoulderUp', armLS * 12.0);
        setParam('ParamRightShoulderUp', armRS * 12.0);
        setParam('ParamArmLA01', armLS * 30.0);
        setParam('ParamArmLA02', armLE * 25.0);
        setParam('ParamArmLA03', armLW * 20.0);
        setParam('ParamHandLA', handLVal);

        setParam('ParamArmRA01', armRS * 30.0);
        setParam('ParamArmRA02', armRE * 25.0);
        setParam('ParamArmRA03', armRW * 20.0);
        setParam('ParamHandRA', handRVal);
        break;

      case 'friday':
        // Haru model arm and hand parameters
        setParam('ParamArmLA', armLS * 30.0);
        setParam('ParamArmRA', armRS * 30.0);
        setParam('ParamHandAngleL', armLW * 25.0);
        setParam('ParamHandAngleR', armRW * 25.0);
        setParam('ParamBodyUpper', gestures.bodyAngleX);
        break;

      case 'shiroko':
        setParam('Param82', 0.0); // Hide gamepad
        setParam('Param58', armLS * 25.0);
        setParam('Param59', armLE * 25.0);
        setParam('Param60', armLW * 20.0);
        setParam('Param69', armRS * 25.0);
        setParam('Param70', armRE * 25.0);
        setParam('Param71', armRW * 20.0);
        break;

      case 'venom':
        // Natori model arms
        setParam('ParamLeftShoulderUp', armLS * 12.0);
        setParam('ParamRightShoulderUp', armRS * 12.0);
        setParam('ParamArmAL01', armLS * 30.0);
        setParam('ParamArmAL02', armLE * 25.0);
        setParam('ParamArmAL03', armLW * 20.0);
        setParam('ParamArmAR01', armRS * 30.0);
        setParam('ParamArmAR02', armRE * 25.0);
        setParam('ParamArmAR03', armRW * 20.0);
        break;

      case 'icy':
        setParam('ShouBing', 0.0); // Hide gamepad
        setParam('JiaJu', 0.0);    // Hide furniture
        setParam('Param59', armRS * 30.0); // Waving hand
        setParam('Param58', armRE * 25.0);
        setParam('Param29', handLVal);
        setParam('Param28', handRVal);
        break;

      default:
        // Generic Cubism fallback
        setParam('ParamArmL', armLS * 25.0);
        setParam('ParamArmR', armRS * 25.0);
        setParam('ParamHandL', handLVal);
        setParam('ParamHandR', handRVal);
        break;
    }
  }
}

export const animationBridge = AvatarAnimationBridge.getInstance();
