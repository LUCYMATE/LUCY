import { invoke } from '@tauri-apps/api/core';

// Check if we are running in Tauri
export const isTauriApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };

  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
};

export const getSystemStats = async (): Promise<{ cpu_usage: number; total_memory: number; used_memory: number; app_memory: number } | null> => {
  if (!isTauriApp()) {
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
  if (!isTauriApp()) {
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
  if (!isTauriApp()) {
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
  if (!isTauriApp()) {
    console.warn(`typeString called with text: "${text}" - not running in Tauri`);
    return;
  }
  try {
    await invoke('type_string', { text });
  } catch (error) {
    console.error('Error typing string:', error);
  }
};

export const trimMemory = async (): Promise<void> => {
  if (!isTauriApp()) return;
  try {
    await invoke('trim_memory');
  } catch (error) {
    console.error('Error trimming memory:', error);
  }
};

