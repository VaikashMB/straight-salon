import { Types, type ClientSession } from 'mongoose';
import type {
  ActiveBookingScope,
  ActiveBookingsGate,
} from '../../src/modules/bookings/bookings.gate.js';
import type { CategoryDoc, ServiceDoc } from '../../src/modules/catalog/catalog.model.js';
import { catalogRepository } from '../../src/modules/catalog/catalog.repository.js';
import type { StaffDoc } from '../../src/modules/staff/staff.model.js';
import { staffRepository } from '../../src/modules/staff/staff.repository.js';
import type { UserDoc } from '../../src/modules/users/users.model.js';
import { bearerFor, createUser } from './auth.js';

// Phase 4 entities written straight to the test database (no audit/outbox rows).

let counter = 0;
const next = () => ++counter;

export async function createCategory(overrides: Partial<CategoryDoc> = {}): Promise<CategoryDoc> {
  const n = next();
  return catalogRepository.createCategory({
    name: overrides.name ?? `Category ${n}`,
    slug: overrides.slug ?? `category-${n}`,
    sortOrder: overrides.sortOrder ?? n,
    ...(overrides.description ? { description: overrides.description } : {}),
  });
}

export async function createService(
  overrides: Partial<Omit<ServiceDoc, 'categoryId'>> & { categoryId?: Types.ObjectId } = {},
): Promise<ServiceDoc> {
  const n = next();
  const categoryId = overrides.categoryId ?? (await createCategory())._id;
  return catalogRepository.createService({
    name: overrides.name ?? `Service ${n}`,
    slug: overrides.slug ?? `service-${n}`,
    categoryId,
    durationMin: overrides.durationMin ?? 30,
    priceMinor: overrides.priceMinor ?? 50_000,
    isActive: overrides.isActive ?? true,
    ...(overrides.description ? { description: overrides.description } : {}),
  });
}

// A STAFF user with a profile, plus a bearer token carrying its staffId (06 §1).
export async function createStylist(
  overrides: { displayName?: string; serviceIds?: Types.ObjectId[]; isActive?: boolean } = {},
): Promise<{ user: UserDoc; staff: StaffDoc; staffId: string; header: string }> {
  const user = await createUser({ role: 'STAFF' });
  let staff = await staffRepository.create({
    userId: user._id,
    displayName: overrides.displayName ?? `Stylist ${next()}`,
    serviceIds: overrides.serviceIds ?? [],
  });
  if (overrides.isActive === false) {
    staff = await staffRepository.update(staff._id, staff.__v, { isActive: false });
  }
  const staffId = staff._id.toHexString();
  return { user, staff, staffId, header: await bearerFor(user, { staffId }) };
}

// Pretends `active` bookings exist in every scope (Phase 5 provides the real gate).
export function fakeBookingsGate(active = 1) {
  const calls: {
    method: 'count' | 'cancel';
    scope: ActiveBookingScope;
    reason?: string;
    inTransaction: boolean;
  }[] = [];
  const gate: ActiveBookingsGate = {
    countActive(scope: ActiveBookingScope, session?: ClientSession) {
      calls.push({ method: 'count', scope, inTransaction: session?.inTransaction() ?? false });
      return Promise.resolve(active);
    },
    cancelActive(scope: ActiveBookingScope, reason: string, session: ClientSession) {
      calls.push({ method: 'cancel', scope, reason, inTransaction: session.inTransaction() });
      return Promise.resolve(active);
    },
  };
  return { gate, calls };
}

export const newId = () => new Types.ObjectId().toHexString();
