import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toAuditView, toUserDto } from '../users.mapper.js';
import type { UserDoc } from '../users.model.js';
import { searchFilter } from '../users.repository.js';
import {
  AdminUpdateBodySchema,
  ListUsersQuerySchema,
  UpdateMeBodySchema,
} from '../users.schemas.js';

const base: UserDoc = {
  _id: new Types.ObjectId('6712c0f9a1b2c3d4e5f60111'),
  name: 'Ananya R',
  email: 'ananya@example.com',
  phone: '+919876543212',
  passwordHash: '$2b$12$secret',
  role: 'CUSTOMER',
  isActive: true,
  isWalkIn: false,
  preferences: {
    smsOptIn: true,
    emailOptIn: false,
    preferredStaffId: new Types.ObjectId('6712c0f9a1b2c3d4e5f60222'),
  },
  lastLoginAt: new Date('2026-10-06T09:00:00Z'),
  createdAt: new Date('2026-10-01T09:00:00Z'),
  updatedAt: new Date('2026-10-02T09:00:00Z'),
};

describe('toUserDto', () => {
  it('maps _id to id, ISO dates, and never exposes passwordHash', () => {
    const dto = toUserDto(base);
    expect(dto).toEqual({
      id: '6712c0f9a1b2c3d4e5f60111',
      name: 'Ananya R',
      email: 'ananya@example.com',
      phone: '+919876543212',
      role: 'CUSTOMER',
      isActive: true,
      isWalkIn: false,
      preferences: {
        smsOptIn: true,
        emailOptIn: false,
        preferredStaffId: '6712c0f9a1b2c3d4e5f60222',
      },
      lastLoginAt: '2026-10-06T09:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('secret');
  });

  it('omits optional fields for a walk-in', () => {
    const walkIn = {
      ...base,
      email: undefined,
      lastLoginAt: undefined,
      preferences: undefined,
      isWalkIn: true,
    } as unknown as UserDoc;
    const dto = toUserDto(walkIn);
    expect(dto).not.toHaveProperty('email');
    expect(dto).not.toHaveProperty('lastLoginAt');
    expect(dto.preferences).toEqual({ smsOptIn: true, emailOptIn: true });
    expect(toAuditView(walkIn)).toMatchObject({
      email: null,
      preferences: { preferredStaffId: null, smsOptIn: true, emailOptIn: true },
    });
  });
});

describe('searchFilter (API-011 q)', () => {
  it('phone digits -> anchored phone prefix (adds +), as a trusted operator', () => {
    // trusted() adds a hidden Symbol marker; compare the serialised filter.
    expect(JSON.parse(JSON.stringify(searchFilter({ q: '9198' })))).toEqual({
      phone: { $regex: '^\\+9198' },
    });
  });

  it('email -> lowercased escaped prefix; words -> $text; plus role/isActive', () => {
    expect(JSON.parse(JSON.stringify(searchFilter({ q: 'A.B@x' })))).toEqual({
      email: { $regex: '^a\\.b@x' },
    });
    expect(
      JSON.parse(JSON.stringify(searchFilter({ q: 'ananya', role: 'CUSTOMER', isActive: false }))),
    ).toEqual({
      role: 'CUSTOMER',
      isActive: false,
      $text: { $search: 'ananya' },
    });
    expect(searchFilter({ q: '   ' })).toEqual({});
  });
});

describe('users request schemas', () => {
  it('UpdateMe needs at least one field and rejects unknown ones (incl. role)', () => {
    expect(UpdateMeBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ preferences: { smsOptIn: false } }).success).toBe(true);
  });

  it('AdminUpdate needs role or isActive', () => {
    expect(AdminUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(AdminUpdateBodySchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('ListUsers coerces isActive and paging', () => {
    expect(ListUsersQuerySchema.parse({ isActive: 'false', page: '2' })).toMatchObject({
      isActive: false,
      page: 2,
      pageSize: 20,
    });
  });
});
