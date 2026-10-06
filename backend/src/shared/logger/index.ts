import { hostname } from 'node:os';
import {
  pino,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';
import { getRequestContext } from '../http/requestContext.js';

// JSON logs per 07-logging §1: base fields on every line, request/job context injected by a
// mixin from AsyncLocalStorage, and mandatory redaction of secrets and PII (§1.4).
export interface LoggerConfig {
  level: LevelWithSilent;
  pretty: boolean;
  env: string;
  version: string;
  processName: 'api' | 'worker' | 'relay';
}

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.email',
  '*.phone',
  // The same keys at the top level of a log call, e.g. logger.info({ email }, '...').
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'email',
  'phone',
];

export function contextFields(): Record<string, string> {
  const ctx = getRequestContext();
  if (!ctx) return {};
  const fields: Record<string, string> = { requestId: ctx.requestId };
  if (ctx.userId) fields.userId = ctx.userId;
  if (ctx.role) fields.role = ctx.role;
  if (ctx.jobId) fields.jobId = ctx.jobId;
  if (ctx.queue) fields.queue = ctx.queue;
  if (ctx.eventType) fields.eventType = ctx.eventType;
  return fields;
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
    mixin: contextFields,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
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
