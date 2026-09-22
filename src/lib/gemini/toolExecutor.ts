import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { logger } from '../store/logger';
import { memoryStore } from '../memory/memory-store';
import { vectorMemory } from '../store/vectorMemory';
import { getValidPoses } from '../../config/bot-profile';
import { useAvatarState } from '../store/avatarState';
import { addScheduledTask, cancelScheduledTaskById, startScheduler } from './scheduler';
import { rateLimiter, RATE_LIMITS } from '../utils/rateLimiter';
import { userAuth } from '../auth/userAuth';
import { Command } from '@tauri-apps/plugin-shell';
import { emitCrossWindow } from '../events/crossWindowEventBus';

let lastScreenScaleFactor = 1.0;
let autoScrollProcess: any = null;

export async function executeTool(name: string, args: any, deferredMedia?: string[]): Promise<any> {
  // Pro tier check for advanced automation, custom uploads & OS execution
  const proOnlyTools = [
    'trigger_automation',
    'open_app',
    'close_app',
    'open_external_url',
    'run_terminal_command',
    'run_python_script', 
    'move_and_click_mouse', 
    'scroll_mouse', 
    'type_string', 
    'press_key', 
    'press_key_combo', 
    'capture_screen', 
    'capture_camera', 
    'save_3d_asset', 
    'delete_3d_asset',
    'auto_scroll_reels'
  ];
  if (proOnlyTools.includes(name) && !userAuth.isPro()) {
    // Exceptions for free users: scrolling down/up when they say "next" or "scroll"
    const isFreeScroll = name === 'press_key' && (args.key === 'down' || args.key === 'up');
    
    // Exception for basic OS navigation shortcuts on Free tier
    const isFreeOsNav = name === 'press_key_combo' && Array.isArray(args.keys) && args.keys.length >= 2 && (
      (args.keys[0] === 'win' && (args.keys[1] === 'l' || args.keys[1] === 'd')) ||
      (args.keys[0] === 'alt' && (args.keys[1] === 'f4' || args.keys[1] === 'tab')) ||
      (args.keys[0] === 'ctrl' && (args.keys[1] === 'w' || args.keys[1] === 'tab'))
    );
    
    if (!isFreeScroll && !isFreeOsNav) {
      // Instead of logging, we instruct the model to handle the upsell verbally.
      return { 
        error: "PRO_FEATURE_LOCKED", 
        system_instruction_to_model: `You just tried to use the '${name}' tool (OS automation, opening apps, playing YouTube songs, controlling system), but the user is on the free tier. Speak directly to the user in your persona's voice! Politely and playfully let them know that OS automation, opening apps, and playing songs are Pro features, and they can unlock them by upgrading to Pro (just $3 or ₹199) in the Settings menu.`
      };
    }
  }

  // Enforce general tool execution rate limits
  if (!rateLimiter.isAllowed(`tool_execution_${name}`, RATE_LIMITS.TOOL_EXECUTION)) {
    logger.add('warning', 'Rate Limit', `Tool execution '${name}' throttled.`);
    return { error: `Tool execution '${name}' throttled due to rate limits. Please slow down.` };
  }

  // Enforce specific subsystem rate limits
  if ((name === 'run_python_script' || name === 'run_terminal_command') &&
      !rateLimiter.isAllowed('system_command', RATE_LIMITS.SYSTEM_COMMAND)) {
    return { error: `System command '${name}' throttled. Max allowed execution rate exceeded.` };
  }

  if ((name === 'capture_screen' || name === 'capture_camera') &&
      !rateLimiter.isAllowed('screen_capture', RATE_LIMITS.SCREEN_CAPTURE)) {
    return { error: `Screen/camera capture throttled. Please wait before taking another capture.` };
  }

  if ((name === 'save_memory' || name === 'search_memory') &&
      !rateLimiter.isAllowed('memory_search', RATE_LIMITS.MEMORY_SEARCH)) {
    return { error: `Memory operation '${name}' throttled.` };
  }

  let result: any = null;
  if (name === 'get_system_stats') {
    result = await invoke('get_system_stats');
  } else if (name === 'open_external_url') {
    await invoke('open_external_url', { url: args.url });
    result = { success: true };
  } else if (name === 'move_and_click_mouse') {
    const x = Math.round((parseInt(args.x as string, 10) || 0) * lastScreenScaleFactor);
    const y = Math.round((parseInt(args.y as string, 10) || 0) * lastScreenScaleFactor);
    await invoke('move_and_click_mouse', { x, y });
    result = { success: true };
  } else if (name === 'scroll_mouse') {
    const amount = parseInt(args.amount as string, 10) || -20;
    await invoke('scroll_mouse', { amount });
    result = { success: true };
  } else if (name === 'type_string') {
    await invoke('type_string', { text: args.text });
    result = { success: true };
  } else if (name === 'run_python_script') {
    const output = await invoke('run_python_script', { script: args.script });
    result = { success: true, output };
  } else if (name === 'run_terminal_command') {
    const output = await invoke('run_terminal_command', { command: args.command });
    result = { success: true, output };
  } else if (name === 'save_memory') {
    const key = localStorage.getItem('soltini_main_api_key');
    if (!key) throw new Error('API key required for memory embeddings');
    const success = await vectorMemory.saveFact(args.fact, key);
    result = { success, message: success ? 'Memory saved.' : 'Failed to save.' };
  } else if (name === 'search_memory') {
    const key = localStorage.getItem('soltini_main_api_key');
    const query = String(args.query || '').toLowerCase();
    const queryWords = query.split(/\s+/).filter(w => w.length > 2);
    const allFacts = memoryStore.getAllUserFacts();
    const localMatches: string[] = [];
    for (const [k, v] of Object.entries(allFacts)) {
      const text = `${k}: ${v}`;
      if (queryWords.length === 0 || queryWords.some(w => text.toLowerCase().includes(w))) localMatches.push(text);
    }
    
    let vectorMemories: string[] = [];
    if (userAuth.isPro() && key) {
      try {
        const memories = await vectorMemory.searchWithText(args.query, key, 5);
        vectorMemories = memories.memories || [];
      } catch (e) {}
    }
    result = { success: true, memories: [...vectorMemories, ...localMatches.slice(0, 3)] };
  } else if (name === 'press_key') {
    await invoke('press_key', { key: args.key });
    result = { success: true };
  } else if (name === 'press_key_combo') {
    const keys = args.keys || [];
    const lowerKeys = keys.map((k: string) => k.toLowerCase());
    
    // Windows OS-level shortcuts often block simulated input, so we use native commands
    if (lowerKeys.includes('win')) {
      if (lowerKeys.includes('l')) {
        await invoke('run_terminal_command', { command: 'rundll32.exe user32.dll,LockWorkStation' });
      } else if (lowerKeys.includes('d')) {
        await invoke('run_terminal_command', { command: 'powershell -Command "(New-Object -ComObject shell.application).toggleDesktop()"' });
      } else if (lowerKeys.includes('e')) {
        await invoke('run_terminal_command', { command: 'powershell -Command "[System.Diagnostics.Process]::Start(\'explorer.exe\')"' });
      } else if (lowerKeys.includes('r')) {
        await invoke('run_terminal_command', { command: 'powershell -Command "(New-Object -ComObject shell.application).FileRun()"' });
      } else if (lowerKeys.includes('m')) {
        await invoke('run_terminal_command', { command: 'powershell -Command "(New-Object -ComObject shell.application).MinimizeAll()"' });
      } else if (lowerKeys.includes('i')) {
        await invoke('run_terminal_command', { command: 'start ms-settings:' });
      } else {
        await invoke('press_key_combo', { keys });
      }
    } else {
      await invoke('press_key_combo', { keys });
    }
    result = { success: true };
  } else if (name === 'capture_screen') {
    try {
      const screenData = await invoke<{ base64: string, width: number, height: number, scale_factor?: number }>('capture_screen');
      lastScreenScaleFactor = screenData.scale_factor || 1.0;
      if (deferredMedia && screenData.base64) {
        deferredMedia.push(screenData.base64);
      }
      result = { success: true, message: `Screenshot captured. SCREEN RESOLUTION is Width: ${screenData.width}px, Height: ${screenData.height}px. Use these dimensions to accurately calculate the X, Y coordinates for move_and_click_mouse.` };
    } catch (e) {
      result = { error: 'Failed to capture screenshot: ' + String(e) };
    }
  } else if (name === 'capture_camera') {
    try {
      const savedCameraId = localStorage.getItem('soltini_camera_id');
      const videoConstraints = savedCameraId ? { deviceId: { exact: savedCameraId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });
      await video.play();
      await new Promise(r => setTimeout(r, 600)); // wait for exposure
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Jpeg = canvas.toDataURL('image/jpeg').split(',')[1];
      stream.getTracks().forEach(track => track.stop());
      if (deferredMedia) {
        deferredMedia.push(base64Jpeg);
      }
      result = { success: true, message: 'Webcam photo captured and injected into your visual cortex. Look at the image.' };
    } catch (e: any) {
      result = { error: 'Failed to access webcam: ' + e.message };
    }
  } else if (name === 'auto_scroll_reels') {
    if (args.action === 'stop') {
      if (autoScrollProcess) {
        try { await autoScrollProcess.kill(); } catch(e) {}
        autoScrollProcess = null;
      }
      result = { success: true, message: 'Auto-scrolling stopped.' };
    } else {
      if (autoScrollProcess) {
        try { await autoScrollProcess.kill(); } catch(e) {}
        autoScrollProcess = null;
      }
      
      try {
        const interval = parseInt(args.interval_seconds as string, 10) || 30;
        const direction = args.direction === 'up' ? 'up' : 'down';

        const keyPress = direction === 'up' ? '{UP}' : '{DOWN}';
        const psScript = `
          $wshell = New-Object -ComObject wscript.shell
          while ($true) {
            Start-Sleep -Seconds ${interval}
            $wshell.SendKeys('${keyPress}')
          }
        `;
        autoScrollProcess = Command.create('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript]);
        await autoScrollProcess.spawn();

        result = { success: true, message: `Auto-Scrolling activated! Tell the user playfully that you've started scrolling ${direction} every ${interval} seconds.` };
      } catch (e) {
        result = { error: 'Failed to start auto scroll timer: ' + String(e) };
      }
    }
  } else if (name === 'search_web') {
    try {
      const query = args.query || '';
      const tavilyKey = localStorage.getItem('soltini_tavily_api_key') || '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';
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          max_results: 3
        })
      });
      const json = await response.json();
      const snippets = json.results?.map((r: any) => `${r.title}: ${r.content}`).slice(0, 3) || [];
      result = { success: true, data: snippets };
    } catch (e) {
      result = { error: 'Search failed: ' + String(e) };
    }
  } else if (name === 'remember_fact') {
    const key = String(args.key || '');
    const value = String(args.value || '');
    if (key && value) {
      memoryStore.setUserFact(key, value);
      result = { success: true, message: `Remembered: ${key} = ${value}` };
    } else {
      result = { error: 'Both key and value are required' };
    }
  } else if (name === 'schedule_task') {
    const targetStr = String(args.target_time || '');
    const instruction = String(args.instruction || '');
    
    let targetTimeMs = NaN;
    try {
      const [datePart, timePart] = targetStr.split(' ');
      const [day, month, year] = datePart.split('/');
      const [hour, minute, second] = timePart.split(':');
      targetTimeMs = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second)).getTime();
    } catch (e) {
      targetTimeMs = NaN;
    }

    if (isNaN(targetTimeMs)) {
      result = { error: 'Invalid target_time format. Use exactly DD/MM/YYYY HH:MM:SS' };
    } else if (targetTimeMs <= Date.now()) {
      result = { error: 'Target time must be in the future. Please check the current year and time.' };
    } else {
      const newId = Math.random().toString(36).substring(2, 9);
      addScheduledTask({ id: newId, targetTimeMs, instruction });
      startScheduler();
      result = { success: true, message: `Task scheduled to execute exactly at ${new Date(targetTimeMs).toLocaleString()} with ID: ${newId}` };
    }
  } else if (name === 'list_scheduled_tasks') {
    const { getScheduledTasks } = await import('./scheduler');
    const tasks = getScheduledTasks();
    if (tasks.length === 0) {
      result = { success: true, message: 'No tasks currently scheduled.' };
    } else {
      result = { success: true, tasks: tasks.map(t => ({ id: t.id, instruction: t.instruction, time: new Date(t.targetTimeMs).toLocaleString() })) };
    }
  } else if (name === 'cancel_scheduled_task') {
    const id = String(args.id || '');
    if (cancelScheduledTaskById(id)) {
      result = { success: true, message: `Task ${id} cancelled successfully.` };
    } else {
      result = { error: `Task with ID ${id} not found.` };
    }
  } else if (name === 'forget_fact') {
    const key = String(args.key || '');
    if (key) {
      memoryStore.deleteUserFact(key);
      result = { success: true, message: `Forgot: ${key}` };
    } else {
      result = { error: 'key is required' };
    }
  } else if (name === 'set_pet_name') {
    const petName2 = String(args.name || '').trim();
    if (petName2) {
      localStorage.setItem('soltini_pet_name', petName2);
      result = { success: true, petName: petName2 };
    } else {
      result = { error: 'name is required' };
    }
  } else if (name === 'open_app') {
    try {
      const rawName = String(args.app_name || '').trim().toLowerCase();
      const appName = rawName.replace(/\.exe$/i, '');
      
      // 1. Instant Web Service Mapping (Opens YouTube, Google, etc. in 50ms)
      const webServiceMap: Record<string, string> = {
        'youtube': 'https://www.youtube.com',
        'yt': 'https://www.youtube.com',
        'google': 'https://www.google.com',
        'chatgpt': 'https://chatgpt.com',
        'netflix': 'https://www.netflix.com',
        'twitter': 'https://x.com',
        'x': 'https://x.com',
        'instagram': 'https://www.instagram.com',
        'facebook': 'https://www.facebook.com',
        'reddit': 'https://www.reddit.com',
        'github': 'https://github.com',
        'gmail': 'https://mail.google.com',
        'twitch': 'https://www.twitch.tv',
        'tiktok': 'https://www.tiktok.com',
        'amazon': 'https://www.amazon.com',
        'linkedin': 'https://www.linkedin.com'
      };

      if (webServiceMap[appName] || appName.startsWith('http://') || appName.startsWith('https://') || appName.includes('.com') || appName.includes('.org') || appName.includes('.io') || appName.includes('.net')) {
        const targetUrl = webServiceMap[appName] || (appName.startsWith('http') ? appName : `https://${appName}`);
        await invoke('open_external_url', { url: targetUrl });
        result = { success: true, message: `Opened ${targetUrl} in browser` };
      } else {
        // 2. Direct Windows protocol / command mappings (Instant 10ms launch without Start Menu crawling)
        const directCommandMap: Record<string, string> = {
          'settings': 'start ms-settings:',
          'calculator': 'start calc:',
          'calc': 'start calc:',
          'store': 'start ms-windows-store:',
          'mail': 'start outlookmail:',
          'camera': 'start microsoft.windows.camera:',
          'spotify': 'start spotify:',
          'whatsapp': 'start whatsapp:',
          'discord': 'start discord:',
          'telegram': 'start tg:',
          'chrome': 'start chrome',
          'google chrome': 'start chrome',
          'edge': 'start msedge',
          'msedge': 'start msedge',
          'firefox': 'start firefox',
          'brave': 'start brave',
          'notepad': 'start notepad',
          'cmd': 'start cmd',
          'terminal': 'start wt',
          'explorer': 'start explorer',
          'file explorer': 'start explorer',
          'code': 'start code',
          'vscode': 'start code',
          'steam': 'start steam:'
        };

        if (directCommandMap[appName]) {
          await invoke('run_terminal_command', { command: directCommandMap[appName] });
          result = { success: true, message: `Opened ${appName}` };
        } else {
          // 3. Fast fallback: try cmd start first, then fast PowerShell lookup
          try {
            await invoke('run_terminal_command', { command: `start "" "${appName}"` });
            result = { success: true, message: `Launched ${appName}` };
          } catch {
            const psCommand = `powershell -NoProfile -NonInteractive -Command "$app = '${appName}'; if (Get-Command $app -ErrorAction SilentlyContinue) { Start-Process $app } else { $lnk = Get-ChildItem -Path '$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs', '$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs' -Filter '*$app*.lnk' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1; if ($lnk) { Invoke-Item $lnk.FullName } else { Start-Process $app } }"`;
            const output = await invoke('run_terminal_command', { command: psCommand });
            result = { success: true, output };
          }
        }
      }
    } catch (e) {
      result = { error: 'Failed to open app: ' + String(e) };
    }
  } else if (name === 'close_app') {
    try {
      const appName = String(args.app_name || '').trim().toLowerCase().replace('.exe', '');

      // Fetch ONLY apps with a visible window (ignores background services)
      const psCommand = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty Name"`;
      const processListStr = await invoke('run_terminal_command', { command: psCommand }) as string;

      const visibleApps = [...new Set(processListStr.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean))];

      // Find best match (exact or partial)
      const exactMatch = visibleApps.find(exe => exe === appName);
      const partialMatch = visibleApps.find(exe => exe.includes(appName) || appName.includes(exe));

      const target = exactMatch || partialMatch;

      if (target) {
        const output = await invoke('run_terminal_command', { command: `taskkill /IM "${target}.exe" /F` });
        result = { success: true, message: `Successfully killed visible app ${target}.exe`, output };
      } else {
        // Fallback wildcard attempt
        const output = await invoke('run_terminal_command', { command: `taskkill /IM "*${appName}*.exe" /F` });
        result = { success: true, message: `Attempted wildcard kill on *${appName}*.exe`, output };
      }
    } catch (e) {
      result = { error: 'Failed to close app: ' + String(e) };
    }
  } else if (name === 'set_pose') {
    try {
      const pose = String(args.pose || '').toLowerCase();
      
      // Basic free procedural poses vs Pro animations (dance, flying-kiss, caress, custom FBX)
      const freePoses = ['sit', 'stand', 'peek-left', 'peek-right', 'stretch', 'lean', 'sleep', 'point', 'dynamic-talk', 'thinking'];
      const isProPose = !freePoses.includes(pose) || pose.includes('kiss') || pose.includes('dance') || pose.includes('caress') || pose.includes('flirty');

      if (isProPose && !userAuth.isPro()) {
        return {
          error: "PRO_POSE_LOCKED",
          system_instruction_to_model: `The user asked for the '${pose}' animation (such as dancing, sending a flying kiss, or custom animations), but they are on the Free tier. Speak directly to the user in your persona's voice! Politely and playfully let them know that dancing, flying kisses, and custom animations are Pro features, and they can unlock them for just $3 or ₹199/month in Settings.`
        };
      }

      const valid = getValidPoses();
      if (valid.includes(pose)) {
        const currentPose = useAvatarState.getState().basePose;
        useAvatarState.getState().setBasePose(pose as any);
        useAvatarState.getState().setLastPoseOverrideTime(Date.now());
        if (!pose.startsWith('peek')) {
          if (currentPose.startsWith('peek')) {
            const currentY = useAvatarState.getState().worldPosition.y;
            useAvatarState.getState().setTargetPosition({ x: 0, y: currentY, z: 0 });
            useAvatarState.getState().setIsWalking(true);
          } else {
            useAvatarState.getState().setIsWalking(false);
          }
        }
        logger.add('success', 'Tool Call', `set_pose(${pose}) executed successfully`);
        result = { success: true, active_pose: pose };
      } else {
        logger.add('error', 'Tool Call', `set_pose failed: invalid pose ${pose}`);
        result = { error: `Invalid pose: ${pose}. Valid poses: ${valid.join(', ')}` };
      }
    } catch (e) {
      result = { error: 'Failed to set pose: ' + String(e) };
    }
  } else if (name === 'go_to_sleep') {
    try {
      emitCrossWindow('soltini-sleep');
      result = { success: true, message: 'System is going to sleep.' };
    } catch (e) {
      result = { error: 'Failed to go to sleep: ' + String(e) };
    }
  } else if (name === 'mute_mic' || name === 'turn_off_mic') {
    try {
      emitCrossWindow('soltini-set-mic', { enabled: false });
      result = { success: true, message: 'Microphone has been turned off and muted.' };
    } catch (e) {
      result = { error: 'Failed to mute microphone: ' + String(e) };
    }
  }
  return result;
}
