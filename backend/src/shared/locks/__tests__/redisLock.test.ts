import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError } from '../../errors/index.js';
import { createRedisLock } from '../redisLock.js';

const redis = new RedisMock();
const noSleep = () => Promise.resolve();

afterEach(async () => {
  await redis.flushall();
});

describe('createRedisLock (08 §5)', () => {
  it('acquires a free lock with a TTL and returns a token', async () => {
    const lock = createRedisLock({ redis, sleep: noSleep });
    const token = await lock.acquire('ss:v1:lock:staff:s1:2026-10-12', { ttlMs: 5000 });
    expect(token).toEqual(expect.any(String));
    expect(await redis.get('ss:v1:lock:staff:s1:2026-10-12')).toBe(token);
    expect(await redis.pttl('ss:v1:lock:staff:s1:2026-10-12')).toBeGreaterThan(4000);
  });

  it('a second acquirer fails after its retries, backing off with jitter', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const lock = createRedisLock({ redis, sleep, random: () => 0.5 });
    await lock.acquire('k');
    expect(await lock.acquire('k', { retries: 3, retryDelayMs: 50 })).toBeNull();
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100, 150]);
  });

  it('release with the wrong token does nothing; the right token releases', async () => {
    const lock = createRedisLock({ redis, sleep: noSleep });
    const token = await lock.acquire('k');
    expect(await lock.release('k', 'someone-else')).toBe(false);
    expect(await redis.exists('k')).toBe(1);
    expect(await lock.release('k', token!)).toBe(true);
    expect(await redis.exists('k')).toBe(0);
  });

  it('fails closed with 503 when Redis is unreachable', async () => {
    const broken = {
      set: () => Promise.reject(new Error('ECONNREFUSED')),
      eval: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const lock = createRedisLock({ redis: broken, sleep: noSleep });
    await expect(lock.acquire('k')).rejects.toBeInstanceOf(ServiceUnavailableError);
    // Release failures are swallowed: the lock expires on its own.
    await expect(lock.release('k', 't')).resolves.toBe(false);
  });

  it('uses real timers by default', async () => {
    const lock = createRedisLock({ redis });
    await lock.acquire('k');
    await expect(lock.acquire('k', { retries: 1, retryDelayMs: 1 })).resolves.toBeNull();
  });
});
