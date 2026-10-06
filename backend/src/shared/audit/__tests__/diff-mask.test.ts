import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { diffPaths, isEqual, pickTopLevel } from '../diff.js';
import { maskEmail, maskPhone, maskPii } from '../mask.js';

describe('diffPaths (07 §2.2)', () => {
  it('lists changed, added and removed paths deeply', () => {
    const before = {
      status: 'BOOKED',
      notes: 'hi',
      preferences: { smsOptIn: true, emailOptIn: true },
    };
    const after = {
      status: 'CANCELLED',
      cancellation: { reason: 'Customer called', overridden: true },
      preferences: { smsOptIn: false, emailOptIn: true },
    };
    expect(diffPaths(before, after)).toEqual([
      'cancellation',
      'notes',
      'preferences.smsOptIn',
      'status',
    ]);
  });

  it('compares ObjectIds, Dates and arrays by value', () => {
    const id = new Types.ObjectId();
    const before = { staffId: id, at: new Date('2026-10-12T05:30:00Z'), serviceIds: ['a', 'b'] };
    const same = {
      staffId: new Types.ObjectId(id.toHexString()),
      at: new Date('2026-10-12T05:30:00Z'),
      serviceIds: ['a', 'b'],
    };
    expect(diffPaths(before, same)).toEqual([]);
    expect(diffPaths(before, { ...same, serviceIds: ['a'] })).toEqual(['serviceIds']);
    expect(diffPaths(before, { ...same, serviceIds: ['a', 'c'] })).toEqual(['serviceIds']);
  });

  it('treats a create (empty before) as every field changed', () => {
    expect(diffPaths({}, { name: 'Haircut', priceMinor: 40000 })).toEqual(['name', 'priceMinor']);
  });

  it('isEqual handles nested arrays of objects and type mismatches', () => {
    expect(isEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    expect(isEqual({ a: 1 }, [1])).toBe(false);
    expect(isEqual(Object.create(null) as object, {})).toBe(true);
  });
});

describe('pickTopLevel', () => {
  it('keeps only top-level fields touched by the diff', () => {
    expect(
      pickTopLevel({ status: 'X', notes: 'n', preferences: { a: 1 } }, ['status', 'preferences.a']),
    ).toEqual({
      status: 'X',
      preferences: { a: 1 },
    });
    expect(pickTopLevel(null, ['status'])).toBeNull();
  });
});

describe('PII masking (07 §2.2)', () => {
  it('masks emails and phones like the spec examples', () => {
    expect(maskEmail('ananya@x.com')).toBe('a***@x.com');
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskPhone('+919876543212')).toBe('+9198******12');
    expect(maskPhone('12345')).toBe('*****');
  });

  it('masks at any depth and leaves other values alone', () => {
    const id = new Types.ObjectId();
    const at = new Date();
    expect(
      maskPii({
        email: 'ravi@salon.in',
        profile: { phone: '+919811112222' },
        contacts: [{ email: 'a@b.c' }],
        id,
        at,
        n: 1,
      }),
    ).toEqual({
      email: 'r***@salon.in',
      profile: { phone: '+9198******22' },
      contacts: [{ email: 'a***@b.c' }],
      id,
      at,
      n: 1,
    });
  });
});
