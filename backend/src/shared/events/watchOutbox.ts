import type { Logger } from '../logger/index.js';
import { OutboxModel } from './outbox.model.js';

// Wakes the relay as soon as a row is inserted (09 §4). Change streams need a replica set,
// which every environment runs. On error the relay keeps polling, so this is only a speed-up.
export function watchOutboxInserts(logger: Logger) {
  return (onInsert: () => void) => {
    const stream = OutboxModel.watch([{ $match: { operationType: 'insert' } }]);
    stream.on('change', onInsert);
    stream.on('error', (err: unknown) => {
      logger.warn({ err }, 'Outbox change stream error; relay continues by polling');
    });
    return { close: () => stream.close() };
  };
}
