import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildLoggerOptions, createLogger, type LoggerConfig } from '../index.js';

const config: LoggerConfig = {
  level: 'info',
  pretty: false,
  env: 'test',
  version: '1.0.0',
  processName: 'api',
};

function captureLines(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const lines = () =>
    chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stream, lines };
}

describe('createLogger', () => {
  it('writes one JSON line with the base fields from 07-logging §1.1', () => {
    const { stream, lines } = captureLines();
    createLogger(config, stream).info({ bookingId: 'b1' }, 'Booking created');

    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      service: 'straight-salon-api',
      env: 'test',
      version: '1.0.0',
      process: 'api',
      msg: 'Booking created',
      bookingId: 'b1',
    });
    expect(typeof line?.time).toBe('string');
    expect(Number.isNaN(Date.parse(String(line?.time)))).toBe(false);
  });

  it('respects the configured level', () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ ...config, level: 'warn' }, stream);
    logger.info('dropped');
    logger.warn('kept');
    expect(lines().map((l) => l.msg)).toEqual(['kept']);
  });

  it('creates a stdout logger when no destination is given', () => {
    expect(createLogger({ ...config, level: 'silent' }).level).toBe('silent');
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
