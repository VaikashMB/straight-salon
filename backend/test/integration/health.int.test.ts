import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ReadinessReport } from '../../src/modules/health/health.service.js';
import { buildTestApp } from '../setup/testApp.js';

function appWith(report: ReadinessReport) {
  return buildTestApp({
    readiness: { check: () => Promise.resolve(report), markShuttingDown: () => undefined },
  }).app;
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
});

describe('GET /health/ready (03 §6)', () => {
  it.each<[ReadinessReport, number]>([
    [okReport, 200],
    [{ status: 'degraded', checks: { mongo: { status: 'up' }, redis: { status: 'down' } } }, 200],
    [{ status: 'error', checks: { mongo: { status: 'down' }, redis: { status: 'up' } } }, 503],
    [{ status: 'shutting_down', checks: {} }, 503],
  ])('%o -> %i', async (report, status) => {
    const res = await request(appWith(report)).get('/health/ready');
    expect(res.status).toBe(status);
    expect(res.body).toEqual(report);
  });
});
