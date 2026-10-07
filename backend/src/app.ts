import compression from 'compression';
import cors from 'cors';
import express, { json, static as serveStatic, type Express, type Router } from 'express';
import helmet from 'helmet';
import { docsRouter, generateOpenApiDocument } from './docs/openapi.js';
import { createHealthController } from './modules/health/health.controller.js';
import { healthRouter } from './modules/health/health.routes.js';
import type { ReadinessService } from './modules/health/health.service.js';
import { createErrorHandler, notFoundHandler } from './shared/errors/index.js';
import { accessLog } from './shared/http/accessLog.js';
import { requestContextMiddleware } from './shared/http/requestContext.js';
import type { Logger } from './shared/logger/index.js';
import { httpMetricsMiddleware, metricsHandler, type Metrics } from './shared/metrics/index.js';

export const API_BASE_PATH = '/api/v1';
export const UPLOADS_PATH = '/uploads';
const JSON_BODY_LIMIT = '100kb';

export interface AppConfig {
  version: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  metricsEnabled: boolean;
  // Local ObjectStorage directory, served read-only at /uploads (API-027). Omit to not serve.
  uploadsDir?: string;
}

// Infrastructure the app needs, injected so tests can use fakes (01-architecture §3.5).
export interface AppDeps {
  logger: Logger;
  readiness: ReadinessService;
  metrics: Metrics;
  config: AppConfig;
  // Business modules, mounted at /api/v1 (built by modules/index.ts buildApiRouter).
  apiRouter: Router;
  // Bull Board at /admin/queues with its own guard (09 §5); omitted when disabled.
  queuesBoard?: Router;
}

// Express app factory without listen(), so tests can drive it with Supertest.
// Middleware order follows 01-architecture §5.
export function createApp(deps: AppDeps): Express {
  const { logger, metrics, config } = deps;
  const app = express();
  app.disable('x-powered-by');
  // One proxy hop: the Next.js /api proxy (05 §5), so req.ip is the browser's address.
  app.set('trust proxy', 1);

  app.use(requestContextMiddleware);
  app.use(accessLog(logger));
  if (config.metricsEnabled) app.use(httpMetricsMiddleware(metrics));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(compression());
  app.use(json({ limit: JSON_BODY_LIMIT }));

  // Ops endpoints, outside /api/v1.
  app.use(healthRouter(createHealthController(deps.readiness)));
  if (config.metricsEnabled) app.get('/metrics', metricsHandler(metrics));
  if (config.swaggerEnabled) app.use(docsRouter(generateOpenApiDocument(config.version)));
  if (config.uploadsDir) app.use(UPLOADS_PATH, uploadsStatic(config.uploadsDir));
  if (deps.queuesBoard) app.use(deps.queuesBoard);

  app.use(API_BASE_PATH, deps.apiRouter);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

// Uploaded images (local ObjectStorage adapter). The frontend origin embeds them, so the
// resource policy is relaxed from helmet's same-origin; files are inert (nosniff, own names,
// re-encoded images only). Misses fall through to the problem+json 404.
function uploadsStatic(dir: string) {
  return serveStatic(dir, {
    index: false,
    dotfiles: 'deny',
    redirect: false,
    maxAge: '7d',
    immutable: true, // random names: content never changes
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
