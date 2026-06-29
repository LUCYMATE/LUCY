export type LogLevel = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  action: string;
  detail?: string;
}

type Subscriber = (logs: LogEntry[]) => void;

class Logger {
  private logs: LogEntry[] = [];
  private subscribers: Set<Subscriber> = new Set();

  add(level: LogLevel, action: string, detail?: string) {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      action,
      detail
    };
    // Append new logs so they appear at the bottom, limit to 200
    this.logs = [...this.logs, entry].slice(-200);
    this.notify();
    
    // Also log to console for debugging
    if (level === 'error') {
      console.error(`[${action}]`, detail || '');
    } else {
      console.log(`[${level.toUpperCase()}] ${action}`, detail || '');
    }
  }

  subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    sub(this.logs);
    return () => this.subscribers.delete(sub);
  }

  private notify() {
    this.subscribers.forEach(sub => sub(this.logs));
  }
}

export const logger = new Logger();
