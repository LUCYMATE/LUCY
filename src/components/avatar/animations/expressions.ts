import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { Emotion } from './core';

export function applyExpressions(
  vrm: VRM,
  t: number,
  isSpeaking: boolean,
  isListening: boolean,
  isThinking: boolean,
  emotion: Emotion,
  basePose?: string
) {
  if (!vrm.expressionManager) return;

  // 1. Blinking
  const bp = t % 4.0;
  const blink = bp < 0.08 ? 1
              : bp < 0.18 ? 1 - (bp - 0.08) / 0.10
              : 0;
  
  // Don't blink if surprised or angry, or if sleeping
  if (basePose === 'sleep') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, 1.0);
  } else if (emotion === 'surprised' || emotion === 'angry') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, 0);
  } else {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blink);
  }

  // 2. Lip Sync
  if (isSpeaking) {
    // Mouth opens wider and faster to simulate active talking
    const aa = Math.min(1.0, Math.max(0, Math.sin(t * 15.0) * 1.4 + Math.sin(t * 8.5) * 0.5));
    const ih = Math.min(1.0, Math.max(0, Math.sin(t * 11.2) * 0.7));
    vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, aa);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, ih);
  } else {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, 0);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, 0);
  }

  // 3. Emotion Overrides
  // Reset all first to avoid blending weirdly
  vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Angry, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Sad, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Surprised, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0);

  if (basePose === 'sleep') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0.8);
  } else if (emotion === 'happy') {
    // Gently pulse the happy expression so eyes don't close completely and mouth opens just a bit
    const happyIntensity = 0.4 + Math.max(0, Math.sin(t * 2.5)) * 0.3;
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, happyIntensity);
  } else if (emotion === 'angry') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Angry, 1.0);
  } else if (emotion === 'sad') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Sad, 1.0);
  } else if (emotion === 'surprised') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Surprised, 1.0);
  } else if (emotion === 'thinking' || isThinking) {
    // A slight neutral/relaxed face for thinking
    vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0.5);
  } else if (isListening) {
    // Pleasant attentive look
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.3);
  } else {
    // Default neutral, slight smile
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.1);
  }
}
