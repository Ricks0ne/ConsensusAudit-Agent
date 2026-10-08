// lib/rate-limit.ts
import { getRedis } from './redis';

// Generous default so judges/testers don't get blocked mid-demo.
const WINDOW_SECONDS = 10 * 60; // 10 minutes
const MAX_REQUESTS = 20; // per IP per window

// In-memory fallback (per-instance, resets on cold start). Used automatically
// whenever Redis isn't configured, so local/dev/judge runs without Upstash
// env vars still work — just without cross-instance persistence.
const memoryStore = new Map<string, number[]>();

function checkMemory(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;
  const timestamps = (memoryStore.get(ip) || []).filter(t => now - t < windowMs);

  if (timestamps.length >= MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  timestamps.push(now);
  memoryStore.set(ip, timestamps);
  return { allowed: true };
}

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const redis = getRedis();
  if (!redis) return checkMemory(ip);

  try {
    const key = `ratelimit:audit:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    if (count > MAX_REQUESTS) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
    }
    return { allowed: true };
  } catch (err) {
    console.warn('Redis rate limit check failed, falling back to allow:', err);
    // Fail open rather than blocking legitimate traffic (including judges)
    // if Redis has a transient issue.
    return { allowed: true };
  }
}