import { createApp, type AppConfig } from '../../src/app.js';
import type { ReadinessReport, ReadinessService } from '../../src/modules/health/health.service.js';
import { createMetrics } from '../../src/shared/metrics/index.js';
import { captureLogger } from '../helpers/logger.js';

// Builds the real app with test dependencies (10-testing §3).
export function buildTestApp(
  overrides: { config?: Partial<AppConfig>; readiness?: ReadinessService } = {},
) {
  const { logger, lines } = captureLogger();
  const metrics = createMetrics({ defaultMetrics: false });
  const readiness: ReadinessService = overrides.readiness ?? {
    check: () =>
      Promise.resolve<ReadinessReport>({
        status: 'ok',
        checks: { mongo: { status: 'up' }, redis: { status: 'up' } },
      }),
    markShuttingDown: () => undefined,
  };
  const app = createApp({
    logger,
    readiness,
    metrics,
    config: {
      version: '0.0.0-test',
      corsOrigins: ['http://localhost:3000'],
      swaggerEnabled: true,
      metricsEnabled: true,
      ...overrides.config,
    },
  });
  return { app, logs: lines, metrics };
}
