import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REMINDER_SCAN_MS, scheduledJobs } from '../../src/jobs/definitions.js';
import { runScheduledJob } from '../../src/jobs/scheduler.js';
import { BookingModel } from '../../src/modules/bookings/bookings.model.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { OutboxModel, type OutboxStatus } from '../../src/shared/events/outbox.model.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import type { ManualClock } from '../../src/shared/time/clock.js';
import { buildDomainEvent, encryptionKey } from '../factories/index.js';
import {
  bookAs,
  frozenClock,
  local,
  salonScenario,
  type BookingBody,
  type Scenario,
} from '../helpers/booking.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';
import { captureLogger } from '../helpers/logger.js';
import { buildWorkerHarness } from '../helpers/worker.js';
import { buildApiTestApp } from '../setup/testApp.js';

// Scheduled jobs (09 §7) on a frozen clock: exactly the right bookings at the window
// boundaries (09 §9).

const TOMORROW = '2026-10-13';
const MINUTE = 60_000;

let app: Express;
let clock: ManualClock;
let s: Scenario;
let worker: ReturnType<typeof buildWorkerHarness>;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections();
  clock = frozenClock();
  const key = encryptionKey();
  const api = buildApiTestApp({ clock, modules: { outboxEncryptionKey: key } });
  app = api.app;
  worker = buildWorkerHarness({ clock, redis: api.redis, key });
  s = await salonScenario();
});

// Reception books on the customer's behalf (no BR-009 limit), so tests can hold many.
async function book(time: string, date?: string, staffId = s.ravi.staffId, service?: string) {
  const res = await bookAs(app, s.receptionist.header, {
    serviceIds: [service ?? s.haircut],
    staffId,
    startAt: local(time, date),
    customerId: s.customer.user._id.toHexString(),
  });
  expect(res.status).toBe(201);
  return res.body as BookingBody;
}

const reminderEvents = () =>
  OutboxModel.find({ type: 'booking.reminder_due' }).sort({ occurredAt: 1 }).lean();

describe('reminders-24h / reminders-2h (FR-051, 09 §7)', () => {
  it('queue exactly the bookings starting in (now+23h55m, now+24h], once', async () => {
    // 15-minute beard trims back to back, plus an earlier haircut with the other stylist.
    const early = await book('09:45', TOMORROW, s.arjun.staffId);
    const due = await book('10:00', TOMORROW, s.ravi.staffId, s.beard);
    const later = await book('10:15', TOMORROW, s.ravi.staffId, s.beard);

    clock.set(local('10:00')); // window (10:00 tomorrow - 5 min, 10:00 tomorrow]
    expect(await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS)).toBe(1);
    let events = await reminderEvents();
    expect(events.map((e) => e.aggregateId)).toEqual([due.id]);
    expect(events[0]).toMatchObject({
      actor: { id: 'system', role: 'SYSTEM' },
      payload: {
        bookingId: due.id,
        customerId: s.customer.user._id.toHexString(),
        startAt: due.startAt,
        window: '24h',
      },
    });
    const flagged = await BookingModel.findById(due.id).lean();
    expect(flagged!.reminders?.h24SentAt).toEqual(clock.now());

    // Next run: (10:00, 10:05] — the lower bound is exclusive and the flag guards repeats.
    clock.advance(REMINDER_SCAN_MS);
    expect(await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS)).toBe(0);
    clock.advance(2 * REMINDER_SCAN_MS); // (10:10, 10:15]
    expect(await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS)).toBe(1);
    events = await reminderEvents();
    expect(events.map((e) => e.aggregateId)).toEqual([due.id, later.id]);
    expect((await BookingModel.findById(early.id).lean())!.reminders?.h24SentAt).toBeUndefined();
  });

  it('a running job and a flagged booking are not queued twice', async () => {
    const due = await book('10:00', TOMORROW);
    clock.set(local('10:00'));
    const [a, b] = await Promise.all([
      worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS),
      worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS),
    ]);
    expect(a + b).toBe(1);
    expect((await reminderEvents()).map((e) => e.aggregateId)).toEqual([due.id]);
  });

  it('the 2-hour reminder uses its own window and flag', async () => {
    const due = await book('11:15');
    clock.set(local('09:15')); // (11:10, 11:15]
    expect(await worker.services.bookings.queueReminders('2h', REMINDER_SCAN_MS)).toBe(1);
    const flagged = await BookingModel.findById(due.id).lean();
    expect(flagged!.reminders).toEqual({ h2SentAt: clock.now() });
    expect((await reminderEvents())[0]!.payload).toMatchObject({ window: '2h' });
  });

  it('only BOOKED bookings get reminders', async () => {
    const cancelled = await book('11:15');
    await request(app)
      .post(`/api/v1/bookings/${cancelled.id}/cancel`)
      .set('Authorization', s.receptionist.header)
      .send({ override: true, reason: 'Customer called' })
      .expect(200);
    clock.set(local('09:15'));
    expect(await worker.services.bookings.queueReminders('2h', REMINDER_SCAN_MS)).toBe(0);
  });

  it('EVT-017 sends the reminder by email and SMS', async () => {
    await book('10:00', TOMORROW);
    clock.set(local('10:00'));
    await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS);
    await worker.drain();
    const reminders = (await worker.notifications()).filter(
      (n) => n.template === 'booking_reminder_24h',
    );
    expect(reminders.map((n) => n.channel)).toEqual(['EMAIL', 'SMS']);
    expect(worker.providers.emails.at(-1)!.subject).toBe(
      'Reminder: your appointment tomorrow, Tue 13 Oct 2026, 10:00',
    );
  });

  it('BR-015 rescheduling resets the reminders; the stale reminder is not sent', async () => {
    const due = await book('10:00', TOMORROW);
    clock.set(local('10:00'));
    await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS);

    await request(app)
      .post(`/api/v1/bookings/${due.id}/reschedule`)
      .set('Authorization', s.customer.header)
      .send({ startAt: local('12:00', TOMORROW) })
      .expect(200);
    expect((await BookingModel.findById(due.id).lean())!.reminders).toEqual({});

    await worker.drain();
    expect(
      (await worker.notifications()).filter((n) => n.template === 'booking_reminder_24h'),
    ).toEqual([]);

    // The new time gets its own reminder.
    clock.set(local('12:00'));
    expect(await worker.services.bookings.queueReminders('24h', REMINDER_SCAN_MS)).toBe(1);
  });
});

describe('auto-no-show (FR-042, 09 §7)', () => {
  it('marks BOOKED bookings once their start is more than noShowGraceMin ago', async () => {
    const overdue = await book('10:00');
    const onTime = await book('10:15', undefined, s.arjun.staffId);

    clock.set(local('10:30')); // exactly 30 minutes after 10:00: still within the grace period
    expect(await worker.services.bookings.markNoShows()).toBe(0);

    clock.advance(1);
    const { logger } = captureLogger();
    const [job] = scheduledJobs({
      bookings: worker.services.bookings,
      outbox: outboxRepository,
      reports: worker.services.reports,
      clock,
      logger,
    }).filter((j) => j.id === 'auto-no-show');
    expect(await runScheduledJob(job!, logger, 'run-1')).toEqual({ marked: 1 });

    const marked = await BookingModel.findById(overdue.id).lean();
    expect(marked!.status).toBe('NO_SHOW');
    expect(marked!.statusHistory.at(-1)).toMatchObject({ status: 'NO_SHOW', by: 'system' });
    expect((await BookingModel.findById(onTime.id).lean())!.status).toBe('BOOKED');

    // 07 §2.1: audited as the system actor; EVT-013 and EVT-015 in the same transaction.
    const audit = await AuditLogModel.findOne({
      entityId: overdue.id,
      action: 'booking.status_change',
    }).lean();
    expect(audit).toMatchObject({
      actor: { id: 'system', role: 'SYSTEM' },
      before: { status: 'BOOKED' },
      after: { status: 'NO_SHOW' },
      requestId: 'job-auto-no-show-run-1',
    });
    const events = await OutboxModel.find({ aggregateId: overdue.id, occurredAt: clock.now() })
      .sort({ _id: 1 })
      .lean();
    expect(events.map((e) => [e.type, e.actor.id, e.correlationId])).toEqual([
      ['booking.status_changed', 'system', 'job-auto-no-show-run-1'],
      ['booking.no_show', 'system', 'job-auto-no-show-run-1'],
    ]);

    expect(await worker.services.bookings.markNoShows()).toBe(0); // already done
    await worker.drain();
    expect(worker.providers.emails.map((m) => m.subject)).toContain('We missed you today');
  });

  it('leaves checked-in bookings alone and frees the no-show slot for availability', async () => {
    const arrived = await book('10:00');
    const missed = await book('10:00', undefined, s.arjun.staffId);
    clock.set(local('10:01'));
    await request(app)
      .post(`/api/v1/bookings/${arrived.id}/status`)
      .set('Authorization', s.receptionist.header)
      .send({ status: 'CHECKED_IN' })
      .expect(200);

    clock.set(local('10:31'));
    expect(await worker.services.bookings.markNoShows()).toBe(1);
    expect((await BookingModel.findById(arrived.id).lean())!.status).toBe('CHECKED_IN');
    expect((await BookingModel.findById(missed.id).lean())!.status).toBe('NO_SHOW');
  });
});

describe('outbox-cleanup (09 §7)', () => {
  it('removes FAILED events older than 30 days and keeps the rest', async () => {
    const at = (daysAgo: number) => new Date(clock.now().getTime() - daysAgo * 1440 * MINUTE);
    const insert = (status: OutboxStatus, daysAgo: number) =>
      OutboxModel.create({
        ...buildDomainEvent(),
        occurredAt: at(daysAgo),
        status,
        attempts: status === 'FAILED' ? 10 : 0,
      });
    const old = await insert('FAILED', 31);
    const recent = await insert('FAILED', 29);
    const pending = await insert('PENDING', 40);

    const { logger, lines } = captureLogger();
    const [job] = scheduledJobs({
      bookings: worker.services.bookings,
      outbox: outboxRepository,
      reports: worker.services.reports,
      clock,
      logger,
    }).filter((j) => j.id === 'outbox-cleanup');
    expect(await job!.run()).toEqual({ deleted: 1 });

    const left = (await OutboxModel.find().lean()).map((e) => e._id.toHexString());
    expect(left.sort()).toEqual([recent._id.toHexString(), pending._id.toHexString()].sort());
    expect(left).not.toContain(old._id.toHexString());
    expect(lines().find((l) => l.msg === 'Removing FAILED outbox events')).toMatchObject({
      byType: [{ type: 'booking.created', count: 1 }],
    });
  });
});
