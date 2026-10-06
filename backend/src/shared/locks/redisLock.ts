import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ServiceUnavailableError } from '../errors/index.js';

// Distributed lock (08-caching §5): SET key token NX PX ttl; release deletes only if the token
// still matches, so a holder whose lock expired cannot delete someone else's lock. The lock
// reduces contention; correctness of bookings comes from the staff-day guard (02 §2.18).

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export interface LockOptions {
  ttlMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface RedisLock {
  // Resolves to the token on success, or null when still held by someone else after retries.
  // Throws ServiceUnavailableError when Redis is unreachable (fail closed, 08 §5).
  acquire(key: string, options?: LockOptions): Promise<string | null>;
  release(key: string, token: string): Promise<boolean>;
}

export interface RedisLockDeps {
  redis: Pick<Redis, 'set' | 'eval'>;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaults: Required<LockOptions> = { ttlMs: 5_000, retries: 3, retryDelayMs: 50 };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRedisLock({
  redis,
  random = Math.random,
  sleep = realSleep,
}: RedisLockDeps): RedisLock {
  return {
    async acquire(key, options = {}) {
      const { ttlMs, retries, retryDelayMs } = { ...defaults, ...options };
      const token = randomUUID();
      for (let attempt = 0; attempt <= retries; attempt++) {
        let result: string | null;
        try {
          result = await redis.set(key, token, 'PX', ttlMs, 'NX');
        } catch {
          throw new ServiceUnavailableError();
        }
        if (result === 'OK') return token;
        if (attempt < retries) {
          // Jittered backoff so competing requests do not retry in lockstep.
          await sleep(Math.round(retryDelayMs * (attempt + 1) * (0.5 + random())));
        }
      }
      return null;
    },

    async release(key, token) {
      try {
        return (await redis.eval(RELEASE_SCRIPT, 1, key, token)) === 1;
      } catch {
        // The lock expires on its own; failing to release early is not an error for the caller.
        return false;
      }
    },
  };
}
