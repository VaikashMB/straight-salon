import express, { type Express } from 'express';
import { createHealthController } from './modules/health/health.controller.js';
import { healthRouter } from './modules/health/health.routes.js';
import type { ReadinessService } from './modules/health/health.service.js';

// Infrastructure the app needs, injected so tests can use fakes (01-architecture §3.5).
export interface AppDeps {
  readiness: ReadinessService;
}

// Express app factory without listen(), so tests can drive it with Supertest.
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(healthRouter(createHealthController(deps.readiness)));
  return app;
}
