/**
 * Rate Limiter Engine for Soltini
 * Prevents rapid API spam, infinite loop execution, and runaway quota usage.
 */

interface RateLimitConfig {
  maxCalls: number;       // Maximum allowed calls in the window
  windowMs: number;       // Time window in milliseconds
  minIntervalMs?: number; // Minimum interval between consecutive calls
}

class RateLimiter {
  private callLogs: Map<string, number[]> = new Map();
  private lastCallTimes: Map<string, number> = new Map();

  /**
   * Check if an action key is permitted under the rate limit.
   * If allowed, records the call timestamp and returns true.
   * If exceeded, returns false.
   */
  public isAllowed(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();

    // Check minimum interval guard
    if (config.minIntervalMs) {
      const lastTime = this.lastCallTimes.get(key) || 0;
      if (now - lastTime < config.minIntervalMs) {
        console.warn(`[RateLimiter] Throttled '${key}': minimum interval of ${config.minIntervalMs}ms not met.`);
        return false;
      }
    }

    // Sliding window check
    const timestamps = this.callLogs.get(key) || [];
    const validTimestamps = timestamps.filter(t => now - t < config.windowMs);

    if (validTimestamps.length >= config.maxCalls) {
      console.warn(`[RateLimiter] Rate limit exceeded for '${key}': ${validTimestamps.length}/${config.maxCalls} calls in ${config.windowMs}ms.`);
      this.callLogs.set(key, validTimestamps);
      return false;
    }

    validTimestamps.push(now);
    this.callLogs.set(key, validTimestamps);
    this.lastCallTimes.set(key, now);
    return true;
  }

  /**
   * Reset rate limit history for a specific key or all keys.
   */
  public reset(key?: string): void {
    if (key) {
      this.callLogs.delete(key);
      this.lastCallTimes.delete(key);
    } else {
      this.callLogs.clear();
      this.lastCallTimes.clear();
    }
  }
}

export const rateLimiter = new RateLimiter();

// Pre-defined rate limit configurations for Soltini modules
export const RATE_LIMITS = {
  // Max 10 Live connection attempts per 30 seconds
  GEMINI_CONNECT: { maxCalls: 10, windowMs: 30_000, minIntervalMs: 1_000 },
  
  // Max 120 tool executions per minute, no minimum interval
  TOOL_EXECUTION: { maxCalls: 120, windowMs: 60_000, minIntervalMs: 0 },
  
  // Max 30 screen captures per 10 seconds, min 200ms apart
  SCREEN_CAPTURE: { maxCalls: 30, windowMs: 10_000, minIntervalMs: 200 },

  // Max 60 vector memory queries per minute
  MEMORY_SEARCH: { maxCalls: 60, windowMs: 60_000, minIntervalMs: 200 },

  // Max 60 terminal/python commands per minute
  SYSTEM_COMMAND: { maxCalls: 60, windowMs: 60_000, minIntervalMs: 200 },
};
