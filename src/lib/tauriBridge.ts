import { invoke } from '@tauri-apps/api/core';

// Check if we are running in Tauri
export const isTauriApp = (): boolean => {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
};

const isTauri = isTauriApp;

export const getSystemStats = async (): Promise<{ cpu_usage: number; total_memory: number; used_memory: number } | null> => {
  if (!isTauri()) {
    console.warn('getSystemStats called but not running in Tauri environment.');
    return null;
  }
  try {
    return await invoke('get_system_stats');
  } catch (error) {
    console.error('Error fetching system stats:', error);
    return null;
  }
};

export const openExternalUrl = async (url: string): Promise<void> => {
  if (!isTauri()) {
    console.warn(`openExternalUrl called with URL: ${url} (Mock behavior in browser)`);
    window.open(url, '_blank');
    return;
  }
  try {
    await invoke('open_external_url', { url });
  } catch (error) {
    console.error('Error opening external URL:', error);
  }
};

export const moveAndClickMouse = async (x: number, y: number): Promise<void> => {
  if (!isTauri()) {
    console.warn(`moveAndClickMouse called with coordinates: (${x}, ${y}) - not running in Tauri`);
    return;
  }
  try {
    await invoke('move_and_click_mouse', { x, y });
  } catch (error) {
    console.error('Error moving mouse:', error);
  }
};

export const typeString = async (text: string): Promise<void> => {
  if (!isTauri()) {
    console.warn(`typeString called with text: "${text}" - not running in Tauri`);
    return;
  }
  try {
    await invoke('type_string', { text });
  } catch (error) {
    console.error('Error typing string:', error);
  }
};

/**
 * Checks the native OS microphone permission state.
 * Returns "granted", "denied", or "unknown".
 * In the browser (non-Tauri), always returns "unknown".
 */
export const checkMicrophonePermission = async (): Promise<'granted' | 'denied' | 'unknown'> => {
  if (!isTauri()) return 'unknown';
  try {
    return await invoke<'granted' | 'denied' | 'unknown'>('check_microphone_permission');
  } catch (error) {
    console.error('Error checking microphone permission:', error);
    return 'unknown';
  }
};

/**
 * Opens the native OS microphone privacy settings so the user can grant access.
 * On Windows this opens ms-settings:privacy-microphone.
 */
export const openMicrophonePrivacySettings = async (): Promise<void> => {
  if (!isTauri()) {
    console.warn('openMicrophonePrivacySettings: not running in Tauri');
    return;
  }
  try {
    await invoke('open_microphone_privacy_settings');
  } catch (error) {
    console.error('Error opening microphone privacy settings:', error);
  }
};

export const startNativeMic = async (): Promise<void> => {
  if (!isTauri()) {
    throw new Error('Native mic is only available in the Tauri desktop app');
  }
  try {
    await invoke('start_native_mic');
  } catch (error) {
    console.error('Error starting native mic:', error);
    throw error;
  }
};

export const stopNativeMic = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    await invoke('stop_native_mic');
  } catch (error) {
    console.error('Error stopping native mic:', error);
  }
};
