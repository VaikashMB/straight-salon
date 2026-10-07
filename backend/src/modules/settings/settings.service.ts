import type { Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { Cache } from '../../shared/cache/cache.js';
import { cacheKeys, cacheTags } from '../../shared/cache/keys.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { BusinessRuleError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import type { Clock } from '../../shared/time/clock.js';
import type { ActiveBookingsGate } from '../bookings/bookings.gate.js';
import {
  changedKeys,
  fieldsFromBody,
  toFields,
  toPublicSettingsDto,
  toSettingsDto,
} from './settings.mapper.js';
import { DEFAULT_SETTINGS, SETTINGS_ID } from './settings.model.js';
import type { SettingsRepository } from './settings.repository.js';
import type { PublicSettingsDto, SettingsDto, UpdateSettingsBody } from './settings.schemas.js';

// Settings module public interface. Other modules read the salon's rules through get(), which
// is cached (08 §2) and returns defaults until an admin first saves settings.

export interface SettingsService {
  get(): Promise<SettingsDto>;
  getPublic(): Promise<PublicSettingsDto>;
  update(body: UpdateSettingsBody): Promise<SettingsDto>;
}

// Implemented by the catalog module; passed in to avoid a settings <-> catalog import cycle.
export interface ServiceDurationSource {
  activeServiceDurations(): Promise<{ name: string; durationMin: number }[]>;
}

export interface SettingsServiceDeps {
  repository: SettingsRepository;
  audit: AuditService;
  outbox: Outbox;
  cache: Cache;
  connection: Connection;
  clock: Clock;
  bookings: ActiveBookingsGate;
  services: ServiceDurationSource;
}

const TTL_SECONDS = 600; // 08 §2: 10 min

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { repository, audit, outbox, cache, connection, clock, bookings, services } = deps;

  const load = async () => {
    const doc = await repository.find();
    return doc ? toSettingsDto(doc) : toSettingsDto(DEFAULT_SETTINGS);
  };

  async function get(): Promise<SettingsDto> {
    return cache.cacheAside(cacheKeys.settingsFull(), TTL_SECONDS, load, {
      tags: [cacheTags.settings],
    });
  }

  // BR-013: every active service must still fit the new granularity. Inactive services are
  // re-checked when they are reactivated (catalog service).
  async function assertDurationsFit(granularity: number): Promise<void> {
    const misfits = (await services.activeServiceDurations()).filter(
      (service) => service.durationMin % granularity !== 0,
    );
    if (misfits.length > 0) {
      throw new BusinessRuleError(
        'INVALID_DURATION',
        `These services are not a multiple of ${granularity} minutes: ${misfits.map((s) => s.name).join(', ')}. Change their duration first.`,
        [
          {
            path: 'slotGranularityMin',
            message: `Not compatible with ${misfits.length} service(s)`,
          },
        ],
      );
    }
  }

  return {
    get,

    async getPublic() {
      return cache.cacheAside(
        cacheKeys.settingsPublic(),
        TTL_SECONDS,
        async () => toPublicSettingsDto(await get()),
        { tags: [cacheTags.settings] },
      );
    },

    async update(body) {
      const current = await repository.find();
      const before = toFields(current ?? DEFAULT_SETTINGS);
      const after = fieldsFromBody(body);
      const changed = changedKeys(before, after);
      if (changed.length === 0) return toSettingsDto(current ?? DEFAULT_SETTINGS);

      if (after.slotGranularityMin !== before.slotGranularityMin) {
        await assertDurationsFit(after.slotGranularityMin);
      }
      // FR-080: staff schedules are local wall-clock times, so the timezone is frozen while
      // future active bookings exist.
      if (
        after.timezone !== before.timezone &&
        (await bookings.countActive({ from: clock.now() })) > 0
      ) {
        throw new BusinessRuleError(
          'ACTIVE_BOOKINGS_EXIST',
          'The timezone cannot change while future bookings exist.',
          [{ path: 'timezone', message: 'Future active bookings exist' }],
        );
      }

      const saved = await withTransaction(connection, async (session) => {
        const doc = await repository.save(after, current?.__v ?? null, session);
        await audit.record(
          {
            action: 'settings.update',
            entityType: 'settings',
            entityId: SETTINGS_ID,
            before: { ...before },
            after: { ...toFields(doc) },
          },
          session,
        );
        // EVT-032
        await outbox.add(session, {
          type: 'settings.changed',
          aggregateType: 'settings',
          aggregateId: SETTINGS_ID,
          payload: { changedKeys: changed },
        });
        return doc;
      });

      // 08 §4: invalidate after commit. Catalog prices carry the currency, so those go too.
      await cache.invalidateTag(cacheTags.settings);
      await cache.invalidateTag(cacheTags.catalog);
      return toSettingsDto(saved);
    },
  };
}
