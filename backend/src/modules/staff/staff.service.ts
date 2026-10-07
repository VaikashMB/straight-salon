import { Types, type ClientSession, type Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import { assertPermission, canDo } from '../../shared/auth/middleware.js';
import { hasPermission, type Permission } from '../../shared/auth/permissions.js';
import type { Cache } from '../../shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../shared/cache/keys.js';
import { bumpStaffDayGuards } from '../../shared/db/staffDayGuard.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import type { EventType } from '../../shared/events/registry.js';
import type { Clock } from '../../shared/time/clock.js';
import { addDays, startOfZonedDay, zonedDatesBetween } from '../../shared/time/tz.js';
import type { ActiveBookingsGate } from '../bookings/bookings.gate.js';
import type { StylistSummaryDto } from '../catalog/catalog.schemas.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { UsersService } from '../users/users.service.js';
import {
  defaultWeekly,
  normaliseWeekly,
  staffAuditView,
  timeOffAuditView,
  toScheduleDto,
  toStaffDto,
  toStylistSummary,
  toTimeOffDto,
} from './staff.mapper.js';
import type { StaffDoc } from './staff.model.js';
import type { StaffChanges, StaffRepository } from './staff.repository.js';
import type {
  CreateStaffBody,
  CreateTimeOffBody,
  ListStaffQuery,
  ListTimeOffQuery,
  PutScheduleBody,
  ScheduleDto,
  StaffDto,
  StaffProfileDto,
  TimeOffDto,
  UpdateStaffBody,
} from './staff.schemas.js';

// Staff module public interface: profiles, weekly schedules and time-off.

export interface StaffService {
  list(query: ListStaffQuery, viewer?: AuthContext): Promise<StaffDto[]>;
  getProfile(id: string, viewer?: AuthContext): Promise<StaffProfileDto>;
  create(body: CreateStaffBody): Promise<StaffDto>;
  update(id: string, body: UpdateStaffBody): Promise<StaffDto>;
  getSchedule(id: string, viewer: AuthContext): Promise<ScheduleDto>;
  putSchedule(id: string, body: PutScheduleBody): Promise<ScheduleDto>;
  listTimeOff(id: string, query: ListTimeOffQuery, viewer: AuthContext): Promise<TimeOffDto[]>;
  createTimeOff(id: string, body: CreateTimeOffBody, viewer: AuthContext): Promise<TimeOffDto>;
  deleteTimeOff(id: string, timeOffId: string, viewer: AuthContext): Promise<void>;
  // For other modules
  stylistsForService(serviceId: string): Promise<StylistSummaryDto[]>;
  findIdByUserId(userId: string): Promise<string | undefined>; // staffId access-token claim
}

export interface StaffServiceDeps {
  repository: StaffRepository;
  audit: AuditService;
  outbox: Outbox;
  cache: Cache;
  connection: Connection;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  catalog: Pick<CatalogService, 'findServices'>;
  users: Pick<UsersService, 'findActiveById'>;
  bookings: ActiveBookingsGate;
}

const TTL = { list: 600, profile: 1800 }; // 08 §2
const STAFF_EVENT_TAGS = [cacheTags.staff, cacheTags.catalog];

const asObjectId = (id: string) => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null);

// "own" permissions apply only to the stylist's own profile (06 §3). Staff ids are public
// (API-030), so another stylist's resource is a 403, not a hidden 404.
function assertOwnOrAny(viewer: AuthContext, staffId: string, any: Permission, own: Permission) {
  if (hasPermission(viewer.role, any)) return;
  if (hasPermission(viewer.role, own) && viewer.staffId === staffId) return;
  throw new ForbiddenError('You can only do this for your own profile.');
}

export function createStaffService(deps: StaffServiceDeps): StaffService {
  const {
    repository,
    audit,
    outbox,
    cache,
    connection,
    clock,
    settings,
    catalog,
    users,
    bookings,
  } = deps;

  async function requireStaff(id: string): Promise<StaffDoc> {
    const objectId = asObjectId(id);
    const staff = objectId ? await repository.findById(objectId) : null;
    if (!staff) throw new NotFoundError('Stylist not found.');
    return staff;
  }

  // Every id must be a service; newly added ones must also be active (BR-007 later checks
  // activeness at booking time, so keeping an already-assigned deactivated service is harmless).
  async function assertServices(ids: string[], alreadyAssigned: string[] = []): Promise<void> {
    const found = new Map((await catalog.findServices(ids)).map((s) => [s.id, s]));
    const errors = ids.flatMap((id, index) => {
      const service = found.get(id);
      if (!service) return [{ path: `serviceIds.${index}`, message: 'Service not found' }];
      if (!service.isActive && !alreadyAssigned.includes(id))
        return [{ path: `serviceIds.${index}`, message: 'Service is not active' }];
      return [];
    });
    if (errors.length > 0) throw new ValidationError('The request is invalid.', errors);
  }

  async function staffEvent(
    session: ClientSession,
    type: Extract<EventType, `staff.${string}`>,
    staffId: string,
    affectedDates: string[] = [],
  ): Promise<void> {
    // EVT-030. An empty affectedDates list means "all dates".
    await outbox.add(session, {
      type,
      aggregateType: 'staff',
      aggregateId: staffId,
      payload: { staffId, affectedDates },
    });
  }

  const invalidateStaff = () => cache.invalidateTag(cacheTags.staff);

  async function loadProfile(staff: StaffDoc, admin: boolean): Promise<StaffProfileDto> {
    const services = await catalog.findServices(staff.serviceIds.map((id) => id.toHexString()));
    return {
      ...toStaffDto(staff, { admin }),
      services: admin ? services : services.filter((s) => s.isActive),
    };
  }

  // Active bookings in `scope` block the change unless `force` cancels them (BR-014, FR-024).
  async function clearActiveBookings(
    session: ClientSession,
    scope: { staffId: string; from: Date; to?: Date },
    force: boolean | undefined,
    reason: string,
  ): Promise<number> {
    const active = await bookings.countActive(scope, session);
    if (active === 0) return 0;
    if (!force) {
      throw new BusinessRuleError(
        'ACTIVE_BOOKINGS_EXIST',
        `${active} active booking(s) are affected. Reschedule them first, or pass force: true to cancel them and notify the customers.`,
      );
    }
    return bookings.cancelActive(scope, reason, session);
  }

  return {
    async list(query, viewer) {
      if (query.includeInactive) {
        assertPermission(viewer, 'staff:manage');
        const all = await repository.list({
          ...(query.serviceId ? { serviceId: query.serviceId } : {}),
          includeInactive: true,
        });
        return all.map((s) => toStaffDto(s, { admin: true }));
      }
      return cache.cacheAside(
        cacheKeys.staffList(query.serviceId ?? 'all'),
        TTL.list,
        async () =>
          (
            await repository.list({
              ...(query.serviceId ? { serviceId: query.serviceId } : {}),
              includeInactive: false,
            })
          ).map((s) => toStaffDto(s)),
        { tags: STAFF_EVENT_TAGS },
      );
    },

    async getProfile(id, viewer) {
      // Admins see deactivated stylists and admin fields, uncached.
      if (canDo(viewer, 'staff:manage')) return loadProfile(await requireStaff(id), true);
      const objectId = asObjectId(id);
      if (!objectId) throw new NotFoundError('Stylist not found.');
      const profile = await cache.cacheAside(
        cacheKeys.staff(objectId.toHexString()),
        TTL.profile,
        async () => {
          const staff = await repository.findById(objectId);
          return staff?.isActive ? loadProfile(staff, false) : null;
        },
        { tags: STAFF_EVENT_TAGS },
      );
      if (!profile) throw new NotFoundError('Stylist not found.');
      return profile;
    },

    async create(body) {
      const user = await users.findActiveById(body.userId);
      if (user?.role !== 'STAFF') {
        throw new ValidationError('The request is invalid.', [
          { path: 'userId', message: 'Must be an active user with role STAFF' },
        ]);
      }
      if (await repository.findByUserId(body.userId)) {
        throw new ConflictError('This user already has a stylist profile.');
      }
      await assertServices(body.serviceIds);
      const weekly = defaultWeekly(await settings.get());

      const created = await withTransaction(connection, async (session) => {
        const staff = await repository.create(
          {
            userId: user._id,
            displayName: body.displayName,
            serviceIds: body.serviceIds.map((id) => new Types.ObjectId(id)),
            ...(body.bio ? { bio: body.bio } : {}),
            ...(body.photoUrl ? { photoUrl: body.photoUrl } : {}),
          },
          session,
        );
        // FR-023: starts with the salon's hours; the admin edits it via API-034.
        await repository.saveSchedule(staff._id, weekly, session);
        await audit.record(
          {
            action: 'staff.create',
            entityType: 'staff',
            entityId: staff._id.toHexString(),
            before: null,
            after: staffAuditView(staff),
          },
          session,
        );
        await staffEvent(session, 'staff.updated', staff._id.toHexString());
        return staff;
      });
      await invalidateStaff();
      return toStaffDto(created, { admin: true });
    },

    async update(id, body) {
      const staff = await requireStaff(id);
      const assigned = staff.serviceIds.map((s) => s.toHexString());
      const changes: StaffChanges = {};
      if (body.displayName !== undefined && body.displayName !== staff.displayName)
        changes.displayName = body.displayName;
      if (body.bio !== undefined && body.bio !== (staff.bio ?? null))
        changes.bio = body.bio || null;
      if (body.photoUrl !== undefined && body.photoUrl !== (staff.photoUrl ?? null))
        changes.photoUrl = body.photoUrl;
      if (body.serviceIds !== undefined && body.serviceIds.join() !== assigned.join()) {
        await assertServices(body.serviceIds, assigned);
        changes.serviceIds = body.serviceIds.map((s) => new Types.ObjectId(s));
      }
      if (body.isActive !== undefined && body.isActive !== staff.isActive)
        changes.isActive = body.isActive;
      if (Object.keys(changes).length === 0) return toStaffDto(staff, { admin: true });

      const updated = await withTransaction(connection, async (session) => {
        // BR-014: deactivating with future active bookings needs force (cancel + notify).
        const cancelled =
          changes.isActive === false
            ? await clearActiveBookings(
                session,
                { staffId: id, from: clock.now() },
                body.force,
                'Stylist no longer available',
              )
            : 0;
        const next = await repository.update(staff._id, staff.__v, changes, session);
        await audit.record(
          {
            action: changes.isActive === false ? 'staff.deactivate' : 'staff.update',
            entityType: 'staff',
            entityId: id,
            before: staffAuditView(staff),
            after: staffAuditView(next),
            ...(cancelled > 0 ? { metadata: { force: true, cancelledBookings: cancelled } } : {}),
          },
          session,
        );
        await staffEvent(session, 'staff.updated', id);
        return next;
      });
      await invalidateStaff();
      return toStaffDto(updated, { admin: true });
    },

    async getSchedule(id, viewer) {
      assertOwnOrAny(viewer, id, 'schedule:read:any', 'schedule:read:own');
      const staff = await requireStaff(id);
      const schedule = await repository.findSchedule(staff._id);
      return toScheduleDto(id, schedule ?? { weekly: defaultWeekly(await settings.get()) });
    },

    async putSchedule(id, body) {
      const staff = await requireStaff(id);
      const previous = await repository.findSchedule(staff._id);
      const before = normaliseWeekly(previous?.weekly ?? defaultWeekly(await settings.get()));
      const weekly = normaliseWeekly(body.weekly);
      if (JSON.stringify(before) === JSON.stringify(weekly)) return toScheduleDto(id, { weekly });

      const saved = await withTransaction(connection, async (session) => {
        const schedule = await repository.saveSchedule(staff._id, weekly, session);
        await audit.record(
          {
            action: 'staff.schedule_update',
            entityType: 'staff',
            entityId: id,
            before: { weekly: before },
            after: { weekly },
          },
          session,
        );
        await staffEvent(session, 'staff.schedule_changed', id);
        return schedule;
      });
      return toScheduleDto(id, saved);
    },

    async listTimeOff(id, query, viewer) {
      assertOwnOrAny(viewer, id, 'schedule:read:any', 'schedule:read:own');
      const staff = await requireStaff(id);
      const { timezone } = await settings.get();
      const timeOff = await repository.listTimeOff(staff._id, {
        ...(query.from ? { from: startOfZonedDay(query.from, timezone) } : {}),
        ...(query.to ? { to: startOfZonedDay(addDays(query.to, 1), timezone) } : {}),
      });
      return timeOff.map(toTimeOffDto);
    },

    async createTimeOff(id, body, viewer) {
      assertOwnOrAny(viewer, id, 'timeoff:manage:any', 'timeoff:manage:own');
      if (body.force && !hasPermission(viewer.role, 'timeoff:manage:any')) {
        throw new ForbiddenError('Only an admin can force time-off over existing bookings.');
      }
      const staff = await requireStaff(id);
      const startAt = new Date(body.startAt);
      const endAt = new Date(body.endAt);
      const { timezone } = await settings.get();
      const dates = zonedDatesBetween(startAt, endAt, timezone);

      const created = await withTransaction(connection, async (session) => {
        // 02 §2.18: time-off races booking creation for the same stylist/day like a booking.
        await bumpStaffDayGuards(
          session,
          dates.map((date) => ({ staffId: staff._id, date })),
        );
        const cancelled = await clearActiveBookings(
          session,
          { staffId: id, from: startAt, to: endAt },
          body.force,
          body.reason ? `Stylist unavailable: ${body.reason}` : 'Stylist unavailable',
        );
        const timeOff = await repository.createTimeOff(
          {
            staffId: staff._id,
            startAt,
            endAt,
            createdBy: new Types.ObjectId(viewer.userId),
            ...(body.reason ? { reason: body.reason } : {}),
          },
          session,
        );
        await audit.record(
          {
            action: 'timeoff.create',
            entityType: 'staff',
            entityId: id,
            before: null,
            after: timeOffAuditView(timeOff),
            metadata: {
              timeOffId: timeOff._id.toHexString(),
              ...(cancelled > 0 ? { force: true, cancelledBookings: cancelled } : {}),
            },
          },
          session,
        );
        await staffEvent(session, 'staff.timeoff_changed', id, dates);
        return timeOff;
      });
      return toTimeOffDto(created);
    },

    async deleteTimeOff(id, timeOffId, viewer) {
      assertOwnOrAny(viewer, id, 'timeoff:manage:any', 'timeoff:manage:own');
      const timeOff = await repository.findTimeOff(timeOffId);
      if (timeOff?.staffId.toHexString() !== id) throw new NotFoundError('Time-off not found.');
      const { timezone } = await settings.get();

      await withTransaction(connection, async (session) => {
        if (!(await repository.deleteTimeOff(timeOff._id, session))) {
          throw new NotFoundError('Time-off not found.');
        }
        await audit.record(
          {
            action: 'timeoff.delete',
            entityType: 'staff',
            entityId: id,
            before: timeOffAuditView(timeOff),
            after: null,
            metadata: { timeOffId },
          },
          session,
        );
        await staffEvent(
          session,
          'staff.timeoff_changed',
          id,
          zonedDatesBetween(timeOff.startAt, timeOff.endAt, timezone),
        );
      });
    },

    async stylistsForService(serviceId) {
      if (!Types.ObjectId.isValid(serviceId)) return [];
      return (await repository.list({ serviceId, includeInactive: false })).map(toStylistSummary);
    },

    async findIdByUserId(userId) {
      const staff = Types.ObjectId.isValid(userId) ? await repository.findByUserId(userId) : null;
      return staff?._id.toHexString();
    },
  };
}
