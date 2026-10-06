import { createApp } from './app.js';
import { parseEnv, type Env } from './config/env.js';
import { createLogger } from './shared/logger/index.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadEnvOrExit(): Env {
  try {
    return parseEnv(process.env);
  } catch (err) {
    const bootLogger = createLogger({
      level: 'info',
      pretty: false,
      env: process.env.NODE_ENV ?? 'unknown',
      version: 'unknown',
      processName: 'api',
    });
    // The err serializer includes EnvValidationError.issues (path + message per variable).
    bootLogger.fatal({ err }, 'Invalid environment configuration; exiting');
    process.exit(1);
  }
}

const env = loadEnvOrExit();
const logger = createLogger({
  level: env.LOG_LEVEL,
  pretty: env.LOG_PRETTY,
  env: env.NODE_ENV,
  version: env.APP_VERSION,
  processName: 'api',
});

const server = createApp().listen(env.PORT, (err?: Error) => {
  if (err) {
    logger.fatal({ err }, 'API failed to start');
    process.exit(1);
  }
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'API listening');
});

// Phase 0 graceful shutdown: stop accepting connections, exit when drained or after 10 s.
// Phase 2 extends this to readiness, queues, Redis and Mongo (03-backend §7).
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error while closing HTTP server');
      process.exit(1);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
