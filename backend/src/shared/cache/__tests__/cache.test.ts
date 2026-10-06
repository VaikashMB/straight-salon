import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createMetrics } from '../../metrics/index.js';
import { createManualClock } from '../../time/clock.js';
import { createCache, type CacheDeps } from '../cache.js';
import { cacheKeys, cacheTags } from '../keys.js';

const redis = new RedisMock();

afterEach(async () => {
  await redis.flushall();
});

function setup(overrides: Partial<CacheDeps> = {}) {
  const { logger, lines } = captureLogger();
  const metrics = createMetrics({ defaultMetrics: false });
  const clock = createManualClock('2026-10-06T09:00:00.000Z');
  const cache = createCache({ redis, enabled: true, logger, metrics, clock, ...overrides });
  return { cache, metrics, clock, lines };
}

async function counter(metrics: ReturnType<typeof createMetrics>, name: string): Promise<number> {
  const metric = (await metrics.registry.getMetricsAsJSON()).find((m) => m.name === name);
  return metric?.values.reduce((sum, v) => sum + v.value, 0) ?? 0;
}

const key = cacheKeys.categories();

describe('cacheAside (08 §7)', () => {
  it('a miss runs the loader and stores the value with its TTL', async () => {
    const { cache, metrics } = setup();
    const loader = vi.fn(() => Promise.resolve([{ name: 'Hair' }]));

    await expect(cache.cacheAside(key, 1800, loader)).resolves.toEqual([{ name: 'Hair' }]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await redis.get(key))!)).toEqual([{ name: 'Hair' }]);
    expect(await redis.ttl(key)).toBeGreaterThan(1790);
    expect(await counter(metrics, 'cache_misses_total')).toBe(1);
  });

  it('a hit skips the loader', async () => {
    const { cache, metrics } = setup();
    await redis.set(key, JSON.stringify(['cached']));
    const loader = vi.fn(() => Promise.resolve(['fresh']));

    await expect(cache.cacheAside(key, 60, loader)).resolves.toEqual(['cached']);
    expect(loader).not.toHaveBeenCalled();
    expect(await counter(metrics, 'cache_hits_total')).toBe(1);
  });

  // TTL semantics (EXPIRE NX/GT) are checked against real Redis in test/integration/redis.int.test.ts;
  // ioredis-mock ignores those flags.
  it('records tag membership with a TTL', async () => {
    const { cache } = setup();
    await cache.cacheAside(cacheKeys.service('s1'), 1800, () => Promise.resolve({ id: 's1' }), {
      tags: [cacheTags.catalog],
    });
    await cache.cacheAside(cacheKeys.services({ q: 'cut' }), 600, () => Promise.resolve([]), {
      tags: [cacheTags.catalog],
    });
    const tagKey = cacheKeys.tag(cacheTags.catalog);
    expect((await redis.smembers(tagKey)).sort()).toEqual(
      [cacheKeys.service('s1'), cacheKeys.services({ q: 'cut' })].sort(),
    );
    expect(await redis.ttl(tagKey)).toBeGreaterThan(0);
  });

  it('does not cache values over the size limit', async () => {
    const { cache } = setup({ maxValueBytes: 10 });
    await cache.cacheAside(key, 60, () => Promise.resolve('a value longer than ten bytes'));
    expect(await redis.exists(key)).toBe(0);
  });

  it('does not cache undefined', async () => {
    const { cache } = setup();
    await expect(
      cache.cacheAside(key, 60, () => Promise.resolve(undefined)),
    ).resolves.toBeUndefined();
    expect(await redis.exists(key)).toBe(0);
  });

  it('is a pass-through when CACHE_ENABLED=false', async () => {
    const { cache } = setup({ enabled: false });
    const loader = vi.fn(() => Promise.resolve(1));
    await cache.cacheAside(key, 60, loader);
    await cache.cacheAside(key, 60, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(await redis.exists(key)).toBe(0);
    await expect(cache.invalidateTag('catalog')).resolves.toBeUndefined();
    await expect(cache.invalidateKeys(key)).resolves.toBeUndefined();
  });
});

describe('Redis failure (08 §1): reads still work and nothing throws', () => {
  const failing = () => Promise.reject(new Error('ECONNREFUSED'));
  const brokenRedis = {
    get: failing,
    smembers: failing,
    multi: () => {
      const chain = {
        set: () => chain,
        sadd: () => chain,
        expire: () => chain,
        unlink: () => chain,
        exec: failing,
      };
      return chain;
    },
  } as unknown as CacheDeps['redis'];

  it('calls the loader, counts errors, and warns at most once a minute', async () => {
    const { cache, metrics, clock, lines } = setup({ redis: brokenRedis });
    const loader = vi.fn(() => Promise.resolve('from-db'));

    await expect(cache.cacheAside(key, 60, loader)).resolves.toBe('from-db');
    await expect(cache.cacheAside(key, 60, loader)).resolves.toBe('from-db');
    await expect(cache.invalidateTag('catalog')).resolves.toBeUndefined();
    await expect(cache.invalidateKeys(key)).resolves.toBeUndefined();

    expect(loader).toHaveBeenCalledTimes(2);
    expect(await counter(metrics, 'cache_errors_total')).toBe(6); // 2 gets + 2 sets + smembers + unlink
    expect(lines().filter((l) => l.level === 'warn')).toHaveLength(1);

    clock.advance(60_000);
    await cache.cacheAside(key, 60, loader);
    expect(lines().filter((l) => l.level === 'warn')).toHaveLength(2);
  });
});

describe('invalidation', () => {
  it('invalidateTag removes every member and the tag set', async () => {
    const { cache } = setup();
    const tag = cacheTags.availability('st1', '2026-10-12');
    const a = cacheKeys.availability('st1', '2026-10-12', 60);
    const b = cacheKeys.availability('st1', '2026-10-12', 45);
    const other = cacheKeys.availability('st2', '2026-10-12', 60);
    await cache.cacheAside(a, 60, () => Promise.resolve([1]), { tags: [tag] });
    await cache.cacheAside(b, 60, () => Promise.resolve([2]), { tags: [tag] });
    await cache.cacheAside(other, 60, () => Promise.resolve([3]), {
      tags: [cacheTags.availability('st2', '2026-10-12')],
    });

    await cache.invalidateTag(tag);

    expect(await redis.exists(a, b, cacheKeys.tag(tag))).toBe(0);
    expect(await redis.exists(other)).toBe(1);
  });

  it('invalidateTag on an unknown tag is a no-op', async () => {
    const { cache } = setup();
    await expect(cache.invalidateTag('nothing-here')).resolves.toBeUndefined();
  });

  it('invalidateKeys deletes exact keys', async () => {
    const { cache } = setup();
    await redis.set(cacheKeys.settingsPublic(), '{}');
    await cache.invalidateKeys(cacheKeys.settingsPublic());
    expect(await redis.exists(cacheKeys.settingsPublic())).toBe(0);
  });
});
