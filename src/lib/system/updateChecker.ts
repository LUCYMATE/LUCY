import { openExternalUrl } from './tauriBridge';

export interface AppUpdateInfo {
  updateAvailable: boolean;
  version: string;
  url: string;
  notes: string;
  updateId: string;
  platform: 'windows' | 'mac' | 'linux';
  isNewNotification: boolean;
}

export const getClientPlatform = (): 'windows' | 'mac' | 'linux' => {
  if (typeof window === 'undefined') return 'windows';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
};

export const checkAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  try {
    const res = await fetch('https://soltini.vercel.app/api/settings');
    if (!res.ok) return null;
    
    const data = await res.json();
    const platform = getClientPlatform();
    const platformUpdate = data.updates?.[platform];

    if (!platformUpdate || !platformUpdate.update_id) {
      return null;
    }

    let currentVersion = '1.0.0';
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      currentVersion = await getVersion();
    } catch (e) {}

    const serverVersion = (platformUpdate.version || '1.0.0').trim();

    // If server notify version matches installed app version, do NOT trigger update or banner
    if (serverVersion === currentVersion) {
      return null;
    }

    const lastNotifiedId = localStorage.getItem('soltini_last_notified_update_id');
    const updateId = platformUpdate.update_id;
    const isNewNotification = lastNotifiedId !== updateId;

    return {
      updateAvailable: true,
      version: serverVersion,
      url: platformUpdate.url || data.links?.[platform] || 'https://soltini.vercel.app',
      notes: platformUpdate.notes || 'Performance improvements and bug fixes.',
      updateId,
      platform,
      isNewNotification
    };
  } catch (error) {
    console.error('Failed to check for app updates:', error);
    return null;
  }
};

export const markUpdateNotified = (updateId: string) => {
  localStorage.setItem('soltini_last_notified_update_id', updateId);
};

export const downloadUpdate = (url: string) => {
  openExternalUrl(url);
};
