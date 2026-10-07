import { Types, type Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import type { Clock } from '../../shared/time/clock.js';
import type { BookingDto } from '../bookings/bookings.schemas.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { RecordPaymentBody } from './payments.schemas.js';

// Recording payments on bookings (FR-043, BR-011). Payment is collected at the counter; this
// only records it. Goes through the bookings service, never its repository (01 §3).

export interface PaymentsService {
  record(bookingId: string, body: RecordPaymentBody, viewer: AuthContext): Promise<BookingDto>;
}

export interface PaymentsServiceDeps {
  bookings: Pick<BookingsService, 'findById' | 'setPayment' | 'toDto'>;
  audit: AuditService;
  outbox: Outbox;
  connection: Connection;
  clock: Clock;
}

export function createPaymentsService(deps: PaymentsServiceDeps): PaymentsService {
  const { bookings, audit, outbox, connection, clock } = deps;
  return {
    async record(bookingId, body, viewer) {
      const booking = await bookings.findById(bookingId);
      if (!booking) throw new NotFoundError('Booking not found.');
      // Decision 2026-10-07: one payment per booking; same-key retries replay via Idempotency-Key.
      if (booking.payment.status === 'PAID') {
        throw new ConflictError(
          'Payment was already recorded for this booking.',
          'PAYMENT_ALREADY_RECORDED',
        );
      }
      if (booking.status !== 'COMPLETED') {
        throw new BusinessRuleError(
          'PAYMENT_NOT_ALLOWED',
          'Payment can only be recorded once the booking is completed (BR-011).',
        );
      }
      const discountMinor = body.discountMinor ?? 0;
      if (body.amountPaidMinor + discountMinor !== booking.totalPriceMinor) {
        throw new BusinessRuleError(
          'PAYMENT_MISMATCH',
          `Amount paid plus discount must equal the total of ${booking.totalPriceMinor}.`,
          [{ path: 'amountPaidMinor', message: 'Does not add up to the booking total' }],
        );
      }
      const updated = await withTransaction(connection, async (session) => {
        const next = await bookings.setPayment(
          booking,
          {
            status: 'PAID',
            method: body.method,
            amountPaidMinor: body.amountPaidMinor,
            discountMinor,
            recordedBy: new Types.ObjectId(viewer.userId),
            recordedAt: clock.now(),
            ...(body.discountReason ? { discountReason: body.discountReason } : {}),
          },
          session,
        );
        await audit.record(
          {
            action: 'payment.record',
            entityType: 'booking',
            entityId: bookingId,
            before: { payment: { status: booking.payment.status } },
            after: {
              payment: {
                status: 'PAID',
                method: body.method,
                amountPaidMinor: body.amountPaidMinor,
                discountMinor,
                discountReason: body.discountReason ?? null,
              },
            },
          },
          session,
        );
        // EVT-016
        await outbox.add(session, {
          type: 'booking.payment_recorded',
          aggregateType: 'booking',
          aggregateId: bookingId,
          payload: { bookingId, amountPaidMinor: body.amountPaidMinor, method: body.method },
        });
        return next;
      });
      return bookings.toDto(updated, viewer);
    },
  };
}
