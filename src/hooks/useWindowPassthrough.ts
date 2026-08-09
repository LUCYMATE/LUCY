import { useEffect } from 'react';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { useAvatarState } from '../lib/store/avatarState';

export function useWindowPassthrough(licenseStatus: string) {
  useEffect(() => {
    let active = true;
    let lastIgnore = true;
    const win = getCurrentWindow();
    let cachedWinPos = { x: 0, y: 0 };
    let cachedFactor = 1;
    let cacheAge = 999;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (ms: number) => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(checkMouse, ms);
    };

    const checkMouse = async () => {
      if (!active) return;
      timer = null;
      try {
        if (useAvatarState.getState().isSleepMode) return;

        const isVisible = await win.isVisible();
        if (!isVisible) {
          scheduleNext(1000);
          return;
        }

        let inside = false;

        if (document.querySelector('.is-dragging-window')) {
          inside = true;
        } else {
          cacheAge++;
          if (cacheAge > 25) {
            cachedWinPos = await win.outerPosition();
            cachedFactor = await win.scaleFactor();
            cacheAge = 0;
          }
          const cursor = await cursorPosition();
          const x = (cursor.x - cachedWinPos.x) / cachedFactor;
          const y = (cursor.y - cachedWinPos.y) / cachedFactor;

          const offsets = [
            [0, 0], [-12, 0], [12, 0], [0, -12], [0, 12],
            [-24, 0], [24, 0], [0, -24], [0, 24],
            [-12, -12], [12, -12], [-12, 12], [12, 12]
          ];
          for (const [dx, dy] of offsets) {
            const el = document.elementFromPoint(x + dx, y + dy);
            if (el && el.closest('.pointer-events-auto')) {
              inside = true;
              break;
            }
          }
        }

        if (inside !== !lastIgnore) {
          lastIgnore = !inside;
          if (active) {
             try {
                await win.setIgnoreCursorEvents(lastIgnore);
             } catch (err: any) {
                console.warn('IgnoreCursorEvents error:', err);
             }
          }
        }
      } catch (e: any) {
        console.warn('checkMouse error:', e);
      }
      scheduleNext(200);
    };

    const handleSleep = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      lastIgnore = true;
      win.setIgnoreCursorEvents(true).catch(() => {});
    };

    const handleWakeUp = () => {
      lastIgnore = false;
      win.setAlwaysOnTop(true).catch(() => {});
      win.maximize().catch(() => {});
      win.show().catch(() => {});

      document.body.style.backgroundColor = 'rgba(0,0,0,0.01)';
      setTimeout(() => {
        document.body.style.backgroundColor = 'rgba(0, 0, 0, 0.005)';
      }, 10);

      if (active && !timer) {
        scheduleNext(50);
      }
    };

    let prevSleep = useAvatarState.getState().isSleepMode;
    const unsubStore = useAvatarState.subscribe((state) => {
      const currentSleep = state.isSleepMode;
      if (currentSleep === prevSleep) return;
      prevSleep = currentSleep;
      if (currentSleep) {
        handleSleep();
      } else {
        handleWakeUp();
      }
    });

    const handleWakeUpEvent = () => {
      useAvatarState.getState().setIsSleepMode(false);
    };

    const handleSleepEvent = () => {
      useAvatarState.getState().setIsSleepMode(true);
    };

    window.addEventListener('soltini-sleep', handleSleepEvent);
    window.addEventListener('soltini-wake-up', handleWakeUpEvent);

    if (!useAvatarState.getState().isSleepMode) {
      checkMouse();
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubStore();
      window.removeEventListener('soltini-sleep', handleSleepEvent);
      window.removeEventListener('soltini-wake-up', handleWakeUpEvent);
      win.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [licenseStatus]);
}
