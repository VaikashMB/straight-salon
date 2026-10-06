import { z } from '../../docs/zod.js';

export const LivenessSchema = z
  .object({ status: z.literal('ok') })
  .openapi('Liveness', { example: { status: 'ok' } });

const DependencyStatusSchema = z.object({ status: z.enum(['up', 'down']) });

export const ReadinessSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'error', 'shutting_down']).openapi({
      description:
        'ok: all up. degraded: a non-critical dependency (Redis) is down, still serving (HTTP 200). error: a critical dependency (MongoDB) is down (HTTP 503). shutting_down: draining (HTTP 503).',
    }),
    checks: z.record(z.string(), DependencyStatusSchema),
  })
  .openapi('Readiness');
