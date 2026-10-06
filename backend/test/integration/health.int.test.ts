import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

describe('GET /health/live', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(createApp()).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not advertise the framework', async () => {
    const res = await request(createApp()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
