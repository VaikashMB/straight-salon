import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createMetrics, httpMetricsMiddleware, metricsHandler } from '../index.js';

describe('metrics', () => {
  it('records HTTP duration by route pattern and exposes Prometheus text', async () => {
    const metrics = createMetrics({ defaultMetrics: false });
    metrics.registerGauge('outbox_pending_events', 'Outbox events not yet published', () =>
      Promise.resolve(7),
    );
    metrics.cacheHits.inc({ prefix: 'catalog' });

    const app = express();
    app.use(httpMetricsMiddleware(metrics));
    app.get('/items/:id', (_req, res) => {
      res.send('ok');
    });
    app.get('/metrics', metricsHandler(metrics));

    await request(app).get('/items/123');
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/items\/:id",status="200"\} 1/,
    );
    expect(res.text).not.toContain('/items/123');
    expect(res.text).toContain('outbox_pending_events 7');
    expect(res.text).toContain('cache_hits_total{prefix="catalog"} 1');
  });

  it('includes default process metrics unless disabled', async () => {
    expect(await createMetrics().registry.metrics()).toContain('process_cpu_user_seconds_total');
    expect(await createMetrics({ defaultMetrics: false }).registry.metrics()).not.toContain(
      'process_cpu',
    );
  });
});
