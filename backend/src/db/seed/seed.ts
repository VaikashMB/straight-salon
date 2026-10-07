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
  const count = (what: string) => {
    created[what] = (created[what] ?? 0) + 1;
  };

  // Settings
  if (!(await settingsRepository.find())) {
    await settingsRepository.save(SETTINGS, null);
    count('settings');
  }
  const settings = (await settingsRepository.find()) ?? { ...SETTINGS };
  const tz = settings.timezone;

  // Users
  const passwordHash = await hasher.hash(SEED_PASSWORD);
  const userIds = new Map<string, Types.ObjectId>();
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

  // Catalogue
  const categoryIds = new Map<string, Types.ObjectId>();
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

  const serviceIds = new Map<string, Types.ObjectId>();
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

  // Staff profiles and schedules
  const staffIds = new Map<string, Types.ObjectId>();
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

    if (!(await staffRepository.findSchedule(existing._id))) {
      const weekly = defaultWeekly(settings).map((day) => ({
        ...day,
        isWorking: day.isWorking && !(member.offOnMonday && day.dayOfWeek === MONDAY),
        breaks: [LUNCH],
      }));
      await staffRepository.saveSchedule(existing._id, weekly);
      count('schedules');
    }
  }

  // One holiday next month (the 15th, salon timezone)
  const today = toZonedDate(clock.now(), tz);
  const holidayDate = `${addDays(`${today.slice(0, 8)}01`, 32).slice(0, 8)}15`;
  if (!(await holidaysRepository.findByDate(holidayDate))) {
    await holidaysRepository.create({ date: holidayDate, name: 'Staff Training Day' });
    count('holidays');
  }

  // A few time-off blocks in the coming week
  const admin = userIds.get('admin')!;
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

  // Bookings over the past 14 days and the next 7, across all statuses, with payments on
  // completed ones (02 §3, Phase 5). One booking per stylist per day, so none overlap.
  if ((await bookingsRepository.search({ skip: 0, limit: 1, sort: { startAt: 1 } })).total === 0) {
    const holidays = new Set(
      (await holidaysRepository.list({ from: addDays(today, -14), to: addDays(today, 7) })).map(
        (h) => h.date,
      ),
    );
    const services = new Map(SERVICES.map((svc) => [svc.slug, svc]));
    const customers = USERS.filter((u) => u.role === 'CUSTOMER').map((u) => userIds.get(u.key)!);
    const reception = userIds.get('reception')!;
    const futureBooked = new Map<string, number>();
    const times = ['10:00', '11:30', '14:30', '16:00', '17:30'];
    const methods: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'UPI', 'CASH', 'OTHER'];
    const now = clock.now();
    let n = 0;

    for (let offset = -14; offset <= 7; offset++) {
      const date = addDays(today, offset);
      if (holidays.has(date)) continue;
      for (const [index, member] of STAFF.entries()) {
        if ((offset + index + 20) % 4 === 0) continue; // about three bookings a day
        if (member.offOnMonday && weekdayOf(date) === MONDAY) continue;
        const staffId = staffIds.get(member.user)!;
        const slug = member.services[(offset + 20 + index) % member.services.length]!;
        const svc = services.get(slug)!;
        const startAt = zonedDateTime(date, times[(offset + 20 + index * 2) % times.length]!, tz);
        const endAt = new Date(startAt.getTime() + svc.durationMin * 60_000);
        const blocks = await staffRepository.listTimeOff(staffId, { from: startAt, to: endAt });
        if (
          blocks.some((b) =>
            overlaps(
              { start: b.startAt.getTime(), end: b.endAt.getTime() },
              { start: startAt.getTime(), end: endAt.getTime() },
            ),
          )
        )
          continue;
        n++;

        const future = endAt.getTime() > now.getTime();
        let status: BookingStatus = 'COMPLETED';
        if (future) status = n % 8 === 0 ? 'CANCELLED' : 'BOOKED';
        else if (n % 9 === 0) status = 'NO_SHOW';
        else if (n % 7 === 0) status = 'CANCELLED';

        // BR-009: at most 3 upcoming BOOKED per customer.
        let customer = customers[n % customers.length]!;
        if (status === 'BOOKED') {
          for (
            let k = 0;
            (futureBooked.get(customer.toHexString()) ?? 0) >= 3 && k < customers.length;
            k++
          ) {
            customer = customers[(n + k + 1) % customers.length]!;
          }
          futureBooked.set(
            customer.toHexString(),
            (futureBooked.get(customer.toHexString()) ?? 0) + 1,
          );
        }
        const source: BookingSource = n % 5 === 0 ? 'WALK_IN' : n % 3 === 0 ? 'PHONE' : 'ONLINE';
        const createdBy = source === 'ONLINE' ? customer : reception;
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
          step('COMPLETED', svc.durationMin);
        }
        if (status === 'NO_SHOW') step('NO_SHOW', 30);
        if (status === 'CANCELLED') step('CANCELLED', -24 * 60);
        const discountMinor = status === 'COMPLETED' && n % 6 === 0 ? 5_000 : 0;

        await bookingsRepository.create({
          bookingRef: makeBookingRef(date),
          customerId: customer,
          staffId,
          services: [
            {
              serviceId: serviceIds.get(slug)!,
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
                  method: methods[n % methods.length]!,
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
        count('bookings');
      }
    }
  }

  // A handful of reviews on recently completed bookings, within the review window (Phase 7).
  if ((await ReviewModel.countDocuments()) === 0) {
    const comments = [
      'Great cut, exactly what I asked for.',
      undefined,
      'Friendly and on time. Will come back.',
      'Good, but the wait was a little long.',
      undefined,
      'Best beard trim in town!',
      'Very relaxing, thank you.',
      undefined,
    ];
    const ratings = [5, 4, 5, 3, 4, 5, 5, 4];
    const windowStart = new Date(clock.now().getTime() - settings.reviewWindowDays * 86_400_000);
    const { data: recent } = await bookingsRepository.search({
      from: windowStart,
      to: clock.now(),
      status: 'COMPLETED',
      skip: 0,
      limit: ratings.length * 2,
      sort: { startAt: -1 },
    });
    // Every other completed booking, so not every visit has a review.
    for (const [i, booking] of recent.filter((_, k) => k % 2 === 0).entries()) {
      const comment = comments[i];
      await ReviewModel.create({
        bookingId: booking._id,
        customerId: booking.customerId,
        staffId: booking.staffId,
        serviceIds: booking.services.map((svc) => svc.serviceId),
        rating: ratings[i]!,
        ...(comment ? { comment } : {}),
        isHidden: false,
      });
      count('reviews');
    }
  }

  log.info(
    { created },
    `Seed complete. Every seeded account uses the password ${SEED_PASSWORD} (e.g. admin@${DOMAIN}).`,
  );
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
