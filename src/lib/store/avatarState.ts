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
  affectionLevel: number;
  blush: boolean;
  heartsActive: boolean;
  afterDark: boolean;
  isPetMode: boolean;
  wearClothes: boolean;
  avatarScale: number;
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
  setAffectionLevel: (val: number) => void;
  setBlush: (val: boolean) => void;
  setHeartsActive: (val: boolean) => void;
  setAfterDark: (val: boolean) => void;
  setIsPetMode: (val: boolean) => void;
  setWearClothes: (val: boolean) => void;
  setAvatarScale: (val: number) => void;
}

export const useAvatarState = create<AvatarState>((set) => ({
  isSpeaking: false,
  isThinking: false,
  isListening: false,
  emotion: 'neutral',
  basePose: 'stand',
  isWalking: false,
  worldPosition: { x: 0, y: -0.5, z: 0 },
  targetPosition: null,
  isDragging: false,
  isHearingSound: false,
  affectionLevel: parseInt(localStorage.getItem('syra_affection') ?? '30', 10),
  blush: false,
  heartsActive: false,
  afterDark: false,
  isPetMode: false,
  wearClothes: true,
  avatarScale: parseFloat(localStorage.getItem('syra_avatar_size') ?? localStorage.getItem('syra_avatar_size') ?? '100') / 100,
  
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
  setAffectionLevel: (val) => set({ affectionLevel: val }),
  setBlush: (val) => set({ blush: val }),
  setHeartsActive: (val) => set({ heartsActive: val }),
  setAfterDark: (val) => set({ afterDark: val }),
  setIsPetMode: (val) => set({ isPetMode: val, heartsActive: val }),
  setWearClothes: (val) => set({ wearClothes: val }),
  setAvatarScale: (val) => set({ avatarScale: val }),
}));
