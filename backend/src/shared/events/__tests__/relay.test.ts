import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { buildDomainEvent } from '../../../../test/factories/index.js';
import { captureLogger } from '../../../../test/helpers/logger.js';
import { createManualClock } from '../../time/clock.js';
import type { DomainEvent } from '../envelope.js';
import type { EventBus } from '../EventBus.js';
import { createInMemoryEventBus } from '../inMemoryEventBus.js';
import type { ClaimedEvent, OutboxRepository } from '../outbox.repository.js';
import { createOutboxRelay } from '../relay.js';

interface Row {
  id: Types.ObjectId;
  event: DomainEvent;
  status: 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  claimedAt?: Date;
  lastError?: string;
}

// In-memory OutboxRepository with the same state machine as the Mongo one.
function fakeRepository(events: DomainEvent[]) {
  const rows: Row[] = events.map((event) => ({
    id: new Types.ObjectId(),
    event,
    status: 'PENDING',
    attempts: 0,
  }));
  const repository: OutboxRepository = {
    insert: () => Promise.resolve(),
    findPendingIds: (limit) =>
      Promise.resolve(
        rows
          .filter((r) => r.status === 'PENDING')
          .slice(0, limit)
          .map((r) => r.id),
      ),
    claim: (id, now) => {
      const row = rows.find((r) => r.id.equals(id) && r.status === 'PENDING');
      if (!row) return Promise.resolve(null);
      row.status = 'PUBLISHING';
      row.claimedAt = now;
      return Promise.resolve<ClaimedEvent>({
        id: row.id,
        attempts: row.attempts,
        event: row.event,
      });
    },
    markPublished: (id) => {
      rows.find((r) => r.id.equals(id))!.status = 'PUBLISHED';
      return Promise.resolve();
    },
    markFailedAttempt: (id, error, giveUp) => {
      const row = rows.find((r) => r.id.equals(id))!;
      row.attempts++;
      row.lastError = error;
      row.status = giveUp ? 'FAILED' : 'PENDING';
      return Promise.resolve();
    },
    resetStaleClaims: (before) => {
      const stale = rows.filter((r) => r.status === 'PUBLISHING' && r.claimedAt! < before);
      stale.forEach((r) => (r.status = 'PENDING'));
      return Promise.resolve(stale.length);
    },
    countPending: () => Promise.resolve(rows.filter((r) => r.status === 'PENDING').length),
  };
  return { rows, repository };
}

function failingBus(failures: number): EventBus & { published: DomainEvent[] } {
  const inner = createInMemoryEventBus();
  let remaining = failures;
  return {
    ...inner,
    published: inner.published,
    publish: (event) =>
      remaining-- > 0 ? Promise.reject(new Error('Redis down')) : inner.publish(event),
  };
}

describe('outbox relay (09 §4)', () => {
  it('publishes pending events once, in order, and marks them published', async () => {
    const events = [buildDomainEvent(), buildDomainEvent()];
    const { rows, repository } = fakeRepository(events);
    const bus = createInMemoryEventBus();
    const relay = createOutboxRelay({ repository, bus, logger: captureLogger().logger });

    expect(await relay.runOnce()).toEqual({ published: 2, failed: 0, claimed: 2 });
    expect(bus.published.map((e) => e.eventId)).toEqual(events.map((e) => e.eventId));
    expect(rows.map((r) => r.status)).toEqual(['PUBLISHED', 'PUBLISHED']);

    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0, claimed: 0 });
    expect(bus.published).toHaveLength(2);
  });

  it('retries a failed publish on the next run', async () => {
    const { rows, repository } = fakeRepository([buildDomainEvent()]);
    const bus = failingBus(1);
    const { logger, lines } = captureLogger();
    const relay = createOutboxRelay({ repository, bus, logger });

    expect(await relay.runOnce()).toMatchObject({ failed: 1 });
    expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Redis down' });
    expect(
      lines().some((l) => l.level === 'warn' && l.msg === 'Outbox publish failed; will retry'),
    ).toBe(true);

    expect(await relay.runOnce()).toMatchObject({ published: 1 });
    expect(rows[0]?.status).toBe('PUBLISHED');
  });

  it('marks an event FAILED after maxAttempts and logs an error', async () => {
    const { rows, repository } = fakeRepository([buildDomainEvent()]);
    const { logger, lines } = captureLogger();
    const relay = createOutboxRelay({ repository, bus: failingBus(99), logger, maxAttempts: 3 });

    for (let i = 0; i < 5; i++) await relay.runOnce();

    expect(rows[0]).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(lines().filter((l) => l.level === 'error')).toHaveLength(1);
  });

  it('skips rows another relay claimed first', async () => {
    const { rows, repository } = fakeRepository([buildDomainEvent()]);
    const bus = createInMemoryEventBus();
    const relay = createOutboxRelay({ repository, bus, logger: captureLogger().logger });
    const ids = await repository.findPendingIds(10);
    await repository.claim(ids[0]!, new Date()); // the "other" relay
    vi.spyOn(repository, 'findPendingIds').mockResolvedValueOnce(ids);

    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0, claimed: 0 });
    expect(rows[0]?.status).toBe('PUBLISHING');
  });

  it('releases stale PUBLISHING claims older than staleClaimMs', async () => {
    const { rows, repository } = fakeRepository([buildDomainEvent()]);
    const clock = createManualClock('2026-10-06T09:00:00.000Z');
    await repository.claim(rows[0]!.id, clock.now()); // a relay crashed mid-publish
    const bus = createInMemoryEventBus();
    const relay = createOutboxRelay({
      repository,
      bus,
      clock,
      logger: captureLogger().logger,
      staleClaimMs: 60_000,
    });

    expect(await relay.runOnce()).toMatchObject({ published: 0 });
    clock.advance(61_000);
    expect(await relay.runOnce()).toMatchObject({ published: 1 });
    expect(rows[0]?.status).toBe('PUBLISHED');
  });

  it('runs in the background until stopped, and an insert wakes it before the next poll', async () => {
    const { rows, repository } = fakeRepository([buildDomainEvent()]);
    const bus = createInMemoryEventBus();
    let onInsert: (() => void) | undefined;
    const close = vi.fn(() => Promise.resolve());
    const relay = createOutboxRelay({
      repository,
      bus,
      logger: captureLogger().logger,
      intervalMs: 60_000, // without a wake-up, nothing else would be published during this test
      watchInserts: (cb) => {
        onInsert = cb;
        return { close };
      },
    });

    relay.start();
    relay.start(); // idempotent
    await vi.waitFor(() => expect(bus.published).toHaveLength(1));

    const later = buildDomainEvent();
    rows.push({ id: new Types.ObjectId(), event: later, status: 'PENDING', attempts: 0 });
    onInsert?.();
    await vi.waitFor(() => expect(bus.published.map((e) => e.eventId)).toContain(later.eventId));

    relay.wake(); // harmless while idle
    await relay.stop();
    expect(close).toHaveBeenCalled();
  });

  it('keeps going when an iteration throws, and when the change stream cannot start', async () => {
    const { repository } = fakeRepository([buildDomainEvent()]);
    const findPendingIds = vi
      .spyOn(repository, 'findPendingIds')
      .mockRejectedValueOnce(new Error('Mongo blip'));
    const { logger, lines } = captureLogger();
    const bus = createInMemoryEventBus();
    const relay = createOutboxRelay({
      repository,
      bus,
      logger,
      intervalMs: 5,
      watchInserts: () => {
        throw new Error('not a replica set');
      },
    });

    relay.start();
    await vi.waitFor(() => expect(bus.published).toHaveLength(1));
    await relay.stop();

    expect(findPendingIds.mock.calls.length).toBeGreaterThan(1);
    expect(lines().some((l) => l.msg === 'Outbox relay iteration failed')).toBe(true);
    expect(lines().some((l) => l.msg === 'Outbox change stream unavailable; polling only')).toBe(
      true,
    );
  });

  it('immediately runs another batch when a full batch was claimed', async () => {
    const { rows, repository } = fakeRepository([
      buildDomainEvent(),
      buildDomainEvent(),
      buildDomainEvent(),
    ]);
    const bus = createInMemoryEventBus();
    const relay = createOutboxRelay({
      repository,
      bus,
      logger: captureLogger().logger,
      batchSize: 2,
      intervalMs: 60_000,
    });
    relay.start();
    await vi.waitFor(() => expect(rows.every((r) => r.status === 'PUBLISHED')).toBe(true));
    await relay.stop();
  });
});
