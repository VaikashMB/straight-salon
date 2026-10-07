import express, { json } from 'express';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createErrorHandler } from '../../errors/index.js';
import { idempotency } from '../idempotency.js';

function app(redis: Pick<Redis, 'set' | 'get' | 'del'>, handler: express.RequestHandler) {
  const { logger, lines } = captureLogger();
  const server = express();
  server.use(json());
  server.use((req, _res, next) => {
    req.auth = { userId: 'u1', role: 'CUSTOMER' };
    next();
  });
  server.post('/things', idempotency({ redis, logger }), handler);
  server.use(createErrorHandler(logger));
  return { server, lines };
}

describe('idempotency middleware (03 §9)', () => {
  it('requests without the header pass straight through', async () => {
    const handler = vi.fn((_req: express.Request, res: express.Response) =>
      res.status(201).json({ ok: 1 }),
    );
    const { server } = app(new RedisMock({ host: 'idem-1' }), handler);
    await request(server).post('/things').send({}).expect(201);
    await request(server).post('/things').send({}).expect(201);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a duplicate while the first is still running is 409; it succeeds once released', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { server } = app(new RedisMock({ host: 'idem-2' }), async (_req, res) => {
      await gate;
      res.status(201).json({ id: 1 });
    });
    const first = request(server)
      .post('/things')
      .set('Idempotency-Key', 'key-in-flight')
      .send({ a: 1 })
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    const second = await request(server)
      .post('/things')
      .set('Idempotency-Key', 'key-in-flight')
      .send({ a: 1 });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    release();
    expect((await first).status).toBe(201);
  });

  it('runs without idempotency when Redis is down (warns once)', async () => {
    const broken = {
      set: () => Promise.reject(new Error('down')),
      get: () => Promise.reject(new Error('down')),
      del: () => Promise.reject(new Error('down')),
    } as unknown as Pick<Redis, 'set' | 'get' | 'del'>;
    const { server, lines } = app(broken, (_req, res) => res.status(201).json({ ok: 1 }));
    await request(server)
      .post('/things')
      .set('Idempotency-Key', 'key-redis-down')
      .send({})
      .expect(201);
    await request(server)
      .post('/things')
      .set('Idempotency-Key', 'key-redis-down')
      .send({})
      .expect(201);
    expect(
      lines().filter((l) => l.msg === 'Idempotency store unavailable; continuing without it'),
    ).toHaveLength(1);
  });

  it('a stored entry that cannot be read is treated as in progress', async () => {
    const redis = new RedisMock({ host: 'idem-3' });
    const flaky = {
      set: redis.set.bind(redis),
      del: redis.del.bind(redis),
      get: () => Promise.reject(new Error('read failed')),
    } as unknown as Pick<Redis, 'set' | 'get' | 'del'>;
    await redis.set('ss:v1:idem:u1:key-unreadable', '{}');
    const { server } = app(flaky, (_req, res) => res.status(201).json({ ok: 1 }));
    const res = await request(server)
      .post('/things')
      .set('Idempotency-Key', 'key-unreadable')
      .send({});
    expect(res.status).toBe(409);
  });
});
