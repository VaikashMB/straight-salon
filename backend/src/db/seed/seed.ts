import { Types } from 'mongoose';
import type { BookingSource, BookingStatus, PaymentMethod, Role } from '../../config/constants.js';
import { makeBookingRef } from '../../modules/bookings/bookings.mapper.js';
import type { StatusChange } from '../../modules/bookings/bookings.model.js';
import { bookingsRepository } from '../../modules/bookings/bookings.repository.js';
import { catalogRepository } from '../../modules/catalog/catalog.repository.js';
import { holidaysRepository } from '../../modules/holidays/holidays.repository.js';
import type { ReportsService } from '../../modules/reports/reports.service.js';
import { ReviewModel } from '../../modules/reviews/reviews.model.js';
import type { ReviewsService } from '../../modules/reviews/reviews.service.js';
import { DEFAULT_SETTINGS, type SettingsFields } from '../../modules/settings/settings.model.js';
import { settingsRepository } from '../../modules/settings/settings.repository.js';
import { defaultWeekly } from '../../modules/staff/staff.mapper.js';
import { staffRepository } from '../../modules/staff/staff.repository.js';
import { usersRepository } from '../../modules/users/users.repository.js';
import { createPasswordHasher } from '../../shared/auth/password.js';
import type { Logger } from '../../shared/logger/index.js';
import { systemClock, type Clock } from '../../shared/time/clock.js';
import { overlaps, weekdayOf } from '../../shared/time/slots.js';
import { addDays, toZonedDate, zonedDateTime } from '../../shared/time/tz.js';

// Seed data for local dev and e2e (02 §3). Grows with the build plan: Phase 3 seeded the admin;
// Phase 4 adds settings, users, catalogue, staff, schedules, holidays and time-off; Phase 5
// bookings and payments; Phase 7 reviews. Every step skips records that already exist. The
// derived data (ratings, daily_stats) is then recomputed by seedDerivedData.

export const SEED_PASSWORD = 'Password@123'; // dev/e2e only (02 §3)
const DOMAIN = 'straightsalon.local';

const SETTINGS: SettingsFields = {
  ...DEFAULT_SETTINGS,
  address: '12 MG Road, Bengaluru 560001',
  phone: '+918041234567',
  email: `hello@${DOMAIN}`,
};

interface SeedUser {
  key: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
}

const USERS: SeedUser[] = [
  {
    key: 'admin',
    name: 'Salon Admin',
    email: `admin@${DOMAIN}`,
    phone: '+919000000001',
    role: 'ADMIN',
  },
  {
    key: 'reception',
    name: 'Front Desk',
    email: `reception@${DOMAIN}`,
    phone: '+919000000002',
    role: 'RECEPTIONIST',
  },
  {
    key: 'ravi',
    name: 'Ravi Kumar',
    email: `ravi@${DOMAIN}`,
    phone: '+919000000011',
    role: 'STAFF',
  },
  {
    key: 'priya',
    name: 'Priya Nair',
    email: `priya@${DOMAIN}`,
    phone: '+919000000012',
    role: 'STAFF',
  },
  {
    key: 'arjun',
    name: 'Arjun Mehta',
    email: `arjun@${DOMAIN}`,
    phone: '+919000000013',
    role: 'STAFF',
  },
  {
    key: 'meera',
    name: 'Meera Iyer',
    email: `meera@${DOMAIN}`,
    phone: '+919000000014',
    role: 'STAFF',
  },
  ...[
    'Ananya Rao',
    'Karthik S',
    'Divya Menon',
    'Rohan Gupta',
    'Sneha Pillai',
    'Vikram Joshi',
    'Aisha Khan',
    'Nikhil Reddy',
    'Pooja Sharma',
    'Farhan Ali',
  ].map((name, i) => ({
    key: `customer${i + 1}`,
    name,
    email: `customer${i + 1}@${DOMAIN}`,
    phone: `+9190000001${String(i + 1).padStart(2, '0')}`,
    role: 'CUSTOMER' as const,
  })),
];

const CATEGORIES = [
  { name: 'Hair', description: 'Cuts, colour and treatments', sortOrder: 1 },
  { name: 'Beard & Grooming', description: 'Trims, shaves and styling', sortOrder: 2 },
  { name: 'Skin', description: 'Facials and skin care', sortOrder: 3 },
  { name: 'Nails', description: 'Manicures, pedicures and polish', sortOrder: 4 },
];

// Prices in paise (₹1 = 100). Durations are multiples of 15 min (BR-013).
const SERVICES = [
  {
    slug: 'haircut',
    name: 'Haircut',
    category: 'Hair',
    durationMin: 45,
    priceMinor: 40_000,
    description: 'Consultation, wash, cut and style',
  },
  {
    slug: 'kids-haircut',
    name: 'Kids Haircut',
    category: 'Hair',
    durationMin: 30,
    priceMinor: 25_000,
  },
  {
    slug: 'wash-and-blow-dry',
    name: 'Wash & Blow-dry',
    category: 'Hair',
    durationMin: 30,
    priceMinor: 35_000,
  },
  {
    slug: 'hair-colour-global',
    name: 'Hair Colour (Global)',
    category: 'Hair',
    durationMin: 120,
    priceMinor: 250_000,
  },
  { slug: 'hair-spa', name: 'Hair Spa', category: 'Hair', durationMin: 60, priceMinor: 120_000 },
  {
    slug: 'keratin-smoothing',
    name: 'Keratin Smoothing',
    category: 'Hair',
    durationMin: 120,
    priceMinor: 450_000,
  },
  {
    slug: 'beard-trim',
    name: 'Beard Trim',
    category: 'Beard & Grooming',
    durationMin: 15,
    priceMinor: 15_000,
  },
  {
    slug: 'clean-shave',
    name: 'Clean Shave',
    category: 'Beard & Grooming',
    durationMin: 30,
    priceMinor: 20_000,
  },
  {
    slug: 'beard-styling',
    name: 'Beard Styling',
    category: 'Beard & Grooming',
    durationMin: 30,
    priceMinor: 30_000,
  },
  {
    slug: 'classic-facial',
    name: 'Classic Facial',
    category: 'Skin',
    durationMin: 60,
    priceMinor: 150_000,
  },
  { slug: 'cleanup', name: 'Cleanup', category: 'Skin', durationMin: 45, priceMinor: 80_000 },
  {
    slug: 'de-tan-pack',
    name: 'De-tan Pack',
    category: 'Skin',
    durationMin: 30,
    priceMinor: 60_000,
  },
  { slug: 'manicure', name: 'Manicure', category: 'Nails', durationMin: 45, priceMinor: 70_000 },
  { slug: 'pedicure', name: 'Pedicure', category: 'Nails', durationMin: 60, priceMinor: 90_000 },
  {
    slug: 'gel-polish',
    name: 'Gel Polish',
    category: 'Nails',
    durationMin: 45,
    priceMinor: 100_000,
  },
];

const HAIR = [
  'haircut',
  'kids-haircut',
  'wash-and-blow-dry',
  'hair-colour-global',
  'hair-spa',
  'keratin-smoothing',
];
const BEARD = ['beard-trim', 'clean-shave', 'beard-styling'];
const SKIN = ['classic-facial', 'cleanup', 'de-tan-pack'];
const NAILS = ['manicure', 'pedicure', 'gel-polish'];

const STAFF = [
  {
    user: 'ravi',
    displayName: 'Ravi',
    bio: 'Precision cuts and beard styling, 8 years behind the chair.',
    services: [...HAIR, ...BEARD],
  },
  {
    user: 'priya',
    displayName: 'Priya',
    bio: 'Colour specialist who also loves a good facial.',
    services: [...HAIR, ...SKIN],
  },
  {
    user: 'arjun',
    displayName: 'Arjun',
    bio: 'Classic barbering: fades, shaves and hot towels.',
    services: ['haircut', 'kids-haircut', ...BEARD],
    offOnMonday: true,
  },
  {
    user: 'meera',
    displayName: 'Meera',
    bio: 'Skin and nail care with a calm touch.',
    services: [...SKIN, ...NAILS],
  },
];

const LUNCH = { start: '13:30', end: '14:15' };
const MONDAY = 1;

type SeedService = (typeof SERVICES)[number];
type SeedStaff = (typeof STAFF)[number];
type Ids = Map<string, Types.ObjectId>;
// Tallies what a run created, for the final log line.
type Count = (what: string) => void;

// Bookings (Phase 5): start times cycled per stylist/day, and payment methods per booking.
const SERVICE_BY_SLUG = new Map(SERVICES.map((svc) => [svc.slug, svc]));
const BOOKING_TIMES = ['10:00', '11:30', '14:30', '16:00', '17:30'];
const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'UPI', 'CASH', 'OTHER'];

// Reviews (Phase 7): one rating (and maybe a comment) per reviewed booking, in order.
const REVIEW_COMMENTS = [
  'Great cut, exactly what I asked for.',
  undefined,
  'Friendly and on time. Will come back.',
  'Good, but the wait was a little long.',
  undefined,
  'Best beard trim in town!',
  'Very relaxing, thank you.',
  undefined,
];
const REVIEW_RATINGS = [5, 4, 5, 3, 4, 5, 5, 4];

export async function seedDatabase({
  logger,
  bcryptCost,
  clock = systemClock,
}: {
  logger: Logger;
  bcryptCost: number;
  clock?: Clock;
}): Promise<void> {
  const log = logger.child({ component: 'seed' });
  const hasher = createPasswordHasher(bcryptCost);
  const created: Record<string, number> = {};
  const count: Count = (what) => {
    created[what] = (created[what] ?? 0) + 1;
  };

  const settings = await seedSettings(count);
  const tz = settings.timezone;
  const userIds = await seedUsers(await hasher.hash(SEED_PASSWORD), count);
  const categoryIds = await seedCategories(count);
  const serviceIds = await seedServices(categoryIds, count);
  const staffIds = await seedStaff(settings, userIds, serviceIds, count);
  const today = toZonedDate(clock.now(), tz);
  await seedHoliday(today, count);
  await seedTimeOff(today, tz, staffIds, userIds.get('admin')!, count);
  await seedBookings({ today, tz, clock, userIds, staffIds, serviceIds }, count);
  await seedReviews(settings, clock, count);

  log.info(
    { created },
    `Seed complete. Every seeded account uses the password ${SEED_PASSWORD} (e.g. admin@${DOMAIN}).`,
  );
}

async function seedSettings(count: Count): Promise<SettingsFields> {
  if (!(await settingsRepository.find())) {
    await settingsRepository.save(SETTINGS, null);
    count('settings');
  }
  return (await settingsRepository.find()) ?? { ...SETTINGS };
}

async function seedUsers(passwordHash: string, count: Count): Promise<Ids> {
  const userIds: Ids = new Map();
  for (const user of USERS) {
    let existing = await usersRepository.findByEmail(user.email);
    if (!existing) {
      existing = await usersRepository.create({
        name: user.name,
        email: user.email,
        phone: user.phone,
        passwordHash,
        role: user.role,
        isWalkIn: false,
      });
      count('users');
    }
    userIds.set(user.key, existing._id);
  }
  return userIds;
}

async function seedCategories(count: Count): Promise<Ids> {
  const categoryIds: Ids = new Map();
  for (const [index, category] of CATEGORIES.entries()) {
    let existing = await catalogRepository.findCategoryByName(category.name);
    if (!existing) {
      existing = await catalogRepository.createCategory({
        ...category,
        slug: ['hair', 'beard-grooming', 'skin', 'nails'][index]!,
      });
      count('categories');
    }
    categoryIds.set(category.name, existing._id);
  }
  return categoryIds;
}

async function seedServices(categoryIds: Ids, count: Count): Promise<Ids> {
  const serviceIds: Ids = new Map();
  for (const service of SERVICES) {
    let existing = await catalogRepository.findServiceBySlug(service.slug);
    if (!existing) {
      existing = await catalogRepository.createService({
        name: service.name,
        slug: service.slug,
        categoryId: categoryIds.get(service.category)!,
        durationMin: service.durationMin,
        priceMinor: service.priceMinor,
        isActive: true,
        ...(service.description ? { description: service.description } : {}),
      });
      count('services');
    }
    serviceIds.set(service.slug, existing._id);
  }
  return serviceIds;
}

// Staff profiles, each followed by its weekly schedule.
async function seedStaff(
  settings: SettingsFields,
  userIds: Ids,
  serviceIds: Ids,
  count: Count,
): Promise<Ids> {
  const staffIds: Ids = new Map();
  for (const member of STAFF) {
    const userId = userIds.get(member.user)!;
    let existing = await staffRepository.findByUserId(userId);
    if (!existing) {
      existing = await staffRepository.create({
        userId,
        displayName: member.displayName,
        bio: member.bio,
        serviceIds: member.services.map((slug) => serviceIds.get(slug)!),
      });
      count('staff');
    }
    staffIds.set(member.user, existing._id);
    await seedSchedule(existing._id, member, settings, count);
  }
  return staffIds;
}

async function seedSchedule(
  staffId: Types.ObjectId,
  member: SeedStaff,
  settings: SettingsFields,
  count: Count,
): Promise<void> {
  if (await staffRepository.findSchedule(staffId)) return;
  const weekly = defaultWeekly(settings).map((day) => ({
    ...day,
    isWorking: day.isWorking && !(member.offOnMonday && day.dayOfWeek === MONDAY),
    breaks: [LUNCH],
  }));
  await staffRepository.saveSchedule(staffId, weekly);
  count('schedules');
}

// One holiday next month (the 15th, salon timezone)
async function seedHoliday(today: string, count: Count): Promise<void> {
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const nextMonth = addDays(firstOfMonth, 32).slice(0, 8);
  const holidayDate = `${nextMonth}15`;
  if (!(await holidaysRepository.findByDate(holidayDate))) {
    await holidaysRepository.create({ date: holidayDate, name: 'Staff Training Day' });
    count('holidays');
  }
}

// A few time-off blocks in the coming week
async function seedTimeOff(
  today: string,
  tz: string,
  staffIds: Ids,
  admin: Types.ObjectId,
  count: Count,
): Promise<void> {
  const timeOff = [
    {
      staff: 'priya',
      date: addDays(today, 1),
      start: '14:30',
      end: '16:30',
      reason: 'Doctor appointment',
    },
    {
      staff: 'meera',
      date: addDays(today, 2),
      start: '09:30',
      end: '20:30',
      reason: 'Personal leave',
    },
    {
      staff: 'ravi',
      date: addDays(today, 5),
      start: '10:00',
      end: '12:00',
      reason: 'Product training',
    },
  ];
  for (const block of timeOff) {
    const staffId = staffIds.get(block.staff)!;
    if ((await staffRepository.listTimeOff(staffId, {})).length > 0) continue;
    await staffRepository.createTimeOff({
      staffId,
      startAt: zonedDateTime(block.date, block.start, tz),
      endAt: zonedDateTime(block.date, block.end, tz),
      reason: block.reason,
      createdBy: admin,
    });
    count('timeOff');
  }
}

interface BookingSeedInput {
  today: string;
  tz: string;
  clock: Clock;
  userIds: Ids;
  staffIds: Ids;
  serviceIds: Ids;
}

interface BookingSeedContext {
  tz: string;
  now: Date;
  staffIds: Ids;
  serviceIds: Ids;
  customers: Types.ObjectId[];
  reception: Types.ObjectId;
  futureBooked: Map<string, number>; // upcoming BOOKED per customer (BR-009)
}

interface SeedSlot {
  date: string;
  staffId: Types.ObjectId;
  slug: string;
  svc: SeedService;
  startAt: Date;
  endAt: Date;
}

// Bookings over the past 14 days and the next 7, across all statuses, with payments on
// completed ones (02 §3, Phase 5). One booking per stylist per day, so none overlap.
async function seedBookings(input: BookingSeedInput, count: Count): Promise<void> {
  const { today, userIds } = input;
  if ((await bookingsRepository.search({ skip: 0, limit: 1, sort: { startAt: 1 } })).total !== 0)
    return;
  const holidays = new Set(
    (await holidaysRepository.list({ from: addDays(today, -14), to: addDays(today, 7) })).map(
      (h) => h.date,
    ),
  );
  const ctx: BookingSeedContext = {
    tz: input.tz,
    staffIds: input.staffIds,
    serviceIds: input.serviceIds,
    customers: USERS.filter((u) => u.role === 'CUSTOMER').map((u) => userIds.get(u.key)!),
    reception: userIds.get('reception')!,
    futureBooked: new Map(),
    now: input.clock.now(),
  };
  let n = 0;

  for (let offset = -14; offset <= 7; offset++) {
    const date = addDays(today, offset);
    if (holidays.has(date)) continue;
    for (const [index, member] of STAFF.entries()) {
      const slot = await bookableSlot(ctx, date, offset, index, member);
      if (!slot) continue;
      n++;
      await createSeedBooking(ctx, slot, n);
      count('bookings');
    }
  }
}

// The stylist's booking on `date`, or null on a day off or when it would hit their time-off.
async function bookableSlot(
  ctx: BookingSeedContext,
  date: string,
  offset: number,
  index: number,
  member: SeedStaff,
): Promise<SeedSlot | null> {
  if ((offset + index + 20) % 4 === 0) return null; // about three bookings a day
  if (member.offOnMonday && weekdayOf(date) === MONDAY) return null;
  const staffId = ctx.staffIds.get(member.user)!;
  const slug = member.services[(offset + 20 + index) % member.services.length]!;
  const svc = SERVICE_BY_SLUG.get(slug)!;
  const time = BOOKING_TIMES[(offset + 20 + index * 2) % BOOKING_TIMES.length]!;
  const startAt = zonedDateTime(date, time, ctx.tz);
  const endAt = new Date(startAt.getTime() + svc.durationMin * 60_000);
  const blocks = await staffRepository.listTimeOff(staffId, { from: startAt, to: endAt });
  const blocked = blocks.some((b) =>
    overlaps(
      { start: b.startAt.getTime(), end: b.endAt.getTime() },
      { start: startAt.getTime(), end: endAt.getTime() },
    ),
  );
  return blocked ? null : { date, staffId, slug, svc, startAt, endAt };
}

// The n-th seeded booking: its status, customer, source, history and payment all follow from n.
async function createSeedBooking(
  ctx: BookingSeedContext,
  slot: SeedSlot,
  n: number,
): Promise<void> {
  const { date, staffId, slug, svc, startAt, endAt } = slot;
  const { reception } = ctx;
  const status = seedStatus(n, endAt.getTime() > ctx.now.getTime());
  const customer =
    status === 'BOOKED' ? reserveCustomer(ctx, n) : ctx.customers[n % ctx.customers.length]!;
  const source = seedSource(n);
  const createdBy = source === 'ONLINE' ? customer : reception;
  const history = seedHistory(status, startAt, svc.durationMin, createdBy, reception);
  const discountMinor = status === 'COMPLETED' && n % 6 === 0 ? 5_000 : 0;

  await bookingsRepository.create({
    bookingRef: makeBookingRef(date),
    customerId: customer,
    staffId,
    services: [
      {
        serviceId: ctx.serviceIds.get(slug)!,
        name: svc.name,
        durationMin: svc.durationMin,
        priceMinor: svc.priceMinor,
      },
    ],
    startAt,
    endAt,
    blockedUntil: endAt, // bufferMin is 0 in the seeded settings
    totalDurationMin: svc.durationMin,
    totalPriceMinor: svc.priceMinor,
    status,
    statusHistory: history,
    source,
    payment:
      status === 'COMPLETED'
        ? {
            status: 'PAID',
            method: PAYMENT_METHODS[n % PAYMENT_METHODS.length]!,
            amountPaidMinor: svc.priceMinor - discountMinor,
            discountMinor,
            ...(discountMinor > 0 ? { discountReason: 'Loyalty discount' } : {}),
            recordedBy: reception,
            recordedAt: endAt,
          }
        : { status: 'UNPAID' },
    reminders: {},
    createdBy,
    ...(status === 'CANCELLED'
      ? {
          cancellation: {
            at: history.at(-1)!.at,
            by: customer.toHexString(),
            reason: 'Plans changed',
            overridden: false,
          },
        }
      : {}),
  });
}

function seedStatus(n: number, future: boolean): BookingStatus {
  if (future) return n % 8 === 0 ? 'CANCELLED' : 'BOOKED';
  if (n % 9 === 0) return 'NO_SHOW';
  if (n % 7 === 0) return 'CANCELLED';
  return 'COMPLETED';
}

function seedSource(n: number): BookingSource {
  if (n % 5 === 0) return 'WALK_IN';
  return n % 3 === 0 ? 'PHONE' : 'ONLINE';
}

// BR-009: at most 3 upcoming BOOKED per customer; moves on to the next customer with room.
function reserveCustomer(ctx: BookingSeedContext, n: number): Types.ObjectId {
  const { customers, futureBooked } = ctx;
  let customer = customers[n % customers.length]!;
  for (
    let k = 0;
    (futureBooked.get(customer.toHexString()) ?? 0) >= 3 && k < customers.length;
    k++
  ) {
    customer = customers[(n + k + 1) % customers.length]!;
  }
  futureBooked.set(customer.toHexString(), (futureBooked.get(customer.toHexString()) ?? 0) + 1);
  return customer;
}

function seedHistory(
  status: BookingStatus,
  startAt: Date,
  durationMin: number,
  createdBy: Types.ObjectId,
  reception: Types.ObjectId,
): StatusChange[] {
  const createdAt = new Date(startAt.getTime() - 2 * 86_400_000);
  const history: StatusChange[] = [
    { status: 'BOOKED', at: createdAt, by: createdBy.toHexString() },
  ];
  const step = (st: BookingStatus, minutes: number) =>
    history.push({
      status: st,
      at: new Date(startAt.getTime() + minutes * 60_000),
      by: reception.toHexString(),
    });
  if (status === 'COMPLETED') {
    step('CHECKED_IN', -5);
    step('IN_SERVICE', 0);
    step('COMPLETED', durationMin);
  }
  if (status === 'NO_SHOW') step('NO_SHOW', 30);
  if (status === 'CANCELLED') step('CANCELLED', -24 * 60);
  return history;
}

// A handful of reviews on recently completed bookings, within the review window (Phase 7).
async function seedReviews(settings: SettingsFields, clock: Clock, count: Count): Promise<void> {
  if ((await ReviewModel.countDocuments()) !== 0) return;
  const windowStart = new Date(clock.now().getTime() - settings.reviewWindowDays * 86_400_000);
  const { data: recent } = await bookingsRepository.search({
    from: windowStart,
    to: clock.now(),
    status: 'COMPLETED',
    skip: 0,
    limit: REVIEW_RATINGS.length * 2,
    sort: { startAt: -1 },
  });
  // Every other completed booking, so not every visit has a review.
  for (const [i, booking] of recent.filter((_, k) => k % 2 === 0).entries()) {
    const comment = REVIEW_COMMENTS[i];
    await ReviewModel.create({
      bookingId: booking._id,
      customerId: booking.customerId,
      staffId: booking.staffId,
      serviceIds: booking.services.map((svc) => svc.serviceId),
      rating: REVIEW_RATINGS[i]!,
      ...(comment ? { comment } : {}),
      isHidden: false,
    });
    count('reviews');
  }
}

export const SEED_STAFF_EMAILS = STAFF.map((s) => `${s.user}@${DOMAIN}`);
export const SEED_SERVICE_COUNT = SERVICES.length;
export const SEED_CUSTOMER_COUNT = USERS.filter((u) => u.role === 'CUSTOMER').length;

// Ratings (FR-061) and daily_stats (02 §2.17) derive from the seeded reviews and bookings, which
// were written directly (no events), so they are recomputed through the services here.
export async function seedDerivedData(
  services: {
    reviews: Pick<ReviewsService, 'refreshAllRatings'>;
    reports: Pick<ReportsService, 'rebuildAll'>;
  },
  logger: Logger,
): Promise<void> {
  const ratings = await services.reviews.refreshAllRatings();
  const stats = await services.reports.rebuildAll();
  logger.child({ component: 'seed' }).info({ ratings, stats }, 'Derived data recomputed');
}
