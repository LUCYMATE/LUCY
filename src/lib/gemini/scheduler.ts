import { emitCrossWindow, listenCrossWindow } from '../events/crossWindowEventBus';

export interface ScheduledTask {
  id: string;
  targetTimeMs: number;
  instruction: string;
}

const STORAGE_KEY = 'lucy_scheduled_tasks';

function loadTasksFromStorage(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const now = Date.now();
        // Discard tasks expired more than 1 minute ago
        return parsed.filter(t => t.targetTimeMs > (now - 60000));
      }
    }
  } catch (e) {
    console.warn('[scheduler] Failed to load tasks from storage:', e);
  }
  return [];
}

function saveTasksToStorage(tasks: ScheduledTask[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.warn('[scheduler] Failed to save tasks to storage:', e);
  }
}

export let activeScheduledTasks: ScheduledTask[] = loadTasksFromStorage();

export function getScheduledTasks(): ScheduledTask[] {
  activeScheduledTasks = loadTasksFromStorage();
  return [...activeScheduledTasks];
}

export function cancelScheduledTaskById(id: string): boolean {
  activeScheduledTasks = loadTasksFromStorage();
  const initialLength = activeScheduledTasks.length;
  activeScheduledTasks = activeScheduledTasks.filter(t => t.id !== id);
  if (activeScheduledTasks.length < initialLength) {
    saveTasksToStorage(activeScheduledTasks);
    emitCrossWindow('lucy-tasks-changed', activeScheduledTasks);
    return true;
  }
  return false;
}

export function addScheduledTask(task: ScheduledTask) {
  activeScheduledTasks = loadTasksFromStorage();
  // Avoid duplicates
  if (!activeScheduledTasks.some(t => t.id === task.id)) {
    activeScheduledTasks.push(task);
    saveTasksToStorage(activeScheduledTasks);
    emitCrossWindow('lucy-tasks-changed', activeScheduledTasks);
  }
}

let scheduleInterval: any = null;
let globalScheduleCallback: ((taskInst: string) => void) | null = null;

export function setGlobalScheduleCallback(cb: ((taskInst: string) => void) | null) {
  globalScheduleCallback = cb;
}

// Global listener for cross-window task cancellations
let isInitializedListener = false;
function initCrossWindowTaskListener() {
  if (isInitializedListener) return;
  isInitializedListener = true;
  listenCrossWindow<string>('lucy-cancel-task', (taskId) => {
    if (taskId) {
      cancelScheduledTaskById(taskId);
    }
  });
}

export function startScheduler() {
  initCrossWindowTaskListener();
  if (scheduleInterval) return;
  scheduleInterval = setInterval(() => {
    activeScheduledTasks = loadTasksFromStorage();
    const now = Date.now();
    const dueTasks = activeScheduledTasks.filter(t => now >= t.targetTimeMs);
    if (dueTasks.length > 0) {
      activeScheduledTasks = activeScheduledTasks.filter(t => now < t.targetTimeMs);
      saveTasksToStorage(activeScheduledTasks);
      dueTasks.forEach(task => {
        if (globalScheduleCallback) globalScheduleCallback(task.instruction);
      });
      emitCrossWindow('lucy-tasks-changed', activeScheduledTasks);
    }
  }, 3000);
}
