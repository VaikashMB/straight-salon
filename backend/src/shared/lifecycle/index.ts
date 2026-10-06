import { parseEnv, type Env } from '../../config/env.js';
import { createLogger, type Logger, type LoggerConfig } from '../logger/index.js';

// Process bootstrap and graceful shutdown shared by the api, worker and relay entrypoints.

type ProcessName = LoggerConfig['processName'];
type Exit = (code: number) => void;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

// Parses the environment; on failure logs a fatal line (with every invalid variable) and exits.
export function loadEnvOrExit(
  processName: ProcessName,
  source: NodeJS.ProcessEnv = process.env,
  exit: Exit = (code) => process.exit(code),
): Env | undefined {
  try {
    return parseEnv(source);
  } catch (err) {
    const bootLogger = createLogger({
      level: 'info',
      pretty: false,
      env: source.NODE_ENV ?? 'unknown',
      version: 'unknown',
      processName,
    });
    // The err serializer includes EnvValidationError.issues (path + message per variable).
    bootLogger.fatal({ err }, 'Invalid environment configuration; exiting');
    exit(1);
    return undefined;
  }
}

export function createProcessLogger(env: Env, processName: ProcessName): Logger {
  return createLogger({
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
    env: env.NODE_ENV,
    version: env.APP_VERSION,
    processName,
  });
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export interface SignalSource {
  once(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
}

export interface ShutdownOptions {
  timeoutMs?: number;
  signals?: SignalSource;
  exit?: Exit;
}

// On SIGTERM/SIGINT runs the steps in order (03-backend §7), then exits 0. A failing step is
// logged and the remaining steps still run (exit code 1). The whole sequence is capped by a
// timeout so a hung dependency cannot block a rolling deploy.
export function registerShutdown(
  logger: Logger,
  steps: ShutdownStep[],
  {
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    signals = process,
    exit = (code) => process.exit(code),
  }: ShutdownOptions = {},
): void {
  let started = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (started) return;
    started = true;
    logger.info({ signal }, 'Shutting down');

    setTimeout(() => {
      logger.error({ timeoutMs }, 'Forced shutdown after timeout');
      exit(1);
    }, timeoutMs).unref();

    let failed = false;
    for (const step of steps) {
      try {
        await step.run();
        logger.debug({ step: step.name }, 'Shutdown step complete');
      } catch (err) {
        failed = true;
        logger.error({ err, step: step.name }, 'Shutdown step failed');
      }
    }
    logger.info('Shutdown complete');
    exit(failed ? 1 : 0);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    signals.once(signal, (received) => void shutdown(received));
  }
}
