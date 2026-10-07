import type { Schemas } from '@/lib/api/client';

// API fixtures for component tests. IDs are 24-hex ObjectIds like the API's.

export const ids = {
  hair: '6712c0f9a1b2c3d4e5f6c001',
  beard: '6712c0f9a1b2c3d4e5f6c002',
  haircut: '6712c0f9a1b2c3d4e5f6a001',
  beardTrim: '6712c0f9a1b2c3d4e5f6a002',
  colour: '6712c0f9a1b2c3d4e5f6a003',
  ravi: '6712c0f9a1b2c3d4e5f6b001',
  meera: '6712c0f9a1b2c3d4e5f6b002',
  booking: '6712c0f9a1b2c3d4e5f60789',
  customer: '6712c0f9a1b2c3d4e5f60111',
};

const inr = (amountMinor: number): Schemas['Money'] => ({ amountMinor, currency: 'INR' });

export function makeCategory(overrides: Partial<Schemas['Category']> = {}): Schemas['Category'] {
  return { id: ids.hair, name: 'Hair', slug: 'hair', sortOrder: 1, isActive: true, ...overrides };
}

export const categories: Schemas['Category'][] = [
  makeCategory(),
  makeCategory({ id: ids.beard, name: 'Beard & Grooming', slug: 'beard-grooming', sortOrder: 2 }),
];

export function makeService(overrides: Partial<Schemas['Service']> = {}): Schemas['Service'] {
  return {
    id: ids.haircut,
    slug: 'haircut',
    name: 'Haircut',
    description: 'Cut and style.',
    categoryId: ids.hair,
    durationMin: 45,
    price: inr(40_000),
    isActive: true,
    ratingAvg: 4.5,
    ratingCount: 12,
    ...overrides,
  };
}

export const services: Schemas['Service'][] = [
  makeService(),
  makeService({
    id: ids.beardTrim,
    slug: 'beard-trim',
    name: 'Beard Trim',
    categoryId: ids.beard,
    durationMin: 15,
    price: inr(15_000),
    ratingAvg: 0,
    ratingCount: 0,
  }),
  makeService({
    id: ids.colour,
    slug: 'hair-colour',
    name: 'Hair Colour',
    durationMin: 90,
    price: inr(150_000),
    ratingCount: 3,
  }),
];

export function makeStylist(overrides: Partial<Schemas['Staff']> = {}): Schemas['Staff'] {
  return {
    id: ids.ravi,
    displayName: 'Ravi',
    bio: 'Fades and classic cuts.',
    serviceIds: [ids.haircut, ids.beardTrim],
    ratingAvg: 4.8,
    ratingCount: 20,
    ...overrides,
  };
}

export const stylists: Schemas['Staff'][] = [
  makeStylist(),
  makeStylist({
    id: ids.meera,
    displayName: 'Meera',
    bio: 'Colour specialist.',
    serviceIds: [ids.haircut, ids.colour],
    ratingAvg: 4.6,
    ratingCount: 8,
  }),
];

export function makeBooking(overrides: Partial<Schemas['Booking']> = {}): Schemas['Booking'] {
  return {
    id: ids.booking,
    bookingRef: 'SS-261012-7KQ2',
    status: 'BOOKED',
    startAt: '2026-10-12T05:30:00.000Z',
    endAt: '2026-10-12T06:30:00.000Z',
    customer: { id: ids.customer, name: 'Ananya Rao', phone: '+919876543212' },
    staff: { id: ids.ravi, displayName: 'Ravi' },
    services: [
      { serviceId: ids.haircut, name: 'Haircut', durationMin: 45, price: inr(40_000) },
      { serviceId: ids.beardTrim, name: 'Beard Trim', durationMin: 15, price: inr(15_000) },
    ],
    total: inr(55_000),
    source: 'ONLINE',
    payment: { status: 'UNPAID' },
    canCancel: true,
    canReschedule: true,
    canReview: false,
    createdAt: '2026-10-06T09:12:44.000Z',
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Schemas['Review']> = {}): Schemas['Review'] {
  return {
    id: '6712c0f9a1b2c3d4e5f6d001',
    rating: 5,
    comment: 'Best fade in town.',
    customer: { name: 'Ananya' },
    staff: { id: ids.ravi, displayName: 'Ravi' },
    services: [{ id: ids.haircut, name: 'Haircut' }],
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

export function page<T>(data: T[], overrides: Partial<Schemas['PaginationMeta']> = {}) {
  return {
    data,
    meta: { page: 1, pageSize: 20, total: data.length, totalPages: 1, ...overrides },
  };
}

// An unsigned JWT-shaped token carrying claims (the UI reads, never verifies, 06 §1).
export function tokenWith(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}
