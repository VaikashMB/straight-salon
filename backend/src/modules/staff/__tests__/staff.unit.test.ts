import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../settings/settings.model.js';
import { defaultWeekly, normaliseWeekly, toStaffDto, toTimeOffDto } from '../staff.mapper.js';
import type { StaffDoc } from '../staff.model.js';
import {
  CreateTimeOffBodySchema,
  PutScheduleBodySchema,
  UpdateStaffBodySchema,
} from '../staff.schemas.js';

const day = (dayOfWeek: number, overrides: object = {}) => ({
  dayOfWeek,
  isWorking: true,
  start: '10:00',
  end: '19:00',
  breaks: [{ start: '13:30', end: '14:15' }],
  ...overrides,
});
const week = (overrides: Record<number, object> = {}) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, overrides[d]));

describe('PutScheduleBodySchema (02 §2.7, API-034)', () => {
  it('accepts 7 days with breaks inside working hours', () => {
    expect(PutScheduleBodySchema.safeParse({ weekly: week() }).success).toBe(true);
    // A non-working day is not checked for times or breaks.
    expect(
      PutScheduleBodySchema.safeParse({
        weekly: week({ 1: { isWorking: false, start: '19:00', end: '10:00' } }),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['six days', { weekly: week().slice(1) }],
    ['a repeated weekday', { weekly: week().map((d) => ({ ...d, dayOfWeek: d.dayOfWeek || 1 })) }],
    ['start after end', { weekly: week({ 2: { start: '19:00', end: '10:00' } }) }],
    [
      'a break outside hours',
      { weekly: week({ 3: { breaks: [{ start: '09:00', end: '10:30' }] } }) },
    ],
    [
      'overlapping breaks',
      {
        weekly: week({
          4: {
            breaks: [
              { start: '15:00', end: '15:30' },
              { start: '13:00', end: '15:15' },
            ],
          },
        }),
      },
    ],
    [
      'a break ending before it starts',
      { weekly: week({ 5: { breaks: [{ start: '14:00', end: '13:00' }] } }) },
    ],
    ['a bad time format', { weekly: week({ 6: { start: '9:00' } }) }],
  ])('rejects %s', (_label, input) => {
    expect(PutScheduleBodySchema.safeParse(input).success).toBe(false);
  });
});

describe('CreateTimeOffBodySchema (API-036)', () => {
  it('needs endAt after startAt and at most 366 days', () => {
    const ok = { startAt: '2026-10-12T05:00:00Z', endAt: '2026-10-12T07:00:00Z' };
    expect(CreateTimeOffBodySchema.safeParse(ok).success).toBe(true);
    expect(CreateTimeOffBodySchema.safeParse({ ...ok, endAt: ok.startAt }).success).toBe(false);
    expect(
      CreateTimeOffBodySchema.safeParse({ ...ok, endAt: '2027-10-14T07:00:00Z' }).success,
    ).toBe(false);
    expect(CreateTimeOffBodySchema.safeParse({ ...ok, startAt: '12 Oct' }).success).toBe(false);
  });
});

describe('UpdateStaffBodySchema', () => {
  it('force alone is not a change; duplicate services are rejected', () => {
    expect(UpdateStaffBodySchema.safeParse({ force: true }).success).toBe(false);
    expect(UpdateStaffBodySchema.safeParse({ isActive: false, force: true }).success).toBe(true);
    const id = '6712c0f9a1b2c3d4e5f60501';
    expect(UpdateStaffBodySchema.safeParse({ serviceIds: [id, id] }).success).toBe(false);
  });
});

describe('staff mapper', () => {
  it('FR-023: the default schedule mirrors the salon hours', () => {
    const hours = DEFAULT_SETTINGS.businessHours.map((d) =>
      d.dayOfWeek === 0 ? { ...d, isOpen: false } : d,
    );
    const weekly = defaultWeekly({ businessHours: [...hours].reverse() });
    expect(weekly.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekly[0]).toEqual({
      dayOfWeek: 0,
      isWorking: false,
      start: '09:30',
      end: '20:30',
      breaks: [],
    });
  });

  it('normalises breaks into start order', () => {
    const [monday] = normaliseWeekly([
      day(1, {
        breaks: [
          { start: '16:00', end: '16:15' },
          { start: '13:30', end: '14:15' },
        ],
      }),
    ]);
    expect(monday!.breaks.map((b) => b.start)).toEqual(['13:30', '16:00']);
  });

  it('public DTOs hide admin fields', () => {
    const staff: StaffDoc = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      displayName: 'Ravi',
      serviceIds: [],
      isActive: true,
      ratingAvg: 0,
      ratingCount: 0,
      __v: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(toStaffDto(staff)).not.toHaveProperty('userId');
    expect(toStaffDto(staff)).not.toHaveProperty('isActive');
    expect(toStaffDto({ ...staff, bio: 'b', photoUrl: 'http://p' }, { admin: true })).toMatchObject(
      {
        userId: staff.userId.toHexString(),
        isActive: true,
        bio: 'b',
        photoUrl: 'http://p',
      },
    );
  });

  it('time-off DTO uses ISO instants', () => {
    const dto = toTimeOffDto({
      _id: new Types.ObjectId(),
      staffId: new Types.ObjectId(),
      startAt: new Date('2026-10-12T05:00:00Z'),
      endAt: new Date('2026-10-12T07:00:00Z'),
      createdBy: new Types.ObjectId(),
      createdAt: new Date('2026-10-06T00:00:00Z'),
      updatedAt: new Date('2026-10-06T00:00:00Z'),
    });
    expect(dto).toMatchObject({
      startAt: '2026-10-12T05:00:00.000Z',
      endAt: '2026-10-12T07:00:00.000Z',
    });
    expect(dto).not.toHaveProperty('reason');
  });
});
