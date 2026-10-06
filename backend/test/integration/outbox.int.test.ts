import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditRepository } from '../../src/shared/audit/audit.repository.js';
import { idempotent, processedEventsRepository } from '../../src/shared/events/idempotent.js';
import { createInMemoryEventBus } from '../../src/shared/events/inMemoryEventBus.js';
import { createOutbox } from '../../src/shared/events/outbox.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import { createOutboxRelay } from '../../src/shared/events/relay.js';
import { watchOutboxInserts } from '../../src/shared/events/watchOutbox.js';
import { withTransaction } from '../../src/shared/db/withTransaction.js';
import { buildBookingCreatedPayload, buildDomainEvent, encryptionKey } from '../factories/index.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { captureLogger } from '../helpers/logger.js';

let connection: mongoose.Connection;
const outbox = createOutbox({ repository: outboxRepository, encryptionKey: encryptionKey() });

beforeAll(async () => {
  connection = await connectTestDb();
});
afterAll(disconnectTestDb);
beforeEach(clearCollections);

async function addEvent() {
  const payload = buildBookingCreatedPayload();
  return withTransaction(connection, (session) =>
    outbox.add(session, {
      type: 'booking.created',
      aggregateType: 'booking',
      aggregateId: payload.bookingId,
      payload,
    }),
  );
}

describe('outboxRepository against MongoDB', () => {
  it('stores the envelope and reads it back identically when claimed', async () => {
    const event = await addEvent();
    const [id] = await outboxRepository.findPendingIds(10);
    const claimed = await outboxRepository.claim(id!, new Date());
    expect(claimed?.event).toEqual(event);
    expect(claimed?.attempts).toBe(0);
  });

  it('round-trips an encrypted secret through MongoDB', async () => {
    const userId = buildBookingCreatedPayload().customerId;
    const event = await withTransaction(connection, (session) =>
      outbox.add(session, {
        type: 'user.password_reset_requested',
        aggregateType: 'user',
        aggregateId: userId,
        payload: { userId },
        secret: 'raw-token',
      }),
    );
    const [id] = await outboxRepository.findPendingIds(10);
    const claimed = await outboxRepository.claim(id!, new Date());
    expect(claimed?.event.secret).toEqual(event.secret);
    expect(JSON.stringify(await OutboxModel.findById(id).lean())).not.toContain('raw-token');
  });

  it('only one of two concurrent claims wins', async () => {
    await addEvent();
    const [id] = await outboxRepository.findPendingIds(10);
    const results = await Promise.all([
      outboxRepository.claim(id!, new Date()),
      outboxRepository.claim(id!, new Date()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('tracks failures, publication, stale claims and the pending count (operators work with sanitizeFilter)', async () => {
    await addEvent();
    await addEvent();
    expect(await outboxRepository.countPending()).toBe(2);
    const [a, b] = await outboxRepository.findPendingIds(10);

    await outboxRepository.claim(a!, new Date('2026-10-06T09:00:00Z'));
    // Cutoff = now - staleClaimMs: claims made before the cutoff are stale.
    expect(await outboxRepository.resetStaleClaims(new Date('2026-10-06T08:59:59Z'))).toBe(0);
    expect(await outboxRepository.resetStaleClaims(new Date('2026-10-06T09:00:01Z'))).toBe(1);

    await outboxRepository.claim(a!, new Date());
    await outboxRepository.markFailedAttempt(a!, 'x'.repeat(2000), false);
    await outboxRepository.claim(b!, new Date());
    await outboxRepository.markPublished(b!, new Date());

    const rows = await OutboxModel.find().sort({ occurredAt: 1 }).lean();
    const failed = rows.find((r) => r._id.equals(a));
    expect(failed).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(failed?.lastError).toHaveLength(1000);
    expect(rows.find((r) => r._id.equals(b))).toMatchObject({ status: 'PUBLISHED' });
    expect(await outboxRepository.countPending()).toBe(1);

    await outboxRepository.claim(a!, new Date());
    await outboxRepository.markFailedAttempt(a!, 'final', true);
    expect(await OutboxModel.findById(a).lean()).toMatchObject({ status: 'FAILED', attempts: 2 });
  });
});

describe('relay end to end with a change stream (09 §4)', () => {
  it('publishes a committed event promptly, exactly once', async () => {
    const bus = createInMemoryEventBus();
    const logger = captureLogger().logger;
    // Long poll interval: a quick publish proves the change stream woke the relay.
    const relay = createOutboxRelay({
      repository: outboxRepository,
      bus,
      logger,
      intervalMs: 30_000,
      watchInserts: watchOutboxInserts(logger),
    });
    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the first (empty) poll finish

    const event = await addEvent();
    await vi.waitFor(() => expect(bus.published.map((e) => e.eventId)).toEqual([event.eventId]), {
      timeout: 5_000,
    });
    await relay.stop();

    expect(await OutboxModel.findOne({ eventId: event.eventId }).lean()).toMatchObject({
      status: 'PUBLISHED',
    });
    expect(bus.published).toHaveLength(1);
  });
});

describe('processed_events (09 §6) against MongoDB', () => {
  it('detects duplicates per consumer and allows retry after removal', async () => {
    const event = buildDomainEvent();
    expect(await processedEventsRepository.tryInsert('stats', event.eventId, new Date())).toBe(
      true,
    );
    expect(await processedEventsRepository.tryInsert('stats', event.eventId, new Date())).toBe(
      false,
    );
    expect(await processedEventsRepository.tryInsert('ratings', event.eventId, new Date())).toBe(
      true,
    );
    await processedEventsRepository.remove('stats', event.eventId);
    expect(await processedEventsRepository.tryInsert('stats', event.eventId, new Date())).toBe(
      true,
    );
  });

  it('a duplicate delivery through the wrapper is a no-op', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const wrapped = idempotent('stats', handler, { logger: captureLogger().logger });
    const event = buildDomainEvent();
    await wrapped(event);
    await wrapped(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('auditRepository (07 §2.3)', () => {
  it('exposes only insert, find and count', () => {
    expect(Object.keys(auditRepository).sort()).toEqual(['count', 'find', 'insert']);
  });

  it('finds newest first with paging', async () => {
    await withTransaction(connection, async (session) => {
      for (const [i, action] of ['a.one', 'a.two', 'a.three'].entries()) {
        await auditRepository.insert(
          {
            at: new Date(Date.UTC(2026, 9, 6, 9, i)),
            actor: { id: 'u', role: 'ADMIN' },
            action,
            entityType: 'x',
            entityId: '1',
            before: null,
            after: { n: i },
            diff: ['n'],
          },
          session,
        );
      }
    });
    const page = await auditRepository.find({ entityType: 'x' }, { skip: 1, limit: 1 });
    expect(page.map((r) => r.action)).toEqual(['a.two']);
    expect(await auditRepository.count({ entityType: 'x' })).toBe(3);
  });
});
