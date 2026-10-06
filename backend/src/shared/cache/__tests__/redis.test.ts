import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { closeRedis, createRedisClient, pingRedis } from '../redis.js';

vi.mock('ioredis', () => ({ Redis: RedisMock }));

type Client = ReturnType<typeof createRedisClient>;
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.quit()));
});

function create(): { client: Client; messages: () => [string, string][] } {
  const { logger, lines } = captureLogger();
  const client = createRedisClient('redis://localhost:6379', logger);
  clients.push(client);
  const messages = () =>
    lines()
      .filter((l) => l.component === 'redis')
      .map((l) => [String(l.level), String(l.msg)] as [string, string]);
  return { client, messages };
}

describe('createRedisClient', () => {
  it('answers ping', async () => {
    const { client } = create();
    await expect(pingRedis(client)).resolves.toBeUndefined();
  });

  it('logs the connection lifecycle once per transition, not once per retry', () => {
    const { client, messages } = create();
    const before = messages().length;

    client.emit('ready');
    client.emit('error', new Error('ECONNRESET'));
    client.emit('error', new Error('ECONNREFUSED'));
    client.emit('ready');
    client.emit('end');

    expect(messages().slice(before)).toEqual([
      ['info', 'Redis connected'],
      ['warn', 'Redis connection lost; reconnecting in the background'],
      ['debug', 'Redis connection attempt failed'],
      ['info', 'Redis connected'],
      ['info', 'Redis connection closed'],
    ]);
  });
});

describe('closeRedis', () => {
  it('sends QUIT when connected', async () => {
    const client = {
      status: 'ready' as const,
      quit: vi.fn(() => Promise.resolve('OK' as const)),
      disconnect: vi.fn(),
    };
    await closeRedis(client);
    expect(client.quit).toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('drops the socket without QUIT when Redis is unreachable', async () => {
    const client = { status: 'reconnecting' as const, quit: vi.fn(), disconnect: vi.fn() };
    await closeRedis(client);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.quit).not.toHaveBeenCalled();
  });
});

describe('pingRedis', () => {
  it('rejects when the client cannot reach Redis', async () => {
    const failing = { ping: () => Promise.reject(new Error('Connection is closed.')) };
    await expect(pingRedis(failing)).rejects.toThrow('Connection is closed.');
  });
});
