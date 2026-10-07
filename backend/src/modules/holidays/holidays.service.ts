import { Types, type Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import { addDays, startOfZonedDay } from '../../shared/time/tz.js';
import type { ActiveBookingsGate } from '../bookings/bookings.gate.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toHolidayDto } from './holidays.mapper.js';
import type { HolidaysRepository } from './holidays.repository.js';
import type { CreateHolidayBody, HolidayDto, ListHolidaysQuery } from './holidays.schemas.js';

export interface HolidaysService {
  list(query: ListHolidaysQuery): Promise<HolidayDto[]>;
  create(body: CreateHolidayBody): Promise<HolidayDto>;
  delete(id: string): Promise<void>;
}

export interface HolidaysServiceDeps {
  repository: HolidaysRepository;
  audit: AuditService;
  outbox: Outbox;
  connection: Connection;
  settings: Pick<SettingsService, 'get'>;
  bookings: ActiveBookingsGate;
}

export function createHolidaysService(deps: HolidaysServiceDeps): HolidaysService {
  const { repository, audit, outbox, connection, settings, bookings } = deps;

  return {
    async list(query) {
      return (await repository.list(query)).map(toHolidayDto);
    },

    async create(body) {
      if (await repository.findByDate(body.date)) {
        throw new ConflictError(`${body.date} is already a holiday.`);
      }
      const { timezone } = await settings.get();
      const day = {
        from: startOfZonedDay(body.date, timezone),
        to: startOfZonedDay(addDays(body.date, 1), timezone),
      };

      const created = await withTransaction(connection, async (session) => {
        // API-020: active bookings that day block the closure unless force cancels them.
        const active = await bookings.countActive(day, session);
        if (active > 0 && !body.force) {
          throw new BusinessRuleError(
            'ACTIVE_BOOKINGS_EXIST',
            `${active} active booking(s) exist on ${body.date}. Move them, or pass force: true to cancel them and notify the customers.`,
          );
        }
        const cancelled =
          active > 0 ? await bookings.cancelActive(day, `Salon closed: ${body.name}`, session) : 0;
        const holiday = await repository.create({ date: body.date, name: body.name }, session);
        await audit.record(
          {
            action: 'holiday.create',
            entityType: 'holiday',
            entityId: holiday._id.toHexString(),
            before: null,
            after: { date: holiday.date, name: holiday.name },
            ...(cancelled > 0 ? { metadata: { force: true, cancelledBookings: cancelled } } : {}),
          },
          session,
        );
        // EVT-033
        await outbox.add(session, {
          type: 'holiday.changed',
          aggregateType: 'holiday',
          aggregateId: holiday._id.toHexString(),
          payload: { date: holiday.date },
        });
        return holiday;
      });
      return toHolidayDto(created);
    },

    async delete(id) {
      const holiday = Types.ObjectId.isValid(id) ? await repository.findById(id) : null;
      if (!holiday) throw new NotFoundError('Holiday not found.');
      await withTransaction(connection, async (session) => {
        if (!(await repository.delete(holiday._id, session))) {
          throw new NotFoundError('Holiday not found.');
        }
        await audit.record(
          {
            action: 'holiday.delete',
            entityType: 'holiday',
            entityId: id,
            before: { date: holiday.date, name: holiday.name },
            after: null,
          },
          session,
        );
        await outbox.add(session, {
          type: 'holiday.changed',
          aggregateType: 'holiday',
          aggregateId: id,
          payload: { date: holiday.date },
        });
      });
    },
  };
}
