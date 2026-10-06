import type { Request, Response } from 'express';

// GET /health/live — process is up; no dependency checks (03-backend §6).
export function getLiveness(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok' });
}
