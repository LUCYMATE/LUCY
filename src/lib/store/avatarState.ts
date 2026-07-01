import { create } from 'zustand';
import { BasePose, Emotion } from '../../components/avatar/animations/core';

interface AvatarState {
  isSpeaking: boolean;
  isThinking: boolean;
  isListening: boolean;
  emotion: Emotion;
  basePose: BasePose;
  isWalking: boolean;
  worldPosition: { x: number; y: number; z: number };
  targetPosition: { x: number; y: number; z: number } | null;
  isDragging: boolean;
  
  setSpeaking: (val: boolean) => void;
  setThinking: (val: boolean) => void;
  setListening: (val: boolean) => void;
  setEmotion: (val: Emotion) => void;
  setBasePose: (val: BasePose) => void;
  setIsWalking: (val: boolean) => void;
  setWorldPosition: (pos: { x: number; y: number; z: number }) => void;
  setTargetPosition: (pos: { x: number; y: number; z: number } | null) => void;
  setIsDragging: (val: boolean) => void;
  isHearingSound: boolean;
  setHearingSound: (val: boolean) => void;
}

export const useAvatarState = create<AvatarState>((set) => ({
  isSpeaking: false,
  isThinking: false,
  isListening: false,
  emotion: 'neutral',
  basePose: 'sit',
  isWalking: false,
  worldPosition: { x: 0, y: -0.5, z: 0 },
  targetPosition: null,
  isDragging: false,
  isHearingSound: false,
  
  setSpeaking: (val) => set({ isSpeaking: val }),
  setThinking: (val) => set({ isThinking: val }),
  setListening: (val) => set({ isListening: val }),
  setEmotion: (val) => set({ emotion: val }),
  setBasePose: (val) => set({ basePose: val }),
  setIsWalking: (val) => set({ isWalking: val }),
  setWorldPosition: (pos) => set({ worldPosition: pos }),
  setTargetPosition: (pos) => set({ targetPosition: pos }),
  setIsDragging: (val) => set({ isDragging: val }),
  setHearingSound: (val) => set({ isHearingSound: val }),
}));
