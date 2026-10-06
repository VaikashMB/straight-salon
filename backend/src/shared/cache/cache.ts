import type { Redis } from 'ioredis';
import type { Logger } from '../logger/index.js';
import type { Metrics } from '../metrics/index.js';
import { systemClock, type Clock } from '../time/clock.js';
import { cacheKeys, keyPrefix } from './keys.js';

// Cache-aside with tag invalidation (08-caching). The cache is an optimisation, never the
// source of truth: when Redis fails, reads go to the loader and nothing is thrown.
// Values are stored as JSON, so cached Dates come back as ISO strings; cache DTOs, not documents.

export interface CacheAsideOptions {
  tags?: string[];
}

export interface Cache {
  cacheAside<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options?: CacheAsideOptions,
  ): Promise<T>;
  invalidateTag(tag: string): Promise<void>;
  invalidateKeys(...keys: string[]): Promise<void>;
}

export interface CacheDeps {
  redis: Pick<Redis, 'get' | 'smembers' | 'multi'>;
  enabled: boolean;
  logger: Logger;
  metrics: Pick<Metrics, 'cacheHits' | 'cacheMisses' | 'cacheErrors'>;
  clock?: Clock;
  maxValueBytes?: number;
}

const MAX_VALUE_BYTES = 256 * 1024;
const ERROR_LOG_INTERVAL_MS = 60_000;

export function createCache(deps: CacheDeps): Cache {
  const {
    redis,
    enabled,
    logger,
    metrics,
    clock = systemClock,
    maxValueBytes = MAX_VALUE_BYTES,
  } = deps;
  const log = logger.child({ component: 'cache' });
  let lastErrorLogAt = Number.NEGATIVE_INFINITY;

  // Count every failure; log at most once a minute (08 §1).
  function recordError(err: unknown, operation: string): void {
    metrics.cacheErrors.inc();
    const now = clock.now().getTime();
    if (now - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
      lastErrorLogAt = now;
      log.warn({ err, operation }, 'Cache unavailable; falling back to the database');
    }
  }

  async function read(key: string): Promise<string | null> {
    try {
      return await redis.get(key);
    } catch (err) {
      recordError(err, 'get');
      return null;
    }
  }

  async function write(
    key: string,
    ttlSeconds: number,
    value: unknown,
    tags: string[],
  ): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return;
    if (Buffer.byteLength(serialized) > maxValueBytes) {
      log.debug({ prefix: keyPrefix(key) }, 'Value too large to cache');
      return;
    }
    const tx = redis.multi().set(key, serialized, 'EX', ttlSeconds);
    for (const tag of tags) {
      const tagKey = cacheKeys.tag(tag);
      // Tag set lives at least as long as its longest-lived member.
      tx.sadd(tagKey, key).expire(tagKey, ttlSeconds, 'NX').expire(tagKey, ttlSeconds, 'GT');
    }
    try {
      await tx.exec();
    } catch (err) {
      recordError(err, 'set');
    }
  }

  async function unlink(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await redis
        .multi()
        .unlink(...keys)
        .exec();
    } catch (err) {
      recordError(err, 'unlink');
    }
  }

  return {
    async cacheAside<T>(
      key: string,
      ttlSeconds: number,
      loader: () => Promise<T>,
      options: CacheAsideOptions = {},
    ) {
      if (!enabled) return loader();
      const prefix = keyPrefix(key);
      const cached = await read(key);
      if (cached !== null) {
        metrics.cacheHits.inc({ prefix });
        log.debug({ prefix }, 'Cache hit');
        return JSON.parse(cached) as T;
      }
      metrics.cacheMisses.inc({ prefix });
      log.debug({ prefix }, 'Cache miss');
      const value = await loader();
      await write(key, ttlSeconds, value, options.tags ?? []);
      return value;
    },

    async invalidateTag(tag) {
      if (!enabled) return;
      const tagKey = cacheKeys.tag(tag);
      let members: string[];
      try {
        members = await redis.smembers(tagKey);
      } catch (err) {
        recordError(err, 'smembers');
        return;
      }
      await unlink([...members, tagKey]);
    },

    async invalidateKeys(...keys) {
      if (!enabled) return;
      await unlink(keys);
    },
  };
}
