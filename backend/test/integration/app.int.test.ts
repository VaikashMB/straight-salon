import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../setup/testApp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('request lifecycle (01 §5)', () => {
  it('every response carries X-Request-Id (04 §1), echoed or generated', async () => {
    const { app } = buildTestApp();
    expect(
      (await request(app).get('/health/live').set('X-Request-Id', 'abc-1')).headers['x-request-id'],
    ).toBe('abc-1');
    expect((await request(app).get('/nope')).headers['x-request-id']).toMatch(UUID);
  });

  it('sets security headers and hides the framework (06 §4)', async () => {
    const res = await request(buildTestApp().app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('allows only allow-listed origins, with credentials (06 §4 CORS)', async () => {
    const { app } = buildTestApp();
    const allowed = await request(app).get('/health/live').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app).get('/health/live').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes, including under /api/v1, with a 404 problem', async () => {
    const res = await request(buildTestApp().app)
      .get('/api/v1/bookings')
      .set('X-Request-Id', 'r-404');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(JSON.parse(res.text)).toMatchObject({
      code: 'NOT_FOUND',
      instance: '/api/v1/bookings',
      requestId: 'r-404',
    });
  });

  it('turns malformed JSON into a 400 problem and oversized bodies into 413', async () => {
    const { app } = buildTestApp();
    const bad = await request(app)
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text)).toMatchObject({ code: 'VALIDATION_FAILED' });
    const big = await request(app)
      .post('/api/v1/anything')
      .send({ blob: 'x'.repeat(101 * 1024) });
    expect(big.status).toBe(413);
    expect(JSON.parse(big.text)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('writes one access-log line per request with the request id', async () => {
    const { app, logs } = buildTestApp();
    await request(app).get('/api/v1/nothing').set('X-Request-Id', 'r-log');
    const line = logs().find((l) => l.msg === 'Request completed');
    expect(line).toMatchObject({
      requestId: 'r-log',
      route: 'unmatched',
      status: 404,
      level: 'info',
    });
  });
});

describe('ops endpoints', () => {
  it('serves Swagger UI and the raw OpenAPI document (03 §6)', async () => {
    const { app } = buildTestApp();
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const initScript = await request(app).get('/api/docs/swagger-ui-init.js');
    expect(initScript.status).toBe(200);
    expect(initScript.text).toContain('/health/ready');

    const doc = await request(app).get('/api/docs/openapi.json');
    expect(doc.status).toBe(200);
    const body = doc.body as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining(['/health/live', '/health/ready', '/metrics']),
    );
  });

  it('serves Prometheus metrics, labelled by route pattern', async () => {
    const { app } = buildTestApp();
    await request(app).get('/health/live');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/health/live",status="200"} 1',
    );
  });

  it('hides Swagger and metrics when disabled', async () => {
    const { app } = buildTestApp({ config: { swaggerEnabled: false, metricsEnabled: false } });
    expect((await request(app).get('/api/docs/')).status).toBe(404);
    expect((await request(app).get('/api/docs/openapi.json')).status).toBe(404);
    expect((await request(app).get('/metrics')).status).toBe(404);
  });
});
