import express from 'express';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createErrorHandler } from '../../errors/index.js';
import { byIp, rateLimit, type RateLimitOptions } from '../rateLimit.js';

const redis = new RedisMock();
afterEach(async () => {
  await redis.flushall();
});

function app(options: Partial<RateLimitOptions> = {}) {
  const { logger, lines } = captureLogger();
  const a = express();
  a.use(
    rateLimit({
      scope: 'test',
      windowMs: 60_000,
      max: 3,
      key: byIp,
      failOpen: false,
      redis,
      logger,
      ...options,
    }),
  );
  a.get('/', (_req, res) => {
    res.send('ok');
  });
  a.use(createErrorHandler(logger));
  return { app: a, lines };
}

describe('rateLimit (06 §4, 08 §5)', () => {
  it('allows up to max requests per window, then 429 with Retry-After', async () => {
    const { app: a, lines } = app();
    for (let i = 1; i <= 3; i++) {
      const res = await request(a).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
      expect(res.headers['ratelimit-remaining']).toBe(String(3 - i));
    }
    const blocked = await request(a).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(lines().some((l) => l.msg === 'Rate limit hit' && l.level === 'warn')).toBe(true);
  });

  it('stores counters under the shared key builder with the window as TTL', async () => {
    await request(app().app).get('/');
    const keys = await redis.keys('ss:v1:rl:test:*');
    expect(keys).toHaveLength(1);
    expect(await redis.pttl(keys[0]!)).toBeGreaterThan(59_000);
  });

  it('skips requests without a key', async () => {
    const { app: a } = app({ key: () => undefined, max: 0 });
    expect((await request(a).get('/')).status).toBe(200);
  });

  const broken = { eval: () => Promise.reject(new Error('ECONNREFUSED')) };

  it('fails CLOSED (429) when Redis is down, for sensitive limits', async () => {
    const { app: a, lines } = app({ redis: broken, failOpen: false });
    const res = await request(a).get('/');
    expect(res.status).toBe(429);
    expect(lines().some((l) => l.msg === 'Rate limiter unavailable')).toBe(true);
  });

  it('fails OPEN when Redis is down, for the global limit, warning at most once a minute', async () => {
    const { app: a, lines } = app({ redis: broken, failOpen: true });
    expect((await request(a).get('/')).status).toBe(200);
    expect((await request(a).get('/')).status).toBe(200);
    expect(lines().filter((l) => l.msg === 'Rate limiter unavailable')).toHaveLength(1);
  });
});
