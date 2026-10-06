import { hostname } from 'node:os';
import {
  pino,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';

// Phase 0 logger: base fields and JSON format from 07-logging §1.1.
// Phase 2 adds redaction, the requestContext mixin and pino-http.
export interface LoggerConfig {
  level: LevelWithSilent;
  pretty: boolean;
  env: string;
  version: string;
  processName: 'api' | 'worker' | 'relay';
}

export function buildLoggerOptions(config: LoggerConfig): LoggerOptions {
  const options: LoggerOptions = {
    level: config.level,
    base: {
      service: 'straight-salon-api',
      env: config.env,
      version: config.version,
      process: config.processName,
      pid: process.pid,
      hostname: hostname(),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  if (config.pretty) {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }
  return options;
}

export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  const options = buildLoggerOptions(config);
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
