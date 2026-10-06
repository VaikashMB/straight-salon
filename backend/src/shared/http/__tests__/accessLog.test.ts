import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { accessLog, accessLogLevel } from '../accessLog.js';

describe('accessLogLevel (07 §1.3)', () => {
  it.each([
    [200, 'info'],
    [204, 'info'],
    [301, 'info'],
    [400, 'warn'],
    [401, 'info'],
    [403, 'warn'],
    [404, 'info'],
    [409, 'warn'],
    [422, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('%i -> %s', (status, level) => {
    expect(accessLogLevel(status)).toBe(level);
  });
});

describe('accessLog', () => {
  function app() {
    const { logger, lines } = captureLogger();
    const a = express();
    a.use(accessLog(logger));
    const api = Router();
    api.get('/bookings/:id', (_req, res) => {
      res.status(409).json({ error: 'conflict' });
    });
    a.use('/api/v1', api);
    a.get('/health/live', (_req, res) => {
      res.json({ status: 'ok' });
    });
    return { app: a, lines };
  }

  it('logs the route pattern, never the raw URL with IDs', async () => {
    const { app: a, lines } = app();
    await request(a)
      .get('/api/v1/bookings/6712c0f9a1b2c3d4e5f60789?email=x@y.z')
      .set('User-Agent', 'vitest');
    const [line] = lines();
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'Request completed',
      method: 'GET',
      route: '/api/v1/bookings/:id',
      status: 409,
      userAgent: 'vitest',
    });
    expect(typeof line?.responseTimeMs).toBe('number');
    expect(line?.contentLength).toBeGreaterThan(0);
    expect(JSON.stringify(line)).not.toContain('6712c0f9a1b2c3d4e5f60789');
  });

  it('labels unmatched routes and skips health checks', async () => {
    const { app: a, lines } = app();
    await request(a).get('/health/live');
    await request(a).get('/nowhere');
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ route: 'unmatched', status: 404, level: 'info' });
  });
});
