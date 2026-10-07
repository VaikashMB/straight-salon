import type { BookingsService } from '../../modules/bookings/bookings.service.js';
import type { SettingsService } from '../../modules/settings/settings.service.js';
import type { Cache } from '../../shared/cache/cache.js';
import { availabilityTagsFor, cacheTags } from '../../shared/cache/keys.js';
import type { DomainEvent } from '../../shared/events/envelope.js';
import type { EventHandler } from '../../shared/events/EventBus.js';
import { parseEventPayload } from '../../shared/events/registry.js';
import type { Logger } from '../../shared/logger/index.js';
import { toZonedDate } from '../../shared/time/tz.js';

// `cache-invalidation` consumer (08 §4, 09 §5). Services already invalidate synchronously after
// commit; this repeats it from the event, so caches are cleared even if the API died between
// commit and that call. Both are idempotent. The tags match what each service clears.

export interface CacheInvalidationDeps {
  cache: Pick<Cache, 'invalidateTag'>;
  settings: Pick<SettingsService, 'get'>;
  bookings: Pick<BookingsService, 'findById'>;
  logger: Logger;
}

const FREES_SLOT = new Set(['CANCELLED', 'NO_SHOW']);

export async function tagsForEvent(
  event: DomainEvent,
  deps: Pick<CacheInvalidationDeps, 'settings' | 'bookings'>,
): Promise<string[]> {
  const day = async (startAt: string | Date) =>
    toZonedDate(new Date(startAt), (await deps.settings.get()).timezone);

  switch (event.type) {
    // Bookings change a stylist's free time on one day (08 §2) and the report figures.
    case 'booking.created': {
      const p = parseEventPayload(event.type, event.payload);
      return [...availabilityTagsFor(p.staffId, [await day(p.startAt)]), cacheTags.reports];
    }
    case 'booking.rescheduled': {
      const p = parseEventPayload(event.type, event.payload);
      return [
        ...availabilityTagsFor(p.from.staffId, [await day(p.from.startAt)]),
        ...availabilityTagsFor(p.to.staffId, [await day(p.to.startAt)]),
        cacheTags.reports,
      ];
    }
    case 'booking.cancelled': {
      const p = parseEventPayload(event.type, event.payload);
      return [...availabilityTagsFor(p.staffId, [await day(p.startAt)]), cacheTags.reports];
    }
    case 'booking.status_changed': {
      const p = parseEventPayload(event.type, event.payload);
      if (!FREES_SLOT.has(p.to)) return [cacheTags.reports];
      const booking = await deps.bookings.findById(p.bookingId);
      if (!booking) return [cacheTags.reports];
      return [
        ...availabilityTagsFor(booking.staffId.toHexString(), [await day(booking.startAt)]),
        cacheTags.reports,
      ];
    }
    // The slot side of these is covered by booking.status_changed.
    case 'booking.completed':
    case 'booking.no_show':
    case 'booking.payment_recorded':
      return [cacheTags.reports];

    // Staff (staff.service.ts): profile changes alter public reads and who can be booked.
    case 'staff.updated': {
      const p = parseEventPayload(event.type, event.payload);
      return [cacheTags.staff, ...availabilityTagsFor(p.staffId)];
    }
    case 'staff.schedule_changed':
    case 'staff.timeoff_changed': {
      const p = parseEventPayload(event.type, event.payload);
      // An empty affectedDates list means "all dates" (EVT-030).
      return availabilityTagsFor(
        p.staffId,
        p.affectedDates.length > 0 ? p.affectedDates : undefined,
      );
    }

    // catalog.service.ts: staff entries embed service data; durations feed availability.
    case 'catalog.changed':
      return [cacheTags.catalog, cacheTags.staff, cacheTags.availabilityAll];
    // settings.service.ts: prices carry the currency; hours, granularity, buffer and tz.
    case 'settings.changed':
      return [cacheTags.settings, cacheTags.catalog, cacheTags.availabilityAll];
    // holidays.service.ts: a closure changes every stylist's availability.
    case 'holiday.changed':
      return [cacheTags.availabilityAll];
    // Rating aggregates appear in staff profiles and service details (08 §2).
    case 'review.created':
    case 'review.visibility_changed':
      return [cacheTags.staff, cacheTags.catalog];

    default:
      return [];
  }
}

export function createCacheInvalidationConsumer(deps: CacheInvalidationDeps): EventHandler {
  const log = deps.logger.child({ consumer: 'cache-invalidation' });
  return async (event) => {
    const tags = [...new Set(await tagsForEvent(event, deps))];
    for (const tag of tags) await deps.cache.invalidateTag(tag);
    log.debug({ eventType: event.type, tags: tags.length }, 'Cache tags invalidated');
  };
}
