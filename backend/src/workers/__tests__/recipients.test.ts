import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { BookingDoc } from '../../modules/bookings/bookings.model.js';
import type { SettingsDto } from '../../modules/settings/settings.schemas.js';
import type { UserDoc } from '../../modules/users/users.model.js';
import { bookingInfo, firstName, recipientsFor, salonInfo } from '../consumers/recipients.js';

function user(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    _id: new Types.ObjectId(),
    name: 'Ananya Rao',
    email: 'ananya@example.com',
    phone: '+919876543212',
    role: 'CUSTOMER',
    isActive: true,
    isWalkIn: false,
    preferences: { smsOptIn: true, emailOptIn: true },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('notification channel rules (decision 2026-10-07)', () => {
  it('booking messages go by email and SMS when both are opted in', () => {
    expect(recipientsFor(user(), 'booking')).toEqual([
      { channel: 'EMAIL', to: 'ananya@example.com' },
      { channel: 'SMS', to: '+919876543212' },
    ]);
  });

  it('FR-054: SMS opt-out removes SMS; email opt-out removes email', () => {
    expect(
      recipientsFor(user({ preferences: { smsOptIn: false, emailOptIn: true } }), 'booking'),
    ).toEqual([{ channel: 'EMAIL', to: 'ananya@example.com' }]);
    expect(
      recipientsFor(user({ preferences: { smsOptIn: true, emailOptIn: false } }), 'booking'),
    ).toEqual([{ channel: 'SMS', to: '+919876543212' }]);
  });

  it('walk-ins without an email get SMS only', () => {
    const walkIn = user({ isWalkIn: true });
    delete walkIn.email;
    expect(recipientsFor(walkIn, 'booking')).toEqual([{ channel: 'SMS', to: '+919876543212' }]);
    expect(recipientsFor(walkIn, 'account')).toEqual([]);
  });

  it('account messages are email only and ignore the opt-outs', () => {
    expect(
      recipientsFor(user({ preferences: { smsOptIn: false, emailOptIn: false } }), 'account'),
    ).toEqual([{ channel: 'EMAIL', to: 'ananya@example.com' }]);
  });

  it('deactivated accounts get nothing', () => {
    expect(recipientsFor(user({ isActive: false }), 'booking')).toEqual([]);
    expect(recipientsFor(user({ isActive: false }), 'account')).toEqual([]);
  });
});

describe('message data', () => {
  const settings = {
    name: 'Straight Salon',
    phone: '+919000000001',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  } as SettingsDto;

  it('formats a booking in salon time and currency', () => {
    const booking = {
      bookingRef: 'SS-261012-7KQ2',
      startAt: new Date('2026-10-12T05:30:00.000Z'),
      services: [
        { name: 'Haircut', serviceId: new Types.ObjectId(), durationMin: 45, priceMinor: 40_000 },
        {
          name: 'Beard Trim',
          serviceId: new Types.ObjectId(),
          durationMin: 15,
          priceMinor: 15_000,
        },
      ],
      totalPriceMinor: 55_000,
    } as BookingDoc;
    expect(bookingInfo(booking, settings, 'Ravi', 'https://x/b/1')).toEqual({
      ref: 'SS-261012-7KQ2',
      when: 'Mon 12 Oct 2026, 11:00',
      services: 'Haircut, Beard Trim',
      stylist: 'Ravi',
      total: '₹550.00',
      link: 'https://x/b/1',
    });
    expect(salonInfo(settings)).toEqual({ name: 'Straight Salon', phone: '+919000000001' });
    expect(firstName('  Ananya   Rao ')).toBe('Ananya');
  });
});
