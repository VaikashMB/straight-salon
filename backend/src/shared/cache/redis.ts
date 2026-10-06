import { Redis } from 'ioredis';
import type { Logger } from '../logger/index.js';

// Redis client for cache, rate limits and locks (08-caching). Commands fail fast while
// Redis is unreachable instead of queueing, so callers can fall back (cache is never the
// source of truth). BullMQ creates its own connections with its required options (Phase 2).
export function createRedisClient(url: string, logger: Logger): Redis {
  const log = logger.child({ component: 'redis' });
  const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });

  // ioredis emits 'error' on every reconnect attempt; log the transition once, not each retry.
  let connected = false;
  client.on('ready', () => {
    connected = true;
    log.info('Redis connected');
  });
  client.on('error', (err: Error) => {
    if (connected) {
      connected = false;
      log.warn({ err }, 'Redis connection lost; reconnecting in the background');
    } else {
      log.debug({ err }, 'Redis connection attempt failed');
    }
  });
  client.on('end', () => {
    connected = false;
    log.info('Redis connection closed');
  });

  return client;
}

export async function pingRedis(client: Pick<Redis, 'ping'>): Promise<void> {
  await client.ping();
}

// QUIT is a command, so it fails while Redis is unreachable (offline queue is disabled).
// In that case drop the socket and stop reconnecting instead.
export async function closeRedis(
  client: Pick<Redis, 'status' | 'quit' | 'disconnect'>,
): Promise<void> {
  if (client.status === 'ready') {
    await client.quit();
  } else {
    client.disconnect();
  }
}
