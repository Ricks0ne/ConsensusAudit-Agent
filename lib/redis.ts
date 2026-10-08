// lib/redis.ts
import { Redis } from '@upstash/redis';

// Returns null if Upstash env vars aren't set — callers must fall back to
// in-memory storage in that case so the app still works without Redis
// configured (important for judges running this without your env setup).
export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}