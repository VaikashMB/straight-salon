import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { cacheKeys } from '../../shared/cache/keys.js';
import { TooManyRequestsError } from '../../shared/errors/index.js';

// Brute-force lockout per account (06 §2 login step 2): 5 failed logins within 15 minutes lock
// that email for 15 minutes. Keyed by a hash so no email sits in Redis. If Redis is down,
// login fails closed with 429 (08 §5).

export const MAX_FAILURES = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

const RECORD_FAILURE = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return count`;

export interface LoginThrottle {
  assertNotLocked(email: string): Promise<void>;
  recordFailure(email: string): Promise<void>;
  reset(email: string): Promise<void>;
}

export function emailKey(email: string): string {
  return cacheKeys.loginFailures(
    createHash('sha256').update(email.trim().toLowerCase()).digest('hex'),
  );
}

const unavailable = () =>
  new TooManyRequestsError('Login is temporarily unavailable. Please try again shortly.');

export function createLoginThrottle(redis: Pick<Redis, 'get' | 'eval' | 'del'>): LoginThrottle {
  return {
    async assertNotLocked(email) {
      let failures: string | null;
      try {
        failures = await redis.get(emailKey(email));
      } catch {
        throw unavailable();
      }
      if (Number(failures ?? 0) >= MAX_FAILURES) {
        throw new TooManyRequestsError(
          'Too many failed logins. Try again in 15 minutes or reset your password.',
        );
      }
    },
    async recordFailure(email) {
      try {
        await redis.eval(RECORD_FAILURE, 1, emailKey(email), LOCKOUT_WINDOW_MS);
      } catch {
        throw unavailable();
      }
    },
    async reset(email) {
      try {
        await redis.del(emailKey(email));
      } catch {
        // Not fatal: the counter expires on its own.
      }
    },
  };
}
