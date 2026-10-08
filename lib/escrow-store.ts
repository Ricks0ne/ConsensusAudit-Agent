// lib/escrow-store.ts
import { getRedis } from './redis';

export type EscrowRecord = {
  status: 'HELD' | 'RELEASED' | 'BLOCKED';
  amount: number;
  createdAt: string;
  releasedAt?: string;
};

// In-memory fallback, same rationale as rate-limit.ts: keeps the escrow
// feature fully functional without requiring Redis to be configured.
const memoryStore = new Map<string, EscrowRecord>();
const KEY_PREFIX = 'escrow:';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — plenty for a demo/judging window

export async function getEscrow(hash: string): Promise<EscrowRecord | null> {
  const redis = getRedis();
  if (!redis) return memoryStore.get(hash) || null;

  try {
    const record = await redis.get<EscrowRecord>(`${KEY_PREFIX}${hash}`);
    return record || null;
  } catch (err) {
    console.warn('Redis escrow read failed, falling back to memory:', err);
    return memoryStore.get(hash) || null;
  }
}

export async function setEscrow(hash: string, record: EscrowRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memoryStore.set(hash, record);
    return;
  }

  try {
    await redis.set(`${KEY_PREFIX}${hash}`, record, { ex: TTL_SECONDS });
  } catch (err) {
    console.warn('Redis escrow write failed, falling back to memory:', err);
    memoryStore.set(hash, record);
  }
}