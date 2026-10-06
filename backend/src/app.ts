import express, { type Express } from 'express';
import { healthRouter } from './modules/health/health.routes.js';

// Express app factory without listen(), so tests can drive it with Supertest.
// Phase 2 turns this into createApp(deps) with injected infra clients (01-architecture §3.5).
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(healthRouter());
  return app;
}
