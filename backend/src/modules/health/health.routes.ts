import { Router } from 'express';
import { registry } from '../../docs/registry.js';
import type { HealthController } from './health.controller.js';
import { LivenessSchema, ReadinessSchema } from './health.schemas.js';

// Ops routes live outside /api/v1 (04-api-contract §3, Ops).
registry.registerPath({
  method: 'get',
  path: '/health/live',
  tags: ['Ops'],
  summary: 'Liveness probe',
  description: 'The process is up. No dependency checks (03-backend §6).',
  security: [],
  responses: {
    200: {
      description: 'Process is alive',
      content: { 'application/json': { schema: LivenessSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/ready',
  tags: ['Ops'],
  summary: 'Readiness probe',
  description:
    'Pings MongoDB (critical) and Redis (non-critical). Returns 503 if MongoDB is down or the process is shutting down; Redis down only degrades the status (03-backend §6).',
  security: [],
  responses: {
    200: {
      description: 'Ready (status ok or degraded)',
      content: {
        'application/json': {
          schema: ReadinessSchema,
          examples: {
            ok: {
              value: { status: 'ok', checks: { mongo: { status: 'up' }, redis: { status: 'up' } } },
            },
            degraded: {
              value: {
                status: 'degraded',
                checks: { mongo: { status: 'up' }, redis: { status: 'down' } },
              },
            },
          },
        },
      },
    },
    503: {
      description: 'Not ready (MongoDB down or shutting down)',
      content: {
        'application/json': {
          schema: ReadinessSchema,
          example: {
            status: 'error',
            checks: { mongo: { status: 'down' }, redis: { status: 'up' } },
          },
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['Ops'],
  summary: 'Prometheus metrics',
  description: 'Exposed when METRICS_ENABLED=true (03-backend §6).',
  security: [],
  responses: {
    200: {
      description: 'Prometheus text exposition format',
      content: {
        'text/plain': {
          schema: { type: 'string', example: 'http_request_duration_seconds_bucket{...} 3' },
        },
      },
    },
  },
});

export function healthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/health/live', (req, res) => controller.live(req, res));
  router.get('/health/ready', (req, res) => controller.ready(req, res));
  return router;
}
