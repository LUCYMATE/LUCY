export interface Live2DModelConfig {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export const LIVE2D_MODELS: Live2DModelConfig[] = [
  { id: 'icy', name: 'Icy', icon: '❄️', desc: 'Ice Cheongsam' },
  { id: 'rozen', name: 'Rozen', icon: '🌹', desc: 'Maiden Doll' },
  { id: 'shiroko', name: 'Shiroko', icon: '🐺', desc: 'Blue Archive' },
  { id: 'maya', name: 'Maya', icon: '🐱', desc: 'Catgirl Maid' },
  { id: 'friday', name: 'Friday', icon: '🎀', desc: 'Haru Assistant' },
  { id: 'venom', name: 'Venom', icon: '🖤', desc: 'Natori Companion' },
];
