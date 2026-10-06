import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { runWithContext } from '../../http/requestContext.js';
import { buildLoggerOptions, createLogger, type LoggerConfig } from '../index.js';

const config: LoggerConfig = {
  level: 'info',
  pretty: false,
  env: 'test',
  version: '1.0.0',
  processName: 'api',
};

describe('createLogger', () => {
  it('writes one JSON line with the base fields from 07-logging §1.1', () => {
    const { logger, lines } = captureLogger('info');
    logger.info({ bookingId: 'b1' }, 'Booking created');

    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      service: 'straight-salon-api',
      env: 'test',
      process: 'api',
      msg: 'Booking created',
      bookingId: 'b1',
    });
    expect(Number.isNaN(Date.parse(String(line?.time)))).toBe(false);
  });

  it('respects the configured level', () => {
    const { logger, lines } = captureLogger('info');
    logger.debug('dropped');
    logger.warn('kept');
    expect(lines().map((l) => l.msg)).toEqual(['kept']);
  });

  it('injects requestId, userId, role and job fields from the request context', () => {
    const { logger, lines } = captureLogger('info');
    runWithContext(
      {
        requestId: 'r-1',
        userId: 'u-1',
        role: 'STAFF',
        jobId: 'j-1',
        queue: 'stats',
        eventType: 'booking.created',
      },
      () => {
        logger.info('inside');
      },
    );
    logger.info('outside');
    const [inside, outside] = lines();
    expect(inside).toMatchObject({
      requestId: 'r-1',
      userId: 'u-1',
      role: 'STAFF',
      jobId: 'j-1',
      queue: 'stats',
      eventType: 'booking.created',
    });
    expect(outside).not.toHaveProperty('requestId');
  });

  it('creates a stdout logger when no destination is given', () => {
    expect(createLogger({ ...config, level: 'silent' }).level).toBe('silent');
  });
});

describe('redaction (07 §1.4): secrets and PII never reach the output', () => {
  it('redacts every mandatory path', () => {
    const { logger, lines } = captureLogger('info');
    const secrets = {
      password: 'p@ss-1',
      newPassword: 'p@ss-2',
      currentPassword: 'p@ss-3',
      passwordHash: '$2b$12$hash',
      token: 'tok-1',
      accessToken: 'eyJ.access',
      refreshToken: 'opaque-refresh',
      secret: 'reset-secret',
      email: 'ananya@example.com',
      phone: '+919876543212',
    };
    logger.info(
      {
        ...secrets,
        user: { ...secrets },
        req: { headers: { authorization: 'Bearer eyJ.header', cookie: 'ss_rt=opaque-cookie' } },
        res: { headers: { 'set-cookie': 'ss_rt=new-cookie' } },
      },
      'sensitive',
    );
    const output = JSON.stringify(lines());
    for (const value of [...Object.values(secrets), 'eyJ.header', 'opaque-cookie', 'new-cookie']) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain('[REDACTED]');
  });
});

describe('buildLoggerOptions', () => {
  it('uses plain JSON output unless pretty printing is requested', () => {
    expect(buildLoggerOptions(config).transport).toBeUndefined();
  });

  it('routes through pino-pretty when pretty is true', () => {
    expect(buildLoggerOptions({ ...config, pretty: true }).transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true },
    });
  });
});
