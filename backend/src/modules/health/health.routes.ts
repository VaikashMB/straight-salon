import { Router } from 'express';
import { getLiveness } from './health.controller.js';

// Ops routes live outside /api/v1 (04-api-contract §3, Ops). /health/ready arrives in Phase 1.
export function healthRouter(): Router {
  const router = Router();
  router.get('/health/live', getLiveness);
  return router;
}
