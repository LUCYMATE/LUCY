import { isTauriApp } from '../system/tauriBridge';

export type UnlistenFn = () => void;

interface CrossWindowEventEnvelope<T> {
  __crossWindowBus: true;
  id: string;
  sender: string;
  payload?: T;
}

// Generate unique window instance ID
const WINDOW_INSTANCE_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `win_${Math.random().toString(36).substring(2)}_${Date.now()}`;

let sequenceCounter = 0;

// Set of recently processed event IDs to prevent duplicate execution across DOM & Tauri transports
const recentEventIds = new Set<string>();
const recentEventOrder: string[] = [];
const MAX_RECENT_EVENTS = 300;

function trackAndCheckDuplicate(id: string): boolean {
  if (recentEventIds.has(id)) {
    return true; // Already processed
  }
  recentEventIds.add(id);
  recentEventOrder.push(id);
  if (recentEventOrder.length > MAX_RECENT_EVENTS) {
    const oldest = recentEventOrder.shift();
    if (oldest) recentEventIds.delete(oldest);
  }
  return false;
}

/**
 * Emits an event across all open Webview windows and local DOM.
 * Envelopes each payload with a unique ID to prevent double execution in the emitter window.
 */
export async function emitCrossWindow<T = any>(event: string, payload?: T): Promise<void> {
  const isSleepWakeEvent = event === 'lucy-sleep' || event === 'lucy-wake-up';
  if (isSleepWakeEvent && isTauriApp()) {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      if (getCurrentWebviewWindow().label !== 'main') return;
    } catch (e) {
      console.warn(`[crossWindowEventBus] Could not verify main window for "${event}":`, e);
      return;
    }
  }

  const eventId = `${WINDOW_INSTANCE_ID}:${++sequenceCounter}:${Date.now()}`;
  const envelope: CrossWindowEventEnvelope<T> = {
    __crossWindowBus: true,
    id: eventId,
    sender: WINDOW_INSTANCE_ID,
    payload,
  };

  // Dispatch locally in current DOM first
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: envelope }));
  } catch (e) {
    console.warn(`[crossWindowEventBus] Failed to dispatch DOM event "${event}":`, e);
  }

  // Sleep/wake transitions belong to the main webview only. Wake requests must
  // go through the native main-window command, which restores that window first.
  if (isSleepWakeEvent) return;

  // If running inside Tauri, emit globally to all windows
  if (isTauriApp()) {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(event, envelope);
    } catch (e) {
      console.warn(`[crossWindowEventBus] Failed to emit Tauri event "${event}":`, e);
    }
  }
}

/**
 * Listens for an event originating from any window (via Tauri IPC) or local DOM.
 * Unpacks the envelope and cleanly deduplicates events without arbitrary time window throttling.
 */
export function listenCrossWindow<T = any>(
  event: string,
  callback: (payload: T) => void
): UnlistenFn {
  let isCleanedUp = false;
  let tauriUnlisten: (() => void) | null = null;

  const trigger = (rawDetail: any) => {
    if (isCleanedUp) return;

    // Check if event is wrapped in our cross-window envelope
    if (rawDetail && typeof rawDetail === 'object' && rawDetail.__crossWindowBus === true) {
      const envelope = rawDetail as CrossWindowEventEnvelope<T>;
      if (trackAndCheckDuplicate(envelope.id)) {
        // Already processed via the other transport (e.g. DOM handled, now Tauri delivered back to sender)
        return;
      }
      callback(envelope.payload as T);
    } else {
      // Raw event (e.g. emitted directly by native Rust app_handle.emit or direct DOM dispatch)
      callback(rawDetail as T);
    }
  };

  // DOM listener for local events
  const domHandler = (e: Event) => {
    trigger((e as CustomEvent).detail);
  };

  window.addEventListener(event, domHandler);

  // Tauri listener for cross-window and native backend events
  if (isTauriApp()) {
    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        if (isCleanedUp) return;
        return listen<any>(event, (e) => {
          trigger(e.payload);
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
