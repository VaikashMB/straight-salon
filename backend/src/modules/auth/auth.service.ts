import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Connection, Types } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import type { PasswordHasher } from '../../shared/auth/password.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { AppError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import type { Logger } from '../../shared/logger/index.js';
import type { Clock } from '../../shared/time/clock.js';
import { toUserDto } from '../users/users.mapper.js';
import type { UserDoc } from '../users/users.model.js';
import type { UserDto } from '../users/users.schemas.js';
import type { RegisterInput, UsersService } from '../users/users.service.js';
import type { LoginThrottle } from './loginThrottle.js';
import type { TokensRepository } from './tokens.repository.js';

// Authentication flows (06 §1–2). Refresh tokens are opaque 256-bit random strings; only their
// SHA-256 hash is stored. Every login starts a token "family"; rotation keeps the family, and
// presenting an already-rotated token revokes the whole family (stolen-token mitigation).

export const RESET_TOKEN_TTL_MS = 30 * 60_000; // FR-004

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface SessionResult {
  user: UserDto;
  accessToken: string;
  refresh: IssuedRefreshToken;
}

export interface AuthService {
  register(input: RegisterInput, meta: ClientMeta): Promise<SessionResult>;
  login(email: string, password: string, meta: ClientMeta): Promise<SessionResult>;
  refresh(
    refreshToken: string | undefined,
    meta: ClientMeta,
  ): Promise<{ accessToken: string; refresh: IssuedRefreshToken }>;
  logout(refreshToken: string | undefined): Promise<void>;
  logoutAll(userId: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: ClientMeta,
  ): Promise<IssuedRefreshToken>;
  // HTTP Basic login for ops pages (Bull Board, 09 §5): an active ADMIN's email and password.
  // Same timing, lockout and failure audit as login; issues no session.
  verifyAdmin(email: string, password: string): Promise<boolean>;
}

export interface AuthServiceDeps {
  users: UsersService;
  tokens: TokensRepository;
  accessTokens: AccessTokenService;
  hasher: PasswordHasher;
  throttle: LoginThrottle;
  audit: AuditService;
  outbox: Outbox;
  connection: Connection;
  clock: Clock;
  logger: Logger;
  refreshTokenTtlDays: number;
  // STAFF tokens carry staffId (06 §1) for "own profile" checks; implemented by the staff module.
  staffIdFor?: (userId: string) => Promise<string | undefined>;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newOpaqueToken = (): string => randomBytes(32).toString('base64url');

const invalidCredentials = () => new UnauthorizedError('Invalid email or password.');
const invalidRefresh = () => new UnauthorizedError('Your session has ended. Please log in again.');

// Audit `reason` for a failed login (metadata only; the caller always sees the same error).
function loginFailureReason(user: UserDoc | null): string {
  if (!user) return 'unknown_email';
  return user.isActive ? 'bad_password' : 'inactive';
}

// Same for the queues-board admin check, which also rejects non-admin accounts.
function adminFailureReason(user: UserDoc | null): string {
  if (!user) return 'unknown_email';
  if (!user.isActive) return 'inactive';
  return user.role === 'ADMIN' ? 'bad_password' : 'not_admin';
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const {
    users,
    tokens,
    accessTokens,
    hasher,
    throttle,
    audit,
    outbox,
    connection,
    clock,
    refreshTokenTtlDays,
    staffIdFor,
  } = deps;
  const log = deps.logger.child({ module: 'auth' });

  async function issueRefresh(
    userId: Types.ObjectId,
    family: string,
    meta: ClientMeta,
  ): Promise<IssuedRefreshToken> {
    const token = newOpaqueToken();
    const expiresAt = new Date(clock.now().getTime() + refreshTokenTtlDays * 86_400_000);
    await tokens.createRefresh({
      userId,
      tokenHash: sha256(token),
      family,
      expiresAt,
      ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 512) } : {}),
      ...(meta.ip ? { ip: meta.ip } : {}),
    });
    return { token, expiresAt };
  }

  // Role and staffId are read fresh at every login/refresh, so changes reach the token there.
  async function signAccess(user: UserDoc): Promise<string> {
    const userId = user._id.toHexString();
    const staffId = user.role === 'STAFF' && staffIdFor ? await staffIdFor(userId) : undefined;
    return accessTokens.sign({ userId, role: user.role, ...(staffId ? { staffId } : {}) });
  }

  async function startSession(user: UserDoc, meta: ClientMeta): Promise<SessionResult> {
    const accessToken = await signAccess(user);
    const refresh = await issueRefresh(user._id, randomUUID(), meta);
    return { user: toUserDto(user), accessToken, refresh };
  }

  const actorOf = (user: { _id: Types.ObjectId; role: string }) => ({
    id: user._id.toHexString(),
    role: user.role,
  });

  return {
    async register(input, meta) {
      const user = await users.registerCustomer(input);
      return startSession(user, meta);
    },

    async login(email, password, meta) {
      await throttle.assertNotLocked(email);
      const user = await users.findForLogin(email);
      const usable = user?.isActive ? user.passwordHash : undefined;
      // Always run bcrypt (dummy hash when there is no usable account): same timing either way.
      const valid = await hasher.verify(password, usable);
      if (!user || !valid) {
        await throttle.recordFailure(email);
        await audit.record({
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user?._id.toHexString() ?? 'unknown',
          metadata: {
            reason: loginFailureReason(user),
          },
          ...(user ? { actor: actorOf(user) } : {}),
        });
        throw invalidCredentials();
      }
      await throttle.reset(email);
      const now = clock.now();
      await users.recordLogin(user._id, now);
      await audit.record({
        action: 'auth.login',
        entityType: 'user',
        entityId: user._id.toHexString(),
        actor: actorOf(user),
      });
      return startSession({ ...user, lastLoginAt: now }, meta);
    },

    async verifyAdmin(email, password) {
      await throttle.assertNotLocked(email);
      const user = await users.findForLogin(email);
      const usable = user?.isActive && user.role === 'ADMIN' ? user.passwordHash : undefined;
      const valid = await hasher.verify(password, usable);
      if (user && valid) {
        await throttle.reset(email);
        return true;
      }
      await throttle.recordFailure(email);
      await audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?._id.toHexString() ?? 'unknown',
        metadata: {
          channel: 'queues-board',
          reason: adminFailureReason(user),
        },
        ...(user ? { actor: actorOf(user) } : {}),
      });
      return false;
    },

    async refresh(refreshToken, meta) {
      if (!refreshToken) throw invalidRefresh();
      const now = clock.now();
      const hash = sha256(refreshToken);
      const record = await tokens.findRefreshByHash(hash);
      if (!record || record.expiresAt <= now) throw invalidRefresh();

      const reuse = async () => {
        await tokens.revokeFamily(record.family, now);
        await audit.record({
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: record.userId.toHexString(),
          actor: { id: record.userId.toHexString(), role: 'UNKNOWN' },
          metadata: { family: record.family },
        });
        log.warn(
          { userId: record.userId.toHexString() },
          'Refresh token reuse detected; session family revoked',
        );
        return invalidRefresh();
      };
      if (record.revokedAt) throw await reuse();

      const user = await users.findActiveById(record.userId.toHexString());
      if (!user || (user.passwordChangedAt && user.passwordChangedAt > record.createdAt)) {
        await tokens.revokeRefresh(hash, now);
        throw invalidRefresh();
      }

      const next = newOpaqueToken();
      const rotated = await tokens.rotateRefresh(hash, sha256(next), now);
      if (!rotated) throw await reuse(); // lost a race with another refresh of the same token

      const expiresAt = new Date(now.getTime() + refreshTokenTtlDays * 86_400_000);
      await tokens.createRefresh({
        userId: user._id,
        tokenHash: sha256(next),
        family: record.family,
        expiresAt,
        ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 512) } : {}),
        ...(meta.ip ? { ip: meta.ip } : {}),
      });
      const accessToken = await signAccess(user);
      return { accessToken, refresh: { token: next, expiresAt } };
    },

    async logout(refreshToken) {
      if (!refreshToken) return;
      const revoked = await tokens.revokeRefresh(sha256(refreshToken), clock.now());
      if (revoked) {
        await audit.record({
          action: 'auth.logout',
          entityType: 'user',
          entityId: revoked.userId.toHexString(),
          actor: { id: revoked.userId.toHexString(), role: 'UNKNOWN' },
        });
      }
    },

    async logoutAll(userId) {
      const user = await users.findWithPassword(userId);
      if (!user) throw new UnauthorizedError();
      const count = await tokens.revokeAllForUser(user._id, clock.now());
      await audit.record({
        action: 'auth.logout_all',
        entityType: 'user',
        entityId: userId,
        metadata: { sessions: count },
      });
    },

    async forgotPassword(email) {
      const user = await users.findForLogin(email);
      // Same 202 whether or not the account exists (no user enumeration, API-006).
      if (!user?.isActive || !user.passwordHash) return;
      const token = newOpaqueToken();
      await withTransaction(connection, async (session) => {
        await tokens.deleteUnusedResets(user._id, session);
        await tokens.createReset(
          {
            userId: user._id,
            tokenHash: sha256(token),
            expiresAt: new Date(clock.now().getTime() + RESET_TOKEN_TTL_MS),
          },
          session,
        );
        // EVT-002: the raw token travels encrypted to the email consumer only (09 §7).
        await outbox.add(session, {
          type: 'user.password_reset_requested',
          aggregateType: 'user',
          aggregateId: user._id.toHexString(),
          payload: { userId: user._id.toHexString() },
          secret: token,
          actor: actorOf(user),
        });
      });
    },

    async resetPassword(token, newPassword) {
      const passwordHash = await hasher.hash(newPassword);
      const now = clock.now();
      await withTransaction(connection, async (session) => {
        const reset = await tokens.consumeReset(sha256(token), now, session);
        if (!reset) {
          throw new AppError(
            400,
            'INVALID_RESET_TOKEN',
            'This reset link is invalid or has expired. Request a new one.',
          );
        }
        await users.setPassword(reset.userId, passwordHash, now, session);
        await tokens.revokeAllForUser(reset.userId, now, session);
        await audit.record(
          {
            action: 'auth.password_reset',
            entityType: 'user',
            entityId: reset.userId.toHexString(),
            actor: { id: reset.userId.toHexString(), role: 'UNKNOWN' },
          },
          session,
        );
      });
    },

    async changePassword(userId, currentPassword, newPassword, meta) {
      const user = await users.findWithPassword(userId);
      if (!user?.isActive) throw new UnauthorizedError();
      if (!(await hasher.verify(currentPassword, user.passwordHash))) {
        throw new ValidationError('The request is invalid.', [
          { path: 'currentPassword', message: 'Incorrect password' },
        ]);
      }
      const passwordHash = await hasher.hash(newPassword);
      const now = clock.now();
      await withTransaction(connection, async (session) => {
        await users.setPassword(user._id, passwordHash, now, session);
        await tokens.revokeAllForUser(user._id, now, session);
        await audit.record(
          { action: 'auth.password_changed', entityType: 'user', entityId: userId },
          session,
        );
      });
      // Every other session ends; this device gets a fresh family (decision recorded in 06 §2).
      return issueRefresh(user._id, randomUUID(), meta);
    },
  };
}
