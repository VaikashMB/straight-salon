import { Writable } from 'node:stream';
import { createLogger, type Logger } from '../../src/shared/logger/index.js';

export interface CapturedLogger {
  logger: Logger;
  lines: () => Record<string, unknown>[];
}

// A real pino logger that writes JSON lines into memory, so tests can assert on log output.
export function captureLogger(level: 'debug' | 'info' = 'debug'): CapturedLogger {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger(
    { level, pretty: false, env: 'test', version: 'test', processName: 'api' },
    stream,
  );
  const lines = () =>
    chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines };
}
