import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { TooManyRequestsError } from '../../../shared/errors/index.js';
import {
  createLoginThrottle,
  emailKey,
  LOCKOUT_WINDOW_MS,
  MAX_FAILURES,
} from '../loginThrottle.js';

const redis = new RedisMock();
afterEach(async () => {
  await redis.flushall();
});

describe('login lockout (06 §2 step 2)', () => {
  it('locks an email after 5 failures within 15 minutes', async () => {
    const throttle = createLoginThrottle(redis);
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(throttle.assertNotLocked('ananya@example.com')).resolves.toBeUndefined();
      await throttle.recordFailure('ananya@example.com');
    }
    await expect(throttle.assertNotLocked('ananya@example.com')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
    // Case/whitespace variants share the counter; other emails are unaffected.
    await expect(throttle.assertNotLocked(' Ananya@Example.com ')).rejects.toBeInstanceOf(
      TooManyRequestsError,
    );
    await expect(throttle.assertNotLocked('ravi@example.com')).resolves.toBeUndefined();
  });

  it('keys by a hash (no email in Redis) with a 15-minute window', async () => {
    const throttle = createLoginThrottle(redis);
    await throttle.recordFailure('ananya@example.com');
    const [key] = await redis.keys('ss:v1:login_fail:*');
    expect(key).toBe(emailKey('ananya@example.com'));
    expect(key).not.toContain('ananya');
    expect(await redis.pttl(key!)).toBeGreaterThan(LOCKOUT_WINDOW_MS - 1000);
  });

  it('a successful login resets the counter', async () => {
    const throttle = createLoginThrottle(redis);
    for (let i = 0; i < MAX_FAILURES; i++) await throttle.recordFailure('a@b.co');
    await throttle.reset('a@b.co');
    await expect(throttle.assertNotLocked('a@b.co')).resolves.toBeUndefined();
  });

  it('fails closed (429) when Redis is down; reset failures are ignored', async () => {
    const fail = () => Promise.reject(new Error('ECONNREFUSED'));
    const throttle = createLoginThrottle({ get: fail, eval: fail, del: fail });
    await expect(throttle.assertNotLocked('a@b.co')).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(throttle.recordFailure('a@b.co')).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(throttle.reset('a@b.co')).resolves.toBeUndefined();
  });
});
