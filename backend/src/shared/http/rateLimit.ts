import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import { cacheKeys } from '../cache/keys.js';
import { TooManyRequestsError } from '../errors/index.js';
import type { Logger } from '../logger/index.js';

// Fixed-window rate limiter on Redis (06 §4, 08 §5). Shared by all API instances.
// When Redis is unreachable: fail OPEN (allow + warn) for the global limit, fail CLOSED (429)
// for sensitive limits such as login, as 08 §5 requires.

// INCR and set the window on the first hit, atomically; returns [count, remaining ms].
const HIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
return { count, redis.call("PTTL", KEYS[1]) }`;

export interface RateLimitOptions {
  scope: string; // key segment, e.g. "global", "auth"
  windowMs: number;
  max: number;
  key: (req: Request) => string | undefined; // undefined = do not limit this request
  failOpen: boolean;
  redis: Pick<Redis, 'eval'>;
  logger: Logger;
}

const WARN_INTERVAL_MS = 60_000;

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { scope, windowMs, max, redis, logger, failOpen } = options;
  let lastWarnAt = Number.NEGATIVE_INFINITY;

  return async (req, res, next) => {
    const id = options.key(req);
    if (!id) {
      next();
      return;
    }

    let count: number;
    let remainingMs: number;
    try {
      const result = (await redis.eval(
        HIT_SCRIPT,
        1,
        cacheKeys.rateLimit(scope, id),
        windowMs,
      )) as [number, number];
      [count, remainingMs] = result;
    } catch (err) {
      if (Date.now() - lastWarnAt >= WARN_INTERVAL_MS) {
        lastWarnAt = Date.now();
        logger.warn({ err, scope, failOpen }, 'Rate limiter unavailable');
      }
      if (failOpen) {
        next();
      } else {
        next(
          new TooManyRequestsError(
            'This action is temporarily unavailable. Please try again shortly.',
          ),
        );
      }
      return;
    }

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
    if (count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      logger.warn({ scope, limit: max }, 'Rate limit hit');
      next(new TooManyRequestsError());
      return;
    }
    next();
  };
}

export const byIp = (req: Request): string | undefined => req.ip;

// Per-user limits (e.g. POST /bookings 20/hour/user, 06 §4); place after authenticate.
export const byUser = (req: Request): string | undefined => req.auth?.userId;
