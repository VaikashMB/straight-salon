import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { auditRepository } from '../shared/audit/audit.repository.js';
import { createAuditService } from '../shared/audit/audit.service.js';
import { createAccessTokenService, type AccessTokenConfig } from '../shared/auth/accessToken.js';
import type { CookieConfig } from '../shared/auth/cookies.js';
import { createPasswordHasher } from '../shared/auth/password.js';
import { createOutbox } from '../shared/events/outbox.js';
import { outboxRepository } from '../shared/events/outbox.repository.js';
import { byIp, rateLimit } from '../shared/http/rateLimit.js';
import type { Logger } from '../shared/logger/index.js';
import type { Clock } from '../shared/time/clock.js';
import { createAuthController } from './auth/auth.controller.js';
import { authRouter } from './auth/auth.routes.js';
import { createAuthService } from './auth/auth.service.js';
import { createLoginThrottle } from './auth/loginThrottle.js';
import { tokensRepository } from './auth/tokens.repository.js';
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
}

export interface ModulesDeps {
  connection: Connection;
  redis: Pick<Redis, 'eval' | 'get' | 'del'>;
  clock: Clock;
  logger: Logger;
  config: ModulesConfig;
}

// 06 §4: login, register and forgot-password: 10 requests / 15 min / IP, fail closed.
export const AUTH_RATE_LIMIT = { windowMs: 15 * 60_000, max: 10 };

export function buildApiRouter({ connection, redis, clock, logger, config }: ModulesDeps): Router {
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
  return router;
}
