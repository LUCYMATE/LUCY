export interface ScheduledTask {
  id: string;
  targetTimeMs: number;
  instruction: string;
}
export let activeScheduledTasks: ScheduledTask[] = [];

export function getScheduledTasks(): ScheduledTask[] {
  return [...activeScheduledTasks];
}

export function cancelScheduledTaskById(id: string): boolean {
  const initialLength = activeScheduledTasks.length;
  activeScheduledTasks = activeScheduledTasks.filter(t => t.id !== id);
  if (activeScheduledTasks.length < initialLength) {
    window.dispatchEvent(new CustomEvent('soltini-tasks-changed'));
    return true;
  }
  return false;
}

export function addScheduledTask(task: ScheduledTask) {
  activeScheduledTasks.push(task);
  window.dispatchEvent(new CustomEvent('soltini-tasks-changed'));
}

let scheduleInterval: any = null;
let globalScheduleCallback: ((taskInst: string) => void) | null = null;

export function setGlobalScheduleCallback(cb: ((taskInst: string) => void) | null) {
  globalScheduleCallback = cb;
}

export function startScheduler() {
  if (scheduleInterval) return;
  scheduleInterval = setInterval(() => {
    const now = Date.now();
    const dueTasks = activeScheduledTasks.filter(t => now >= t.targetTimeMs);
    if (dueTasks.length > 0) {
      activeScheduledTasks = activeScheduledTasks.filter(t => now < t.targetTimeMs);
      dueTasks.forEach(task => {
        if (globalScheduleCallback) globalScheduleCallback(task.instruction);
      });
      window.dispatchEvent(new CustomEvent('soltini-tasks-changed'));
    }
  }, 5000);
}
