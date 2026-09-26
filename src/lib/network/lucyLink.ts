import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '../store/logger';
import { emitCrossWindow } from '../events/crossWindowEventBus';
import { useAvatarState } from '../store/avatarState';

export interface PairingData {
  ip: string;
  port: number;
  secret: string;
  name: string;
  qr_uri: string;
}

export interface LucyLinkStatus {
  connected: boolean;
  connectedDevice: string | null;
  localIp: string;
  port: number;
  deviceName: string;
}

class LucyLinkService {
  private statusListeners: Array<(status: LucyLinkStatus) => void> = [];
  private initPromise: Promise<void> | null = null;
  private currentStatus: LucyLinkStatus = {
    connected: false,
    connectedDevice: null,
    localIp: '127.0.0.1',
    port: 52442,
    deviceName: 'Lucy-PC',
  };

  constructor() {}

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init();
    return this.initPromise;
  }

  private async init() {
    try {
      // Fetch initial status
      const status = await invoke<LucyLinkStatus>('get_lucy_link_status');
      this.currentStatus = status;
      this.notifyListeners();

      // Listen for connection status updates from Rust WebSocket server
      await listen<{ connected: boolean; deviceName: string | null }>('lucy_link_status', (event) => {
        this.currentStatus = {
          ...this.currentStatus,
          connected: event.payload.connected,
          connectedDevice: event.payload.deviceName,
        };
        logger.add(
          event.payload.connected ? 'success' : 'info',
          'LucyLink',
          event.payload.connected
          ? 'Mobile device paired and connected'
            : 'Mobile device disconnected'
        );
        this.notifyListeners();
      });

      // Listen for delegated prompts arriving from the mobile phone
      await listen<{ taskId: string; prompt: string }>('lucy_mobile_prompt', async (event) => {
        try {
          const win = getCurrentWindow();
          if (win && win.label !== 'main') {
            return;
          }
        } catch (_) {}

        const { taskId, prompt } = event.payload;
        logger.add('info', 'LucyLink', `Executing delegated phone task [${taskId}]`);

        // If PC Lucy is sleeping, wake up so the UI restores and Lucy can speak out loud!
        const p = prompt.toLowerCase().trim();
        if (useAvatarState.getState().isSleepMode && !p.includes('sleep')) {
          logger.add('info', 'LucyLink', 'Waking PC Lucy for a delegated phone task');
          emitCrossWindow('lucy-wake-up');
        }

        try {
          // Execute on PC using local tool executor or command runner
          const summary = await this.handleMobilePrompt(prompt);
          await invoke('resolve_mobile_prompt', {
            taskId,
            success: true,
            summary,
          }).catch((err) => {
            console.warn('[LucyLink] Failed to send success result to rust:', err);
          });
          logger.add('success', 'LucyLink', `Completed mobile task [${taskId}] and returned response`);
          emitCrossWindow('lucy-mobile-task-finished', {
            taskId,
            prompt,
            success: true,
            summary,
          });
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          logger.add('error', 'LucyLink', `Failed to execute mobile task [${taskId}]: ${err}`);
          await invoke('resolve_mobile_prompt', {
            taskId,
            success: false,
            summary: `Failed on PC: ${errMsg}`,
          }).catch((err) => {
            console.warn('[LucyLink] Failed to send error result to rust:', err);
          });
          emitCrossWindow('lucy-mobile-task-finished', {
            taskId,
            prompt,
            success: false,
            error: errMsg,
          });
        }
      });
    } catch (e) {
      console.warn('[LucyLinkService] Failed to initialize link service:', e);
    }
  }

  /**
   * Internal dispatcher for prompts received from the Android phone.
   */
  private async handleMobilePrompt(prompt: string): Promise<string> {
    const p = prompt.toLowerCase().trim();
    
    // 1. Audio Mute / Unmute
    if (p.includes('mute') && (p.includes('pc') || p.includes('computer') || p.includes('sound') || p.includes('audio') || p.includes('system'))) {
      await invoke('press_key', { key: 'audiomute' }).catch(() => {});
      return 'Muted audio on PC.';
    }

    // 2. Volume Controls
    if (p.includes('volume') || p.includes('sound')) {
      if (p.includes('up') || p.includes('increase') || p.includes('raise')) {
        for (let i = 0; i < 5; i++) {
          await invoke('press_key', { key: 'audiovolumeup' }).catch(() => {});
        }
        return 'Turned up PC volume.';
      }
      if (p.includes('down') || p.includes('decrease') || p.includes('lower')) {
        for (let i = 0; i < 5; i++) {
          await invoke('press_key', { key: 'audiovolumedown' }).catch(() => {});
        }
        return 'Turned down PC volume.';
      }
    }

    // 3. Screen Lock
    if (p.includes('lock') && (p.includes('pc') || p.includes('computer') || p.includes('screen') || p.includes('desktop'))) {
      await invoke('press_key_combo', { keys: ['win', 'l'] });
      return 'Locked PC workstation.';
    }

    // 4. Lucy Sleep Mode / Wake
    if (p.includes('sleep') && (p.includes('pc') || p.includes('lucy') || p.includes('computer'))) {
      emitCrossWindow('lucy-sleep');
      return 'Put Lucy Companion on PC into sleep mode.';
    }

    const isComplex = p.includes(' and ') || p.includes(' then ') || p.includes('play ') || p.includes('search ') || p.includes('type ') || p.includes('write ') || p.includes('find ') || p.includes('summarize ') || p.includes('download ');

    // 5. Direct URL launch (e.g. "https://..." or "http://...")
    if (!isComplex && (p.startsWith('http://') || p.startsWith('https://'))) {
      await invoke('open_external_url', { url: prompt.trim() });
      return `Opened URL on PC: ${prompt.trim()}`;
    }

    // 6. Generic App / Website launch for ANY requested application or service (<100ms)
    if (!isComplex) {
      let targetApp = '';
      if (p.startsWith('open ') || p.startsWith('launch ') || p.startsWith('start ')) {
        targetApp = prompt
          .replace(/^(open|launch|start)\s+/i, '')
          .replace(/\s+(on\s+pc|on\s+computer|on\s+my\s+pc|on\s+desktop)$/i, '')
          .trim();
      } else if (p.split(/\s+/).length === 1 && !['help', 'status', 'test', 'hi', 'hello'].includes(p)) {
        // Direct single-word app or site name (e.g. "spotify", "calculator", "chrome", "notepad", "youtube")
        targetApp = prompt.trim();
      }

      if (targetApp && targetApp.split(/\s+/).length <= 2) {
        try {
          const { executeTool } = await import('../gemini/toolExecutor');
          const res = await executeTool('open_app', { app_name: targetApp });
          if (res && !res.error) {
            return res.message || `Opened ${targetApp} on PC.`;
          }
        } catch (e) {
          // If direct open fails, fall through to backgroundAgent
        }
      }
    }

    // 7. System Hardware / Resource Stats
    if (p.includes('system') || p.includes('stats') || p.includes('cpu') || p.includes('ram') || p.includes('battery')) {
      try {
        const stats: any = await invoke('get_system_stats');
        const cpu = stats?.cpu_usage ? Math.round(stats.cpu_usage) : 0;
        const mem = stats?.used_memory_mb ? Math.round(stats.used_memory_mb / 1024 * 10) / 10 : 0;
        const totalMem = stats?.total_memory_mb ? Math.round(stats.total_memory_mb / 1024 * 10) / 10 : 0;
        return `PC Status: CPU usage is ${cpu}%, RAM used is ${mem} GB of ${totalMem} GB.`;
      } catch (e) {
        // Fallback
      }
    }

    // 8. General task dispatch directly to PC Background Automation Agent
    try {
      const { backgroundAgent } = await import('../gemini/backgroundAgent');
      logger.add('info', 'LucyLink', 'Dispatching delegated phone task to PC Background Agent');
      const agentSummary = await backgroundAgent.executeTask(prompt);
      return agentSummary;
    } catch (e: any) {
      logger.add('error', 'LucyLink', `Background agent execution error: ${e?.message || e}`);
      return `PC task failed: ${e?.message || 'Unknown error'}`;
    }
  }

  public async getPairingData(): Promise<PairingData> {
    await this.ensureInitialized();
    return await invoke<PairingData>('get_lucy_link_pairing_data');
  }

  public async getStatus(): Promise<LucyLinkStatus> {
    try {
      await this.ensureInitialized();
      const status = await invoke<LucyLinkStatus>('get_lucy_link_status');
      this.currentStatus = status;
      this.notifyListeners();
      return status;
    } catch (e) {
      return this.currentStatus;
    }
  }

  public async sendPromptToPhone(prompt: string): Promise<string> {
    return await invoke<string>('send_prompt_to_phone', { prompt });
  }

  public subscribe(listener: (status: LucyLinkStatus) => void): () => void {
    this.statusListeners.push(listener);
    void this.ensureInitialized();
    listener(this.currentStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    this.statusListeners.forEach((l) => l(this.currentStatus));
  }
}

export const lucyLink = new LucyLinkService();
