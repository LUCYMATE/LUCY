import { create } from 'zustand';
import { BasePose, Emotion } from '../../components/avatar/animations/core';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
  is_taskbar: boolean;
}

interface AvatarState {
  isSpeaking: boolean;
  isThinking: boolean;
  isListening: boolean;
  isMicOn: boolean;
  emotion: Emotion;
  basePose: BasePose;
  lastPoseOverrideTime: number;
  isWalking: boolean;
  worldPosition: { x: number; y: number; z: number };
  targetPosition: { x: number; y: number; z: number } | null;
  isDragging: boolean;
  dragOffset: { x: number; y: number };
  affectionLevel: number;
  avatarScale: number;
  isHearingSound: boolean;
  isToolAgentRunning: boolean;
  isAvatarLocked: boolean;
  lockedPosition: { x: number; y: number; z: number } | null;
  flipCustomModel: boolean;
  isFbxPlaying: boolean;
  connectionState: ConnectionState;
  isDynamicTalkingEnabled: boolean;
  preSpeakingState: { position: { x: number; y: number; z: number }, scale: number, pose: BasePose } | null;
  isSleepMode: boolean;
  desktopRectangles: DesktopRect[];
  anchor: { type: 'window' | 'taskbar', rect: DesktopRect } | null;

  setSpeaking: (val: boolean) => void;
  setThinking: (val: boolean) => void;
  setListening: (val: boolean) => void;
  setIsMicOn: (val: boolean) => void;
  setEmotion: (val: Emotion) => void;
  setBasePose: (val: BasePose) => void;
  setLastPoseOverrideTime: (val: number) => void;
  setIsWalking: (val: boolean) => void;
  setWorldPosition: (pos: { x: number; y: number; z: number }) => void;
  setTargetPosition: (pos: { x: number; y: number; z: number } | null) => void;
  setIsDragging: (val: boolean) => void;
  setDragOffset: (val: { x: number; y: number }) => void;
  setAffectionLevel: (val: number) => void;
  setAvatarScale: (val: number) => void;
  setHearingSound: (val: boolean) => void;
  setToolAgentRunning: (val: boolean) => void;
  setIsAvatarLocked: (val: boolean) => void;
  setLockedPosition: (pos: { x: number; y: number; z: number } | null) => void;
  setFlipCustomModel: (val: boolean) => void;
  setIsFbxPlaying: (val: boolean) => void;
  setConnectionState: (val: ConnectionState) => void;
  setDynamicTalkingEnabled: (val: boolean) => void;
  setPreSpeakingState: (val: { position: { x: number; y: number; z: number }, scale: number, pose: BasePose } | null) => void;
  setIsSleepMode: (val: boolean) => void;
  setDesktopRectangles: (val: DesktopRect[]) => void;
  setAnchor: (val: { type: 'window' | 'taskbar', rect: DesktopRect } | null) => void;
}

export const useAvatarState = create<AvatarState>((set) => ({
  isSpeaking: false,
  isThinking: false,
  isListening: false,
  isMicOn: false,
  emotion: 'neutral',
  basePose: 'sit',
  lastPoseOverrideTime: 0,
  isWalking: false,
  worldPosition: { x: 0, y: -0.5, z: 0 },
  targetPosition: null,
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
  isHearingSound: false,
  isToolAgentRunning: false,
  affectionLevel: parseInt(localStorage.getItem('soltini_affection') ?? '30', 10),
  avatarScale: parseFloat(localStorage.getItem('soltini_avatar_size') ?? '100') / 100,
  isAvatarLocked: localStorage.getItem('soltini_avatar_locked') === 'true',
  lockedPosition: null,
  flipCustomModel: localStorage.getItem('soltini_flip_vrm') === 'true',
  isFbxPlaying: false,
  connectionState: 'idle',
  isDynamicTalkingEnabled: localStorage.getItem('soltini_dynamic_talking') === 'true',
  preSpeakingState: null,
  isSleepMode: false,
  desktopRectangles: [],
  anchor: null,

  setSpeaking: (val) => set({ isSpeaking: val }),
  setThinking: (val) => set({ isThinking: val }),
  setListening: (val) => set({ isListening: val }),
  setIsMicOn: (val) => set({ isMicOn: val }),
  setEmotion: (val) => set({ emotion: val }),
  setBasePose: (val) => set({ basePose: val }),
  setLastPoseOverrideTime: (val) => set({ lastPoseOverrideTime: val }),
  setIsWalking: (val) => set({ isWalking: val }),
  setWorldPosition: (pos) => set({ worldPosition: pos }),
  setTargetPosition: (pos) => set({ targetPosition: pos }),
  setIsDragging: (val) => set({ isDragging: val }),
  setDragOffset: (val) => set({ dragOffset: val }),
  setHearingSound: (val) => set({ isHearingSound: val }),
  setAffectionLevel: (val) => set({ affectionLevel: val }),
  setAvatarScale: (val) => set({ avatarScale: val }),
  setToolAgentRunning: (val) => set({ isToolAgentRunning: val }),
  setIsAvatarLocked: (val) => set({ isAvatarLocked: val }),
  setLockedPosition: (pos) => set({ lockedPosition: pos }),
  setFlipCustomModel: (val) => set({ flipCustomModel: val }),
  setIsFbxPlaying: (val) => set({ isFbxPlaying: val }),
  setConnectionState: (val) => set({ connectionState: val }),
  setDynamicTalkingEnabled: (val) => set({ isDynamicTalkingEnabled: val }),
  setPreSpeakingState: (val) => set({ preSpeakingState: val }),
  setIsSleepMode: (val) => set({ isSleepMode: val }),
  setDesktopRectangles: (val) => set({ desktopRectangles: val }),
  setAnchor: (val) => set({ anchor: val }),
}));
