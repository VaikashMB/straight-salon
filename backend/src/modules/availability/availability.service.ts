import type { AuthContext } from '../../shared/auth/accessToken.js';
import type { Cache } from '../../shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../shared/cache/keys.js';
import { BusinessRuleError, ValidationError } from '../../shared/errors/index.js';
import { compareStrings } from '../../shared/text/strings.js';
import type { Clock } from '../../shared/time/clock.js';
import {
  mergeStaffSlots,
  staffDaySlots,
  startsFrom,
  weekdayOf,
  workingWindows,
  type Interval,
  type StaffDayRules,
} from '../../shared/time/slots.js';
import { addDays, startOfZonedDay, toZonedDate } from '../../shared/time/tz.js';
import type { ServiceDto } from '../catalog/catalog.schemas.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { HolidaysService } from '../holidays/holidays.service.js';
import type { SettingsDto } from '../settings/settings.schemas.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StaffBrief, StaffService } from '../staff/staff.service.js';
import type {
  AvailabilityDto,
  AvailabilityQuery,
  AvailableDaysDto,
  AvailableDaysQuery,
} from './availability.schemas.js';

// Availability (03 §5.2). Per-stylist day slots are cached (08 §2) and do not depend on the
// caller or the clock; the "not in the past" and lead-time filters run after the cache read.

const MINUTE = 60_000;
const TTL = { slots: 60, days: 120 }; // 08 §2

// Implemented by the bookings module (passed in to avoid an import cycle).
export interface BookedIntervals {
  // Active bookings for a stylist overlapping [from, to), as [startAt, blockedUntil).
  activeIntervals(staffId: string, from: Date, to: Date): Promise<Interval[]>;
}

export interface BookingPlan {
  services: ServiceDto[]; // in the requested order
  durationMin: number;
  spanMin: number; // duration + buffer
  candidates: StaffBrief[]; // the requested stylist, or every qualified one ("any")
  settings: SettingsDto;
}

export interface AvailabilityService {
  slots(query: AvailabilityQuery, viewer?: AuthContext): Promise<AvailabilityDto>;
  days(query: AvailableDaysQuery, viewer?: AuthContext): Promise<AvailableDaysDto>;
  // For bookings (03 §5.1)
  plan(serviceIds: string[], staffId: string): Promise<BookingPlan>;
  // BR-005 for one stylist on one salon-local date, ignoring bookings; read fresh.
  workingWindows(staffId: string, date: string, settings: SettingsDto): Promise<Interval[]>;
  // Bookable starts read fresh (no cache), e.g. for walk-ins.
  freshSlots(
    staffId: string,
    date: string,
    spanMin: number,
    settings: SettingsDto,
  ): Promise<number[]>;
  // BR-002: the earliest start this caller may book or see (now, or now + lead time).
  notBefore(viewer: AuthContext | undefined, settings: SettingsDto): number;
}

export interface AvailabilityServiceDeps {
  cache: Cache;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  holidays: Pick<HolidaysService, 'isHoliday'>;
  staff: Pick<StaffService, 'bookable' | 'briefs' | 'weeklySchedule' | 'timeOffBetween'>;
  catalog: Pick<CatalogService, 'findServices'>;
  bookings: BookedIntervals;
}

export function createAvailabilityService(deps: AvailabilityServiceDeps): AvailabilityService {
  const { cache, clock, settings, holidays, staff, catalog, bookings } = deps;

  async function rulesFor(staffId: string, date: string, s: SettingsDto): Promise<StaffDayRules> {
    const dayStart = startOfZonedDay(date, s.timezone);
    const dayEnd = startOfZonedDay(addDays(date, 1), s.timezone);
    const weekday = weekdayOf(date);
    const [isHoliday, weekly, timeOff] = await Promise.all([
      holidays.isHoliday(date),
      staff.weeklySchedule(staffId),
      staff.timeOffBetween(staffId, dayStart, dayEnd),
    ]);
    const salon = s.businessHours.find((d) => d.dayOfWeek === weekday);
    const day = weekly.find((d) => d.dayOfWeek === weekday);
    return {
      date,
      timeZone: s.timezone,
      isHoliday,
      salon: salon ?? { isOpen: false, open: '00:00', close: '00:00' },
      staff: day ?? { isWorking: false, start: '00:00', end: '00:00', breaks: [] },
      timeOff,
    };
  }

  async function computeSlots(staffId: string, date: string, spanMin: number, s: SettingsDto) {
    const rules = await rulesFor(staffId, date, s);
    const booked = await bookings.activeIntervals(
      staffId,
      startOfZonedDay(date, s.timezone),
      startOfZonedDay(addDays(date, 1), s.timezone),
    );
    return staffDaySlots(rules, booked, { granularityMin: s.slotGranularityMin, spanMin });
  }

  // 03 §5.2 step 4, cached per stylist / date / span (08 §2).
  function cachedSlots(staffId: string, date: string, spanMin: number, s: SettingsDto) {
    return cache.cacheAside(
      cacheKeys.availability(staffId, date, spanMin),
      TTL.slots,
      () => computeSlots(staffId, date, spanMin, s),
      {
        tags: [
          cacheTags.availabilityAll,
          cacheTags.availabilityStaff(staffId),
          cacheTags.availability(staffId, date),
        ],
      },
    );
  }

  function notBefore(viewer: AuthContext | undefined, s: SettingsDto): number {
    const now = clock.now().getTime();
    // BR-002: lead time applies to customers and the public, not to staff roles.
    const staffRole = viewer !== undefined && viewer.role !== 'CUSTOMER';
    return staffRole ? now : now + s.minLeadTimeMin * MINUTE;
  }

  // BR-003: dates from today to today + maxAdvanceDays (salon timezone).
  function bookableWindow(s: SettingsDto): { first: string; last: string } {
    const today = toZonedDate(clock.now(), s.timezone);
    return { first: today, last: addDays(today, s.maxAdvanceDays) };
  }

  async function plan(serviceIds: string[], staffId: string): Promise<BookingPlan> {
    const s = await settings.get();
    const found = new Map((await catalog.findServices(serviceIds)).map((svc) => [svc.id, svc]));
    const errors = serviceIds.flatMap((id, index) => {
      const svc = found.get(id);
      if (!svc) return [{ path: `serviceIds.${index}`, message: 'Service not found' }];
      if (!svc.isActive)
        return [{ path: `serviceIds.${index}`, message: 'Service is not available (BR-007)' }];
      return [];
    });
    if (errors.length > 0) throw new ValidationError('The request is invalid.', errors);
    const services = serviceIds.map((id) => found.get(id)!);
    const durationMin = services.reduce((sum, svc) => sum + svc.durationMin, 0);

    let candidates: StaffBrief[];
    if (staffId === 'any') {
      candidates = await staff.bookable(serviceIds);
    } else {
      const [brief] = await staff.briefs([staffId]);
      // BR-007: the stylist must be active and perform every selected service.
      if (!brief?.isActive || !serviceIds.every((id) => brief.serviceIds.includes(id))) {
        throw new BusinessRuleError(
          'STAFF_CANNOT_PERFORM_SERVICE',
          'This stylist is not available for all of the selected services.',
          [{ path: 'staffId', message: 'Not qualified or not active' }],
        );
      }
      candidates = [brief];
    }
    return { services, durationMin, spanMin: durationMin + s.bufferMin, candidates, settings: s };
  }

  return {
    plan,
    notBefore,

    async slots(query, viewer) {
      const p = await plan(query.serviceIds, query.staffId);
      const s = p.settings;
      const empty: AvailabilityDto = { date: query.date, timezone: s.timezone, slots: [] };
      const { first, last } = bookableWindow(s);
      if (query.date < first || query.date > last) return empty;

      const cutoff = notBefore(viewer, s);
      const perStaff = await Promise.all(
        p.candidates.map(async (c) => ({
          staffId: c.id,
          slots: startsFrom(await cachedSlots(c.id, query.date, p.spanMin, s), cutoff),
        })),
      );
      return {
        ...empty,
        slots: mergeStaffSlots(perStaff).map((slot) => ({
          startAt: new Date(slot.startAt).toISOString(),
          staffIds: slot.staffIds,
        })),
      };
    },

    async days(query, viewer) {
      const p = await plan(query.serviceIds, query.staffId);
      const s = p.settings;
      // Cached per stylist choice + services + range: the latest start per date. Comparing it
      // with this caller's cut-off keeps the cached value caller- and clock-independent.
      const latest = await cache.cacheAside(
        cacheKeys.availableDays(query.staffId, query.serviceIds, query.from, query.to),
        TTL.days,
        async () => {
          const { first, last } = bookableWindow(s);
          const result: Record<string, number | null> = {};
          for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
            if (date < first || date > last) {
              result[date] = null;
              continue;
            }
            const all = await Promise.all(
              p.candidates.map((c) => cachedSlots(c.id, date, p.spanMin, s)),
            );
            const starts = all.flat();
            result[date] = starts.length > 0 ? Math.max(...starts) : null;
          }
          return result;
        },
        { tags: [cacheTags.availabilityAll, cacheTags.availableDays(query.staffId)] },
      );
      const cutoff = notBefore(viewer, s);
      return {
        from: query.from,
        to: query.to,
        timezone: s.timezone,
        availableDates: Object.entries(latest)
          .filter(([, t]) => t !== null && t >= cutoff)
          .map(([date]) => date)
          .sort(compareStrings),
      };
    },

    async workingWindows(staffId, date, s) {
      return workingWindows(await rulesFor(staffId, date, s));
    },

    freshSlots: (staffId, date, spanMin, s) => computeSlots(staffId, date, spanMin, s),
  };
}
