import type { BookingsService } from '../../modules/bookings/bookings.service.js';
import type { ReportsService } from '../../modules/reports/reports.service.js';
import type { SettingsService } from '../../modules/settings/settings.service.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventHandler } from '../../shared/events/EventBus.js';
import { parseEventPayload } from '../../shared/events/registry.js';
import type { Logger } from '../../shared/logger/index.js';
import { toZonedDate } from '../../shared/time/tz.js';

// `stats` consumer (09 §5): recomputes daily_stats for the salon-local dates a booking event
// touches (02 §2.17). Each date is rebuilt from its bookings, so the result does not depend on
// how often or in which order events arrive.

export interface StatsConsumerDeps {
  reports: Pick<ReportsService, 'recomputeDays'>;
  bookings: Pick<BookingsService, 'findById'>;
  settings: Pick<SettingsService, 'get'>;
  logger: Logger;
}

export async function datesForEvent(
  event: DomainEvent,
  deps: Pick<StatsConsumerDeps, 'bookings' | 'settings' | 'logger'>,
): Promise<string[]> {
  const day = async (startAt: string | Date) =>
    toZonedDate(new Date(startAt), (await deps.settings.get()).timezone);
  // Payloads without a start time: the booking's own date.
  const bookingDay = async (bookingId: string) => {
    const booking = await deps.bookings.findById(bookingId);
    if (!booking) {
      deps.logger.warn({ bookingId, eventType: event.type }, 'Booking not found; no stats update');
      return [];
    }
    return [await day(booking.startAt)];
  };

  switch (event.type) {
    case 'booking.created':
      return [await day(parseEventPayload(event.type, event.payload).startAt)];
    case 'booking.cancelled':
      return [await day(parseEventPayload(event.type, event.payload).startAt)];
    case 'booking.rescheduled': {
      const p = parseEventPayload(event.type, event.payload);
      return [await day(p.from.startAt), await day(p.to.startAt)];
    }
    case 'booking.completed':
    case 'booking.no_show':
    case 'booking.payment_recorded':
      return bookingDay(parseEventPayload(event.type, event.payload).bookingId);
    default:
      return [];
  }
}

export function createStatsConsumer(deps: StatsConsumerDeps): EventHandler {
  const log = deps.logger.child({ consumer: 'stats' });
  return async (event) => {
    const dates = [...new Set(await datesForEvent(event, { ...deps, logger: log }))];
    await deps.reports.recomputeDays(dates);
    log.debug({ eventType: event.type, dates }, 'Daily stats recomputed');
  };
}
