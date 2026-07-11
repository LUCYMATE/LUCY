import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { Emotion } from './core';

// Cache previous expression values to avoid calling setValue when nothing changed.
// This prevents the VRM expression manager from doing unnecessary GPU updates.
const prevValues: Record<string, number> = {};

/** Reset the expression cache when a new VRM is loaded */
export function clearExpressionCache() {
  for (const key of Object.keys(prevValues)) {
    delete prevValues[key];
  }
}

function setVal(vrm: VRM, name: VRMExpressionPresetName, value: number) {
  const rounded = Math.round(value * 100) / 100; // Round to 2 decimal places
  if (prevValues[name] === rounded) return; // Skip if unchanged
  prevValues[name] = rounded;
  vrm.expressionManager!.setValue(name, rounded);
}

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

  // 1. Blinking - only recalculate during actual blink window (0 to 0.18s of each 4s cycle)
  const bp = t % 4.0;
  const blink = bp < 0.08 ? 1
              : bp < 0.18 ? 1 - (bp - 0.08) / 0.10
              : 0;
  
  if (basePose === 'sleep') {
    setVal(vrm, VRMExpressionPresetName.Blink, 1.0);
  } else if (emotion === 'surprised' || emotion === 'angry') {
    setVal(vrm, VRMExpressionPresetName.Blink, 0);
  } else {
    setVal(vrm, VRMExpressionPresetName.Blink, blink);
  }

  // 2. Lip Sync
  if (isSpeaking) {
    const aa = Math.min(1.0, Math.max(0, Math.sin(t * 15.0) * 1.4 + Math.sin(t * 8.5) * 0.5));
    const ih = Math.min(1.0, Math.max(0, Math.sin(t * 11.2) * 0.7));
    setVal(vrm, VRMExpressionPresetName.Aa, aa);
    setVal(vrm, VRMExpressionPresetName.Ih, ih);
  } else {
    setVal(vrm, VRMExpressionPresetName.Aa, 0);
    setVal(vrm, VRMExpressionPresetName.Ih, 0);
  }

  // 3. Emotion Overrides - reset only the ones that are NOT active
  // This avoids 5 unnecessary setValue calls per frame
  const targetEmotion = basePose === 'sleep' ? 'sleep'
    : emotion === 'happy' ? 'happy'
    : emotion === 'angry' ? 'angry'
    : emotion === 'sad' ? 'sad'
    : emotion === 'surprised' ? 'surprised'
    : (emotion === 'thinking' || isThinking) ? 'thinking'
    : isListening ? 'listening'
    : 'neutral';

  setVal(vrm, VRMExpressionPresetName.Happy,    targetEmotion === 'happy' ? 0.4 + Math.max(0, Math.sin(t * 2.5)) * 0.3 : targetEmotion === 'listening' ? 0.3 : targetEmotion === 'neutral' ? 0.1 : 0);
  setVal(vrm, VRMExpressionPresetName.Angry,    targetEmotion === 'angry' ? 1.0 : 0);
  setVal(vrm, VRMExpressionPresetName.Sad,      targetEmotion === 'sad' ? 1.0 : 0);
  setVal(vrm, VRMExpressionPresetName.Surprised,targetEmotion === 'surprised' ? 1.0 : 0);
  setVal(vrm, VRMExpressionPresetName.Relaxed,  targetEmotion === 'sleep' ? 0.8 : targetEmotion === 'thinking' ? 0.5 : 0);
}
