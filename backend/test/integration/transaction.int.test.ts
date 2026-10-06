import mongoose, { Schema, Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditRepository } from '../../src/shared/audit/audit.repository.js';
import { createAuditService } from '../../src/shared/audit/audit.service.js';
import { AuditLogModel } from '../../src/shared/audit/auditLog.model.js';
import { bumpStaffDayGuards, StaffDayGuardModel } from '../../src/shared/db/staffDayGuard.js';
import { withTransaction } from '../../src/shared/db/withTransaction.js';
import { createOutbox } from '../../src/shared/events/outbox.js';
import { OutboxModel } from '../../src/shared/events/outbox.model.js';
import { outboxRepository } from '../../src/shared/events/outbox.repository.js';
import { runWithContext } from '../../src/shared/http/requestContext.js';
import { buildBookingCreatedPayload, encryptionKey } from '../factories/index.js';
import { clearCollections, connectTestDb, disconnectTestDb } from '../helpers/db.js';

// A stand-in "bookings" collection: the real model arrives in Phase 5. Enough to prove the
// cross-cutting guarantees the booking service will rely on.
interface ProbeBooking {
  staffId: Types.ObjectId;
  startAt: Date;
  blockedUntil: Date;
}
const ProbeBookingModel =
  (mongoose.models.ProbeBooking as mongoose.Model<ProbeBooking> | undefined) ??
  mongoose.model<ProbeBooking>(
    'ProbeBooking',
    new Schema<ProbeBooking>(
      { staffId: Schema.Types.ObjectId, startAt: Date, blockedUntil: Date },
      { collection: 'probe_bookings' },
    ),
  );

let connection: mongoose.Connection;
const audit = createAuditService({ repository: auditRepository });
const outbox = createOutbox({ repository: outboxRepository, encryptionKey: encryptionKey() });

beforeAll(async () => {
  connection = await connectTestDb();
  await ProbeBookingModel.init();
});
afterAll(disconnectTestDb);
beforeEach(clearCollections);

describe('withTransaction: change + audit + outbox commit or roll back together (07 §2.4, 09 §9)', () => {
  async function createBooking(failAfterWrites: boolean) {
    const payload = buildBookingCreatedPayload();
    await runWithContext(
      { requestId: 'req-tx', userId: payload.customerId, role: 'CUSTOMER' },
      () =>
        withTransaction(connection, async (session) => {
          await ProbeBookingModel.create(
            [
              {
                staffId: payload.staffId,
                startAt: new Date(payload.startAt),
                blockedUntil: new Date(payload.endAt),
              },
            ],
            { session },
          );
          await audit.record(
            {
              action: 'booking.create',
              entityType: 'booking',
              entityId: payload.bookingId,
              before: null,
              after: { status: 'BOOKED' },
            },
            session,
          );
          await outbox.add(session, {
            type: 'booking.created',
            aggregateType: 'booking',
            aggregateId: payload.bookingId,
            payload,
          });
          if (failAfterWrites) throw new Error('business rule failed after the writes');
        }),
    );
  }

  it('commits all three writes', async () => {
    await createBooking(false);
    expect(await ProbeBookingModel.countDocuments()).toBe(1);
    expect(await AuditLogModel.countDocuments()).toBe(1);
    expect(await OutboxModel.countDocuments({ status: 'PENDING' })).toBe(1);
    const row = await AuditLogModel.findOne().lean();
    expect(row).toMatchObject({
      action: 'booking.create',
      requestId: 'req-tx',
      actor: { role: 'CUSTOMER' },
    });
  });

  it('leaves no booking, audit row or outbox event when the transaction aborts', async () => {
    await expect(createBooking(true)).rejects.toThrow('business rule failed');
    expect(await ProbeBookingModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(0);
    expect(await OutboxModel.countDocuments()).toBe(0);
  });

  it('returns the work result', async () => {
    await expect(withTransaction(connection, () => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('staff-day guard: BR-004 holds under concurrency without any Redis lock (02 §2.18)', () => {
  // The booking algorithm (03 §5.1 step 4) without the lock: guard, overlap check, insert.
  function tryBook(
    staffId: Types.ObjectId,
    startAt: Date,
    blockedUntil: Date,
    useGuard: boolean,
  ): Promise<'booked' | 'conflict'> {
    return withTransaction(connection, async (session) => {
      if (useGuard) await bumpStaffDayGuards(session, [{ staffId, date: '2026-10-12' }]);
      const overlap = await ProbeBookingModel.exists({
        staffId,
        startAt: mongoose.trusted({ $lt: blockedUntil }),
        blockedUntil: mongoose.trusted({ $gt: startAt }),
      }).session(session);
      if (overlap) return 'conflict';
      // Widen the race window so concurrent transactions really interleave.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await ProbeBookingModel.create([{ staffId, startAt, blockedUntil }], { session });
      return 'booked';
    });
  }

  const slot = {
    startAt: new Date('2026-10-12T05:30:00Z'),
    blockedUntil: new Date('2026-10-12T06:30:00Z'),
  };

  it('10 concurrent bookings for the same stylist and slot -> exactly 1 succeeds', async () => {
    const staffId = new Types.ObjectId();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => tryBook(staffId, slot.startAt, slot.blockedUntil, true)),
    );
    expect(results.filter((r) => r === 'booked')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict')).toHaveLength(9);
    expect(await ProbeBookingModel.countDocuments({ staffId })).toBe(1);
    const guard = await StaffDayGuardModel.findOne({ staffId }).lean();
    expect(guard?.seq).toBe(10); // every transaction (including retried losers) committed its bump
  });

  it('control: without the guard the same race double-books (the write skew the guard prevents)', async () => {
    const staffId = new Types.ObjectId();
    await Promise.all(
      Array.from({ length: 10 }, () => tryBook(staffId, slot.startAt, slot.blockedUntil, false)),
    );
    expect(await ProbeBookingModel.countDocuments({ staffId })).toBeGreaterThan(1);
  });

  it('different stylists do not block each other', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        tryBook(new Types.ObjectId(), slot.startAt, slot.blockedUntil, true),
      ),
    );
    expect(results).toEqual(Array(5).fill('booked'));
  });

  it('bumps each stylist/day once even if listed twice', async () => {
    const staffId = new Types.ObjectId();
    await withTransaction(connection, (session) =>
      bumpStaffDayGuards(session, [
        { staffId, date: '2026-10-12' },
        { staffId: staffId.toHexString(), date: '2026-10-12' },
        { staffId, date: '2026-10-13' },
      ]),
    );
    const guards = await StaffDayGuardModel.find({ staffId }).sort({ date: 1 }).lean();
    expect(guards.map((g) => [g.date, g.seq])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-13', 1],
    ]);
  });
});
