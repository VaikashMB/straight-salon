import { Router } from 'express';
import type { HealthController } from './health.controller.js';

// Ops routes live outside /api/v1 (04-api-contract §3, Ops).
export function healthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/health/live', (req, res) => controller.live(req, res));
  router.get('/health/ready', (req, res) => controller.ready(req, res));
  return router;
}
