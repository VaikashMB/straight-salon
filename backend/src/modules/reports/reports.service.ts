import type { Connection } from 'mongoose';
import { BOOKING_STATUSES, type BookingStatus } from '../../config/constants.js';
import type { Cache } from '../../shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../shared/cache/keys.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { compareStrings } from '../../shared/text/strings.js';
import type { Clock } from '../../shared/time/clock.js';
import { addDays, startOfZonedDay, toZonedDate } from '../../shared/time/tz.js';
import type { AvailabilityService } from '../availability/availability.service.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StaffService } from '../staff/staff.service.js';
import type { UsersService } from '../users/users.service.js';
import {
  addCounts,
  computeDayStats,
  emptyCounts,
  mergeServiceStats,
  noShowRate,
  revenueOf,
  utilisation,
  type StatCounts,
} from './dailyStats.js';
import { csvFilename, summaryToCsv } from './reports.csv.js';
import type { DailyStatsDoc } from './reports.model.js';
import type { ReportsRepository } from './reports.repository.js';
import type {
  DashboardDto,
  DashboardQuery,
  ReportSummaryDto,
  ReportTotals,
  SummaryQuery,
} from './reports.schemas.js';

// Reports (FR-070..072): the live dashboard, and summaries over the daily_stats read model
// (02 §2.17), which this module keeps up to date from bookings (09 §5 stats, §7 reconcile).

const MINUTE = 60_000;
const TTL = { dashboard: 30, summary: 300 }; // 08 §2

export interface ReportsService {
  dashboard(query: DashboardQuery): Promise<DashboardDto>;
  summary(query: SummaryQuery): Promise<ReportSummaryDto>;
  summaryCsv(query: SummaryQuery): Promise<{ filename: string; csv: string }>;
  // Read model upkeep. Each date is recomputed from its bookings (not incremented), so repeats
  // and out-of-order events are harmless.
  recomputeDays(dates: string[]): Promise<void>;
  rebuild(from: string, to: string): Promise<number>; // days recomputed
  rebuildAll(): Promise<{ from: string; to: string; days: number } | null>; // every booking date
  reconcileYesterday(): Promise<string>; // the date recomputed
}

export interface ReportsServiceDeps {
  repository: ReportsRepository;
  connection: Connection;
  cache: Cache;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  bookings: Pick<BookingsService, 'findStartingBetween' | 'startRange'>;
  availability: Pick<AvailabilityService, 'workingWindows'>;
  staff: Pick<StaffService, 'active' | 'briefs'>;
  catalog: Pick<CatalogService, 'findServices'>;
  users: Pick<UsersService, 'findByIds'>;
}

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function createReportsService(deps: ReportsServiceDeps): ReportsService {
  const { repository, connection, cache, clock, settings, bookings, availability, staff } = deps;
  const { catalog, users } = deps;

  async function computeDay(date: string): Promise<void> {
    const s = await settings.get();
    const from = startOfZonedDay(date, s.timezone);
    const to = startOfZonedDay(addDays(date, 1), s.timezone);
    const active = await staff.active();
    // Reads and the replace share one transaction: two recomputes of the same date conflict
    // on the rows, and the retried one sees the other's bookings.
    await withTransaction(connection, async (session) => {
      const dayBookings = await bookings.findStartingBetween(from, to, session);
      const staffIds = new Set([
        ...active.map((a) => a.id),
        ...dayBookings.map((b) => b.staffId.toHexString()),
      ]);
      const available = new Map<string, number>();
      for (const staffId of staffIds) {
        const windows = await availability.workingWindows(staffId, date, s);
        available.set(
          staffId,
          windows.reduce((sum, w) => sum + (w.end - w.start) / MINUTE, 0),
        );
      }
      await repository.replaceDay(date, computeDayStats(dayBookings, available), session);
    });
  }

  // The summary cache is tagged `reports` (08 §2).
  const invalidateSummaries = () => cache.invalidateTag(cacheTags.reports);

  const totalsOf = (c: StatCounts, currency: string): ReportTotals => ({
    bookings: c.bookings,
    completed: c.completed,
    cancelled: c.cancelled,
    noShows: c.noShows,
    noShowRate: noShowRate(c),
    revenue: { amountMinor: c.revenueMinor, currency },
    bookedMinutes: c.bookedMinutes,
    availableMinutes: c.availableMinutes,
    utilisation: utilisation(c),
  });

  async function buildSummary(from: string, to: string): Promise<ReportSummaryDto> {
    const s = await settings.get();
    const rows = await repository.findRange(from, to);
    const salonRows = new Map(rows.filter((r) => r.staffId === null).map((r) => [r.date, r]));
    const staffRows = new Map<string, StatCounts>();
    for (const row of rows) {
      if (row.staffId === null) continue;
      const id = row.staffId.toHexString();
      staffRows.set(id, addCounts(staffRows.get(id) ?? emptyCounts(), row));
    }
    const byService = mergeServiceStats(
      [...salonRows.values()].map((r: DailyStatsDoc) =>
        r.byService.map((svc) => ({ ...svc, serviceId: svc.serviceId.toHexString() })),
      ),
    );
    const [stylists, services] = await Promise.all([
      staff.briefs([...staffRows.keys()]),
      catalog.findServices(byService.map((svc) => svc.serviceId)),
    ]);
    const staffNames = new Map(stylists.map((b) => [b.id, b.displayName]));
    const serviceNames = new Map(services.map((svc) => [svc.id, svc.name]));

    const byDay = datesBetween(from, to).map((date) => {
      const row = salonRows.get(date);
      return { date, ...totalsOf(row ? addCounts(emptyCounts(), row) : emptyCounts(), s.currency) };
    });
    const total = [...salonRows.values()].reduce((sum, r) => addCounts(sum, r), emptyCounts());
    return {
      from,
      to,
      timezone: s.timezone,
      totals: totalsOf(total, s.currency),
      byDay,
      byService: byService.map((svc) => ({
        serviceId: svc.serviceId,
        name: serviceNames.get(svc.serviceId) ?? 'Unknown service',
        count: svc.count,
        revenue: { amountMinor: svc.revenueMinor, currency: s.currency },
      })),
      byStaff: [...staffRows.entries()]
        .map(([staffId, counts]) => ({
          staffId,
          displayName: staffNames.get(staffId) ?? 'Unknown stylist',
          ...totalsOf(counts, s.currency),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  async function buildDashboard(date: string): Promise<DashboardDto> {
    const s = await settings.get();
    const dayBookings = await bookings.findStartingBetween(
      startOfZonedDay(date, s.timezone),
      startOfZonedDay(addDays(date, 1), s.timezone),
    );
    const counts = Object.fromEntries(BOOKING_STATUSES.map((st) => [st, 0])) as Record<
      BookingStatus,
      number
    >;
    for (const b of dayBookings) counts[b.status]++;
    const timeline = dayBookings.filter((b) => b.status !== 'CANCELLED');
    const staffIds = [...new Set(timeline.map((b) => b.staffId.toHexString()))];
    const [active, others, customers] = await Promise.all([
      staff.active(),
      staff.briefs(staffIds),
      users.findByIds([...new Set(timeline.map((b) => b.customerId.toHexString()))]),
    ]);
    const stylists = new Map([...active, ...others].map((b) => [b.id, b.displayName]));
    const customerNames = new Map(customers.map((u) => [u._id.toHexString(), u.name]));
    return {
      date,
      timezone: s.timezone,
      generatedAt: clock.now().toISOString(),
      counts,
      totals: {
        bookings: dayBookings.length,
        revenue: {
          amountMinor: dayBookings.reduce((sum, b) => sum + revenueOf(b), 0),
          currency: s.currency,
        },
      },
      staff: [...stylists.entries()]
        .map(([staffId, displayName]) => ({
          staffId,
          displayName,
          bookings: timeline
            .filter((b) => b.staffId.toHexString() === staffId)
            .map((b) => ({
              id: b._id.toHexString(),
              bookingRef: b.bookingRef,
              status: b.status,
              startAt: b.startAt.toISOString(),
              endAt: b.endAt.toISOString(),
              customerName: customerNames.get(b.customerId.toHexString()) ?? 'Unknown customer',
              services: b.services.map((svc) => svc.name),
            })),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  const service: ReportsService = {
    async dashboard(query) {
      const date = query.date ?? toZonedDate(clock.now(), (await settings.get()).timezone);
      return cache.cacheAside(cacheKeys.dashboard(date), TTL.dashboard, () => buildDashboard(date));
    },

    summary({ from, to }) {
      return cache.cacheAside(
        cacheKeys.reportSummary(from, to),
        TTL.summary,
        () => buildSummary(from, to),
        // Names and the currency come from settings/catalogue/staff too.
        { tags: [cacheTags.reports, cacheTags.settings] },
      );
    },

    async summaryCsv(query) {
      return {
        filename: csvFilename(query.from, query.to),
        csv: summaryToCsv(await service.summary(query)),
      };
    },

    async recomputeDays(dates) {
      const unique = [...new Set(dates)].sort(compareStrings);
      for (const date of unique) await computeDay(date);
      if (unique.length > 0) await invalidateSummaries();
    },

    async rebuild(from, to) {
      const dates = datesBetween(from, to);
      for (const date of dates) await computeDay(date);
      await invalidateSummaries();
      return dates.length;
    },

    async rebuildAll() {
      const range = await bookings.startRange();
      if (!range) return null;
      const { timezone } = await settings.get();
      const from = toZonedDate(range.first, timezone);
      const to = toZonedDate(range.last, timezone);
      return { from, to, days: await service.rebuild(from, to) };
    },

    // stats-reconcile (09 §7): yesterday, salon time, from source (self-healing).
    async reconcileYesterday() {
      const { timezone } = await settings.get();
      const yesterday = addDays(toZonedDate(clock.now(), timezone), -1);
      await service.recomputeDays([yesterday]);
      return yesterday;
    },
  };
  return service;
}
