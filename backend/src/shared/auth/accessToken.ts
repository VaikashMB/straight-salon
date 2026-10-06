import { randomUUID } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ROLES, type Role } from '../../config/constants.js';
import { UnauthorizedError } from '../errors/index.js';
import { systemClock, type Clock } from '../time/clock.js';

// Access tokens (06 §1): HS256 JWT, 15 min, no PII. Verified statelessly on every request.

export interface AuthContext {
  userId: string;
  role: Role;
  staffId?: string;
}

export interface AccessTokenConfig {
  secret: string;
  ttl: string; // "15m", "900s", "1h", "1d"
  issuer: string;
  audience: string;
}

export interface AccessTokenService {
  sign(subject: AuthContext): Promise<string>;
  verify(token: string): Promise<AuthContext>;
  ttlSeconds: number;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

export function parseDurationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration "${duration}"`);
  return Number(match[1]) * (UNIT_SECONDS[match[2]!] ?? 1);
}

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export function createAccessTokenService(
  config: AccessTokenConfig,
  clock: Clock = systemClock,
): AccessTokenService {
  const key = new TextEncoder().encode(config.secret);
  const ttlSeconds = parseDurationSeconds(config.ttl);

  return {
    ttlSeconds,

    async sign({ userId, role, staffId }) {
      const issuedAt = Math.floor(clock.now().getTime() / 1000);
      return new SignJWT({ role, ...(staffId ? { staffId } : {}) })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setJti(randomUUID())
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .sign(key);
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: config.issuer,
          audience: config.audience,
          currentDate: clock.now(),
        });
        if (typeof payload.sub !== 'string' || !isRole(payload.role)) {
          throw new UnauthorizedError();
        }
        const context: AuthContext = { userId: payload.sub, role: payload.role };
        if (typeof payload.staffId === 'string') context.staffId = payload.staffId;
        return context;
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw new UnauthorizedError('The access token has expired.', 'TOKEN_EXPIRED');
        }
        if (err instanceof UnauthorizedError) throw err;
        throw new UnauthorizedError('The access token is invalid.');
      }
    },
  };
}
