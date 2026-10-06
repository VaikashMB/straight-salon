import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ReadinessReport, ReadinessService } from '../../src/modules/health/health.service.js';

function appWith(report: ReadinessReport) {
  const readiness: ReadinessService = {
    check: () => Promise.resolve(report),
    markShuttingDown: () => undefined,
  };
  return createApp({ readiness });
}

const okReport: ReadinessReport = {
  status: 'ok',
  checks: { mongo: { status: 'up' }, redis: { status: 'up' } },
};

describe('GET /health/live', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(appWith(okReport)).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not advertise the framework', async () => {
    const res = await request(appWith(okReport)).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(appWith(okReport)).get('/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 with per-dependency status when everything is up', async () => {
    const res = await request(appWith(okReport)).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(okReport);
  });

  it('returns 200 when degraded (Redis down)', async () => {
    const report: ReadinessReport = {
      status: 'degraded',
      checks: { mongo: { status: 'up' }, redis: { status: 'down' } },
    };
    const res = await request(appWith(report)).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(report);
  });

  it('returns 503 when a critical dependency is down', async () => {
    const report: ReadinessReport = {
      status: 'error',
      checks: { mongo: { status: 'down' }, redis: { status: 'up' } },
    };
    const res = await request(appWith(report)).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual(report);
  });

  it('returns 503 while shutting down', async () => {
    const res = await request(appWith({ status: 'shutting_down', checks: {} })).get(
      '/health/ready',
    );
    expect(res.status).toBe(503);
  });
});
