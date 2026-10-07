import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { logConnectionErrors } from '../connectionErrors.js';

describe('queue connection errors (07 §1, 08 §1)', () => {
  it('logs one warning per minute per component instead of raw stderr output', () => {
    const { logger, lines } = captureLogger();
    const queue = new EventEmitter();
    const connection = new EventEmitter();
    let now = 0;
    logConnectionErrors(logger, 'queue-inspector', [queue, connection], { now: () => now });

    // With a listener attached, 'error' no longer throws.
    queue.emit('error', new Error('connect ECONNREFUSED'));
    connection.emit('error', new Error('connect ECONNREFUSED'));
    now = 59_999;
    queue.emit('error', new Error('connect ECONNREFUSED'));
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      level: 'warn',
      component: 'queue-inspector',
      msg: 'Queue connection error; retrying in the background',
    });

    now = 60_000;
    connection.emit('error', new Error('connect ECONNREFUSED'));
    expect(lines()).toHaveLength(2);
  });
});
