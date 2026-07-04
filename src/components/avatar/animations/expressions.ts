import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { Emotion } from './core';

export function applyExpressions(
  vrm: VRM,
  t: number,
  isSpeaking: boolean,
  isListening: boolean,
  isThinking: boolean,
  emotion: Emotion
) {
  if (!vrm.expressionManager) return;

  const isFlirty = emotion === 'flirty';

  // 1. Blinking
  const bp = t % 4.0;
  const blink = bp < 0.08 ? 1
              : bp < 0.18 ? 1 - (bp - 0.08) / 0.10
              : 0;

  if (emotion === 'surprised' || emotion === 'angry') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, 0);
  } else if (isFlirty) {
    const winkPhase = t % 6.0;
    const wink = winkPhase < 0.08 ? 1
               : winkPhase < 0.18 ? 1 - (winkPhase - 0.08) / 0.10
               : 0;
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, wink);
  } else {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blink);
  }

  // 2. Lip Sync
  if (isSpeaking) {
    const aa = Math.min(1.0, Math.max(0, Math.sin(t * 15.0) * 1.4 + Math.sin(t * 8.5) * 0.5));
    const ih = Math.min(1.0, Math.max(0, Math.sin(t * 11.2) * 0.7));
    vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, aa);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, ih);
  } else if (isFlirty) {
    const sultryPout = Math.sin(t * 2.0) * 0.2 + 0.25;
    vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, sultryPout * 0.7);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, sultryPout * 0.8);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ou, sultryPout * 0.6);
    // Lip bite: brief sharp aa spike
    const lipBitePhase = t % 8.0;
    const lipBite = lipBitePhase > 2.0 && lipBitePhase < 2.15 ? 1.0 :
                    lipBitePhase > 2.15 && lipBitePhase < 2.35 ? 0.5 : 0;
    if (lipBite > 0) {
      vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, lipBite);
      vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, lipBite * 0.7);
    }
  } else {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, 0);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Ih, 0);
  }

  // 3. Emotion Overrides
  vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Angry, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Sad, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Surprised, 0);
  vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0);

  if (emotion === 'happy') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.6); // Reduced from 1.0 to prevent eyes fully closing and mouth breaking
  } else if (emotion === 'angry') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Angry, 0.8);
  } else if (emotion === 'sad') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Sad, 0.8);
  } else if (emotion === 'surprised') {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Surprised, 0.8);
  } else if (isFlirty) {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.5);
    vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0.4);
  } else if (emotion === 'thinking' || isThinking) {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, 0.5);
  } else if (isListening) {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.3);
  } else {
    vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.1);
  }
}
