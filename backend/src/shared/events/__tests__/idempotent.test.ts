import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDomainEvent } from '../../../../test/factories/index.js';
import { captureLogger } from '../../../../test/helpers/logger.js';
import {
  idempotent,
  ProcessedEventModel,
  processedEventsRepository,
  type ProcessedEventsRepository,
} from '../idempotent.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeRepository(): ProcessedEventsRepository & { rows: Set<string> } {
  const rows = new Set<string>();
  return {
    rows,
    tryInsert: (consumer, eventId) => {
      const key = `${consumer}|${eventId}`;
      if (rows.has(key)) return Promise.resolve(false);
      rows.add(key);
      return Promise.resolve(true);
    },
    remove: (consumer, eventId) => {
      rows.delete(`${consumer}|${eventId}`);
      return Promise.resolve();
    },
  };
}

describe('idempotent consumer wrapper (09 §6)', () => {
  it('runs the handler once; a duplicate delivery is a no-op', async () => {
    const repository = fakeRepository();
    const handler = vi.fn(() => Promise.resolve());
    const wrapped = idempotent('stats', handler, { repository, logger: captureLogger().logger });
    const event = buildDomainEvent();

    await wrapped(event);
    await wrapped(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removes the marker when the handler fails, so the retry runs again', async () => {
    const repository = fakeRepository();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce(undefined);
    const wrapped = idempotent('notifications', handler, {
      repository,
      logger: captureLogger().logger,
    });
    const event = buildDomainEvent();

    await expect(wrapped(event)).rejects.toThrow('SMTP down');
    expect(repository.rows.size).toBe(0);
    await wrapped(event);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(repository.rows.size).toBe(1);
  });

  it('tracks each consumer separately', async () => {
    const repository = fakeRepository();
    const event = buildDomainEvent();
    const a = vi.fn(() => Promise.resolve());
    const b = vi.fn(() => Promise.resolve());
    await idempotent('stats', a, { repository, logger: captureLogger().logger })(event);
    await idempotent('ratings', b, { repository, logger: captureLogger().logger })(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('processedEventsRepository.tryInsert', () => {
  it('rethrows errors other than duplicate key', async () => {
    vi.spyOn(ProcessedEventModel, 'create').mockRejectedValueOnce(
      Object.assign(new Error('not primary'), { code: 10107 }),
    );
    await expect(processedEventsRepository.tryInsert('stats', 'e1', new Date())).rejects.toThrow(
      'not primary',
    );
  });
});
