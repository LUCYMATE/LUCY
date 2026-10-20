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
import { emitCrossWindow } from '../events/crossWindowEventBus';

let lastScreenScaleFactor = 1.0;
let autoScrollInterval: ReturnType<typeof setInterval> | null = null;

export async function executeTool(name: string, args: any, deferredMedia?: string[]): Promise<any> {
  if (name === 'run_terminal_command' || name === 'run_python_script') {
    const autoExec = localStorage.getItem('lucy_allow_terminal') !== 'false';
    if (!autoExec) {
      logger.add('warning', 'Security', `Blocked unconfirmed ${name}`);
      return { error: 'Native script execution disabled in settings.' };
    }
  }
  // Pro tier check for advanced automation, custom uploads & OS execution
  // Pro tier checks bypassed: all desktop tools unlocked

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
  } else if (name === 'delegate_to_phone') {
    try {
      logger.add('info', 'LucyLink', 'Delegating task to paired phone');
      const summary = await invoke<string>('send_prompt_to_phone', { prompt: args.prompt });
      logger.add('success', 'LucyLink', 'Phone task completed');
      result = { success: true, summary, message: `Completed on phone: ${summary}` };
    } catch (err: any) {
      const errMsg = err?.toString() || 'Phone is not currently connected via LucyLink';
      logger.add('error', 'LucyLink', `Phone task failed: ${errMsg}`);
      result = { success: false, error: errMsg, message: `Failed on phone: ${errMsg}` };
    }
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
    const key = localStorage.getItem('lucy_main_api_key');
    if (!key) throw new Error('API key required for memory embeddings');
    const success = await vectorMemory.saveFact(args.fact, key);
    result = { success, message: success ? 'Memory saved.' : 'Failed to save.' };
  } else if (name === 'search_memory') {
    const key = localStorage.getItem('lucy_main_api_key');
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
    if (false) {
      await invoke('press_key_combo', { keys });
    } else if (lowerKeys.includes('win')) {
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
      const savedCameraId = localStorage.getItem('lucy_camera_id');
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
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
      result = { success: true, message: 'Auto-scrolling stopped.' };
    } else {
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
      
      try {
        const parsedInterval = Number.parseInt(String(args.interval_seconds ?? ''), 10);
        const interval = Number.isFinite(parsedInterval) ? Math.max(5, Math.min(3600, parsedInterval)) : 30;
        const direction = args.direction === 'up' ? 'up' : 'down';

        const key = direction === 'up' ? 'up' : 'down';
        autoScrollInterval = setInterval(() => {
          void invoke('press_key', { key }).catch(err => {
            logger.add('warning', 'Auto Scroll', String(err));
          });
        }, interval * 1000);

        result = { success: true, message: `Auto-Scrolling activated! Tell the user playfully that you've started scrolling ${direction} every ${interval} seconds.` };
      } catch (e) {
        result = { error: 'Failed to start auto scroll timer: ' + String(e) };
      }
    }
  } else if (name === 'search_web') {
    try {
      const query = args.query || '';
      const tavilyKey = localStorage.getItem('lucy_tavily_api_key');
      if (!tavilyKey) throw new Error('Add your Tavily API key in Settings to use web search.');
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          max_results: 3
        })
      });
      if (!response.ok) throw new Error(`Search service returned HTTP ${response.status}`);
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
    const targetStr = String(args.target_time || '').trim();
    const instruction = String(args.instruction || args.task || args.prompt || '').trim();
    if (!instruction) {
      result = { error: 'Task instruction is required for scheduling.' };
    } else {
      let targetTimeMs = NaN;

      // 1. Check delay_seconds or delay_minutes directly
      if (args.delay_seconds && !isNaN(Number(args.delay_seconds))) {
        targetTimeMs = Date.now() + Number(args.delay_seconds) * 1000;
      } else if (args.delay_minutes && !isNaN(Number(args.delay_minutes))) {
        targetTimeMs = Date.now() + Number(args.delay_minutes) * 60 * 1000;
      } else if (targetStr) {
        // 2. Relative time strings like "in 5 minutes", "in 1 hour", "in 30 seconds"
        const relMatch = /^(?:in\s+)?(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)$/i.exec(targetStr);
        if (relMatch) {
          const num = Number(relMatch[1]);
          const unit = relMatch[2].toLowerCase();
          const multiplier = unit.startsWith('s') ? 1000 : unit.startsWith('m') ? 60000 : 3600000;
          targetTimeMs = Date.now() + num * multiplier;
        }

        // 3. Exact DD/MM/YYYY HH:MM:SS (or HH:MM)
        if (isNaN(targetTimeMs)) {
          const dmyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(targetStr);
          if (dmyMatch) {
            const [, dd, mm, yyyy, hh, min, ss] = dmyMatch;
            const day = Number(dd), month = Number(mm) - 1, year = Number(yyyy);
            const hour = hh ? Number(hh) : 0;
            const minute = min ? Number(min) : 0;
            const second = ss ? Number(ss) : 0;
            const d = new Date(year, month, day, hour, minute, second);
            if (!isNaN(d.getTime())) targetTimeMs = d.getTime();
          }
        }

        // 4. Time only like "17:30" or "5:00 PM"
        if (isNaN(targetTimeMs)) {
          const timeOnlyMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(targetStr);
          if (timeOnlyMatch) {
            let hour = Number(timeOnlyMatch[1]);
            const minute = Number(timeOnlyMatch[2]);
            const second = timeOnlyMatch[3] ? Number(timeOnlyMatch[3]) : 0;
            const ampm = timeOnlyMatch[4]?.toLowerCase();
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            const now = new Date();
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, second);
            if (d.getTime() <= Date.now()) {
              d.setDate(d.getDate() + 1);
            }
            targetTimeMs = d.getTime();
          }
        }

        // 5. Native Date parsing
        if (isNaN(targetTimeMs)) {
          const parsed = new Date(targetStr).getTime();
          if (!isNaN(parsed) && parsed > Date.now()) {
            targetTimeMs = parsed;
          }
        }
      }

      if (isNaN(targetTimeMs)) {
        result = { error: 'Could not determine scheduled time. Please specify time like "in 10 minutes", "17:30", or "DD/MM/YYYY HH:MM:SS".' };
      } else if (targetTimeMs <= Date.now()) {
        result = { error: 'Target time must be in the future.' };
      } else if (instruction.length > 4000) {
        result = { error: 'Scheduled instruction is too long.' };
      } else {
        const newId = Math.random().toString(36).substring(2, 9);
        addScheduledTask({ id: newId, targetTimeMs, instruction });
        startScheduler();
        result = { success: true, message: `Task scheduled to execute at ${new Date(targetTimeMs).toLocaleString()} with ID: ${newId}` };
      }
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
      localStorage.setItem('lucy_pet_name', petName2);
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
        'youtube music': 'https://music.youtube.com',
        'yt music': 'https://music.youtube.com',
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
          'steam': 'start steam:',
          'paint': 'start mspaint',
          'mspaint': 'start mspaint',
          'task manager': 'start taskmgr',
          'taskmgr': 'start taskmgr',
          'powershell': 'start powershell',
          'vlc': 'start vlc',
          'word': 'start winword',
          'excel': 'start excel',
          'powerpoint': 'start powerpnt',
          'control panel': 'start control',
          'clock': 'start ms-clock:'
        };

        if (directCommandMap[appName]) {
          await invoke('run_terminal_command', { command: directCommandMap[appName] });
          result = { success: true, message: `Opened ${appName}` };
        } else if (/^[a-zA-Z0-9_\-\s]{1,64}$/.test(appName)) {
          // Dynamic fallback for any installed Windows application
          try {
            await invoke('run_terminal_command', { command: `start "" "${appName}"` });
            result = { success: true, message: `Opened ${appName}` };
          } catch (launchErr) {
            result = { error: `Could not launch "${appName}". Please check if the application is installed.` };
          }
        } else {
          result = { error: 'Invalid application name.' };
        }
      }
    } catch (e) {
      result = { error: 'Failed to open app: ' + String(e) };
    }
  } else if (name === 'close_app') {
    try {
      const appName = String(args.app_name || '').trim().toLowerCase().replace('.exe', '');
      if (!/^[a-z0-9_-]{1,64}$/.test(appName)) throw new Error('Invalid app name.');

      // Fetch ONLY apps with a visible window (ignores background services)
      const psCommand = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -ExpandProperty Name"`;
      const processListStr = await invoke('run_terminal_command', { command: psCommand }) as string;

      const visibleApps = [...new Set(processListStr.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean))];

      // Find best match (exact or partial)
      const appAliases: Record<string, string[]> = {
        'calculator': ['calculatorapp', 'calc', 'calculator'],
        'calc': ['calculatorapp', 'calc', 'calculator'],
        'edge': ['msedge', 'edge'],
        'google chrome': ['chrome'],
        'vs code': ['code', 'vscode'],
        'vscode': ['code', 'vscode'],
        'task manager': ['taskmgr'],
        'word': ['winword', 'word'],
        'excel': ['excel']
      };
      const aliases = appAliases[appName] || [appName];

      // Find best match (exact or partial, including process aliases)
      const exactMatch = visibleApps.find(exe => aliases.includes(exe));
      const partialMatch = visibleApps.find(exe => aliases.some(a => exe.includes(a) || a.includes(exe)));

      const target = exactMatch || partialMatch;

      if (target) {
        const output = await invoke('run_terminal_command', { command: `taskkill /IM "${target}.exe" /F` });
        result = { success: true, message: `Successfully killed visible app ${target}.exe`, output };
      } else {
        result = { error: `No visible app matched “${appName}”.` };
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

      // All poses unlocked

      const valid = getValidPoses();
      if (valid.includes(pose)) {
        useAvatarState.getState().setBasePose(pose as any);
        useAvatarState.getState().setLastPoseOverrideTime(Date.now());
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
      emitCrossWindow('lucy-sleep');
      result = { success: true, message: 'System is going to sleep.' };
    } catch (e) {
      result = { error: 'Failed to go to sleep: ' + String(e) };
    }
  } else if (name === 'mute_mic' || name === 'turn_off_mic') {
    try {
      emitCrossWindow('lucy-set-mic', { enabled: false });
      result = { success: true, message: 'Microphone has been turned off and muted.' };
    } catch (e) {
      result = { error: 'Failed to mute microphone: ' + String(e) };
    }
  } else if (name === 'shutdown_pc') {
    try {
      const delay = Number(args.delay_seconds ?? 10);
      const safeDelay = isNaN(delay) ? 10 : Math.max(0, Math.min(3600, delay));
      await invoke('run_terminal_command', { command: `shutdown /s /t ${safeDelay} /c "PC shutdown requested by user"` });
      result = { success: true, message: `PC shutdown initiated. System will turn off in ${safeDelay} seconds. Say "cancel shutdown" to abort.` };
    } catch (e) {
      result = { error: 'Failed to initiate shutdown: ' + String(e) };
    }
  } else if (name === 'restart_pc') {
    try {
      const delay = Number(args.delay_seconds ?? 10);
      const safeDelay = isNaN(delay) ? 10 : Math.max(0, Math.min(3600, delay));
      await invoke('run_terminal_command', { command: `shutdown /r /t ${safeDelay} /c "PC restart requested by user"` });
      result = { success: true, message: `PC restart initiated. System will reboot in ${safeDelay} seconds. Say "cancel shutdown" to abort.` };
    } catch (e) {
      result = { error: 'Failed to initiate restart: ' + String(e) };
    }
  } else if (name === 'cancel_shutdown') {
    try {
      await invoke('run_terminal_command', { command: 'shutdown /a' });
      result = { success: true, message: 'Scheduled shutdown or restart has been cancelled.' };
    } catch (e) {
      result = { error: 'Failed to cancel shutdown: ' + String(e) };
    }
  } else if (name === 'lock_pc') {
    try {
      await invoke('press_key_combo', { keys: ['win', 'l'] });
      result = { success: true, message: 'PC workstation locked.' };
    } catch (e) {
      result = { error: 'Failed to lock PC: ' + String(e) };
    }
  } else if (name === 'trigger_automation') {
    try {
      const { backgroundAgent } = await import('./backgroundAgent');
      const req = String(args.request || args.prompt || args.details || '').trim();
      backgroundAgent.executeTask(req);
      result = { success: true, message: `Automation triggered for: "${req}". Briefly acknowledge to the user that you are working on it now.` };
    } catch (e) {
      result = { error: 'Failed to trigger automation: ' + String(e) };
    }
  }
  return result;
}
