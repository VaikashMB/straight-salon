import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { auditRepository } from '../shared/audit/audit.repository.js';
import { createAuditService } from '../shared/audit/audit.service.js';
import { createAccessTokenService, type AccessTokenConfig } from '../shared/auth/accessToken.js';
import type { CookieConfig } from '../shared/auth/cookies.js';
import { createPasswordHasher } from '../shared/auth/password.js';
import { createCache } from '../shared/cache/cache.js';
import { idempotency } from '../shared/http/idempotency.js';
import { createRedisLock, type RedisLock } from '../shared/locks/redisLock.js';
import { createOutbox } from '../shared/events/outbox.js';
import { outboxRepository } from '../shared/events/outbox.repository.js';
import { byIp, byUser, rateLimit } from '../shared/http/rateLimit.js';
import type { Logger } from '../shared/logger/index.js';
import type { Metrics } from '../shared/metrics/index.js';
import type { ObjectStorage } from '../shared/storage/objectStorage.js';
import type { Clock } from '../shared/time/clock.js';
import { createAuthController } from './auth/auth.controller.js';
import { authRouter } from './auth/auth.routes.js';
import { createAuthService } from './auth/auth.service.js';
import { createLoginThrottle } from './auth/loginThrottle.js';
import { tokensRepository } from './auth/tokens.repository.js';
import { createAvailabilityController } from './availability/availability.controller.js';
import { availabilityRouter } from './availability/availability.routes.js';
import { createAvailabilityService } from './availability/availability.service.js';
import type { ActiveBookingsGate } from './bookings/bookings.gate.js';
import { createBookingsController } from './bookings/bookings.controller.js';
import { bookingsRepository } from './bookings/bookings.repository.js';
import { bookingsRouter } from './bookings/bookings.routes.js';
import { createBookingsService } from './bookings/bookings.service.js';
import { createPaymentsController } from './payments/payments.controller.js';
import { paymentsRouter } from './payments/payments.routes.js';
import { createPaymentsService } from './payments/payments.service.js';
import { createCatalogController } from './catalog/catalog.controller.js';
import { catalogRepository } from './catalog/catalog.repository.js';
import { catalogRouter } from './catalog/catalog.routes.js';
import { createCatalogService } from './catalog/catalog.service.js';
import { createHolidaysController } from './holidays/holidays.controller.js';
import { holidaysRepository } from './holidays/holidays.repository.js';
import { holidaysRouter } from './holidays/holidays.routes.js';
import { createHolidaysService } from './holidays/holidays.service.js';
import { createSettingsController } from './settings/settings.controller.js';
import { settingsRepository } from './settings/settings.repository.js';
import { settingsRouter } from './settings/settings.routes.js';
import { createSettingsService } from './settings/settings.service.js';
import { createStaffController } from './staff/staff.controller.js';
import { staffRepository } from './staff/staff.repository.js';
import { staffRouter } from './staff/staff.routes.js';
import { createStaffService } from './staff/staff.service.js';
import { createUsersController } from './users/users.controller.js';
import { usersRouter } from './users/users.routes.js';
import { usersRepository } from './users/users.repository.js';
import { createUsersService } from './users/users.service.js';

// Composition root for business modules: builds services from injected infrastructure and
// returns the /api/v1 router. server.ts passes real clients; tests pass in-memory ones.

export interface ModulesConfig {
  accessToken: AccessTokenConfig;
  refreshTokenTtlDays: number;
  bcryptCost: number;
  cookies: CookieConfig;
  outboxEncryptionKey: string;
  rateLimit: { windowMs: number; max: number };
  cacheEnabled: boolean;
  bookingRateLimit?: { windowMs: number; max: number }; // default 20/hour/user (06 §4)
}

export interface ModulesDeps {
  connection: Connection;
  redis: Pick<Redis, 'eval' | 'get' | 'del' | 'set' | 'smembers' | 'multi'>;
  clock: Clock;
  logger: Logger;
  metrics: Pick<Metrics, 'cacheHits' | 'cacheMisses' | 'cacheErrors'>;
  storage: ObjectStorage;
  config: ModulesConfig;
  // Test seams: replace the active-booking checks (settings/holidays/staff) or the booking lock.
  bookingsGate?: ActiveBookingsGate;
  lock?: RedisLock;
}

export const BOOKING_RATE_LIMIT = { windowMs: 60 * 60_000, max: 20 };

// 06 §4: login, register and forgot-password: 10 requests / 15 min / IP, fail closed.
export const AUTH_RATE_LIMIT = { windowMs: 15 * 60_000, max: 10 };

export function buildApiRouter(deps: ModulesDeps): Router {
  const { connection, redis, clock, logger, config } = deps;
  const cache = createCache({
    redis,
    enabled: config.cacheEnabled,
    logger,
    metrics: deps.metrics,
    clock,
  });
  const audit = createAuditService({ repository: auditRepository, clock });
  const outbox = createOutbox({
    repository: outboxRepository,
    encryptionKey: config.outboxEncryptionKey,
    clock,
  });
  const hasher = createPasswordHasher(config.bcryptCost);
  const accessTokens = createAccessTokenService(config.accessToken, clock);

  const users = createUsersService({
    repository: usersRepository,
    audit,
    outbox,
    hasher,
    connection,
  });
  // Some services need each other (settings <-> catalog, catalog <-> staff, availability <->
  // bookings, and the active-booking gate). The ports below resolve the other service at call
  // time; requests only arrive after every service exists.
  const bookings: ActiveBookingsGate = deps.bookingsGate ?? {
    countActive: (scope, session) => bookingsService.gate.countActive(scope, session),
    cancelActive: (scope, reason, session) =>
      bookingsService.gate.cancelActive(scope, reason, session),
  };
  const settings = createSettingsService({
    repository: settingsRepository,
    audit,
    outbox,
    cache,
    connection,
    clock,
    bookings,
    services: { activeServiceDurations: () => catalog.activeServiceDurations() },
  });
  const catalog = createCatalogService({
    repository: catalogRepository,
    audit,
    outbox,
    cache,
    connection,
    settings,
    stylists: { forService: (serviceId) => staff.stylistsForService(serviceId) },
    storage: deps.storage,
  });
  const holidays = createHolidaysService({
    repository: holidaysRepository,
    audit,
    outbox,
    connection,
    cache,
    settings,
    bookings,
  });
  const staff = createStaffService({
    repository: staffRepository,
    audit,
    outbox,
    cache,
    connection,
    clock,
    settings,
    catalog,
    users,
    bookings,
  });
  const availability = createAvailabilityService({
    cache,
    clock,
    settings,
    holidays,
    staff,
    catalog,
    bookings: {
      activeIntervals: (staffId, from, to) => bookingsService.activeIntervals(staffId, from, to),
    },
  });
  const bookingsService = createBookingsService({
    repository: bookingsRepository,
    auditLog: auditRepository,
    audit,
    outbox,
    cache,
    lock: deps.lock ?? createRedisLock({ redis }),
    connection,
    clock,
    settings,
    availability,
    staff,
    users,
  });
  const payments = createPaymentsService({
    bookings: bookingsService,
    audit,
    outbox,
    connection,
    clock,
  });
  const auth = createAuthService({
    users,
    tokens: tokensRepository,
    accessTokens,
    hasher,
    throttle: createLoginThrottle(redis),
    audit,
    outbox,
    connection,
    clock,
    logger,
    refreshTokenTtlDays: config.refreshTokenTtlDays,
    staffIdFor: (userId) => staff.findIdByUserId(userId),
  });

  const router = Router();
  // Global limit: 300 req/min/IP by default; fails open if Redis is down (08 §5).
  router.use(
    rateLimit({ scope: 'global', ...config.rateLimit, key: byIp, failOpen: true, redis, logger }),
  );
  router.use(
    authRouter({
      controller: createAuthController({ auth, users, cookies: config.cookies, clock }),
      accessTokens,
      authLimiter: rateLimit({
        scope: 'auth',
        ...AUTH_RATE_LIMIT,
        key: byIp,
        failOpen: false,
        redis,
        logger,
      }),
    }),
  );
  router.use(usersRouter({ controller: createUsersController(users), accessTokens }));
  router.use(settingsRouter({ controller: createSettingsController(settings), accessTokens }));
  router.use(holidaysRouter({ controller: createHolidaysController(holidays), accessTokens }));
  router.use(catalogRouter({ controller: createCatalogController(catalog), accessTokens }));
  router.use(staffRouter({ controller: createStaffController(staff), accessTokens }));
  router.use(
    availabilityRouter({ controller: createAvailabilityController(availability), accessTokens }),
  );
  const idempotent = idempotency({ redis, logger });
  router.use(
    bookingsRouter({
      controller: createBookingsController(bookingsService),
      accessTokens,
      idempotency: idempotent,
      // Fails open like the global limit; booking creation fails closed on the lock (08 §5).
      createLimiter: rateLimit({
        scope: 'bookings',
        ...(config.bookingRateLimit ?? BOOKING_RATE_LIMIT),
        key: byUser,
        failOpen: true,
        redis,
        logger,
      }),
    }),
  );
  router.use(
    paymentsRouter({
      controller: createPaymentsController(payments),
      accessTokens,
      idempotency: idempotent,
    }),
  );
  return router;
}
