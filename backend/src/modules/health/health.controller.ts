import type { Request, Response } from 'express';
import type { ReadinessService } from './health.service.js';

export interface HealthController {
  live(req: Request, res: Response): void;
  ready(req: Request, res: Response): Promise<void>;
}

export function createHealthController(readiness: ReadinessService): HealthController {
  return {
    // GET /health/live — process is up; no dependency checks (03-backend §6).
    live(_req, res) {
      res.status(200).json({ status: 'ok' });
    },

    // GET /health/ready — 503 when a critical dependency is down or the process is draining.
    async ready(_req, res) {
      const report = await readiness.check();
      const notReady = report.status === 'error' || report.status === 'shutting_down';
      res.status(notReady ? 503 : 200).json(report);
    },
  };
}
