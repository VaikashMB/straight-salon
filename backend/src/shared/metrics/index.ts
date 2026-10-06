import type { RequestHandler } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { routePattern } from '../http/routePattern.js';

// Prometheus metrics (01 §6, 03 §6, 08 §6). One registry per process (and per test), exposed
// at /metrics when METRICS_ENABLED. Not scraped in v1.
export interface Metrics {
  registry: Registry;
  httpRequestDuration: Histogram<'method' | 'route' | 'status'>;
  cacheHits: Counter<'prefix'>;
  cacheMisses: Counter<'prefix'>;
  cacheErrors: Counter;
  // Gauge whose value is read at scrape time (e.g. outbox pending count).
  registerGauge(name: string, help: string, read: () => Promise<number> | number): void;
}

export function createMetrics(options: { defaultMetrics?: boolean } = {}): Metrics {
  const registry = new Registry();
  if (options.defaultMetrics ?? true) {
    collectDefaultMetrics({ register: registry });
  }

  return {
    registry,
    httpRequestDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration by route pattern and status',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    cacheHits: new Counter({
      name: 'cache_hits_total',
      help: 'Cache hits by key prefix',
      labelNames: ['prefix'],
      registers: [registry],
    }),
    cacheMisses: new Counter({
      name: 'cache_misses_total',
      help: 'Cache misses by key prefix',
      labelNames: ['prefix'],
      registers: [registry],
    }),
    cacheErrors: new Counter({
      name: 'cache_errors_total',
      help: 'Cache operations that failed because Redis was unavailable',
      registers: [registry],
    }),
    registerGauge(name, help, read) {
      new Gauge({
        name,
        help,
        registers: [registry],
        async collect() {
          this.set(await read());
        },
      });
    },
  };
}

export function httpMetricsMiddleware(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const stop = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      stop({ method: req.method, route: routePattern(req), status: String(res.statusCode) });
    });
    next();
  };
}

export function metricsHandler(metrics: Metrics): RequestHandler {
  return async (_req, res) => {
    res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  };
}
