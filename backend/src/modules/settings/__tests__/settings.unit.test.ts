import type { Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../../shared/audit/audit.service.js';
import type { Cache } from '../../../shared/cache/cache.js';
import type { Outbox } from '../../../shared/events/outbox.js';
import { createManualClock } from '../../../shared/time/clock.js';
import { changedKeys, toFields, toPublicSettingsDto, toSettingsDto } from '../settings.mapper.js';
import { DEFAULT_SETTINGS, type SettingsDoc } from '../settings.model.js';
import type { SettingsRepository } from '../settings.repository.js';
import { UpdateSettingsBodySchema, type UpdateSettingsBody } from '../settings.schemas.js';
import { createSettingsService } from '../settings.service.js';

const body = (overrides: Partial<UpdateSettingsBody> = {}): UpdateSettingsBody => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

describe('UpdateSettingsBodySchema (FR-080)', () => {
  it('accepts the defaults and normalises the email', () => {
    const parsed = UpdateSettingsBodySchema.parse({ ...body(), email: 'Hello@Salon.IN' });
    expect(parsed.email).toBe('hello@salon.in');
  });

  it.each([
    ['unknown timezone', { timezone: 'Mars/Olympus' }],
    ['unknown currency', { currency: 'XYZ' }],
    ['lowercase currency', { currency: 'inr' }],
    ['granularity that does not divide an hour', { slotGranularityMin: 25 }],
    ['six weekdays', { businessHours: DEFAULT_SETTINGS.businessHours.slice(1) }],
    [
      'duplicate weekday',
      {
        businessHours: DEFAULT_SETTINGS.businessHours.map((d) => ({
          ...d,
          dayOfWeek: d.dayOfWeek === 6 ? 5 : d.dayOfWeek,
        })),
      },
    ],
    [
      'open after close',
      {
        businessHours: DEFAULT_SETTINGS.businessHours.map((d) => ({
          ...d,
          open: '21:00',
        })),
      },
    ],
    ['negative buffer', { bufferMin: -5 }],
    ['unknown field', { colour: 'gold' }],
  ])('rejects %s', (_label, overrides) => {
    expect(UpdateSettingsBodySchema.safeParse({ ...body(), ...overrides }).success).toBe(false);
  });

  it('allows any times on a closed day', () => {
    const hours = DEFAULT_SETTINGS.businessHours.map((d) =>
      d.dayOfWeek === 1 ? { ...d, isOpen: false, open: '21:00', close: '09:00' } : d,
    );
    expect(UpdateSettingsBodySchema.safeParse(body({ businessHours: hours })).success).toBe(true);
  });
});

describe('settings mapper', () => {
  it('reports changed top-level keys only', () => {
    const before = toFields(DEFAULT_SETTINGS);
    const after = toFields({ ...DEFAULT_SETTINGS, name: 'New', address: 'Somewhere' });
    expect(changedKeys(before, after).sort()).toEqual(['address', 'name']);
    expect(changedKeys(before, toFields(DEFAULT_SETTINGS))).toEqual([]);
  });

  it('sorts business hours and keeps the public view to public fields', () => {
    const shuffled = {
      ...DEFAULT_SETTINGS,
      businessHours: [...DEFAULT_SETTINGS.businessHours].reverse(),
    };
    const dto = toSettingsDto(shuffled);
    expect(dto.businessHours.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const pub = toPublicSettingsDto({ ...dto, phone: '+918041234567' });
    expect(pub).toMatchObject({ phone: '+918041234567', maxAdvanceDays: 30 });
    expect(pub).not.toHaveProperty('bufferMin');
    expect(pub).not.toHaveProperty('noShowGraceMin');
  });
});

describe('settings service (API-018 rules)', () => {
  const doc: SettingsDoc = {
    ...DEFAULT_SETTINGS,
    _id: 'salon',
    __v: 3,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };

  function setup({ durations = [] as { name: string; durationMin: number }[], active = 0 } = {}) {
    const save = vi.fn<SettingsRepository['save']>((fields) =>
      Promise.resolve({ ...doc, ...fields, __v: 4 }),
    );
    const repository: SettingsRepository = { find: () => Promise.resolve(doc), save };
    const invalidateTag = vi.fn(() => Promise.resolve());
    const cache: Cache = {
      cacheAside: (_key, _ttl, loader) => loader(),
      invalidateTag,
      invalidateKeys: () => Promise.resolve(),
    };
    const record = vi.fn(() => Promise.resolve());
    const audit: AuditService = { record };
    const add = vi.fn(() => Promise.resolve());
    const outbox = { add } as unknown as Outbox;
    const connection = {
      transaction: (work: (session: object) => Promise<unknown>) => work({}),
    } as unknown as Connection;
    const countActive = vi.fn(() => Promise.resolve(active));
    const service = createSettingsService({
      repository,
      audit,
      outbox,
      cache,
      connection,
      clock: createManualClock('2026-10-06T00:00:00Z'),
      bookings: { countActive, cancelActive: vi.fn() },
      services: { activeServiceDurations: () => Promise.resolve(durations) },
    });
    return { service, save, record, add, invalidateTag, countActive };
  }

  it('a no-op update writes nothing', async () => {
    const { service, save, record } = setup();
    await service.update(body());
    expect(save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('saves with the read version, audits, emits settings.changed and invalidates', async () => {
    const { service, save, record, add, invalidateTag } = setup();
    const saved = await service.update(body({ name: 'Straight Salon Indiranagar' }));
    expect(saved.name).toBe('Straight Salon Indiranagar');
    expect(save).toHaveBeenCalledWith(expect.anything(), 3, expect.anything());
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settings.update', entityId: 'salon' }),
      expect.anything(),
    );
    expect(add).toHaveBeenCalledWith(expect.anything(), {
      type: 'settings.changed',
      aggregateType: 'settings',
      aggregateId: 'salon',
      payload: { changedKeys: ['name'] },
    });
    expect(invalidateTag).toHaveBeenCalledWith('settings');
    expect(invalidateTag).toHaveBeenCalledWith('catalog');
  });

  it('BR-013 rejects a granularity that an active service does not fit', async () => {
    const { service } = setup({ durations: [{ name: 'Beard Trim', durationMin: 15 }] });
    await expect(service.update(body({ slotGranularityMin: 30 }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_DURATION',
    });
  });

  it('BR-013 accepts a granularity every active service fits', async () => {
    const { service } = setup({ durations: [{ name: 'Haircut', durationMin: 60 }] });
    await expect(service.update(body({ slotGranularityMin: 30 }))).resolves.toMatchObject({
      slotGranularityMin: 30,
    });
  });

  it('FR-080 freezes the timezone while future active bookings exist', async () => {
    const blocked = setup({ active: 2 });
    await expect(blocked.service.update(body({ timezone: 'Asia/Dubai' }))).rejects.toMatchObject({
      code: 'ACTIVE_BOOKINGS_EXIST',
    });
    expect(blocked.countActive).toHaveBeenCalledWith({ from: new Date('2026-10-06T00:00:00Z') });
    // Other changes are not checked against bookings.
    await expect(blocked.service.update(body({ name: 'Other' }))).resolves.toBeDefined();
    const free = setup({ active: 0 });
    await expect(free.service.update(body({ timezone: 'Asia/Dubai' }))).resolves.toMatchObject({
      timezone: 'Asia/Dubai',
    });
  });
});
