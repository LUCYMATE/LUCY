export const AVATAR_CONFIGURATION_CHANGED = 'lucy-avatar-configuration-changed';

export interface AvatarConfigurationChange {
  avatarEngine?: 'vrm' | 'live2d';
  selectedLive2dModel?: string;
  avatarSize?: number;
}
