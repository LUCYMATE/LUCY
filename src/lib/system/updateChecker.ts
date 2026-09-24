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

/**
 * Compares two semantic version strings (e.g., "1.5.0" and "2.0.0").
 * Handles pre-releases according to SemVer 2.0 spec:
 * - 2.0.0 > 1.5.0
 * - 2.0.0 > 2.0.0-beta
 * - 2.0.0-beta.2 > 2.0.0-beta.1
 * Returns true ONLY if candidateVersion is strictly greater than baseVersion.
 */
export function isVersionNewer(candidateVersion: string, baseVersion: string): boolean {
  const clean = (v: string) => v.trim().replace(/^[vV]/, '');

  const parseVersion = (v: string) => {
    const raw = clean(v);
    const [mainPart, ...preParts] = raw.split('-');
    const preRelease = preParts.length > 0 ? preParts.join('-') : null;
    const nums = mainPart.split('.').map(n => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, preRelease };
  };

  const cand = parseVersion(candidateVersion);
  const base = parseVersion(baseVersion);

  const len = Math.max(cand.nums.length, base.nums.length);
  for (let i = 0; i < len; i++) {
    const c = cand.nums[i] || 0;
    const b = base.nums[i] || 0;
    if (c > b) return true;
    if (c < b) return false;
  }

  // Major, minor, and patch are equal. Check pre-release tags:
  // Per SemVer 2.0: A normal version has higher precedence than a pre-release version.
  if (!cand.preRelease && base.preRelease) return true;
  if (cand.preRelease && !base.preRelease) return false;
  if (!cand.preRelease && !base.preRelease) return false;

  // Both have pre-release identifiers: compare dot-separated components
  const cPre = cand.preRelease!.split('.');
  const bPre = base.preRelease!.split('.');
  const maxPreLen = Math.max(cPre.length, bPre.length);

  for (let i = 0; i < maxPreLen; i++) {
    const cId = cPre[i];
    const bId = bPre[i];

    if (cId === undefined) return false; // Smaller set of pre-release fields has lower precedence
    if (bId === undefined) return true;

    if (cId === bId) continue;

    const cIsNum = /^\d+$/.test(cId);
    const bIsNum = /^\d+$/.test(bId);

    if (cIsNum && bIsNum) {
      const cNum = parseInt(cId, 10);
      const bNum = parseInt(bId, 10);
      if (cNum > bNum) return true;
      if (cNum < bNum) return false;
    } else if (cIsNum && !bIsNum) {
      return false; // Numeric has lower precedence than non-numeric
    } else if (!cIsNum && bIsNum) {
      return true;
    } else {
      return cId.localeCompare(bId) > 0;
    }
  }

  return false;
}

export const checkAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  try {
    const res = await fetch('https://lucymate.vercel.app/api/settings');
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

    // Only notify if serverVersion is strictly newer than currentVersion
    if (!isVersionNewer(serverVersion, currentVersion)) {
      return null;
    }

    const lastNotifiedId = localStorage.getItem('lucy_last_notified_update_id');
    const updateId = platformUpdate.update_id;
    const isNewNotification = lastNotifiedId !== updateId;

    return {
      updateAvailable: true,
      version: serverVersion,
      url: platformUpdate.url || data.links?.[platform] || 'https://lucymate.vercel.app',
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
  localStorage.setItem('lucy_last_notified_update_id', updateId);
};

export const downloadUpdate = (url: string) => {
  openExternalUrl(url);
};
