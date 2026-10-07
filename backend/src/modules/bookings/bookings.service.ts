import { Types, type ClientSession, type Connection } from 'mongoose';
import type { BookingSource, BookingStatus } from '../../config/constants.js';
import type { AuditRepository } from '../../shared/audit/audit.repository.js';
import { SYSTEM_ACTOR, type AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import { hasPermission } from '../../shared/auth/permissions.js';
import type { Cache } from '../../shared/cache/cache.js';
import { availabilityTagsFor, cacheKeys } from '../../shared/cache/keys.js';
import { bumpStaffDayGuards } from '../../shared/db/staffDayGuard.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import { getRequestContext } from '../../shared/http/requestContext.js';
import { paginated, parseSort, skipFor, type Paginated } from '../../shared/http/pagination.js';
import type { RedisLock } from '../../shared/locks/redisLock.js';
import type { Clock } from '../../shared/time/clock.js';
import { fitsWithin, floorToSlot, isAligned, type Interval } from '../../shared/time/slots.js';
import { addDays, startOfZonedDay, toZonedDate } from '../../shared/time/tz.js';
import type { AvailabilityService, BookingPlan } from '../availability/availability.service.js';
import type { SettingsDto } from '../settings/settings.schemas.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StaffBrief, StaffService } from '../staff/staff.service.js';
import type { UsersService } from '../users/users.service.js';
import type { ActiveBookingScope, ActiveBookingsGate } from './bookings.gate.js';
import { bookingAuditView, makeBookingRef, toBookingDto } from './bookings.mapper.js';
import type { BookingDoc, Payment } from './bookings.model.js';
import type { BookingsRepository, BookingSearch, ReminderField } from './bookings.repository.js';
import type {
  BookingDto,
  BookingHistoryDto,
  CancelBody,
  CreateBookingBody,
  ListBookingsQuery,
  MyBookingsQuery,
  RescheduleBody,
  StatusBody,
} from './bookings.schemas.js';

// Bookings module public interface (03 §5.1, BR-001..015).

const MINUTE = 60_000;
const MAX_FUTURE_BOOKED = 3; // BR-009

export interface BookingsService {
  create(body: CreateBookingBody, viewer: AuthContext): Promise<BookingDto>;
  listMine(query: MyBookingsQuery, viewer: AuthContext): Promise<Paginated<BookingDto>>;
  list(query: ListBookingsQuery, viewer: AuthContext): Promise<Paginated<BookingDto>>;
  get(id: string, viewer: AuthContext): Promise<BookingDto>;
  reschedule(id: string, body: RescheduleBody, viewer: AuthContext): Promise<BookingDto>;
  cancel(id: string, body: CancelBody, viewer: AuthContext): Promise<BookingDto>;
  changeStatus(id: string, body: StatusBody, viewer: AuthContext): Promise<BookingDto>;
  history(id: string): Promise<BookingHistoryDto>;
  // For the payments module
  findById(id: string): Promise<BookingDoc | null>;
  setPayment(booking: BookingDoc, payment: Payment, session: ClientSession): Promise<BookingDoc>;
  toDto(booking: BookingDoc, viewer: AuthContext): Promise<BookingDto>;
  // Ports for availability, settings, holidays and staff
  activeIntervals(staffId: string, from: Date, to: Date): Promise<Interval[]>;
  gate: ActiveBookingsGate;
  // Scheduled jobs (09 §7), run by the worker as the system actor
  queueReminders(window: ReminderWindow, scanMs: number): Promise<number>;
  markNoShows(): Promise<number>;
}

export type ReminderWindow = '24h' | '2h';

const REMINDER_LEAD_MS: Record<ReminderWindow, number> = {
  '24h': 24 * 60 * MINUTE,
  '2h': 120 * MINUTE,
};
const REMINDER_FIELD: Record<ReminderWindow, ReminderField> = {
  '24h': 'h24SentAt',
  '2h': 'h2SentAt',
};
// Rows handled per job run; a backlog drains over the next runs.
const JOB_BATCH = 200;

export interface BookingsServiceDeps {
  repository: BookingsRepository;
  auditLog: Pick<AuditRepository, 'find'>;
  audit: AuditService;
  outbox: Outbox;
  cache: Cache;
  lock: RedisLock;
  connection: Connection;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  availability: Pick<AvailabilityService, 'plan' | 'workingWindows' | 'freshSlots' | 'notBefore'>;
  staff: Pick<StaffService, 'briefs'>;
  users: Pick<UsersService, 'findActiveById' | 'findByIds' | 'idsByPhonePrefix'>;
  random?: () => number;
}

// BR-010 / FR-040: the status graph for API-056. Cancellation has its own endpoint.
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  BOOKED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CHECKED_IN: ['IN_SERVICE'],
  IN_SERVICE: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const invalidTransition = (from: BookingStatus, to: BookingStatus) =>
  new BusinessRuleError('INVALID_STATUS_TRANSITION', `A ${from} booking cannot become ${to}.`);

const slotUnavailable = (
  detail = 'The selected time is no longer available. Please pick another slot.',
) => new ConflictError(detail, 'SLOT_UNAVAILABLE');

const actorId = () => getRequestContext()?.userId ?? 'system';

export function createBookingsService(deps: BookingsServiceDeps): BookingsService {
  const {
    repository,
    auditLog,
    audit,
    outbox,
    cache,
    lock,
    connection,
    clock,
    settings,
    availability,
    staff,
    users,
  } = deps;
  const random = deps.random ?? Math.random;

  const isDesk = (viewer: AuthContext) => hasPermission(viewer.role, 'booking:create:any');

  async function invalidate(staffId: string, dates: string[]): Promise<void> {
    for (const tag of availabilityTagsFor(staffId, dates)) await cache.invalidateTag(tag);
  }

  async function toDtos(bookings: BookingDoc[], viewer: AuthContext): Promise<BookingDto[]> {
    const s = await settings.get();
    const [customers, stylists] = await Promise.all([
      users.findByIds([...new Set(bookings.map((b) => b.customerId.toHexString()))]),
      staff.briefs([...new Set(bookings.map((b) => b.staffId.toHexString()))]),
    ]);
    const ctx = {
      viewer,
      now: clock.now(),
      currency: s.currency,
      cancellationCutoffMin: s.cancellationCutoffMin,
      customers: new Map(
        customers.map((u) => [u._id.toHexString(), { name: u.name, phone: u.phone }]),
      ),
      staffNames: new Map(stylists.map((b) => [b.id, b.displayName])),
    };
    return bookings.map((b) => toBookingDto(b, ctx));
  }

  const toDto = async (booking: BookingDoc, viewer: AuthContext) =>
    (await toDtos([booking], viewer))[0]!;

  // 06 §3: other customers' bookings and stylists' unassigned bookings are "not found".
  async function requireVisible(id: string, viewer: AuthContext): Promise<BookingDoc> {
    const booking = Types.ObjectId.isValid(id) ? await repository.findById(id) : null;
    const visible =
      booking &&
      (hasPermission(viewer.role, 'booking:read:any') ||
        (viewer.role === 'CUSTOMER' && booking.customerId.toHexString() === viewer.userId) ||
        (viewer.role === 'STAFF' && booking.staffId.toHexString() === viewer.staffId));
    if (!visible) throw new NotFoundError('Booking not found.');
    return booking;
  }

  // FR-033: fewest active bookings that day, then alphabetical.
  async function fairOrder(
    candidates: StaffBrief[],
    date: string,
    s: SettingsDto,
  ): Promise<StaffBrief[]> {
    if (candidates.length < 2) return candidates;
    const counts = await repository.countActiveByStaff(
      candidates.map((c) => c.id),
      startOfZonedDay(date, s.timezone),
      startOfZonedDay(addDays(date, 1), s.timezone),
    );
    return [...candidates].sort(
      (a, b) =>
        (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  // BR-001, BR-002 (customers), BR-003 and "not in the past" for a requested start.
  function assertStartAllowed(startAt: Date, viewer: AuthContext, s: SettingsDto): string {
    const date = toZonedDate(startAt, s.timezone);
    if (
      !isAligned(
        startAt.getTime(),
        startOfZonedDay(date, s.timezone).getTime(),
        s.slotGranularityMin,
      )
    ) {
      throw new BusinessRuleError(
        'VALIDATION_FAILED',
        `Bookings start on ${s.slotGranularityMin}-minute boundaries (BR-001).`,
        [{ path: 'startAt', message: `Not on a ${s.slotGranularityMin}-minute boundary` }],
      );
    }
    if (startAt.getTime() < availability.notBefore(viewer, s)) {
      throw new BusinessRuleError(
        'LEAD_TIME_VIOLATION',
        startAt.getTime() < clock.now().getTime()
          ? 'That time has already passed.'
          : `Online bookings need at least ${s.minLeadTimeMin} minutes' notice.`,
      );
    }
    if (date > addDays(toZonedDate(clock.now(), s.timezone), s.maxAdvanceDays)) {
      throw new BusinessRuleError(
        'ADVANCE_WINDOW_VIOLATION',
        `Bookings can be made at most ${s.maxAdvanceDays} days ahead.`,
      );
    }
    return date;
  }

  // BR-005: candidates whose working time (hours, breaks, time-off, holiday) holds the span.
  async function withinHours(
    candidates: StaffBrief[],
    date: string,
    span: Interval,
    s: SettingsDto,
  ) {
    const checks = await Promise.all(
      candidates.map(async (c) => ({
        c,
        ok: fitsWithin(await availability.workingWindows(c.id, date, s), span),
      })),
    );
    return checks.filter((x) => x.ok).map((x) => x.c);
  }

  const outsideHours = () =>
    new BusinessRuleError(
      'OUTSIDE_BUSINESS_HOURS',
      'The stylist is not working at that time (hours, breaks, time-off or a holiday).',
    );

  // BR-006: cut-off, unless reception/admin override with a reason.
  function assertChangeAllowed(
    booking: BookingDoc,
    viewer: AuthContext,
    override: boolean | undefined,
    s: SettingsDto,
  ) {
    if (override && !hasPermission(viewer.role, 'booking:override_rules')) {
      throw new ForbiddenError('Only reception or an admin can override the cut-off.');
    }
    if (booking.status !== 'BOOKED') throw invalidTransition(booking.status, 'CANCELLED');
    const lead = booking.startAt.getTime() - clock.now().getTime();
    if (!override && lead < s.cancellationCutoffMin * MINUTE) {
      throw new BusinessRuleError(
        'CUTOFF_PASSED',
        `Changes are only possible up to ${s.cancellationCutoffMin} minutes before the appointment. Please call the salon.`,
      );
    }
  }

  // Steps 3-5 of 03 §5.1 for one stylist. Null when the slot is taken (lock or overlap).
  async function tryBook(
    target: { staffId: string; startAt: Date },
    p: BookingPlan,
    input: {
      customerId: string;
      viewer: AuthContext;
      source: BookingSource;
      status: 'BOOKED' | 'CHECKED_IN';
      notes?: string | undefined;
    },
  ): Promise<BookingDoc | null> {
    const s = p.settings;
    const date = toZonedDate(target.startAt, s.timezone);
    const endAt = new Date(target.startAt.getTime() + p.durationMin * MINUTE);
    const blockedUntil = new Date(endAt.getTime() + s.bufferMin * MINUTE);
    const lockKey = cacheKeys.staffDayLock(target.staffId, date);
    const token = await lock.acquire(lockKey); // 503 when Redis is down (08 §5)
    if (!token) return null;
    let created: BookingDoc | null;
    try {
      created = await withTransaction(connection, async (session) => {
        await bumpStaffDayGuards(session, [{ staffId: target.staffId, date }]);
        const clash = await repository.countActive(
          { staffId: target.staffId, from: target.startAt, to: blockedUntil },
          session,
        );
        if (clash > 0) return null;
        const now = clock.now();
        const booking = await repository.create(
          {
            bookingRef: makeBookingRef(date, random),
            customerId: new Types.ObjectId(input.customerId),
            staffId: new Types.ObjectId(target.staffId),
            services: p.services.map((svc) => ({
              serviceId: new Types.ObjectId(svc.id),
              name: svc.name,
              durationMin: svc.durationMin,
              priceMinor: svc.price.amountMinor,
            })),
            startAt: target.startAt,
            endAt,
            blockedUntil,
            totalDurationMin: p.durationMin,
            totalPriceMinor: p.services.reduce((sum, svc) => sum + svc.price.amountMinor, 0),
            status: input.status,
            statusHistory: [{ status: input.status, at: now, by: input.viewer.userId }],
            source: input.source,
            payment: { status: 'UNPAID' },
            reminders: {},
            createdBy: new Types.ObjectId(input.viewer.userId),
            ...(input.notes ? { notes: input.notes } : {}),
          },
          session,
        );
        await audit.record(
          {
            action: 'booking.create',
            entityType: 'booking',
            entityId: booking._id.toHexString(),
            before: null,
            after: bookingAuditView(booking),
          },
          session,
        );
        // EVT-010
        await outbox.add(session, {
          type: 'booking.created',
          aggregateType: 'booking',
          aggregateId: booking._id.toHexString(),
          payload: {
            bookingId: booking._id.toHexString(),
            customerId: input.customerId,
            staffId: target.staffId,
            startAt: booking.startAt.toISOString(),
            endAt: booking.endAt.toISOString(),
            source: booking.source,
          },
        });
        return booking;
      });
    } finally {
      await lock.release(lockKey, token);
    }
    if (created) await invalidate(target.staffId, [date]);
    return created;
  }

  // Walk-ins (00 US-03): from the current slot boundary, the earliest free start today.
  async function walkInTargets(p: BookingPlan): Promise<{ staffId: string; startAt: Date }[]> {
    const s = p.settings;
    const now = clock.now();
    const today = toZonedDate(now, s.timezone);
    const boundary = floorToSlot(
      now.getTime(),
      startOfZonedDay(today, s.timezone).getTime(),
      s.slotGranularityMin,
    );
    const ordered = await fairOrder(p.candidates, today, s);
    const options = await Promise.all(
      ordered.map(async (c, rank) => {
        const first = (await availability.freshSlots(c.id, today, p.spanMin, s)).find(
          (t) => t >= boundary,
        );
        return first === undefined ? null : { staffId: c.id, startAt: new Date(first), rank };
      }),
    );
    return options
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.rank - b.rank);
  }

  async function cancelInSession(
    booking: BookingDoc,
    session: ClientSession,
    details: {
      by: string;
      reason?: string | undefined;
      overridden: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<BookingDoc> {
    const now = clock.now();
    const next = await repository.apply(
      booking._id,
      booking.__v,
      {
        set: {
          status: 'CANCELLED',
          cancellation: {
            at: now,
            by: details.by,
            overridden: details.overridden,
            ...(details.reason ? { reason: details.reason } : {}),
          },
        },
        pushHistory: {
          status: 'CANCELLED',
          at: now,
          by: details.by,
          ...(details.reason ? { note: details.reason } : {}),
        },
      },
      session,
    );
    const id = booking._id.toHexString();
    await audit.record(
      {
        action: 'booking.cancel',
        entityType: 'booking',
        entityId: id,
        before: { status: booking.status },
        after: {
          status: next.status,
          cancellation: { reason: details.reason ?? null, overridden: details.overridden },
        },
        ...(details.metadata ? { metadata: details.metadata } : {}),
      },
      session,
    );
    // EVT-012 and EVT-013 (every status change emits EVT-013, 09 §3)
    await outbox.add(session, {
      type: 'booking.cancelled',
      aggregateType: 'booking',
      aggregateId: id,
      payload: {
        bookingId: id,
        staffId: booking.staffId.toHexString(),
        startAt: booking.startAt.toISOString(),
        cancelledBy: details.by,
        ...(details.reason ? { reason: details.reason.slice(0, 500) } : {}),
      },
    });
    await outbox.add(session, {
      type: 'booking.status_changed',
      aggregateType: 'booking',
      aggregateId: id,
      payload: { bookingId: id, from: booking.status, to: 'CANCELLED' },
    });
    return next;
  }

  async function recordOverride(
    session: ClientSession,
    booking: BookingDoc,
    operation: 'cancel' | 'reschedule',
    reason: string | undefined,
  ): Promise<void> {
    await audit.record(
      {
        action: 'booking.override',
        entityType: 'booking',
        entityId: booking._id.toHexString(),
        before: null,
        after: null,
        metadata: { override: true, operation, reason: reason ?? null },
      },
      session,
    );
  }

  // One status change (BR-010) with its audit row and events EVT-013 (+ EVT-014 / EVT-015, 09 §3).
  // The auto no-show job passes the system actor (07 §2.1).
  async function transitionInSession(
    booking: BookingDoc,
    to: BookingStatus,
    session: ClientSession,
    details: { by: string; note?: string; system?: boolean },
  ): Promise<BookingDoc> {
    const id = booking._id.toHexString();
    const actor = details.system ? { actor: SYSTEM_ACTOR } : {};
    const next = await repository.apply(
      booking._id,
      booking.__v,
      {
        set: { status: to },
        pushHistory: {
          status: to,
          at: clock.now(),
          by: details.by,
          ...(details.note ? { note: details.note } : {}),
        },
      },
      session,
    );
    await audit.record(
      {
        action: 'booking.status_change',
        entityType: 'booking',
        entityId: id,
        before: { status: booking.status },
        after: { status: next.status },
        ...(details.note ? { metadata: { note: details.note } } : {}),
        ...actor,
      },
      session,
    );
    await outbox.add(session, {
      type: 'booking.status_changed',
      aggregateType: 'booking',
      aggregateId: id,
      payload: { bookingId: id, from: booking.status, to },
      ...actor,
    });
    if (to === 'COMPLETED') {
      await outbox.add(session, {
        type: 'booking.completed',
        aggregateType: 'booking',
        aggregateId: id,
        payload: {
          bookingId: id,
          staffId: booking.staffId.toHexString(),
          serviceIds: booking.services.map((svc) => svc.serviceId.toHexString()),
          totalPriceMinor: booking.totalPriceMinor,
        },
        ...actor,
      });
    }
    if (to === 'NO_SHOW') {
      await outbox.add(session, {
        type: 'booking.no_show',
        aggregateType: 'booking',
        aggregateId: id,
        payload: { bookingId: id, staffId: booking.staffId.toHexString() },
        ...actor,
      });
    }
    return next;
  }

  const gate: ActiveBookingsGate = {
    countActive: (scope: ActiveBookingScope, session?: ClientSession) =>
      repository.countActive(scope, session),
    // force: true paths (BR-014, FR-024, API-020): cancel and notify, in the caller's transaction.
    async cancelActive(scope, reason, session) {
      const affected = await repository.findActive(scope, session);
      for (const booking of affected) {
        await cancelInSession(booking, session, {
          by: actorId(),
          reason,
          overridden: true,
          metadata: { force: true },
        });
      }
      return affected.length;
    },
  };

  return {
    gate,
    toDto,
    findById: (id) =>
      Types.ObjectId.isValid(id) ? repository.findById(id) : Promise.resolve(null),

    async activeIntervals(staffId, from, to) {
      const bookings = await repository.findActive({ staffId, from, to });
      return bookings.map((b) => ({ start: b.startAt.getTime(), end: b.blockedUntil.getTime() }));
    },

    async setPayment(booking, payment, session) {
      return repository.apply(booking._id, booking.__v, { set: { payment } }, session);
    },

    async create(body, viewer) {
      const desk = isDesk(viewer);
      // "Staff only" fields (04 API-050) are for reception/admin.
      if (!desk) {
        const staffOnly = (['customerId', 'source', 'checkInNow'] as const).filter(
          (f) => body[f] !== undefined,
        );
        if (staffOnly.length > 0) {
          throw new ValidationError(
            'The request is invalid.',
            staffOnly.map((path) => ({ path, message: 'Only reception or an admin can set this' })),
          );
        }
      }
      if (desk && !body.customerId) {
        throw new ValidationError('The request is invalid.', [
          { path: 'customerId', message: 'Required when booking for a customer' },
        ]);
      }
      const customerId = desk ? body.customerId! : viewer.userId;
      if (desk) {
        const customer = await users.findActiveById(customerId);
        if (customer?.role !== 'CUSTOMER') {
          throw new ValidationError('The request is invalid.', [
            { path: 'customerId', message: 'Must be an active customer' },
          ]);
        }
      }

      const p = await availability.plan(body.serviceIds, body.staffId);
      const s = p.settings;
      // BR-009: not for bookings made by reception/admin on a customer's behalf.
      if (
        !desk &&
        (await repository.countFutureBooked(customerId, clock.now())) >= MAX_FUTURE_BOOKED
      ) {
        throw new BusinessRuleError(
          'BOOKING_LIMIT_REACHED',
          `You can hold at most ${MAX_FUTURE_BOOKED} upcoming bookings.`,
        );
      }
      const input = {
        customerId,
        viewer,
        notes: body.notes,
        source: desk
          ? (body.source ?? (body.checkInNow ? 'WALK_IN' : 'PHONE'))
          : ('ONLINE' as BookingSource),
        status: body.checkInNow ? ('CHECKED_IN' as const) : ('BOOKED' as const),
      };

      let targets: { staffId: string; startAt: Date }[];
      if (body.checkInNow) {
        targets = await walkInTargets(p);
        if (targets.length === 0)
          throw slotUnavailable('No qualified stylist is free for the rest of today.');
      } else {
        const startAt = new Date(body.startAt!);
        const date = assertStartAllowed(startAt, viewer, s);
        const span = { start: startAt.getTime(), end: startAt.getTime() + p.spanMin * MINUTE };
        const fitting = await withinHours(p.candidates, date, span, s);
        if (fitting.length === 0) throw outsideHours();
        targets = (await fairOrder(fitting, date, s)).map((c) => ({ staffId: c.id, startAt }));
      }

      // For "any", try candidates in FR-033 order until one succeeds (03 §5.1).
      for (const target of targets) {
        const booking = await tryBook(target, p, input);
        if (booking) return toDto(booking, viewer);
      }
      throw slotUnavailable();
    },

    async listMine(query, viewer) {
      const result = await repository.listForCustomer(viewer.userId, query.scope, clock.now(), {
        skip: skipFor({ ...query }),
        limit: query.pageSize,
      });
      return paginated(await toDtos(result.data, viewer), result.total, query);
    },

    async list(query, viewer) {
      // 04 API-052: reception, admin and stylists; customers use GET /bookings/me.
      if (viewer.role === 'CUSTOMER') throw new ForbiddenError();
      const s = await settings.get();
      const empty = paginated<BookingDto>([], 0, query);
      // STAFF only ever see their own bookings (04 API-052).
      let staffId = query.staffId;
      if (viewer.role === 'STAFF') {
        if (!viewer.staffId) return empty;
        staffId = viewer.staffId;
      }
      const criteria: Omit<BookingSearch, 'skip' | 'limit' | 'sort'> = {};
      const first = query.date ?? query.from;
      const last = query.date ?? query.to;
      if (first) criteria.from = startOfZonedDay(first, s.timezone);
      if (last) criteria.to = startOfZonedDay(addDays(last, 1), s.timezone);
      if (staffId) criteria.staffId = staffId;
      if (query.status) criteria.status = query.status;
      let customerIds = query.customerId ? [query.customerId] : undefined;
      if (query.q) {
        if (/^ss-/i.test(query.q)) {
          criteria.bookingRefPrefix = query.q.toUpperCase();
        } else {
          const byPhone = await users.idsByPhonePrefix(query.q);
          customerIds = customerIds ? customerIds.filter((id) => byPhone.includes(id)) : byPhone;
          if (customerIds.length === 0) return empty;
        }
      }
      if (customerIds) criteria.customerIds = customerIds;
      const result = await repository.search({
        ...criteria,
        skip: skipFor(query),
        limit: query.pageSize,
        sort: parseSort(query.sort, ['startAt', 'createdAt'], { startAt: 1 }),
      });
      return paginated(await toDtos(result.data, viewer), result.total, query);
    },

    async get(id, viewer) {
      return toDto(await requireVisible(id, viewer), viewer);
    },

    async reschedule(id, body, viewer) {
      const booking = await requireVisible(id, viewer);
      const s = await settings.get();
      assertChangeAllowed(booking, viewer, body.override, s);
      const startAt = new Date(body.startAt);
      const oldStaffId = booking.staffId.toHexString();
      const staffId = body.staffId ?? oldStaffId;
      if (startAt.getTime() === booking.startAt.getTime() && staffId === oldStaffId) {
        return toDto(booking, viewer);
      }
      // BR-015: re-validate BR-001..007 for the target. The booked services keep their
      // snapshot (duration and price); they must still be bookable with this stylist.
      await availability.plan(
        booking.services.map((svc) => svc.serviceId.toHexString()),
        staffId,
      );
      const date = assertStartAllowed(startAt, viewer, s);
      const endAt = new Date(startAt.getTime() + booking.totalDurationMin * MINUTE);
      const blockedUntil = new Date(endAt.getTime() + s.bufferMin * MINUTE);
      const windows = await availability.workingWindows(staffId, date, s);
      if (!fitsWithin(windows, { start: startAt.getTime(), end: blockedUntil.getTime() }))
        throw outsideHours();

      const lockKey = cacheKeys.staffDayLock(staffId, date);
      const token = await lock.acquire(lockKey);
      if (!token) throw slotUnavailable();
      let updated: BookingDoc | null;
      try {
        updated = await withTransaction(connection, async (session) => {
          // The guard covers the target stylist/day; freeing the old slot needs none (02 §2.18).
          await bumpStaffDayGuards(session, [{ staffId, date }]);
          const clash = await repository.countActive(
            { staffId, from: startAt, to: blockedUntil, excludeId: booking._id },
            session,
          );
          if (clash > 0) return null;
          const next = await repository.apply(
            booking._id,
            booking.__v,
            {
              set: { startAt, endAt, blockedUntil, staffId: new Types.ObjectId(staffId) },
              // The new time gets its own reminders (decision 2026-10-07, 09 §7).
              unset: ['reminders.h24SentAt', 'reminders.h2SentAt'],
            },
            session,
          );
          await audit.record(
            {
              action: 'booking.reschedule',
              entityType: 'booking',
              entityId: id,
              before: { startAt: booking.startAt.toISOString(), staffId: oldStaffId },
              after: { startAt: next.startAt.toISOString(), staffId },
              ...(body.override ? { metadata: { override: true, reason: body.reason } } : {}),
            },
            session,
          );
          if (body.override) await recordOverride(session, booking, 'reschedule', body.reason);
          // EVT-011
          await outbox.add(session, {
            type: 'booking.rescheduled',
            aggregateType: 'booking',
            aggregateId: id,
            payload: {
              bookingId: id,
              from: { startAt: booking.startAt.toISOString(), staffId: oldStaffId },
              to: { startAt: next.startAt.toISOString(), staffId },
            },
          });
          return next;
        });
      } finally {
        await lock.release(lockKey, token);
      }
      if (!updated) throw slotUnavailable();
      await invalidate(oldStaffId, [toZonedDate(booking.startAt, s.timezone)]);
      await invalidate(staffId, [date]);
      return toDto(updated, viewer);
    },

    async cancel(id, body, viewer) {
      const booking = await requireVisible(id, viewer);
      const s = await settings.get();
      assertChangeAllowed(booking, viewer, body.override, s);
      const updated = await withTransaction(connection, async (session) => {
        const next = await cancelInSession(booking, session, {
          by: viewer.userId,
          reason: body.reason,
          overridden: body.override ?? false,
          ...(body.override ? { metadata: { override: true } } : {}),
        });
        if (body.override) await recordOverride(session, booking, 'cancel', body.reason);
        return next;
      });
      // US-02: the slot is available to others immediately.
      await invalidate(booking.staffId.toHexString(), [toZonedDate(booking.startAt, s.timezone)]);
      return toDto(updated, viewer);
    },

    async changeStatus(id, body, viewer) {
      const booking = await requireVisible(id, viewer);
      if (!canTransition(booking.status, body.status))
        throw invalidTransition(booking.status, body.status);
      // A no-show can only be recorded once the appointment time has come (decision 2026-10-07).
      if (body.status === 'NO_SHOW' && clock.now().getTime() < booking.startAt.getTime()) {
        throw new BusinessRuleError(
          'INVALID_STATUS_TRANSITION',
          'A booking can be marked as a no-show only after its start time. Cancel it instead.',
        );
      }
      const s = await settings.get();
      const updated = await withTransaction(connection, (session) =>
        transitionInSession(booking, body.status, session, {
          by: viewer.userId,
          ...(body.note ? { note: body.note } : {}),
        }),
      );
      // 08 §2: a no-show frees the rest of the slot.
      if (body.status === 'NO_SHOW') {
        await invalidate(booking.staffId.toHexString(), [toZonedDate(booking.startAt, s.timezone)]);
      }
      return toDto(updated, viewer);
    },

    // reminders-24h / reminders-2h (09 §7): BOOKED bookings starting in (now + lead - scan,
    // now + lead] get their flag set and EVT-017 queued, atomically. Runs every `scanMs`, so
    // consecutive runs tile the timeline.
    async queueReminders(window, scanMs) {
      const now = clock.now();
      const until = new Date(now.getTime() + REMINDER_LEAD_MS[window]);
      const field = REMINDER_FIELD[window];
      const due = await repository.findDueReminders(
        field,
        new Date(until.getTime() - scanMs),
        until,
        JOB_BATCH,
      );
      let queued = 0;
      for (const booking of due) {
        const id = booking._id.toHexString();
        const marked = await withTransaction(connection, async (session) => {
          if (!(await repository.markReminderSent(booking._id, field, now, session))) return false;
          await outbox.add(session, {
            type: 'booking.reminder_due',
            aggregateType: 'booking',
            aggregateId: id,
            payload: {
              bookingId: id,
              customerId: booking.customerId.toHexString(),
              startAt: booking.startAt.toISOString(),
              window,
            },
            actor: SYSTEM_ACTOR,
          });
          return true;
        });
        if (marked) queued++;
      }
      return queued;
    },

    // auto-no-show (FR-042, 09 §7): BOOKED bookings that started more than noShowGraceMin ago.
    async markNoShows() {
      const s = await settings.get();
      const now = clock.now();
      const overdue = await repository.findOverdueBooked(
        new Date(now.getTime() - s.noShowGraceMin * MINUTE),
        JOB_BATCH,
      );
      let marked = 0;
      for (const booking of overdue) {
        try {
          await withTransaction(connection, (session) =>
            transitionInSession(booking, 'NO_SHOW', session, { by: 'system', system: true }),
          );
        } catch (err) {
          // Changed since it was read (e.g. checked in just now): the next run re-reads it.
          if (err instanceof AppError && err.code === 'STALE_VERSION') continue;
          throw err;
        }
        marked++;
        await invalidate(booking.staffId.toHexString(), [toZonedDate(booking.startAt, s.timezone)]);
      }
      return marked;
    },

    async history(id) {
      const booking = Types.ObjectId.isValid(id) ? await repository.findById(id) : null;
      if (!booking) throw new NotFoundError('Booking not found.');
      const entries = await auditLog.find(
        { entityType: 'booking', entityId: id },
        { skip: 0, limit: 200, sort: { at: 1, _id: 1 } },
      );
      return {
        statusHistory: booking.statusHistory.map((h) => ({
          status: h.status,
          at: h.at.toISOString(),
          by: h.by,
          ...(h.note ? { note: h.note } : {}),
        })),
        audit: entries.map((e) => ({
          at: e.at.toISOString(),
          action: e.action,
          actor: { id: e.actor.id, role: e.actor.role },
          diff: e.diff,
          before: e.before,
          after: e.after,
          ...(e.metadata ? { metadata: e.metadata } : {}),
        })),
      };
    },
  };
}
