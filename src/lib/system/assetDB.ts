import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

export type AssetType = 'vrm' | 'fbx' | 'bvh';

export interface AssetRecord {
  id: string; // The slug, e.g. "dance-2"
  type: AssetType; // File type
  name: string; // Original filename
  timestamp: number;
}

/** Converts a JS Blob or File into a base64 string for passing over IPC */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(blob);
  });
}

export async function saveAsset(id: string, type: AssetType, data: Blob, name: string): Promise<void> {
  try {
    const data_base64 = await blobToBase64(data);
    await invoke('save_3d_asset', { id, assetType: type, name, dataBase64: data_base64 });
  } catch (error) {
    console.error("Failed to save asset:", error);
    throw error;
  }
}

/** 
 * Returns just the metadata for a single asset, if it exists. 
 */
export async function getAsset(id: string): Promise<AssetRecord | null> {
  try {
    const assets: AssetRecord[] = await invoke('list_3d_assets');
    return assets.find(a => a.id === id) || null;
  } catch (e) {
    return null;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  try {
    await invoke('delete_3d_asset', { id });
  } catch (e) {
    console.error("Failed to delete asset:", e);
  }
}

export async function listAssets(): Promise<AssetRecord[]> {
  try {
    const assets: AssetRecord[] = await invoke('list_3d_assets');
    return assets;
  } catch (e) {
    console.error("Failed to list assets:", e);
    return [];
  }
}

export async function getAssetDataUrl(id: string): Promise<string | null> {
  try {
    // 1. Get the native absolute path to the file
    const absolutePath: string = await invoke('get_3d_asset_path', { id });
    
    // 2. Use Tauri's native FS plugin to read the file into memory instantly.
    // This uses zero-copy binary serialization and completely avoids slow JSON base64 parsing!
    const bytes = await readFile(absolutePath);
    
    // 3. Create the Blob URL
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('[getAssetDataUrl] native FS read failed, falling back to JSON IPC:', e);
    
    // FALLBACK: If the FS plugin isn't registered yet, fall back to the old method
    try {
      const resultStr: string = await invoke('read_3d_asset', { id });
      const { data: base64, type } = JSON.parse(resultStr);
      const mime = type === 'vrm' ? 'model/gltf-binary' : 'application/octet-stream';
      const response = await fetch(`data:${mime};base64,${base64}`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (fallbackError) {
      console.error('[getAssetDataUrl] fallback JSON IPC failed:', fallbackError);
      return null;
    }
  }
}

/** 
 * Gets the asset's URL mapped to the native asset:// protocol.
 * This completely bypasses loading the file into the JS heap! 
 */
export async function getAssetUrl(id: string): Promise<string | null> {
  try {
    const absolutePath: string = await invoke('get_3d_asset_path', { id });
    return convertFileSrc(absolutePath);
  } catch (e) {
    return null;
  }
}
