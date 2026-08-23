import { isTauriApp } from '../system/tauriBridge';

export type UnlistenFn = () => void;

/**
 * Emits an event across all open Webview windows and local DOM.
 */
export async function emitCrossWindow<T = any>(event: string, payload?: T): Promise<void> {
  // Always dispatch locally in current DOM
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: payload }));
  } catch (e) {
    console.warn(`[crossWindowEventBus] Failed to dispatch DOM event "${event}":`, e);
  }

  // If running inside Tauri, emit globally to all windows
  if (isTauriApp()) {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(event, payload);
    } catch (e) {
      console.warn(`[crossWindowEventBus] Failed to emit Tauri event "${event}":`, e);
    }
  }
}

/**
 * Listens for an event originating from any window (via Tauri IPC) or local DOM.
 */
export function listenCrossWindow<T = any>(
  event: string,
  callback: (payload: T) => void
): UnlistenFn {
  let isCleanedUp = false;
  let tauriUnlisten: (() => void) | null = null;

  // DOM listener for local events (or web-only mode)
  const domHandler = (e: Event) => {
    // Only handle if not handled by Tauri to avoid double triggers
    if (!isTauriApp()) {
      callback((e as CustomEvent).detail);
    }
  };

  window.addEventListener(event, domHandler);

  // Tauri listener for cross-window events
  if (isTauriApp()) {
    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        if (isCleanedUp) return;
        return listen<T>(event, (e) => {
          if (!isCleanedUp) {
            callback(e.payload);
          }
        });
      })
      .then((unsub) => {
        if (unsub) {
          if (isCleanedUp) {
            unsub();
          } else {
            tauriUnlisten = unsub;
          }
        }
      })
      .catch((err) => {
        console.warn(`[crossWindowEventBus] Failed to listen to Tauri event "${event}":`, err);
      });
  }

  return () => {
    isCleanedUp = true;
    window.removeEventListener(event, domHandler);
    if (tauriUnlisten) {
      tauriUnlisten();
      tauriUnlisten = null;
    }
  };
}
